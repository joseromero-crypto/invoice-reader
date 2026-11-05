import type {Workspace,Product,Document,Row} from '../shared/domain';
import type {SupabaseClient} from '@supabase/supabase-js';
import {check} from './auth';
import {asCatalogItem,cityItems,MATCH_CITY,withCityRows} from '../lean/catalog.ts';
export {cityItems};
function asProduct(p:any,city:string|null):Product{const row=city?p.city_rows.find((c:any)=>c.city===city)??p.city_rows[0]:p.city_row,c=asCatalogItem(p,row);return {id:p.id,sku:p.sku,name:c.name,nameColumn:'Item',supplier:c.supplier,supplierSku:c.supplierSku||null,barcode:row.barcode??p.barcode??null,unit:p.calii_unit||'desconocida',purchaseUnit:c.purchaseUnit,perPurchaseUnit:c.perPurchaseUnit,...(c.aliases?{aliases:c.aliases}:{}),...(city&&row.city!==city?{otherCity:row.city}:{})};}
// The hub's city first, products from other cities after: the picker shows them in this order.
export function asProducts(rawProducts:any[],city:string|null):Product[]{const all=rawProducts.map(p=>asProduct(p,city));return [...all.filter(p=>!p.otherCity),...all.filter(p=>p.otherCity)];}
export async function hubCity(db:SupabaseClient,hubId:string):Promise<string|null>{return check(await db.from('hubs').select('city').eq('id',hubId).maybeSingle())?.city??null;}
const CITY_ROW='sku,city,name,barcode,proveedor,sku_proveedor,unidad_compra,piezas_por_unidad,mv_products!inner(id,base_city,calii_unit,barcode,retired:raw->>retired_at)',PAGE=1000;
// Only the columns matching reads: read_mv_catalog for every city took 30 s, these pages take 2 s.
async function otherCityRows(db:SupabaseClient,city:string){
 const cities:any[]=check(await db.rpc('mv_city_status'))??[],total=cities.filter(c=>c.city!==city).reduce((n,c)=>n+Number(c.rows),0);
 const pages=await Promise.all(Array.from({length:Math.ceil(total/PAGE)},async(_,i)=>check(await db.from('mv_product_city').select(CITY_ROW).neq('city',city).order('sku').order('city').range(i*PAGE,(i+1)*PAGE-1))??[]));
 return (pages.flat() as any[]).filter(c=>!c.mv_products.retired).map(({mv_products:{retired,...product},...c})=>({product:{...product,sku:c.sku},row:{...c,raw:{Item:c.name,'Código de Barras':c.barcode,Proveedor:c.proveedor,'SKU Proveedor':c.sku_proveedor,'Unidad de compra':c.unidad_compra,'Peso neto o piezas (por unidad de compra)':c.piezas_por_unidad}}}));
}
// A hub with a city reads every city; a hub with no city reads MATCH_CITY's rows only.
export async function catalog(db:SupabaseClient,city:string|null=null):Promise<any[]>{
 const read=async(c:string):Promise<any[]>=>check(await db.rpc('read_mv_catalog',{p_city:c}))??[];
 if(!city)return read(MATCH_CITY);
 const [own,others]=await Promise.all([read(city),otherCityRows(db,city)]);return withCityRows(own,others);
}
// The catalog read is several MB; polls send it again only when the catalog version changed.
// Independent reads run in parallel (each is a round trip to Supabase).
export async function loadWorkspace(db:SupabaseClient,orgId:string,sessionId:string,knownCatalog?:string|null):Promise<Workspace>{
 const [latest,session,docs]=await Promise.all([db.from('mv_imports').select('id').order('uploaded_at',{ascending:false}).limit(1).maybeSingle(),db.from('receiving_sessions').select('hub_id,status').eq('org_id',orgId).eq('id',sessionId).single(),db.from('documents').select('*').eq('org_id',orgId).eq('session_id',sessionId).order('created_at')]).then(r=>r.map((x:any)=>check(x)) as any[]);
 const catalogVersion:string|null=latest?.id??null,catalogUnchanged=!!catalogVersion&&knownCatalog===catalogVersion;
 const [products,events,documents]=await Promise.all([
 catalogUnchanged?[]:hubCity(db,session.hub_id).then(async city=>asProducts(await catalog(db,city),city)),
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
