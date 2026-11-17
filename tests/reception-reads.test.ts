import {PGlite} from '@electric-sql/pglite';
import {it,expect} from 'vitest';
import fs from 'node:fs';
import {match,type CatalogItem} from '../lean/match.ts';
import {receptionRecord} from '../lean/reception.ts';
import type {Transcription} from '../lean/transcribe.ts';
const read=(f:string)=>fs.readFileSync(f,'utf8').replace('create extension if not exists pgcrypto;','');
const org='10000000-0000-4000-8000-000000000031',receiver='20000000-0000-4000-8000-000000000031',outsider='20000000-0000-4000-8000-000000000032';
// The shared-project stand-in (see shared-project-setup.test.ts), then the Masterview move and this migration.
async function project(){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
 create function storage.foldername(name text) returns text[] language sql immutable as $$select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1]$$;
 grant usage on schema storage to authenticated;grant select,insert on storage.objects to authenticated;
 alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
 alter default privileges in schema public grant all on functions to anon,authenticated,service_role;`);
 await db.exec(read('supabase/shared-project/setup.sql'));
 await db.exec(read('supabase/migrations/20261105120000_masterview_shared.sql'));
 await db.exec(read('supabase/migrations/20261117120000_reception_reads.sql'));
 await db.exec(read('supabase/migrations/20261118120000_reception_external_ref.sql'));
 return db;
}
const t:Transcription={supplier:'COMERCIALIZADORA DE LACTEOS',documentRef:'CWB-1',date:'17/11/2026',quantityColumns:['PIEZAS'],printedTotals:[],rows:[
 {photo:1,codes:[{header:'CLAVE',value:'21541'}],description:'LECHE ENTERA 1L',quantities:['12'],unit:null,mark:'none',note:null},
 {photo:1,codes:[{header:'CLAVE',value:'99'}],description:'LECHE DESL LIGHT 1L',quantities:['6'],unit:null,mark:'none',note:null}]};
const catalog:CatalogItem[]=[
 {id:'a',name:'Leche entera LALA 1L',sku:'LAL-1',supplier:'LALA',supplierSku:'21541',barcodes:[],purchaseUnit:'Pieza',perPurchaseUnit:1},
 {id:'b',name:'Leche deslactosada light LALA 1L',sku:'LAL-2',supplier:'LALA',supplierSku:'',barcodes:[],purchaseUnit:'Pieza',perPurchaseUnit:1}];

it('returns reception reads only, newest first, with the record rows and RLS applied',async()=>{
 const db=await project();
 const result=match(t,catalog,new Map(),{mode:'recepcion'});
 const raw={supplier:'LALA',reference:'CWB-1',matchedSupplier:'LALA',totalsOk:null,warnings:[],purpose:'recepcion',transcription:t,reception:receptionRecord(t,result)};
 await db.exec(`insert into auth.users values('${receiver}'),('${outsider}');insert into organizations(id,name) values('${org}','Test');
 insert into members values('${org}','${receiver}','receiver');
 update hubs set city='Monterrey' where org_id='${org}';
 insert into hub_members select org_id,id,'${receiver}' from hubs where org_id='${org}' and name='MH Cumbres';`);
 const hub=(await db.query<any>(`select id from hubs where org_id='${org}' and name='MH Cumbres'`)).rows[0].id;
 const other=(await db.query<any>(`select id from hubs where org_id='${org}' and name='MH Contry'`)).rows[0].id;
 const doc=async(hubId:string,purpose:string,at:string,job?:{status:string;raw?:any;error?:string})=>{
  const s=(await db.query<any>(`insert into receiving_sessions(org_id,hub_id,created_by) values($1,$2,$3) returning id`,[org,hubId,receiver])).rows[0].id;
  const d=(await db.query<any>(`insert into documents(org_id,session_id,purpose,reference,created_at) values($1,$2,$3,'CWB-1',$4) returning id`,[org,s,purpose,at])).rows[0].id;
  if(job)await db.query(`insert into extraction_jobs(org_id,document_id,requested_by,status,raw_result,error) values($1,$2,$3,$4,$5,$6)`,[org,d,receiver,job.status,job.raw??null,job.error??null]);
  return d;
 };
 const first=await doc(hub,'recepcion','2026-11-17T10:00:00Z',{status:'complete',raw});
 const again=await doc(hub,'recepcion','2026-11-17T11:00:00Z',{status:'complete',raw});
 const failed=await doc(hub,'recepcion','2026-11-17T12:00:00Z',{status:'failed',error:'No se pudo leer la factura'});
 const reading=await doc(hub,'recepcion','2026-11-17T13:00:00Z',{status:'processing'});
 const dead=await doc(hub,'recepcion','2026-11-17T13:30:00Z',{status:'queued'});await db.query(`update extraction_jobs set created_at=now()-interval '1 hour' where document_id=$1`,[dead]);
 await doc(hub,'captura','2026-11-17T14:00:00Z',{status:'complete',raw:{...raw,purpose:'captura'}});
 await doc(other,'recepcion','2026-11-17T15:00:00Z',{status:'complete',raw});

 const all=(await db.query<any>(`select * from reception_reads($1,null)`,[hub])).rows;
 expect(all.map(r=>r.read_id)).toEqual([dead,reading,failed,again,first]);
 expect(all.map(r=>r.status)).toEqual(['failed','processing','failed','done','done']);
 expect(all[0]).toMatchObject({error:'La lectura no terminó.'});
 all.shift();
 expect(all[1]).toMatchObject({error:'No se pudo leer la factura',rows:[]});
 expect(all[0].rows).toEqual([]);
 const done=all[3];
 expect(done).toMatchObject({contract_version:1,hub_id:hub,hub_name:'MH Cumbres',hub_city:'Monterrey',requested_by:receiver,supplier:'LALA',printed_supplier:'COMERCIALIZADORA DE LACTEOS',reference:'CWB-1',totals_ok:null,warnings:[],error:null});
 expect(done.rows).toHaveLength(2);
 expect(done.rows[0]).toMatchObject({sourceRow:1,sku:'LAL-1',matchedBy:'supplierSku',confident:true,piezas:12,quantityOk:true});
 expect(done.rows[1]).toMatchObject({sourceRow:2,sku:null,matchedBy:null,confident:false,piezas:6});
 expect(done.rows[1].candidates[0]).toMatchObject({sku:'LAL-2'});
 expect((await db.query<any>(`select read_id from reception_reads(null,'2026-11-17T11:30:00Z')`)).rows).toHaveLength(4); // other hub too
 await db.query(`update documents set external_ref='mh-cumbres__pd-lala__2026-11-17__1' where id=$1`,[again]);
 expect((await db.query<any>(`select read_id,external_ref from reception_reads(p_external_ref=>'mh-cumbres__pd-lala__2026-11-17__1')`)).rows).toEqual([{read_id:again,external_ref:'mh-cumbres__pd-lala__2026-11-17__1'}]);
 expect((await db.query<any>(`select allowed_mime_types from storage.buckets where id='invoices'`)).rows[0].allowed_mime_types).toContain('image/webp');

 const as=async(user:string,sql:string)=>{await db.exec(`set role authenticated;set request.jwt.claim.sub='${user}';`);try{return (await db.query<any>(sql)).rows;}finally{await db.exec('reset role;reset request.jwt.claim.sub;');}};
 expect(await as(receiver,`select read_id from reception_reads(null,null)`)).toHaveLength(5); // only the hub they belong to
 expect(await as(outsider,`select read_id from reception_reads(null,null)`)).toHaveLength(0);
 const can=async(role:string)=>(await db.query<any>(`select has_function_privilege($1,'public.reception_reads(uuid,timestamptz,text)','execute') ok`,[role])).rows[0].ok;
 expect([await can('anon'),await can('authenticated'),await can('service_role')]).toEqual([false,true,true]);
 await expect(db.query(`insert into documents(org_id,session_id,purpose) select org_id,session_id,'otro' from documents limit 1`)).rejects.toThrow(/check/);
},30000);
