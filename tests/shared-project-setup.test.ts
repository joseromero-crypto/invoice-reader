import {PGlite} from '@electric-sql/pglite';
import {it,expect} from 'vitest';
import fs from 'node:fs';
const setup=fs.readFileSync('supabase/shared-project/setup.sql','utf8').replace('create extension if not exists pgcrypto;','');
const tables=['organizations','members','catalog_imports','products','receiving_sessions','documents','source_pages','extraction_jobs','ai_daily_usage','invoice_rows','review_events','supplier_mappings','quantity_conversions','receipt_snapshots','hubs','hub_members'];
// A stand-in for the shared project: Supabase stubs, older default grants, and another app's objects.
async function sharedProject(){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
 create function storage.foldername(name text) returns text[] language sql immutable as $$select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1]$$;
 grant usage on schema storage to authenticated;grant select,insert on storage.objects to authenticated;
 alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
 alter default privileges in schema public grant all on functions to anon,authenticated,service_role;
 create table public.picks(id int);create table public.rec_events(id int);
 create function public.rec_alert_record() returns int language sql security definer set search_path=public as $$select 1$$;
 insert into storage.buckets(id,name,public) values('recibo','recibo',true);`);
 return db;
}
it('sets up the reader without touching other apps, with explicit grants and nothing for anon',async()=>{
 const db=await sharedProject();await db.exec(setup);
 const one=async<T=any>(sql:string,p:any[]=[])=>(await db.query<T>(sql,p)).rows[0];
 expect((await one(`select proconfig from pg_proc where proname='rec_alert_record'`)).proconfig).toEqual(['search_path=public']);
 expect(await one(`select count(*)::int n from public.organizations`)).toEqual({n:1});
 expect(await one(`select count(*)::int n from public.hubs where active`)).toEqual({n:8});
 for(const table of tables){
  const can=async(role:string,priv:string)=>(await one<{ok:boolean}>('select has_table_privilege($1,$2,$3) ok',[role,`public.${table}`,priv])).ok;
  for(const priv of ['select','insert','update','delete','truncate','references','trigger'])expect(await can('anon',priv),`anon ${priv} ${table}`).toBe(false);
  expect(await can('authenticated','select')).toBe(true);
  for(const priv of ['insert','update','delete'])expect(await can('authenticated',priv),`authenticated ${priv} ${table}`).toBe(false);
  for(const priv of ['select','insert','update','delete'])expect(await can('service_role',priv),`service_role ${priv} ${table}`).toBe(true);
 }
 const open=(await db.query<{name:string}>(`select p.oid::regprocedure::text as name from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','app_private') and p.proname<>'rec_alert_record' and has_function_privilege('anon',p.oid,'execute')`)).rows.map(r=>r.name);
 expect(open).toEqual([]);
},30000);
it('moves to the shared Masterview without touching other apps, with no anon access',async()=>{
 const db=await sharedProject();await db.exec(setup);
 await db.exec(`create table public.partial_events(id int);insert into storage.buckets(id,name,public) values('solcitudesarmado','solcitudesarmado',true),('sorting-hub','sorting-hub',true);`);
 await db.exec(fs.readFileSync('supabase/migrations/20261105120000_masterview_shared.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/migrations/20261105130000_retire_products.sql','utf8'));
 const one=async<T=any>(sql:string,p:any[]=[])=>(await db.query<T>(sql,p)).rows[0];
 for(const table of ['mv_imports','mv_products','mv_product_city']){
  const can=async(role:string,priv:string)=>(await one<{ok:boolean}>('select has_table_privilege($1,$2,$3) ok',[role,`public.${table}`,priv])).ok;
  for(const priv of ['select','insert','update','delete','truncate'])expect(await can('anon',priv),`anon ${priv} ${table}`).toBe(false);
  expect(await can('authenticated','select')).toBe(true);
  for(const priv of ['insert','update','delete'])expect(await can('authenticated',priv),`authenticated ${priv} ${table}`).toBe(false);
  for(const priv of ['select','insert','update','delete'])expect(await can('service_role',priv),`service_role ${priv} ${table}`).toBe(true);
  expect((await one<{r:boolean}>(`select relrowsecurity r from pg_class where oid='public.${table}'::regclass`)).r).toBe(true);
 }
 const open=(await db.query<{name:string}>(`select p.oid::regprocedure::text as name from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','app_private') and p.proname<>'rec_alert_record' and (has_function_privilege('anon',p.oid,'execute') or (p.proname like '%mv%' and has_function_privilege('authenticated',p.oid,'execute')))`)).rows.map(r=>r.name);
 expect(open).toEqual([]);
 expect((await one(`select public from storage.buckets where id='masterview'`)).public).toBe(true);
 expect(await one(`select to_regclass('public.products') p,to_regclass('public.catalog_imports') c,to_regclass('public.picks')::text k,to_regclass('public.rec_events')::text e,to_regclass('public.partial_events')::text a`)).toEqual({p:null,c:null,k:'picks',e:'rec_events',a:'partial_events'});
 expect((await one(`select proconfig from pg_proc where proname='rec_alert_record'`)).proconfig).toEqual(['search_path=public']);
 expect((await db.query(`select id from storage.buckets where id in('recibo','solcitudesarmado','sorting-hub')`)).rows).toHaveLength(3);
 expect((await db.query<any>(`select name from public.hubs where city is null and name<>'Pruebas de facturas'`)).rows).toEqual([]);
},30000);
it('applies nothing when a name is already in use',async()=>{
 const db=await sharedProject();await db.exec('create table public.products(id int);insert into storage.buckets(id,name) values(\'invoices\',\'invoices\')');
 await expect(db.exec(setup)).rejects.toThrow(/Name collision, nothing applied: .*public\.products.*bucket invoices/);
 await db.exec('rollback');
 expect((await db.query<{t:string|null}>(`select to_regclass('public.organizations')::text t`)).rows[0].t).toBeNull();
},30000);
