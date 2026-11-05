import type {Workspace,Product,Document,Row} from '../shared/domain';
import type {SupabaseClient} from '@supabase/supabase-js';
import {check} from './auth';
import {asCatalogItem,MATCH_CITY} from '../lean/catalog.ts';
export {asCatalogItem};
export function asProduct(p:any):Product{const c=asCatalogItem(p);return {id:p.id,sku:p.sku,name:c.name,nameColumn:'Item',supplier:c.supplier,supplierSku:c.supplierSku||null,barcode:p.city_row.barcode??p.barcode??null,unit:p.calii_unit||'desconocida',purchaseUnit:c.purchaseUnit,perPurchaseUnit:c.perPurchaseUnit};}
export async function catalog(db:SupabaseClient):Promise<any[]>{return check(await db.rpc('read_mv_catalog',{p_city:MATCH_CITY}))??[];}
// The catalog read is several MB; polls send it again only when the catalog version changed.
// Independent reads run in parallel (each is a round trip to Supabase).
export async function loadWorkspace(db:SupabaseClient,orgId:string,sessionId:string,knownCatalog?:string|null):Promise<Workspace>{
 const [latest,session,docs]=await Promise.all([db.from('mv_imports').select('id').order('uploaded_at',{ascending:false}).limit(1).maybeSingle(),db.from('receiving_sessions').select('hub_id,status').eq('org_id',orgId).eq('id',sessionId).single(),db.from('documents').select('*').eq('org_id',orgId).eq('session_id',sessionId).order('created_at')]).then(r=>r.map((x:any)=>check(x)) as any[]);
 const catalogVersion:string|null=latest?.id??null,catalogUnchanged=!!catalogVersion&&knownCatalog===catalogVersion;
 const [products,events,documents]=await Promise.all([
 catalogUnchanged?[]:catalog(db).then(c=>c.map(asProduct)),
 db.from('review_events').select('*').eq('org_id',orgId).eq('hub_id',session.hub_id).order('created_at',{ascending:true}).limit(500).then(r=>check(r)!),
 Promise.all(docs.map(async(d:any):Promise<Document>=>{
 const [pages,rows,found]=await Promise.all([db.from('source_pages').select('*').eq('org_id',orgId).eq('document_id',d.id).order('page_number'),db.from('invoice_rows').select('*').eq('org_id',orgId).eq('document_id',d.id).order('source_row'),db.from('extraction_jobs').select('status,lease_until,error,created_at').eq('org_id',orgId).eq('document_id',d.id).maybeSingle()]).then(r=>r.map((x:any)=>check(x)) as any[]);
 let job=found;
 if(job?.status==='processing'&&job.lease_until&&new Date(job.lease_until)<new Date()){check(await db.from('extraction_jobs').update({status:'uncertain',error:'Lease expired; billing/result uncertain. Explicit retry required.'}).eq('document_id',d.id).eq('org_id',orgId).eq('status','processing'))!;job={...job,status:'uncertain'};}
 if(job?.status==='queued'&&new Date(job.created_at).getTime()<Date.now()-120000){check(await db.from('extraction_jobs').update({status:'failed',error:'Dispatch interrupted. Explicit retry required.'}).eq('document_id',d.id).eq('org_id',orgId).eq('status','queued'));job={...job,status:'failed'};}
 const images:string[]=pages.length?check(await db.storage.from('invoices').createSignedUrls(pages.map((p:any)=>p.object_path),300))!.map(s=>s.signedUrl!):[];
 return {id:d.id,scannedAt:d.created_at,invoiceDate:d.invoice_date,metadataRevision:d.metadata_revision,supplier:d.supplier??'Proveedor por identificar',reference:d.reference??'Documento nuevo',image:images[0]??null,images,pages:pages.length,expectedPages:d.expected_pages,warnings:d.warnings??[],printedTotal:d.printed_total===null?null:String(d.printed_total),jobStatus:job?.status,jobError:job?.error,rows:rows.map((r:any)=>({...r.review,id:r.id,revision:r.revision,sourceDetails:r.raw_source} as Row))};
 }))]);
 return {mode:'live',sessionId,hubId:session.hub_id,readOnly:session.status!=='open',products,catalogVersion,catalogUnchanged,documents,audit:events.map((e:any)=>({at:e.created_at,action:e.action,rowId:e.row_id,before:e.before_value,after:e.after_value}))};
}
