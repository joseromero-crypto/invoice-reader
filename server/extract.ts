import Anthropic from '@anthropic-ai/sdk';
import {createHash} from 'node:crypto';
import {invoiceRequest,prepareInvoiceImage} from './invoice-request';
import {buildInvoiceRows} from './match-extraction';
import {documentWarnings} from '../shared/receiving-policy';
import {invoiceOutputEvidence,readInvoiceOutput} from './invoice-output';
import {asProduct,catalog} from './workspace';
import {requireHub} from './hubs';
import {extractionFailure,type ExtractionStage} from './extraction-failure';
import {limits} from './config';
import {authorize,check,HttpError} from './auth';
export async function extractJob(request:Request,jobId:string){
 const {db,orgId,userId}=await authorize(request);
 const job=check(await db.from('extraction_jobs').select('*').eq('id',jobId).eq('org_id',orgId).maybeSingle());if(!job||job.requested_by!==userId)throw new HttpError(404,'Job not found');
 const document=check(await db.from('documents').select('*').eq('id',job.document_id).eq('org_id',orgId).single())!;
 const receiving=check(await db.from('receiving_sessions').select('hub_id').eq('org_id',orgId).eq('id',document.session_id).single())!;
 await requireHub(db,orgId,userId,receiving.hub_id);
 const pages=check(await db.from('source_pages').select('*').eq('document_id',document.id).eq('org_id',orgId).order('page_number'))!;
 const model=process.env.ANTHROPIC_MODEL;if(!model||!process.env.ANTHROPIC_API_KEY)throw new HttpError(503,'Anthropic configuration missing');
 let claimed:any;try{claimed=check(await db.rpc('claim_extraction',{p_job:job.id,p_actor:userId,p_limit:null}));}catch(e){await db.from('extraction_jobs').update({status:'failed',error:'Extraction reservation rejected.'}).eq('id',job.id).eq('org_id',orgId).eq('status','queued');throw e;}if(!claimed)return;
 const started=Date.now();let paidStarted=false;let stage:ExtractionStage='image_validation';
 let received:{model:string;usage:Anthropic.Message['usage'];output:ReturnType<typeof invoiceOutputEvidence>}|undefined;
 let validated:ReturnType<typeof readInvoiceOutput>|undefined;
 try{
 if(!pages.length||pages.length>limits().maxPages)throw Error('Invalid page count');
 const images:Anthropic.ImageBlockParam[]=[];
 for(const page of pages){if(!page.object_path.startsWith(`${orgId}/${document.id}/`))throw Error('Invalid object ownership');
 const blob=check(await db.storage.from('invoices').download(page.object_path))!;if(blob.size>limits().maxUploadBytes)throw Error('Image too large');
 const buffer=Buffer.from(await blob.arrayBuffer());if(createHash('sha256').update(buffer).digest('hex')!==page.content_hash)throw Error('Content hash mismatch');
 images.push(await prepareInvoiceImage(buffer));
 }
 const anthropic=new Anthropic({apiKey:process.env.ANTHROPIC_API_KEY,maxRetries:0,timeout:pages.length>=3?300000:180000});
 const reservation=check(await db.from('extraction_jobs').select('status,claim_token,lease_until').eq('org_id',orgId).eq('id',job.id).single())!;
 const membership=check(await db.from('members').select('user_id').eq('org_id',orgId).eq('user_id',userId).maybeSingle());
 if(!membership||reservation.status!=='processing'||reservation.claim_token!==claimed.claim_token||new Date(reservation.lease_until)<new Date())throw Error('Job reservation expired');
 const requestBody=invoiceRequest(model,images);
 stage='anthropic_request';paidStarted=true;
 const response=await anthropic.messages.create(requestBody);
 received={model:response.model,usage:response.usage,output:invoiceOutputEvidence(response)};stage='structured_output';
 const extraction=readInvoiceOutput(response);validated=extraction;
 if(new Set(extraction.rows.map(r=>r.sourceRow)).size!==extraction.rows.length)throw Error('Duplicate source row references');
 if(extraction.rows.some(r=>r.sourcePage>pages.length))throw Error('Invalid source page reference');
 extraction.warnings=documentWarnings(extraction.warnings);
 if(extraction.reference&&extraction.supplier){const duplicates=check(await db.from('documents').select('id,receiving_sessions!inner(hub_id)').eq('org_id',orgId).eq('receiving_sessions.hub_id',receiving.hub_id).eq('supplier',extraction.supplier).eq('reference',extraction.reference).neq('id',document.id))!;if(duplicates.length)extraction.warnings.push('Posible factura duplicada: proveedor y referencia ya registrados.');}
 stage='catalog_matching';
 const rawProducts=await catalog(db,orgId),products=rawProducts.map(asProduct);
 const mappings=check(await db.from('supplier_mappings').select('*').eq('org_id',orgId))!;
 const rules=check(await db.from('quantity_conversions').select('*').eq('org_id',orgId))!;
 const rows=buildInvoiceRows(extraction,products,rawProducts,mappings,rules);
 const inputPrice=Number(process.env.AI_INPUT_USD_PER_MILLION),outputPrice=Number(process.env.AI_OUTPUT_USD_PER_MILLION);
 const cost=process.env.AI_INPUT_USD_PER_MILLION&&process.env.AI_OUTPUT_USD_PER_MILLION?(response.usage.input_tokens*inputPrice+response.usage.output_tokens*outputPrice)/1e6:null;
 stage='persist_result';
 check(await db.rpc('finish_extraction',{p_job:job.id,p_actor:userId,p_raw:extraction,p_rows:rows,p_usage:response.usage,p_model:response.model,p_duration:Date.now()-started,p_cost:cost,p_token:claimed.claim_token}))!;
 }catch(e){
 // No automatic paid retry. An interrupted request may have been billed.
 const diagnostic=extractionFailure(e,paidStarted,stage);
 // Retain usage and private output text after a paid response. Exclude raw errors, headers, thinking and signatures.
 await db.from('extraction_jobs').update({...diagnostic,...(received?{model:received.model,usage:received.usage,raw_result:validated??{unparsedOutput:received.output},error:diagnostic.error+(received.output.stopReason==='max_tokens'?' Output token limit reached.':'')}:{}),duration_ms:Date.now()-started,updated_at:new Date().toISOString()}).eq('org_id',orgId).eq('id',job.id).eq('status','processing').eq('claim_token',claimed.claim_token);
 throw e;
 }
}
