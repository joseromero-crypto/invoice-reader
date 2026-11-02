import Anthropic from '@anthropic-ai/sdk';
import {prepareColumnsInvoicePage,type BasicImageDiagnosis} from './invoice-image';
import {columnsV3InvoiceRequest} from './invoice-basic-columns-v3';
import {createHash} from 'node:crypto';
import {invoiceImageSizes} from './invoice-request';
import {buildInvoiceRows} from './match-extraction';
import {documentWarnings} from '../shared/receiving-policy';
import {invoiceOutputEvidence,readInvoiceOutput} from './invoice-output';
import {asProduct,catalog} from './workspace';
import {requireHub} from './hubs';
import {extractionFailure,type ExtractionStage} from './extraction-failure';
import {invoiceSpendPreflight,priorDocumentSpend,reserveDocumentCall,reconcileDocumentCall,documentEstimatedCost,InvoiceBudgetError,type DocumentSpend} from './invoice-spend';
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
 // The local cheaper-model benchmark found unsafe loop confirmations. Keep
 // the diagnostic reader available, but do not silently promote it to receiving.
 if(/^claude-haiku-5-5(?:-\d{8})?$/.test(model))throw new HttpError(503,'El lector Haiku no superó la validación de anotaciones. No se realizará una lectura pagada.');
 if(!/^claude-sonnet-5-5(?:-\d{8})?$/.test(model))throw new HttpError(503,'La lectura básica requiere Sonnet 5.5 con precio y capacidades verificados.');
 // Never assume a pre-policy interrupted/historical attempt was free.
 let spend:DocumentSpend;try{spend=priorDocumentSpend(job.usage,job.attempts);}catch(e){throw new HttpError(409,e instanceof InvoiceBudgetError?e.message:'Invoice spend history unavailable');}
 let claimed:any;try{claimed=check(await db.rpc('claim_extraction',{p_job:job.id,p_actor:userId,p_limit:null}));}catch(e){await db.from('extraction_jobs').update({status:'failed',error:'Extraction reservation rejected.'}).eq('id',job.id).eq('org_id',orgId).eq('status','queued');throw e;}if(!claimed)return;
 // Use the locked claim's history, not the earlier read, for admission.
 try{spend=priorDocumentSpend(claimed.usage,claimed.attempts-1);}catch(e){
  await db.from('extraction_jobs').update({status:'failed',error:'Invoice spend history requires manual review.'}).eq('org_id',orgId).eq('id',job.id).eq('status','processing').eq('claim_token',claimed.claim_token);
  throw e;
 }
 const imagePlans:BasicImageDiagnosis[]=[];
 const started=Date.now();let paidStarted=false;let stage:ExtractionStage='image_validation';
 let received:{model:string;usage:Anthropic.Message['usage'];output:ReturnType<typeof invoiceOutputEvidence>}|undefined;
 let validated:ReturnType<typeof readInvoiceOutput>|undefined;
 try{
 if(!pages.length||pages.length>limits().maxPages)throw Error('Invalid page count');
 const images:Anthropic.ImageBlockParam[]=[];
 for(const page of pages){if(!page.object_path.startsWith(`${orgId}/${document.id}/`))throw Error('Invalid object ownership');
 const blob=check(await db.storage.from('invoices').download(page.object_path))!;if(blob.size>limits().maxUploadBytes)throw Error('Image too large');
 const buffer=Buffer.from(await blob.arrayBuffer());if(createHash('sha256').update(buffer).digest('hex')!==page.content_hash)throw Error('Content hash mismatch');
 const prepared=await prepareColumnsInvoicePage(buffer,model,page.page_number);
 images.push(...prepared.images);imagePlans.push(prepared.diagnosis);
 }
 const anthropic=new Anthropic({apiKey:process.env.ANTHROPIC_API_KEY,maxRetries:0,timeout:pages.length>=3?300000:180000});
 const reservation=check(await db.from('extraction_jobs').select('status,claim_token,lease_until').eq('org_id',orgId).eq('id',job.id).single())!;
 const membership=check(await db.from('members').select('user_id').eq('org_id',orgId).eq('user_id',userId).maybeSingle());
 if(!membership||reservation.status!=='processing'||reservation.claim_token!==claimed.claim_token||new Date(reservation.lease_until)<new Date())throw Error('Job reservation expired');
 const requestBody=columnsV3InvoiceRequest(model,images,invoiceImageSizes(images),pages.length);
 requestBody.service_tier='standard_only';
 stage='spend_preflight';
 const allowance=await invoiceSpendPreflight(anthropic,requestBody,spend,pages.length);
 spend=reserveDocumentCall(spend,claimed.attempts,allowance);
 // Persist BEFORE dispatch. A crash/timeout retains the reservation. The same
 // claim token, active lease and membership still fence this paid call.
 const reserved=check(await db.from('extraction_jobs').update({usage:{documentSpend:spend,imagePlans}}).eq('org_id',orgId).eq('id',job.id).eq('status','processing').eq('claim_token',claimed.claim_token).gt('lease_until',new Date().toISOString()).select('id').maybeSingle());
 const activeMember=check(await db.from('members').select('user_id').eq('org_id',orgId).eq('user_id',userId).maybeSingle());
 if(!reserved||!activeMember)throw Error('Job reservation expired');
 stage='anthropic_request';paidStarted=true;
 const response=await anthropic.messages.create(requestBody);
 received={model:response.model,usage:response.usage,output:invoiceOutputEvidence(response)};
 reconcileDocumentCall(spend,response.usage,response.model);stage='structured_output';
 const extraction=readInvoiceOutput(response,invoiceImageSizes(images),'basic-v3');validated=extraction;
 if(new Set(extraction.rows.map(r=>r.sourceRow)).size!==extraction.rows.length)throw Error('Duplicate source row references');
 if(extraction.rows.some(r=>r.sourcePage>pages.length))throw Error('Invalid source page reference');
 extraction.warnings=documentWarnings(extraction.warnings);
 if(extraction.reference&&extraction.supplier){const duplicates=check(await db.from('documents').select('id,receiving_sessions!inner(hub_id)').eq('org_id',orgId).eq('receiving_sessions.hub_id',receiving.hub_id).eq('supplier',extraction.supplier).eq('reference',extraction.reference).neq('id',document.id))!;if(duplicates.length)extraction.warnings.push('Posible factura duplicada: proveedor y referencia ya registrados.');}
 stage='catalog_matching';
 const rawProducts=await catalog(db,orgId),products=rawProducts.map(asProduct);
 const mappings=check(await db.from('supplier_mappings').select('*').eq('org_id',orgId))!;
 const rules=check(await db.from('quantity_conversions').select('*').eq('org_id',orgId))!;
 const rows=buildInvoiceRows(extraction,products,rawProducts,mappings,rules);
 const cost=documentEstimatedCost(spend);
 stage='persist_result';
 check(await db.rpc('finish_extraction',{p_job:job.id,p_actor:userId,p_raw:extraction,p_rows:rows,p_usage:{...response.usage,documentSpend:spend,imagePlans},p_model:response.model,p_duration:Date.now()-started,p_cost:cost,p_token:claimed.claim_token}))!;
 }catch(e){
 // No automatic paid retry. An interrupted request may have been billed.
 const diagnostic=extractionFailure(e,paidStarted,stage);
 // Retain usage and private output text after a paid response. Exclude raw errors, headers, thinking and signatures.
 await db.from('extraction_jobs').update({...diagnostic,usage:{documentSpend:spend,imagePlans},estimated_cost_usd:documentEstimatedCost(spend),...(e instanceof InvoiceBudgetError?{error:e.message}:{}),...(received?{model:received.model,usage:{...received.usage,documentSpend:spend,imagePlans},estimated_cost_usd:documentEstimatedCost(spend),raw_result:validated??{unparsedOutput:received.output},error:diagnostic.error+(received.output.stopReason==='max_tokens'?' Output token limit reached.':'')}:{}),duration_ms:Date.now()-started,updated_at:new Date().toISOString()}).eq('org_id',orgId).eq('id',job.id).eq('status','processing').eq('claim_token',claimed.claim_token);
 throw e;
 }
}
