import {createHash} from 'node:crypto';
import {transcribe,type ImageInput,type ReadResult} from '../lean/transcribe.ts';
import {prepareImage} from '../lean/image.ts';
import {match} from '../lean/match.ts';
import {leanRows,isoDate} from './lean-rows.ts';
import {asCatalogItem,asProduct,catalog} from './workspace';
import {leanMappings} from './rematch';
import {requireHub} from './hubs';
import {limits} from './config';
import {authorize,check,HttpError} from './auth';
// Failures the receiver can't fix by retrying: no credit on the Anthropic account, or a bad/revoked key.
export const NO_CREDIT='Error de lectura, favor de capturar directo en Retool y contactar a José para cargar créditos a la aplicación.';
export function readFailure(error:string|null){
 if(/credit balance|purchase credits|billing/i.test(error??'')||/^HTTP 40[123]\b/.test(error??''))return NO_CREDIT;
 if(/^HTTP (429|5\d\d)\b/.test(error??''))return 'El servicio de lectura está saturado. Reintenta en unos minutos o captura directo en Retool.';
 return `No se pudo leer la factura: ${error??'sin respuesta'}`.slice(0,300);
}
const isImage=(b:Buffer)=>(b[0]===0xff&&b[1]===0xd8)||(b[0]===0x89&&b[1]===0x50&&b[2]===0x4e&&b[3]===0x47);
// Lean reader: photos → one transcription call (lean/transcribe.ts) → deterministic catalog match (lean/match.ts).
export async function extractJob(request:Request,jobId:string){
 const {db,orgId,userId}=await authorize(request);
 const job=check(await db.from('extraction_jobs').select('*').eq('id',jobId).eq('org_id',orgId).maybeSingle());if(!job||job.requested_by!==userId)throw new HttpError(404,'Job not found');
 const document=check(await db.from('documents').select('*').eq('id',job.document_id).eq('org_id',orgId).single())!;
 const receiving=check(await db.from('receiving_sessions').select('hub_id').eq('org_id',orgId).eq('id',document.session_id).single())!;
 await requireHub(db,orgId,userId,receiving.hub_id);
 const pages=check(await db.from('source_pages').select('*').eq('document_id',document.id).eq('org_id',orgId).order('page_number'))!;
 const apiKey=process.env.ANTHROPIC_API_KEY,model=process.env.ANTHROPIC_MODEL||'claude-sonnet-5-5';if(!apiKey)throw new HttpError(503,'Anthropic configuration missing');
 // The lease (claim token + expiry) keeps one job from being processed twice.
 const claimed:any=check(await db.rpc('claim_extraction',{p_job:job.id,p_actor:userId,p_limit:null}));if(!claimed)return;
 const started=Date.now();let read:ReadResult|undefined;
 const fail=(error:string)=>db.from('extraction_jobs').update({status:'failed',error,model,...(read?{raw_result:{transcription:read.transcription},usage:read.usage,estimated_cost_usd:read.costUsd}:{}),duration_ms:Date.now()-started,lease_until:null,updated_at:new Date().toISOString()}).eq('org_id',orgId).eq('id',job.id).eq('status','processing').eq('claim_token',claimed.claim_token);
 try{
 if(!pages.length||pages.length>limits().maxPages)throw new HttpError(400,'Número de fotos inválido.');
 const images:ImageInput[]=[];
 for(const page of pages){
  if(!page.object_path.startsWith(`${orgId}/${document.id}/`))throw new HttpError(400,'Foto de otra organización.');
  const blob=check(await db.storage.from('invoices').download(page.object_path))!;if(blob.size>limits().maxUploadBytes)throw new HttpError(400,'Foto demasiado grande.');
  const buffer=Buffer.from(await blob.arrayBuffer());if(!isImage(buffer))throw new HttpError(400,'La foto no es JPG/PNG.');
  if(createHash('sha256').update(buffer).digest('hex')!==page.content_hash)throw new HttpError(400,'La foto no coincide con la registrada.');
  images.push(await prepareImage(buffer));
 }
 read=await transcribe(apiKey,model,images);
 const t=read.transcription;if(!t||!Array.isArray(t.rows))throw new HttpError(502,readFailure(read.error));
 const rawProducts=await catalog(db),products=rawProducts.map(asProduct);
 const result=match(t,rawProducts.map(asCatalogItem),await leanMappings(db,orgId,rawProducts));
 const supplier=result.supplier??t.supplier,reference=t.documentRef,warnings=[...result.warnings];
 if(read.error)warnings.push(`Lectura incompleta (${read.error}). Revisa que estén todos los renglones.`);
 if(reference&&supplier){const duplicates=check(await db.from('documents').select('id,receiving_sessions!inner(hub_id)').eq('org_id',orgId).eq('receiving_sessions.hub_id',receiving.hub_id).eq('supplier',supplier).eq('reference',reference).neq('id',document.id))!;if(duplicates.length)warnings.push('Posible factura duplicada: proveedor y referencia ya registrados en este hub.');}
 // finish_extraction copies supplier/reference/date/warnings from p_raw onto the document.
 const raw={supplier,reference,date:isoDate(t.date),printedTotal:null,printedPageCount:null,warnings,matchedSupplier:result.supplier,totalsOk:result.totalsOk,transcription:t};
 check(await db.rpc('finish_extraction',{p_job:job.id,p_actor:userId,p_raw:raw,p_rows:leanRows(t,result,products),p_usage:{...read.usage,stopReason:read.stopReason,seconds:read.seconds},p_model:model,p_duration:Date.now()-started,p_cost:read.costUsd,p_token:claimed.claim_token}));
 check(await db.from('extraction_jobs').update({prompt_version:'lean-v2'}).eq('org_id',orgId).eq('id',job.id));
 }catch(e){await fail(e instanceof HttpError?e.message:'No se pudo leer la factura. Reintenta o agrega los renglones a mano.');throw e;}
}
