import type {SupabaseClient} from '@supabase/supabase-js';
import {ExtractionSchema} from '../shared/domain';
import {operationalWarnings} from '../shared/receiving-policy';
import {buildInvoiceRows} from './match-extraction';
import {asProduct,catalog} from './workspace';
import {check,HttpError} from './auth';
// Explicit, paid-free refresh. Rows edited/confirmed by a receiver are preserved.
export async function rematchDocument(db:SupabaseClient,orgId:string,userId:string,document:any){
 const job=check(await db.from('extraction_jobs').select('status,raw_result').eq('org_id',orgId).eq('document_id',document.id).single())!;
 if(job.status!=='complete')throw new HttpError(409,'La lectura todavía no está completa.');
 const extraction=ExtractionSchema.parse(job.raw_result);
 const products=await catalog(db,orgId);
 const mappings=check(await db.from('supplier_mappings').select('*').eq('org_id',orgId))!;
 const rules=check(await db.from('quantity_conversions').select('*').eq('org_id',orgId))!;
 const proposals=buildInvoiceRows({...extraction,supplier:document.supplier??extraction.supplier},products.map(asProduct),products,mappings,rules);
 const rows=check(await db.from('invoice_rows').select('id,source_row,revision,review').eq('org_id',orgId).eq('document_id',document.id))!;
 let updated=0,preserved=0;
 for(const row of rows){
 if(row.revision!==0||row.review.confirmed||row.review.corrections){preserved++;continue;}
 const proposal=proposals.find(p=>p.sourceRow===row.source_row);if(!proposal){preserved++;continue;}
 const {raw,...review}=proposal;review.id=row.id;
 const changed=check(await db.from('invoice_rows').update({review,revision:row.revision+1}).eq('org_id',orgId).eq('document_id',document.id).eq('id',row.id).eq('revision',row.revision).select('id'))!;
 if(!changed.length){preserved++;continue;}
 updated++;
 check(await db.from('review_events').insert({org_id:orgId,actor:userId,row_id:row.id,action:'Coincidencias actualizadas desde lectura guardada',before_value:row.review,after_value:review}));
 }
 // Keep raw provider warnings in raw_result; operative document warnings use the current policy.
 check(await db.from('documents').update({warnings:operationalWarnings(document.warnings??[]),metadata_revision:document.metadata_revision+1}).eq('org_id',orgId).eq('id',document.id).eq('metadata_revision',document.metadata_revision));
 return {updated,preserved};
}
