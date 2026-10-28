import {PGlite} from '@electric-sql/pglite';
import {beforeAll,afterAll,it,expect} from 'vitest';
import fs from 'node:fs';
const db=new PGlite();
const org='10000000-0000-4000-8000-000000000021',admin='20000000-0000-4000-8000-000000000021',receiver='20000000-0000-4000-8000-000000000022',outsider='20000000-0000-4000-8000-000000000023';
const product={id:'0001',sku:'A001',name:'Nombre EXACTO del CSV',supplier:'Proveedor',supplierSku:'00004',barcode:'0000123',unit:'pz',raw:{id:'0001',sku:'A001',Item:'Nombre EXACTO del CSV',Description:'Nota'}};
let version:string;
beforeAll(async()=>{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
 create function storage.foldername(name text) returns text[] language sql immutable as $$select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1]$$;grant usage on schema storage to authenticated;grant select,insert on storage.objects to authenticated;`);
 for(const file of fs.readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort())await db.exec(fs.readFileSync(`supabase/migrations/${file}`,'utf8').replace('create extension if not exists pgcrypto;',''));
 await db.exec(`insert into organizations(id,name) values('${org}','Test');insert into auth.users values('${admin}'),('${receiver}'),('${outsider}');insert into members values('${org}','${admin}','admin'),('${org}','${receiver}','receiver');`);
},30000);
afterAll(async()=>db.close());
async function apply(actor:string,products:unknown[],expected:string|null,hash='first'){return (await db.query<any>('select import_masterview($1,$2,$3,$4,$5,$6) as result',[org,actor,hash,{nameColumn:'Item',sourceName:'Masterview.csv'},products,expected])).rows[0].result;}
async function asUser(user:string,sql:string){await db.exec(`set role authenticated;set request.jwt.claim.sub='${user}';`);try{return await db.query(sql);}finally{await db.exec('reset role;reset request.jwt.claim.sub;');}}
it('restricts imports and raw catalog file uploads to authorized administrators',async()=>{
 await expect(apply(receiver,[product],null)).rejects.toThrow(/administrator/);await expect(apply(outsider,[product],null)).rejects.toThrow(/administrator/);
 await expect(asUser(receiver,`insert into storage.objects(bucket_id,name) values('catalogs','${org}/test.csv')`)).rejects.toThrow(/row-level security/);
 await asUser(admin,`insert into storage.objects(bucket_id,name) values('catalogs','${org}/test.csv')`);
});
it('imports exact names, raw fields and leading zeros in a single transaction',async()=>{
 const result=await apply(admin,[product],null);version=result.version;expect(result.added).toBe(1);
 const saved=(await db.query<any>('select * from products where org_id=$1',[org])).rows[0];expect(saved.external_id).toBe('0001');expect(saved.name).toBe(product.name);expect(saved.barcode).toBe('0000123');expect(saved.raw.Description).toBe('Nota');
});
it('keeps confirmed snapshots and mappings while adding new IDs and updating current catalog names',async()=>{
 const saved=(await db.query<any>('select id from products where org_id=$1',[org])).rows[0].id;
 await db.query('insert into supplier_mappings(org_id,supplier,supplier_sku,product_id,confirmed_by) values($1,$2,$3,$4,$5)',[org,'Proveedor','00004',saved,admin]);
 const hub=(await db.query<any>('select id from hubs where org_id=$1 limit 1',[org])).rows[0].id;
 const session=(await db.query<any>('insert into receiving_sessions(org_id,hub_id,created_by) values($1,$2,$3) returning id',[org,hub,admin])).rows[0].id;
 await db.query('insert into receipt_snapshots(org_id,session_id,snapshot,created_by) values($1,$2,$3,$4)',[org,session,{product},admin]);
 const result=await apply(admin,[{...product,name:'Nombre actualizado'}, {...product,id:'0002',sku:'A002',name:'Producto nuevo'}],version,'second');version=result.version;expect(result.updated).toBe(1);expect(result.added).toBe(1);
 expect((await db.query<any>('select snapshot from receipt_snapshots')).rows[0].snapshot.product.name).toBe(product.name);
 expect((await db.query<any>('select product_id from supplier_mappings')).rows[0].product_id).toBe(saved);
});
it('reimporting a partial export keeps omitted products and does not duplicate IDs',async()=>{
 const result=await apply(admin,[{...product,name:'Nombre actualizado'}],version,'second-partial');version=result.version;expect(result.count).toBe(2);expect(result.added).toBe(0);expect(result.unchanged).toBe(1);
});
it('rejects stale concurrent imports before changing any product',async()=>{
 await expect(apply(admin,[{...product,name:'Stale import'}],null,'stale')).rejects.toThrow(/Revision conflict/);
 expect((await db.query<any>("select name from products where external_id='0001'")).rows[0].name).toBe('Nombre actualizado');
});
it('rolls back malformed duplicate IDs without changing the catalog version',async()=>{
 await expect(apply(admin,[product,product],version,'bad')).rejects.toThrow(/Duplicate catalog IDs/);
 expect((await db.query<any>('select catalog_revision from organizations where id=$1',[org])).rows[0].catalog_revision).toBe(version);
});

it('reads a consistent company catalog and stamps the selected source column on row snapshots',async()=>{
 const all=(await db.query<any>('select read_catalog_snapshot($1) as catalog',[org])).rows[0].catalog;expect(all).toHaveLength(2);expect(all[0].catalog_imports.report.nameColumn).toBe('Item');
 const session=(await db.query<any>('select id from receiving_sessions limit 1')).rows[0].id;
 const doc=(await db.query<any>('insert into documents(org_id,session_id) values($1,$2) returning id',[org,session])).rows[0].id;
 await db.query('insert into invoice_rows(org_id,document_id,source_row,raw_source,review) values($1,$2,1,$3,$4)',[org,doc,{}, {product:{id:'0001',name:'Nombre actualizado'}}]);
 expect((await db.query<any>('select review from invoice_rows where document_id=$1',[doc])).rows[0].review.product.nameColumn).toBe('Item');
});
