import type {SupabaseClient} from '@supabase/supabase-js';
import {match,normCode,type Mappings} from '../lean/match.ts';
import type {Transcription} from '../lean/transcribe.ts';
import {leanRows} from './lean-rows.ts';
import {asCatalogItem,asProduct,catalog} from './workspace';
import {check,HttpError} from './auth';
export async function leanMappings(db:SupabaseClient,orgId:string,rawProducts:any[]):Promise<Mappings>{
 const externalId=new Map(rawProducts.map(p=>[p.id,p.external_id]));
 const rows=check(await db.from('supplier_mappings').select('supplier,supplier_sku,product_id').eq('org_id',orgId))!;
 return new Map(rows.filter(m=>externalId.has(m.product_id)).map(m=>[`${m.supplier}|${normCode(m.supplier_sku)}`,externalId.get(m.product_id)]));
}
// Explicit, paid-free refresh: re-run match() on the saved transcription with the current
// catalog and mappings. Rows edited/confirmed by a receiver are preserved.
export async function rematchDocument(db:SupabaseClient,orgId:string,userId:string,document:any){
 const job=check(await db.from('extraction_jobs').select('status,raw_result').eq('org_id',orgId).eq('document_id',document.id).single())!;
 if(job.status!=='complete')throw new HttpError(409,'La lectura todavía no está completa.');
 const t=job.raw_result?.transcription as Transcription|undefined;if(!t)throw new HttpError(409,'Esta factura se leyó con el lector anterior; no se puede actualizar.');
 const rawProducts=await catalog(db,orgId);
 const result=match(t,rawProducts.map(asCatalogItem),await leanMappings(db,orgId,rawProducts));
 const proposals=leanRows(t,result,rawProducts.map(asProduct));
 const rows=check(await db.from('invoice_rows').select('id,source_row,revision,review').eq('org_id',orgId).eq('document_id',document.id))!;
 let updated=0,preserved=0;
 for(const row of rows){
 if(row.review.confirmed||row.review.manual){preserved++;continue;}
 const proposal=proposals.find(p=>p.sourceRow===row.source_row);if(!proposal){preserved++;continue;}
 const {raw,...review}=proposal;review.id=row.id;
 const changed=check(await db.from('invoice_rows').update({review,revision:row.revision+1}).eq('org_id',orgId).eq('document_id',document.id).eq('id',row.id).eq('revision',row.revision).select('id'))!;
 if(!changed.length){preserved++;continue;}
 updated++;
 check(await db.from('review_events').insert({org_id:orgId,actor:userId,row_id:row.id,action:'Coincidencias actualizadas desde lectura guardada',before_value:row.review,after_value:review}));
 }
 return {updated,preserved};
}
