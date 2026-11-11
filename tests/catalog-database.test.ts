import {PGlite} from '@electric-sql/pglite';
import {beforeAll,afterAll,it,expect} from 'vitest';
import fs from 'node:fs';
import {parseMasterviewFile} from '../shared/catalog';
import {buildLatest,importPayload,planImport,type MvState} from '../shared/masterview';
const db=new PGlite();
const org='10000000-0000-4000-8000-000000000021',admin='20000000-0000-4000-8000-000000000021',receiver='20000000-0000-4000-8000-000000000022',outsider='20000000-0000-4000-8000-000000000023',legacy='50000000-0000-4000-8000-000000000021',lost='50000000-0000-4000-8000-000000000022';
const RETIRE='20261105130000_retire_products.sql';
const header='id,sku,Item,city,Código de Barras,Image URL,Proveedor,SKU Proveedor,Unidad de compra,Peso neto o piezas (por unidad de compra),Calii Unit';
const file=(city:string,rows:string[])=>parseMasterviewFile([header,...rows].join('\n'),`${city}.csv`);
const monterrey=()=>file('Monterrey',['101,AAA,Tomate huaje,Monterrey,750111,https://img/a,LALA,21541,Caja,12,pz','102,BBB,Queso,Monterrey,750222,https://img/b,Sigma,,,,pz']);
const cdmx=()=>file('CDMX',['901,AAA,Jitomate saladet,CDMX,750111,https://img/a,Otro,5,Caja,6,pz','902,CCC,Aceite local,CDMX,,https://img/c,Local,,,,pz']);
async function state():Promise<MvState>{return (await db.query<any>('select read_mv_state() s')).rows[0].s;}
async function write(actor:string,files:ReturnType<typeof file>[],hash:string,expected?:string|null){
 const s=await state(),plan=planImport(files,s,{confirmDrop:true}),p=importPayload(plan);
 return (await db.query<any>('select import_mv($1,$2,$3,$4,$5,$6,$7) r',[actor,hash,plan.report,expected===undefined?s.version:expected,p.p_cities,JSON.stringify(p.p_products),JSON.stringify(p.p_rows)])).rows[0].r;
}
async function asUser(user:string,sql:string){await db.exec(`set role authenticated;set request.jwt.claim.sub='${user}';`);try{return await db.query(sql);}finally{await db.exec('reset role;reset request.jwt.claim.sub;');}}
beforeAll(async()=>{
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;
 create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;
 create function storage.foldername(name text) returns text[] language sql immutable as $$select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1]$$;grant usage on schema storage to authenticated;grant select,insert on storage.objects to authenticated;`);
 for(const name of fs.readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')&&f<RETIRE).sort())await db.exec(fs.readFileSync(`supabase/migrations/${name}`,'utf8').replace('create extension if not exists pgcrypto;',''));
 await db.exec(`insert into organizations(id,name) values('${org}','Test');insert into auth.users values('${admin}'),('${receiver}'),('${outsider}');insert into members values('${org}','${admin}','admin'),('${org}','${receiver}','receiver');
 insert into products(id,org_id,external_id,sku,name,supplier,unit,raw) values('${legacy}','${org}','101','AAA','Tomate huaje','LALA','pz','{}'),('${lost}','${org}','777','ZZZ','Ya no existe','X','pz','{}');
 insert into supplier_mappings(org_id,supplier,supplier_sku,product_id,confirmed_by) values('${org}','LALA','28328','${legacy}','${admin}');`);
},30000);
afterAll(async()=>db.close());
it('lets only administrators import, and members read',async()=>{
 await expect(write(receiver,[monterrey()],'x')).rejects.toThrow(/administrator/);await expect(write(outsider,[monterrey()],'x')).rejects.toThrow(/administrator/);
 const result=await write(admin,[monterrey(),cdmx()],'first');expect(result.version).toBeTruthy();
 expect((await asUser(receiver,'select * from mv_products')).rows).toHaveLength(3);
 expect((await asUser(outsider,'select * from mv_products')).rows).toHaveLength(0);
 await expect(asUser(admin,`update mv_products set name='x'`)).rejects.toThrow(/permission denied/);
 await expect(asUser(admin,`select read_mv_state()`)).rejects.toThrow(/permission denied/);
});
it('stores the base row, regional names and only barcodes that differ',async()=>{
 const a=(await db.query<any>(`select * from mv_products where sku='AAA'`)).rows[0];
 expect(a).toMatchObject({name:'Tomate huaje',base_city:'Monterrey',barcode:'750111',image_url:'https://img/a',calii_unit:'pz'});
 const rows=(await db.query<any>(`select * from mv_product_city where sku='AAA' order by city`)).rows;
 expect(rows.map(r=>[r.city,r.retool_id,r.name,r.barcode,r.proveedor])).toEqual([['CDMX','901','Jitomate saladet',null,'Otro'],['Monterrey','101','Tomate huaje',null,'LALA']]);
 expect(rows[1].piezas_por_unidad).toBe('12');expect(rows[1].raw['Calii Sale Price']).toBeUndefined();
});
it('matching reads one city and keeps the columns match() needs',async()=>{
 const rows=(await db.query<any>(`select read_mv_catalog('Monterrey') c`)).rows[0].c;
 expect(rows.map((r:any)=>r.sku).sort()).toEqual(['AAA','BBB']);
 expect(rows.find((r:any)=>r.sku==='AAA').city_row.raw).toMatchObject({Proveedor:'LALA','SKU Proveedor':'21541','Unidad de compra':'Caja','Peso neto o piezas (por unidad de compra)':'12','Código de Barras':'750111'});
});
it('rejects a stale import and rolls back a failed one without touching anything',async()=>{
 const before=(await state()).version;
 await expect(write(admin,[monterrey()],'stale','90000000-0000-4000-8000-000000000000')).rejects.toThrow(/Revision conflict/);
 const s=await state(),plan=planImport([monterrey()],s),p=importPayload(plan);
 const bad=[...p.p_rows,{...p.p_rows[0],sku:'NO-EXISTE'}];
 await expect(db.query('select import_mv($1,$2,$3,$4,$5,$6,$7)',[admin,'bad',plan.report,s.version,p.p_cities,JSON.stringify(p.p_products),JSON.stringify(bad)])).rejects.toThrow();
 expect((await state()).version).toBe(before);expect((await db.query(`select id from mv_imports where source_hash='bad'`)).rows).toHaveLength(0);
});
it('a partial upload leaves the other cities and keeps product ids; a SKU retires only when no city has it',async()=>{
 const id=(await db.query<any>(`select id from mv_products where sku='CCC'`)).rows[0].id,monterreyImport=(await db.query<any>(`select import_id from mv_product_city where sku='BBB' and city='Monterrey'`)).rows[0].import_id;
 await write(admin,[file('CDMX',['901,AAA,Jitomate saladet,CDMX,750111,https://img/a,Otro,5,Caja,6,pz'])],'partial');
 expect((await db.query<any>(`select import_id from mv_product_city where sku='BBB' and city='Monterrey'`)).rows[0].import_id).toBe(monterreyImport);
 expect((await db.query(`select * from mv_product_city where sku='CCC'`)).rows).toHaveLength(0);
 const retired=(await db.query<any>(`select id,raw from mv_products where sku='CCC'`)).rows[0];expect(retired.id).toBe(id);expect(retired.raw.retired_at).toBeTruthy();
 expect((await db.query<any>(`select read_mv_catalog('CDMX') c`)).rows[0].c.map((r:any)=>r.sku)).toEqual(['AAA']);
 await write(admin,[cdmx()],'back');
 const back=(await db.query<any>(`select id,raw from mv_products where sku='CCC'`)).rows[0];expect(back.id).toBe(id);expect(back.raw.retired_at).toBeUndefined();
});
it('re-importing the same files reuses the import and moves its date',async()=>{
 const first=(await db.query<any>(`select id,uploaded_at from mv_imports where source_hash='first'`)).rows[0];
 const again=await write(admin,[monterrey(),cdmx()],'first');expect(again.version).toBe(first.id);
 expect((await state()).version).toBe(first.id);
 const latest=buildLatest(await state(),[{name:'MH Condesa',city:'CDMX',active:true},{name:'MH San Nicolás',city:'Monterrey',active:true},{name:'Pruebas de facturas',city:null,active:true}]);
 expect(latest.hubCities).toEqual({'mh-condesa':'CDMX','mh-san-nicolas':'Monterrey'});expect(Object.keys(latest.cityUpdatedAt).sort()).toEqual(['CDMX','Monterrey']);expect(latest.count).toBe(3);
});
it('confirms with either id during the switch, and snapshots the Masterview product',async()=>{
 const hub=(await db.query<any>('select id from hubs where org_id=$1 limit 1',[org])).rows[0].id;
 await db.query('insert into hub_members values($1,$2,$3)',[org,hub,admin]);
 const session=(await db.query<any>('insert into receiving_sessions(org_id,hub_id,created_by) values($1,$2,$3) returning id',[org,hub,admin])).rows[0].id;
 const doc=(await db.query<any>('insert into documents(org_id,session_id) values($1,$2) returning id',[org,session])).rows[0].id;
 const rows=(await db.query<any>(`insert into invoice_rows(org_id,document_id,source_row,raw_source,review) values($1,$2,1,'{}','{"flags":[],"confirmed":false}'),($1,$2,2,'{}','{"flags":[],"confirmed":false}') returning id`,[org,doc])).rows;
 const mv=(await db.query<any>(`select id from mv_products where sku='AAA'`)).rows[0].id;
 await db.query('select confirm_receiving_row($1,$2,$3,$4,$5,3,true,false,$6,0)',[admin,org,doc,rows[0].id,mv,{}]);
 await db.query('select confirm_receiving_row($1,$2,$3,$4,$5,3,true,false,$6,0)',[admin,org,doc,rows[1].id,legacy,{}]);
 const saved=(await db.query<any>('select id,review from invoice_rows where document_id=$1',[doc])).rows;
 expect(saved.find(r=>r.id===rows[0].id).review.product).toMatchObject({id:mv,sku:'AAA',name:'Tomate huaje',supplier:'LALA',supplierSku:'21541',barcode:'750111',unit:'pz'});
 expect(saved.find(r=>r.id===rows[1].id).review.product.id).toBe('101');
});
it('reports what does not map and refuses to retire products until it is resolved',async()=>{
 await db.query(`insert into supplier_mappings(org_id,supplier,supplier_sku,product_id,confirmed_by) values($1,'X','1',$2,$3)`,[org,lost,admin]);
 const report=(await db.query<any>('select mv_remap_learned() r')).rows[0].r;
 expect(report.mapped).toBe(1);expect(report.unmapped).toEqual([expect.objectContaining({table:'supplier_mappings',supplier:'X',code:'1',retoolId:'777',sku:'ZZZ'})]);
 const retire=fs.readFileSync(`supabase/migrations/${RETIRE}`,'utf8');
 await expect(db.exec(retire)).rejects.toThrow(/Unmapped rows, nothing retired/);await db.exec('rollback');
 expect((await db.query<any>(`select to_regclass('public.products')::text t`)).rows[0].t).toBe('products');
 await db.query(`delete from supplier_mappings where supplier='X'`);
 await db.exec(retire);
 expect((await db.query<any>(`select to_regclass('public.products') p,to_regclass('public.catalog_imports') c`)).rows[0]).toEqual({p:null,c:null});
 const mv=(await db.query<any>(`select id from mv_products where sku='AAA'`)).rows[0].id;
 expect((await db.query<any>('select supplier_sku,mv_product_id from supplier_mappings')).rows).toEqual([{supplier_sku:'28328',mv_product_id:mv}]);
 await expect(db.query(`select id from organizations where catalog_revision is null`)).rejects.toThrow(/catalog_revision/);
 await expect(db.query(`select read_catalog_snapshot($1)`,[org])).rejects.toThrow(/does not exist/);
 const row=(await db.query<any>(`select r.id,r.document_id from invoice_rows r where source_row=1`)).rows[0];
 await db.query('update invoice_rows set review=$2 where id=$1',[row.id,{flags:[],confirmed:false}]);
 const revision=(await db.query<any>('select revision from invoice_rows where id=$1',[row.id])).rows[0].revision;
 await db.query('select confirm_receiving_row($1,$2,$3,$4,$5,4,true,false,$6,$7)',[admin,org,row.document_id,row.id,mv,{},revision]);
 await expect(db.query('select confirm_receiving_row($1,$2,$3,$4,$5,4,true,false,$6,$7)',[admin,org,row.document_id,row.id,legacy,{},revision+1])).rejects.toThrow(/Product not found/);
 await db.exec(fs.readFileSync('supabase/migrations/20261105140000_confirm_hub_city_row.sql','utf8'));
 const confirmed=async(city:string|null,product=mv)=>{
  await db.query('update hubs set city=$2 where id=(select s.hub_id from documents d join receiving_sessions s on s.id=d.session_id where d.id=$1)',[row.document_id,city]);
  await db.query('update invoice_rows set review=$2 where id=$1',[row.id,{flags:[],confirmed:false}]);
  const {revision}=(await db.query<any>('select revision from invoice_rows where id=$1',[row.id])).rows[0];
  await db.query('select confirm_receiving_row($1,$2,$3,$4,$5,4,true,false,$6,$7)',[admin,org,row.document_id,row.id,product,{},revision]);
  return (await db.query<any>('select review from invoice_rows where id=$1',[row.id])).rows[0].review.product.name;
 };
 expect(await confirmed('CDMX')).toBe('Jitomate saladet');
 expect(await confirmed('Monterrey')).toBe('Tomate huaje');
 expect(await confirmed(null)).toBe('Tomate huaje');
 expect(await confirmed('Saltillo')).toBe('Tomate huaje');
});
it('saves each city file\'s Tiers as text, overwrites it on re-upload, and leaves it null without the column',async()=>{
 // inventario-conf owns the column on armado-ch; this stands in for its migration.
 await db.exec(`alter table mv_product_city add column tiers text;`);
 await db.exec(fs.readFileSync('supabase/migrations/20261111120000_import_mv_tiers.sql','utf8'));
 const withTiers=(city:string,tiers:string[],rows:string[])=>parseMasterviewFile([`${header},Tiers`,...rows.map((r,i)=>`${r},${tiers[i]}`)].join('\n'),`${city}.csv`);
 const mty=(t:string[])=>withTiers('Monterrey',t,['101,AAA,Tomate huaje,Monterrey,750111,https://img/a,LALA,21541,Caja,12,pz','102,BBB,Queso,Monterrey,750222,https://img/b,Sigma,,,,pz']);
 const tiers=async()=>Object.fromEntries((await db.query<any>(`select sku||'/'||city k,tiers from mv_product_city order by 1`)).rows.map(r=>[r.k,r.tiers]));
 await write(admin,[mty([' 3 ','C']),withTiers('CDMX',['0',''],['901,AAA,Jitomate saladet,CDMX,750111,https://img/a,Otro,5,Caja,6,pz','902,CCC,Aceite local,CDMX,,https://img/c,Local,,,,pz'])],'tiers-1');
 expect(await tiers()).toEqual({'AAA/CDMX':'0','AAA/Monterrey':'3','BBB/Monterrey':'C','CCC/CDMX':null});
 await write(admin,[mty(['8',''])],'tiers-2');
 expect(await tiers()).toEqual({'AAA/CDMX':'0','AAA/Monterrey':'8','BBB/Monterrey':null,'CCC/CDMX':null});
 await write(admin,[monterrey()],'tiers-3');
 expect((await tiers())['AAA/Monterrey']).toBeNull();
 expect((await db.query<any>(`select raw from mv_product_city where sku='AAA' and city='Monterrey'`)).rows[0].raw.Tiers).toBeUndefined();
});
