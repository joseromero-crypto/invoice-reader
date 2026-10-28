import {PGlite} from '@electric-sql/pglite';
import {beforeAll,afterAll,it,expect} from 'vitest';
import fs from 'node:fs';
const db=new PGlite();
const org='10000000-0000-4000-8000-000000000011',userA='20000000-0000-4000-8000-000000000011',userB='20000000-0000-4000-8000-000000000012',admin='20000000-0000-4000-8000-000000000013';
const sessionA='30000000-0000-4000-8000-000000000011',sessionB='30000000-0000-4000-8000-000000000012',docA='40000000-0000-4000-8000-000000000011',docB='40000000-0000-4000-8000-000000000012',docC='40000000-0000-4000-8000-000000000013',product='50000000-0000-4000-8000-000000000011',rowA='60000000-0000-4000-8000-000000000011',rowB='60000000-0000-4000-8000-000000000012',jobA='70000000-0000-4000-8000-000000000011',jobB='70000000-0000-4000-8000-000000000012';
let hubA:string,hubB:string;
beforeAll(async()=>{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
 create function storage.foldername(name text) returns text[] language sql immutable as $$select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1]$$;
 grant usage on schema storage to authenticated;grant select,insert on storage.objects to authenticated;`);
 for(const file of fs.readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort())await db.exec(fs.readFileSync(`supabase/migrations/${file}`,'utf8').replace('create extension if not exists pgcrypto;',''));
 await db.query('insert into organizations(id,name) values($1,$2)',[org,'Calii test']);
 const hubs=(await db.query<any>('select id,name from hubs where org_id=$1',[org])).rows;hubA=hubs.find(h=>h.name==='MH Contry').id;hubB=hubs.find(h=>h.name==='MH Cumbres').id;
 await db.exec(`insert into auth.users values('${userA}'),('${userB}'),('${admin}');insert into members values('${org}','${userA}','receiver'),('${org}','${userB}','receiver'),('${org}','${admin}','admin');
 insert into hub_members values('${org}','${hubA}','${userA}'),('${org}','${hubB}','${userB}');
 insert into products(id,org_id,external_id,sku,name,supplier,unit,raw) values('${product}','${org}','001','TEST','Artículo de prueba','Proveedor','pz','{}');
 insert into receiving_sessions(id,org_id,hub_id,created_by) values('${sessionA}','${org}','${hubA}','${userA}'),('${sessionB}','${org}','${hubB}','${userB}');
 insert into documents(id,org_id,session_id,supplier,reference,expected_pages) values('${docA}','${org}','${sessionA}','Proveedor A','A',1),('${docB}','${org}','${sessionB}','Proveedor B','B',1),('${docC}','${org}','${sessionA}',null,null,null);
 insert into invoice_rows(id,org_id,document_id,source_row,raw_source,review) values('${rowA}','${org}','${docA}',1,'{"quantity":10}','{"flags":[],"evidence":[],"resolvedFlags":[],"confirmed":false,"billedQuantity":10}'),('${rowB}','${org}','${docB}',1,'{"quantity":20}','{"flags":[],"evidence":[],"resolvedFlags":[],"confirmed":false,"billedQuantity":20}');
 insert into extraction_jobs(id,org_id,document_id,requested_by) values('${jobA}','${org}','${docC}','${userA}'),('${jobB}','${org}','${docB}','${userB}');`);
},30000);
afterAll(async()=>db.close());
async function asUser(user:string,sql:string){await db.exec(`set role authenticated;set request.jwt.claim.sub='${user}';`);try{return await db.query<any>(sql);}finally{await db.exec('reset role;reset request.jwt.claim.sub;');}}
async function confirm(user:string,document:string,row:string,quantity:number,revision:number){return db.query('select confirm_receiving_row($1,$2,$3,$4,$5,$6,true,false,$7,$8)',[user,org,document,row,product,quantity,{},revision]);}
it('seeds all eight hubs and limits the menu to authorized memberships',async()=>{
 expect((await asUser(admin,'select * from hubs')).rows).toHaveLength(8);
 expect((await asUser(userA,'select name from hubs')).rows.map(h=>h.name)).toEqual(['MH Contry']);
 expect((await asUser(userB,'select name from hubs')).rows.map(h=>h.name)).toEqual(['MH Cumbres']);
});
it('shares the Masterview catalog while separating scans and history inside the same organization',async()=>{
 expect((await asUser(userA,'select * from products')).rows).toHaveLength(1);expect((await asUser(userB,'select * from products')).rows).toHaveLength(1);
 expect((await asUser(userA,'select id from documents')).rows.map(d=>d.id).sort()).toEqual([docA,docC].sort());
 expect((await asUser(userB,`select * from documents where id='${docA}'`)).rows).toHaveLength(0);
 expect((await asUser(userA,'select * from invoice_rows')).rows).toHaveLength(1);
});
it('blocks private storage paths belonging to another hub',async()=>{
 await asUser(userA,`insert into storage.objects(bucket_id,name) values('invoices','${org}/${docA}/photo.jpg')`);
 expect((await asUser(userB,'select * from storage.objects')).rows).toHaveLength(0);
 await expect(asUser(userB,`insert into storage.objects(bucket_id,name) values('invoices','${org}/${docA}/other.jpg')`)).rejects.toThrow(/row-level security/);
});
it('does not allow a forged hub selection to confirm or dispatch work at another hub',async()=>{
 await expect(confirm(userB,docA,rowA,10,0)).rejects.toThrow(/Hub access denied/);
 await expect(db.query('select claim_extraction($1,$2,20)',[jobA,userB])).rejects.toThrow(/Hub access denied/);
});
it('allows independent hubs to confirm without replacing each other’s lists',async()=>{
 await Promise.all([confirm(userA,docA,rowA,9,0),confirm(userB,docB,rowB,18,0)]);
 expect((await db.query<any>('select review from invoice_rows where id=$1',[rowA])).rows[0].review.confirmedQuantity).toBe(9);
 expect((await db.query<any>('select review from invoice_rows where id=$1',[rowB])).rows[0].review.confirmedQuantity).toBe(18);
 expect((await asUser(userA,'select * from review_events')).rows).toHaveLength(1);
 expect((await asUser(userB,'select * from review_events')).rows).toHaveLength(1);
});
it('rejects a second edit based on a stale row, preserving the first user’s quantity',async()=>{
 await expect(confirm(admin,docA,rowA,99,0)).rejects.toThrow(/Revision conflict/);
 const row=(await db.query<any>('select * from invoice_rows where id=$1',[rowA])).rows[0];expect(row.revision).toBe(1);expect(row.review.confirmedQuantity).toBe(9);
});
it('bulk review is transactional when any row has a stale revision',async()=>{
 const extra='60000000-0000-4000-8000-000000000013';
 await db.query(`insert into invoice_rows(id,org_id,document_id,source_row,raw_source,review) values($1,$2,$3,2,'{}','{"flags":[],"evidence":[],"resolvedFlags":[],"confirmed":false}')`,[extra,org,docA]);
 const batch=[{rowId:extra,productId:product,quantity:7,revision:0},{rowId:rowA,productId:product,quantity:5,revision:0}];
 await expect(db.query('select confirm_receiving_batch($1,$2,$3,$4)',[userA,org,docA,batch])).rejects.toThrow(/Revision conflict/);
 expect((await db.query<any>('select revision from invoice_rows where id=$1',[extra])).rows[0].revision).toBe(0);
});
it('retains the immutable scan timestamp while allowing versioned supplier and invoice-date corrections',async()=>{
 const before=(await db.query<any>('select created_at from documents where id=$1',[docA])).rows[0].created_at;
 await db.query('select update_scan_metadata($1,$2,$3,$4,$5,$6)',[userA,org,docA,'Proveedor corregido','2026-10-20',0]);
 const d=(await db.query<any>('select *,invoice_date::text as invoice_date from documents where id=$1',[docA])).rows[0];expect(d.invoice_date).toBe('2026-10-20');expect(d.supplier).toBe('Proveedor corregido');expect(d.created_at).toEqual(before);
 await expect(db.query('select update_scan_metadata($1,$2,$3,$4,$5,$6)',[admin,org,docA,'Stale','2026-10-21',0])).rejects.toThrow(/Revision conflict/);
});
it('stores the extracted invoice date separately from upload time',async()=>{
 const claim=(await db.query<any>('select claim_extraction($1,$2,20) as claim',[jobA,userA])).rows[0].claim;
 await db.query('select finish_extraction($1,$2,$3,$4,$5,$6,$7,$8,$9)',[jobA,userA,{supplier:'New supplier',reference:'NEW',date:'2026-10-15',printedPageCount:1,printedTotal:null,warnings:[]},[],{},'test-model',1,null,claim.claim_token]);
 const d=(await db.query<any>('select invoice_date::text as invoice_date,metadata_revision from documents where id=$1',[docC])).rows[0];expect(d.invoice_date).toBe('2026-10-15');expect(d.metadata_revision).toBe(1);
});
it('permits re-scanning the same image into a new independent scan but never duplicates it inside one document',async()=>{
 const hash='a'.repeat(64);
 await db.query('insert into source_pages(org_id,document_id,object_path,content_hash,page_number) values($1,$2,$3,$4,1)',[org,docA,`${org}/${docA}/same.jpg`,hash]);
 await db.query('insert into source_pages(org_id,document_id,object_path,content_hash,page_number) values($1,$2,$3,$4,1)',[org,docB,`${org}/${docB}/same.jpg`,hash]);
 await expect(db.query('insert into source_pages(org_id,document_id,object_path,content_hash,page_number) values($1,$2,$3,$4,2)',[org,docA,`${org}/${docA}/copy.jpg`,hash])).rejects.toThrow(/unique constraint/);
});
it('creates another scan in the same hub without changing the already-open list',async()=>{
 const sid='30000000-0000-4000-8000-000000000013',did='40000000-0000-4000-8000-000000000014';
 await db.query('insert into receiving_sessions(id,org_id,hub_id,created_by) values($1,$2,$3,$4)',[sid,org,hubA,admin]);
 await db.query('insert into documents(id,org_id,session_id,supplier,reference) values($1,$2,$3,$4,$5)',[did,org,sid,'Second scan','SECOND']);
 expect((await asUser(userA,`select id from documents where session_id='${sid}'`)).rows).toHaveLength(1);
 expect((await db.query<any>('select review from invoice_rows where id=$1',[rowA])).rows[0].review.confirmedQuantity).toBe(9);
 expect((await asUser(userB,`select id from documents where id='${did}'`)).rows).toHaveLength(0);
});
it('does not let the bulk main-list confirmation pull a flagged suggestion into the output',async()=>{
 const flagged='60000000-0000-4000-8000-000000000014';
 await db.query(`insert into invoice_rows(id,org_id,document_id,source_row,raw_source,review) values($1,$2,$3,3,'{}','{"flags":["Size conflict"],"evidence":[],"resolvedFlags":[],"confirmed":false}')`,[flagged,org,docA]);
 await expect(db.query('select confirm_receiving_batch($1,$2,$3,$4)',[userA,org,docA,[{rowId:flagged,productId:product,quantity:2,revision:0}]])).rejects.toThrow(/individual confirmation/);
 expect((await db.query<any>('select revision from invoice_rows where id=$1',[flagged])).rows[0].revision).toBe(0);
});

it('keeps policy helpers outside the REST schema and unavailable to anonymous callers',async()=>{
 const functions=(await db.query<any>("select n.nspname,p.proname,has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.prosecdef and n.nspname in ('public','app_private')")).rows;
 expect(functions.filter(f=>f.nspname==='public'&&['is_member','can_access_hub','can_access_session','can_access_document','seed_hubs','set_event_hub','stamp_catalog_column'].includes(f.proname))).toHaveLength(0);
 expect(functions.some(f=>f.anon_execute)).toBe(false);
 expect((await asUser(userA,'select name from hubs')).rows.map(h=>h.name)).toEqual(['MH Contry']);
});
