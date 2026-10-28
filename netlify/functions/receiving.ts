import {z} from 'zod';
import {CorrectionsSchema} from '../../shared/domain';
import {limits} from '../../server/config';
import {authorize,check,HttpError,failure} from '../../server/auth';
import {requireHub,listHubs} from '../../server/hubs';
import {loadWorkspace} from '../../server/workspace';
const uuid=z.string().uuid();
const Input=z.discriminatedUnion('action',[
 z.object({action:z.literal('hubs')}),z.object({action:z.literal('history'),hubId:uuid,before:z.object({at:z.string().datetime({offset:true}),id:uuid}).optional()}),z.object({action:z.literal('create'),hubId:uuid}),z.object({action:z.literal('latest'),hubId:uuid}),z.object({action:z.literal('load'),sessionId:uuid}),
 z.object({action:z.literal('document'),sessionId:uuid}),
 z.object({action:z.literal('metadata'),sessionId:uuid,documentId:uuid,supplier:z.string().trim().min(1).max(200),invoiceDate:z.string().date().nullable(),revision:z.number().int().nonnegative()}),
 z.object({action:z.literal('confirm-batch'),sessionId:uuid,documentId:uuid,rows:z.array(z.object({rowId:uuid,productId:z.string(),quantity:z.number().int().nonnegative().max(1000000),revision:z.number().int().nonnegative()})).min(1).max(500)}),
 z.object({action:z.literal('page'),sessionId:uuid,documentId:uuid,objectPath:z.string(),hash:z.string().regex(/^[a-f0-9]{64}$/)}),
 z.object({action:z.literal('extract'),sessionId:uuid,documentId:uuid}),
 z.object({action:z.literal('snapshot'),sessionId:uuid,partial:z.boolean()}),
 z.object({action:z.literal('confirm'),sessionId:uuid,documentId:uuid,rowId:uuid,productId:z.string(),quantity:z.number().int().nonnegative().max(1000000),identityChecked:z.literal(true),saveMapping:z.boolean(),corrections:CorrectionsSchema.default({}),revision:z.number().int().nonnegative()})]);
export default async function handler(request:Request){
 try{
 if(request.method!=='POST')throw new HttpError(405,'POST required');
 const {db,userId,orgId,role,token}=await authorize(request);
 const parsed=Input.safeParse(await request.json());if(!parsed.success)throw new HttpError(400,'Invalid request');const b=parsed.data;
 if(b.action==='hubs')return Response.json({hubs:await listHubs(db,orgId,userId,role)});
 if(b.action==='history'){
 await requireHub(db,orgId,userId,b.hubId);
 let query=db.from('documents').select('id,session_id,supplier,reference,created_at,invoice_date,receiving_sessions!inner(hub_id,status)').eq('org_id',orgId).eq('receiving_sessions.hub_id',b.hubId).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(51);
 if(b.before)query=query.or(`created_at.lt.${b.before.at},and(created_at.eq.${b.before.at},id.lt.${b.before.id})`);
 const docs=check(await query)!;const visible=docs.slice(0,50);const last=visible.at(-1);
 return Response.json({entries:visible.map((d:any)=>({id:d.id,sessionId:d.session_id,hubId:b.hubId,supplier:d.supplier??'Proveedor por identificar',reference:d.reference??'Sin referencia',scannedAt:d.created_at,invoiceDate:d.invoice_date,status:d.receiving_sessions.status})),next:docs.length>50&&last?{at:last.created_at,id:last.id}:null});
 }
 if(b.action==='create'){await requireHub(db,orgId,userId,b.hubId);const session=check(await db.from('receiving_sessions').insert({org_id:orgId,hub_id:b.hubId,created_by:userId}).select('id').single())!;return Response.json({sessionId:session.id,orgId});}
 if(b.action==='latest'){await requireHub(db,orgId,userId,b.hubId);const latest=check(await db.from('receiving_sessions').select('id').eq('org_id',orgId).eq('hub_id',b.hubId).order('created_at',{ascending:false}).limit(1).maybeSingle());return Response.json({sessionId:latest?.id??null});}
 const session=check(await db.from('receiving_sessions').select('*').eq('org_id',orgId).eq('id',b.sessionId).maybeSingle());if(!session)throw new HttpError(404,'Session not found');
 await requireHub(db,orgId,userId,session.hub_id);
 if(b.action==='load')return Response.json({workspace:await loadWorkspace(db,orgId,b.sessionId)});
 if(b.action==='snapshot'){const id=check(await db.rpc('snapshot_receipt',{p_actor:userId,p_org:orgId,p_session:b.sessionId,p_partial:b.partial}))!;return Response.json({snapshotId:id});}
 if(session.status!=='open')throw new HttpError(409,'Receipt is already saved');
 if(b.action==='document'){const document=check(await db.from('documents').insert({org_id:orgId,session_id:b.sessionId}).select('id').single())!;return Response.json({documentId:document.id});}
 const document=check(await db.from('documents').select('*').eq('org_id',orgId).eq('session_id',b.sessionId).eq('id',b.documentId).maybeSingle());if(!document)throw new HttpError(404,'Document not found');
 if(b.action==='metadata'){check(await db.rpc('update_scan_metadata',{p_actor:userId,p_org:orgId,p_document:b.documentId,p_supplier:b.supplier,p_invoice_date:b.invoiceDate,p_expected_revision:b.revision}));return Response.json({ok:true});}
 if(b.action==='confirm-batch'){
 const products=check(await db.from('products').select('id,external_id').eq('org_id',orgId).in('external_id',b.rows.map(r=>r.productId)))!;
 const batch=b.rows.map(r=>{const product=products.find(p=>p.external_id===r.productId);if(!product)throw new HttpError(404,'Product not found');return {...r,productId:product.id};});
 check(await db.rpc('confirm_receiving_batch',{p_actor:userId,p_org:orgId,p_document:b.documentId,p_rows:batch}));return Response.json({ok:true});}
 if(b.action==='confirm'){
 const product=check(await db.from('products').select('id').eq('org_id',orgId).eq('external_id',b.productId).maybeSingle());if(!product)throw new HttpError(404,'Product not found');
 check(await db.rpc('confirm_receiving_row',{p_actor:userId,p_org:orgId,p_document:b.documentId,p_row:b.rowId,p_product:product.id,p_quantity:b.quantity,p_identity:b.identityChecked,p_mapping:b.saveMapping,p_corrections:b.corrections,p_expected_revision:b.revision}))!;return Response.json({ok:true});
 }
 if(b.action==='page'){
 if(!b.objectPath.startsWith(`${orgId}/${b.documentId}/`)||b.objectPath.split('/').length!==3||b.objectPath.split('/')[2]!==`${b.hash}.${b.objectPath.endsWith('.png')?'png':'jpg'}`)throw new HttpError(400,'Invalid object reference');
 const job=check(await db.from('extraction_jobs').select('id').eq('org_id',orgId).eq('document_id',b.documentId).maybeSingle());if(job)throw new HttpError(409,'Cannot add pages after extraction is queued');
 const existing=check(await db.from('source_pages').select('id,document_id').eq('org_id',orgId).eq('content_hash',b.hash).eq('document_id',b.documentId).maybeSingle());if(existing){if(existing.document_id!==b.documentId)throw new HttpError(409,'This image already belongs to another document');return Response.json({ok:true,duplicate:true});}
 const {count,error}=await db.from('source_pages').select('*',{count:'exact',head:true}).eq('org_id',orgId).eq('document_id',b.documentId);if(error)throw error;if((count??0)>=limits().maxPages)throw new HttpError(400,'Page limit reached');
 // Worker verifies the actual bytes and digest before any paid call.
 check(await db.from('source_pages').insert({org_id:orgId,document_id:b.documentId,object_path:b.objectPath,content_hash:b.hash,page_number:(count??0)+1}))!;return Response.json({ok:true});
 }
 if(b.action==='extract'){
 if(!process.env.ANTHROPIC_API_KEY||!process.env.ANTHROPIC_MODEL)throw new HttpError(503,'Configure ANTHROPIC_API_KEY and ANTHROPIC_MODEL before extraction');
 const pages=check(await db.from('source_pages').select('id').eq('org_id',orgId).eq('document_id',b.documentId))!;if(!pages.length)throw new HttpError(400,'Upload at least one page');
 let job=check(await db.from('extraction_jobs').select('*').eq('org_id',orgId).eq('document_id',b.documentId).maybeSingle());
 if(job?.status==='complete')return Response.json({jobId:job.id,status:'complete'});
 if(job?.status==='processing')return Response.json({jobId:job.id,status:job.status},{status:202});
 if(job&&job.status!=='queued'){if(job.attempts>=2)throw new HttpError(409,'Retry limit reached. Contact an administrator before another paid attempt.');job=check(await db.from('extraction_jobs').update({status:'queued',error:null,requested_by:userId}).eq('org_id',orgId).eq('id',job.id).in('status',['failed','uncertain']).select().single())!;}
 else if(!job){const created=await db.from('extraction_jobs').insert({org_id:orgId,document_id:b.documentId,requested_by:userId}).select().single();if(created.error?.code==='23505')return Response.json({status:'queued'},{status:202});job=check(created)!;}
 const endpoint=new URL('/.netlify/functions/extract-background',request.url);
 const dispatched=await fetch(endpoint,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({jobId:job.id})});
 if(!dispatched.ok){check(await db.from('extraction_jobs').update({status:'failed',error:'Background dispatch failed'}).eq('org_id',orgId).eq('id',job.id).eq('status','queued'))!;throw new HttpError(503,'Background function unavailable; no extraction result yet');}
 return Response.json({jobId:job.id,status:'queued'},{status:202});
 }
 throw new HttpError(400,'Unknown operation');
 }catch(e){return failure(e);}
}
