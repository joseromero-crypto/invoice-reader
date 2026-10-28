import {PGlite} from '@electric-sql/pglite';
import {beforeAll,afterAll,it,expect} from 'vitest';
import fs from 'node:fs';
const db=new PGlite();
const orgA='10000000-0000-4000-8000-000000000001',orgB='10000000-0000-4000-8000-000000000002',userA='20000000-0000-4000-8000-000000000001',userB='20000000-0000-4000-8000-000000000002',sessionA='30000000-0000-4000-8000-000000000001',docA='40000000-0000-4000-8000-000000000001',productA='50000000-0000-4000-8000-000000000001',productB='50000000-0000-4000-8000-000000000002',rowA='60000000-0000-4000-8000-000000000001',jobA='70000000-0000-4000-8000-000000000001';
beforeAll(async()=>{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
 create function storage.foldername(name text) returns text[] language sql immutable as $$select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1]$$;
 grant usage on schema storage to authenticated;grant select,insert on storage.objects to authenticated;`);
 const sql=fs.readFileSync('supabase/migrations/202610270001_receiving.sql','utf8').replace('create extension if not exists pgcrypto;','-- Embedded PG already provides gen_random_uuid; production keeps pgcrypto.');
 await db.exec(sql);
 await db.exec(`insert into auth.users values('${userA}'),('${userB}');insert into organizations values('${orgA}','A'),('${orgB}','B');insert into members values('${orgA}','${userA}','receiver'),('${orgB}','${userB}','receiver');
 insert into products(id,org_id,external_id,sku,name,supplier,supplier_sku,barcode,unit,raw) values('${productA}','${orgA}','0001','A','Pan blanco 620g','Bimbo','001','000123','pz','{}'),('${productB}','${orgB}','0001','B','Otro producto','Bimbo','001','000123','pz','{}');
 insert into receiving_sessions(id,org_id,created_by) values('${sessionA}','${orgA}','${userA}');insert into documents(id,org_id,session_id,supplier,reference,expected_pages,warnings) values('${docA}','${orgA}','${sessionA}','Bimbo','TEST',2,'["Missing page"]');
 insert into invoice_rows(id,org_id,document_id,source_row,raw_source,review) values('${rowA}','${orgA}','${docA}',1,'{"supplierSku":"001","quantity":15}','{"flags":["Size conflict"],"resolvedFlags":[],"confirmed":false,"billedQuantity":15}');
 insert into extraction_jobs(id,org_id,document_id,requested_by) values('${jobA}','${orgA}','${docA}','${userA}');`);
},30000);
afterAll(async()=>{await db.close();});
async function asUser(user:string,sql:string){await db.exec(`set role authenticated;set request.jwt.claim.sub='${user}';`);try{return await db.query(sql);}finally{await db.exec('reset role;reset request.jwt.claim.sub;');}}
it('RLS separates product, document, receipt row and job reads by membership',async()=>{
 expect((await asUser(userA,'select * from products')).rows).toHaveLength(1);
 for(const table of ['documents','invoice_rows','source_pages','extraction_jobs','review_events','supplier_mappings','receipt_snapshots'])expect((await asUser(userB,`select * from ${table}`)).rows).toHaveLength(0);
 expect((await asUser(userB,`select * from documents where id='${docA}'`)).rows).toHaveLength(0);
});
it('authenticated users cannot mutate operational tables or call privileged extraction RPCs',async()=>{
 await expect(asUser(userA,`update invoice_rows set review='{}' where id='${rowA}'`)).rejects.toThrow(/permission denied/);
 await expect(asUser(userA,`select claim_extraction('${jobA}','${userA}',20)`)).rejects.toThrow(/permission denied/);
});
it('storage policy rejects cross-organization document paths and permits own private uploads',async()=>{
 await expect(asUser(userB,`insert into storage.objects(bucket_id,name) values('invoices','${orgA}/${docA}/photo.jpg')`)).rejects.toThrow(/row-level security/);
 await asUser(userA,`insert into storage.objects(bucket_id,name) values('invoices','${orgA}/${docA}/photo.jpg')`);
 expect((await asUser(userA,'select * from storage.objects')).rows).toHaveLength(1);expect((await asUser(userB,'select * from storage.objects')).rows).toHaveLength(0);
});
it('privileged confirmations still enforce organization membership and product ownership',async()=>{
 await expect(db.query(`select confirm_receiving_row($1,$2,$3,$4,$5,15,true,false)`,[userB,orgA,docA,rowA,productA])).rejects.toThrow(/Invalid confirmation/);
 await expect(db.query(`select confirm_receiving_row($1,$2,$3,$4,$5,15,true,false)`,[userA,orgA,docA,rowA,productB])).rejects.toThrow(/Product not found/);
});
it('confirmation, audit and explicit mapping happen together and retain original quantities',async()=>{
 await db.query(`select confirm_receiving_row($1,$2,$3,$4,$5,12,true,true)`,[userA,orgA,docA,rowA,productA]);
 const r=(await db.query<any>('select * from invoice_rows where id=$1',[rowA])).rows[0];expect(r.raw_source.quantity).toBe(15);expect(r.review.billedQuantity).toBe(15);expect(r.review.confirmedQuantity).toBe(12);expect(r.review.flags).toEqual([]);expect(r.review.resolvedFlags).toEqual(['Size conflict']);
 expect((await db.query('select * from review_events')).rows).toHaveLength(2);expect((await db.query('select * from supplier_mappings')).rows).toHaveLength(1);
});
it('duplicate dispatch claims exactly one reservation; cross-organization callers cannot claim',async()=>{
 await expect(db.query('select claim_extraction($1,$2,20)',[jobA,userB])).rejects.toThrow(/Forbidden/);
 const [first,second]=await Promise.all([db.query<any>('select claim_extraction($1,$2,20) as claim',[jobA,userA]),db.query<any>('select claim_extraction($1,$2,20) as claim',[jobA,userA])]);
 expect([first.rows[0].claim,second.rows[0].claim].filter(Boolean)).toHaveLength(1);expect((await db.query<any>('select reserved_calls from ai_daily_usage')).rows[0].reserved_calls).toBe(1);
});
it('stale extraction workers cannot commit with a different claim token',async()=>{
 await expect(db.query('select finish_extraction($1,$2,$3,$4,$5,$6,$7,$8,$9)',[jobA,userA,{},[],{},'test-model',20,null,'90000000-0000-4000-8000-000000000001'])).rejects.toThrow(/Invalid job/);
});
it('incomplete documents cannot be saved as complete and snapshots remain immutable',async()=>{
 await expect(db.query('select snapshot_receipt($1,$2,$3,false)',[userA,orgA,sessionA])).rejects.toThrow(/Unresolved/);
 await db.query('select snapshot_receipt($1,$2,$3,true)',[userA,orgA,sessionA]);
 const session=(await db.query<any>('select status from receiving_sessions where id=$1',[sessionA])).rows[0];expect(session.status).toBe('reviewed_partial');expect((await db.query('select * from receipt_snapshots')).rows).toHaveLength(1);
 await expect(db.query('select confirm_receiving_row($1,$2,$3,$4,$5,1,true,false)',[userA,orgA,docA,rowA,productA])).rejects.toThrow(/closed/);
});
it('catalog upserts retain approved mappings and historical review product names',async()=>{
 await db.query(`insert into products(org_id,external_id,sku,name,supplier,unit,raw) values($1,'0001','A','Changed catalog name','Bimbo','pz','{}') on conflict(org_id,external_id) do update set name=excluded.name`,[orgA]);
 expect((await db.query<any>('select product_id from supplier_mappings where org_id=$1',[orgA])).rows[0].product_id).toBe(productA);
 const snapshot=(await db.query<any>('select snapshot from receipt_snapshots where org_id=$1',[orgA])).rows[0].snapshot;expect(snapshot[0].rows[0].product.name).toBe('Pan blanco 620g');
});
