import type {Workspace,Product,Document,Row} from '../shared/domain';
import type {SupabaseClient} from '@supabase/supabase-js';
import {check} from './auth';
import {operationalWarnings} from '../shared/receiving-policy';
export function asProduct(p:any):Product{return {id:p.external_id,sku:p.sku,name:p.name,nameColumn:p.catalog_imports?.report?.nameColumn??'Item',supplier:p.supplier,supplierSku:p.supplier_sku,barcode:p.barcode,unit:p.unit};}
export async function catalog(db:SupabaseClient,orgId:string):Promise<any[]>{return check(await db.rpc('read_catalog_snapshot',{p_org:orgId}))??[];}
export async function loadWorkspace(db:SupabaseClient,orgId:string,sessionId:string):Promise<Workspace>{
 const products=(await catalog(db,orgId)).map(asProduct);
 const session=check(await db.from('receiving_sessions').select('hub_id,status').eq('org_id',orgId).eq('id',sessionId).single())!;
 const docs=check(await db.from('documents').select('*').eq('org_id',orgId).eq('session_id',sessionId).order('created_at'))!;
 const documents:Document[]=[];
 for(const d of docs){
 const pages=check(await db.from('source_pages').select('*').eq('org_id',orgId).eq('document_id',d.id).order('page_number'))!;
 const rows=check(await db.from('invoice_rows').select('*').eq('org_id',orgId).eq('document_id',d.id).order('source_row'))!;
 let job=check(await db.from('extraction_jobs').select('status,lease_until,error,created_at').eq('org_id',orgId).eq('document_id',d.id).maybeSingle());
 if(job?.status==='processing'&&job.lease_until&&new Date(job.lease_until)<new Date()){check(await db.from('extraction_jobs').update({status:'uncertain',error:'Lease expired; billing/result uncertain. Explicit retry required.'}).eq('document_id',d.id).eq('org_id',orgId).eq('status','processing'))!;job={...job,status:'uncertain'};}
 const warnings=operationalWarnings(d.warnings??[]);
 if(job?.status==='queued'&&new Date(job.created_at).getTime()<Date.now()-120000){check(await db.from('extraction_jobs').update({status:'failed',error:'Dispatch interrupted. Explicit retry required.'}).eq('document_id',d.id).eq('org_id',orgId).eq('status','queued'));job={...job,status:'failed'};}
 const images:string[]=[];for(const page of pages){const signed=check(await db.storage.from('invoices').createSignedUrl(page.object_path,300))!;images.push(signed.signedUrl);}const image=images[0]??null;
 documents.push({id:d.id,scannedAt:d.created_at,invoiceDate:d.invoice_date,metadataRevision:d.metadata_revision,supplier:d.supplier??'Proveedor por identificar',reference:d.reference??'Documento nuevo',image,images,pages:pages.length,expectedPages:d.expected_pages,warnings,printedTotal:d.printed_total===null?null:String(d.printed_total),jobStatus:job?.status,jobError:job?.error,rows:rows.map(r=>({...r.review,id:r.id,revision:r.revision,sourceDetails:r.raw_source} as Row))});
 }
 const events=check(await db.from('review_events').select('*').eq('org_id',orgId).eq('hub_id',session.hub_id).order('created_at',{ascending:true}).limit(500))!;
 return {mode:'live',sessionId,hubId:session.hub_id,readOnly:session.status!=='open',products,documents,audit:events.map(e=>({at:e.created_at,action:e.action,rowId:e.row_id,before:e.before_value,after:e.after_value}))};
}
