-- One Masterview for all four apps. Additive: the live site keeps working on products until
-- 20261105130000_retire_products.sql runs, which must wait until this code is deployed.
-- Every object is named here; the database is shared with Armado CH, Sorting Hub and MH Recibo.
begin;
create table public.mv_imports(
 id uuid primary key default gen_random_uuid(),
 uploaded_at timestamptz not null default now(),
 uploaded_by uuid references auth.users,
 source_hash text not null unique,
 report jsonb not null);
create table public.mv_products(
 id uuid primary key default gen_random_uuid(),
 sku text not null unique,
 name text not null,
 base_city text not null,
 barcode text,
 image_url text,full_res_image_url text,
 calii_unit text,marca text,description text,main_category text,temp text,
 raw jsonb not null,
 import_id uuid not null references public.mv_imports);
create table public.mv_product_city(
 sku text not null references public.mv_products(sku) on delete cascade,
 city text not null,
 retool_id text not null,
 name text not null,
 barcode text,
 proveedor text,sku_proveedor text,
 unidad_compra text,piezas_por_unidad numeric,
 deshabilitar_compras boolean,
 raw jsonb not null,
 import_id uuid not null references public.mv_imports,
 primary key(sku,city));
create index mv_product_city_barcode on public.mv_product_city(barcode);
create index mv_product_city_supplier on public.mv_product_city(proveedor,sku_proveedor);
create index mv_product_city_retool on public.mv_product_city(city,retool_id);
create index mv_products_barcode on public.mv_products(barcode);
-- These tables have no org_id: any member of any organization may read them.
create function app_private.is_any_member() returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from members where user_id=auth.uid())$$;
revoke all on function app_private.is_any_member() from public,anon,authenticated;
grant execute on function app_private.is_any_member() to authenticated,service_role;
alter table public.mv_imports enable row level security;
alter table public.mv_products enable row level security;
alter table public.mv_product_city enable row level security;
create policy member_read on public.mv_imports for select to authenticated using(app_private.is_any_member());
create policy member_read on public.mv_products for select to authenticated using(app_private.is_any_member());
create policy member_read on public.mv_product_city for select to authenticated using(app_private.is_any_member());
revoke all on public.mv_imports,public.mv_products,public.mv_product_city from anon,authenticated;
grant select on public.mv_imports,public.mv_products,public.mv_product_city to authenticated;
grant select,insert,update,delete on public.mv_imports,public.mv_products,public.mv_product_city to service_role;
-- Public read by URL, like sorting-hub/imagedb. No storage policies: only the service role writes.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('masterview','masterview',true,10000000,array['application/json','text/plain']) on conflict(id) do nothing;
alter table public.hubs add column city text;
update public.hubs set city=case
 when name in ('MH Contry','MH Cumbres','MH Guadalupe','MH San Nicolás','CH Guadalupe') then 'Monterrey'
 when name='MH Avícola' then 'Saltillo'
 when name='MH Zapopan' then 'Guadalajara'
 when name='MH Condesa' then 'CDMX' end;
-- Learned knowledge moves to mv_products.id. product_id stays until the retire migration, for the code still live.
alter table public.supplier_mappings alter column product_id drop not null;
alter table public.supplier_mappings add column mv_product_id uuid references public.mv_products(id);
alter table public.quantity_conversions add column mv_product_id uuid references public.mv_products(id);
-- products.external_id is the Monterrey Retool id. Fills only what is still empty, so it can run again.
create function public.mv_remap_learned() returns jsonb language plpgsql security definer set search_path=public as $$
declare mapped integer;converted integer;begin
 update supplier_mappings m set mv_product_id=mp.id from products p join mv_product_city c on c.city='Monterrey' and c.retool_id=p.external_id join mv_products mp on mp.sku=c.sku where m.mv_product_id is null and p.org_id=m.org_id and p.id=m.product_id;
 get diagnostics mapped=row_count;
 update quantity_conversions q set mv_product_id=mp.id from products p join mv_product_city c on c.city='Monterrey' and c.retool_id=p.external_id join mv_products mp on mp.sku=c.sku where q.mv_product_id is null and p.org_id=q.org_id and p.id=q.product_id;
 get diagnostics converted=row_count;
 return jsonb_build_object('mapped',mapped,'converted',converted,
 'skuChanged',(select coalesce(jsonb_agg(jsonb_build_object('supplier',m.supplier,'code',m.supplier_sku,'was',p.sku,'now',mp.sku)),'[]'::jsonb) from supplier_mappings m join products p on p.id=m.product_id join mv_products mp on mp.id=m.mv_product_id where p.sku<>mp.sku),
 'unmapped',(select coalesce(jsonb_agg(u),'[]'::jsonb) from (
  select jsonb_build_object('table','supplier_mappings','supplier',m.supplier,'code',m.supplier_sku,'retoolId',p.external_id,'sku',p.sku,'name',p.name) u from supplier_mappings m left join products p on p.id=m.product_id where m.mv_product_id is null
  union all select jsonb_build_object('table','quantity_conversions','supplier',q.supplier,'code',q.source_unit,'retoolId',p.external_id,'sku',p.sku,'name',p.name) from quantity_conversions q left join products p on p.id=q.product_id where q.mv_product_id is null) x));
end$$;
revoke all on function public.mv_remap_learned() from public,anon,authenticated;
grant execute on function public.mv_remap_learned() to service_role;
-- During the switch a confirmation may come from either version of the site: new code sends mv_products.id, live code products.id.
create or replace function public.confirm_receiving_row_v1(p_actor uuid,p_org uuid,p_document uuid,p_row uuid,p_product uuid,p_quantity integer,p_identity boolean,p_mapping boolean,p_corrections jsonb default '{}'::jsonb) returns void language plpgsql security definer set search_path=public,app_private as $$
declare old invoice_rows; product jsonb; legacy boolean:=false; updated jsonb; supplier_name text;
begin
 if not p_identity or p_quantity<0 or not exists(select 1 from members where org_id=p_org and user_id=p_actor) then raise exception 'Invalid confirmation';end if;
 select * into old from invoice_rows where id=p_row and org_id=p_org and document_id=p_document for update;
 if not found then raise exception 'Row not found';end if;
 perform 1 from documents d join receiving_sessions s on s.id=d.session_id where d.id=p_document and d.org_id=p_org and s.status='open' for update of s;
 if not found then raise exception 'Receipt is closed';end if;
 select jsonb_build_object('id',p.id,'sku',p.sku,'name',coalesce(c.name,p.name),'supplier',coalesce(c.proveedor,''),'supplierSku',c.sku_proveedor,'barcode',coalesce(c.barcode,p.barcode),'unit',coalesce(p.calii_unit,'desconocida')) into product from mv_products p left join mv_product_city c on c.sku=p.sku and c.city=p.base_city where p.id=p_product;
 if product is null then
 select jsonb_build_object('id',p.external_id,'sku',p.sku,'name',p.name,'supplier',p.supplier,'supplierSku',p.supplier_sku,'barcode',p.barcode,'unit',p.unit) into product from products p where p.id=p_product and p.org_id=p_org;
 legacy:=true;
 end if;
 if product is null then raise exception 'Product not found';end if;
 updated=old.review||jsonb_build_object('product',product,'proposalEvidence',coalesce(old.review->'proposalEvidence',old.review->'evidence'),'evidence',jsonb_build_array('Identidad y cantidad verificadas por receptor'),'corrections',p_corrections,'actualQuantity',p_quantity,'confirmedQuantity',p_quantity,'confirmed',true,'resolvedFlags',coalesce(old.review->'resolvedFlags','[]')||coalesce(old.review->'flags','[]'),'flags','[]'::jsonb);
 update invoice_rows set review=updated where id=p_row;
 insert into review_events(org_id,actor,row_id,action,before_value,after_value) values(p_org,p_actor,p_row,'Confirmación física',old.review,updated);
 if p_mapping then
 select supplier into supplier_name from documents where id=p_document;
 if nullif(old.raw_source->>'supplierSku','') is null or supplier_name is null then raise exception 'Supplier and SKU required for mapping';end if;
 insert into supplier_mappings(org_id,supplier,supplier_sku,product_id,mv_product_id,confirmed_by) values(p_org,supplier_name,old.raw_source->>'supplierSku',case when legacy then p_product end,case when not legacy then p_product end,p_actor) on conflict(org_id,supplier,supplier_sku) do update set product_id=excluded.product_id,mv_product_id=excluded.mv_product_id,confirmed_by=p_actor,confirmed_at=now();
 insert into review_events(org_id,actor,row_id,action,after_value) values(p_org,p_actor,p_row,'Mapeo confirmado explícitamente',jsonb_build_object('product_id',p_product));
 end if;
end$$;
-- One transaction: a failed import writes nothing. Called once per upload with what shared/masterview.ts planned.
-- The function-level statement_timeout is what PostgREST applies; the API default is a few seconds on this project.
create function public.import_mv(p_actor uuid,p_hash text,p_report jsonb,p_expected uuid,p_cities text[],p_products jsonb,p_rows jsonb) returns jsonb language plpgsql security definer set search_path=public set statement_timeout='300s' as $$
declare current_version uuid;run_id uuid;stamped timestamptz;begin
 if not exists(select 1 from members where user_id=p_actor and role='admin') then raise exception 'Catalog administrator required';end if;
 if coalesce(array_length(p_cities,1),0)<1 or jsonb_array_length(p_rows)<1 then raise exception 'Empty import';end if;
 lock table mv_imports in exclusive mode;
 select id into current_version from mv_imports order by uploaded_at desc limit 1;
 if current_version is distinct from p_expected then raise exception 'Revision conflict: Masterview changed during the import';end if;
 insert into mv_imports(uploaded_by,source_hash,report) values(p_actor,p_hash,p_report) on conflict(source_hash) do update set uploaded_at=now(),uploaded_by=excluded.uploaded_by,report=excluded.report returning id,uploaded_at into run_id,stamped;
 insert into mv_products(sku,name,base_city,barcode,image_url,full_res_image_url,calii_unit,marca,description,main_category,temp,raw,import_id)
 select x.sku,x.name,x.base_city,x.barcode,x.image_url,x.full_res_image_url,x.calii_unit,x.marca,x.description,x.main_category,x.temp,x.raw,run_id from jsonb_to_recordset(p_products) as x(sku text,name text,base_city text,barcode text,image_url text,full_res_image_url text,calii_unit text,marca text,description text,main_category text,temp text,raw jsonb)
 on conflict(sku) do update set name=excluded.name,base_city=excluded.base_city,barcode=excluded.barcode,image_url=excluded.image_url,full_res_image_url=excluded.full_res_image_url,calii_unit=excluded.calii_unit,marca=excluded.marca,description=excluded.description,main_category=excluded.main_category,temp=excluded.temp,raw=excluded.raw,import_id=excluded.import_id;
 create temp table mv_incoming on commit drop as select * from jsonb_to_recordset(p_rows) as x(sku text,city text,retool_id text,name text,proveedor text,sku_proveedor text,unidad_compra text,piezas_por_unidad numeric,deshabilitar_compras boolean,raw jsonb);
 if exists(select 1 from mv_incoming where not city=any(p_cities)) then raise exception 'Row outside the uploaded cities';end if;
 delete from mv_product_city c where c.city=any(p_cities) and not exists(select 1 from mv_incoming i where i.sku=c.sku and i.city=c.city);
 insert into mv_product_city(sku,city,retool_id,name,proveedor,sku_proveedor,unidad_compra,piezas_por_unidad,deshabilitar_compras,raw,import_id)
 select sku,city,retool_id,name,proveedor,sku_proveedor,unidad_compra,piezas_por_unidad,deshabilitar_compras,raw,run_id from mv_incoming
 on conflict(sku,city) do update set retool_id=excluded.retool_id,name=excluded.name,proveedor=excluded.proveedor,sku_proveedor=excluded.sku_proveedor,unidad_compra=excluded.unidad_compra,piezas_por_unidad=excluded.piezas_por_unidad,deshabilitar_compras=excluded.deshabilitar_compras,raw=excluded.raw,import_id=excluded.import_id;
 -- A city's barcode column holds only a difference from the product's; a changed base row can change it in any city.
 update mv_product_city c set barcode=d.own from(select c2.sku,c2.city,case when nullif(c2.raw->>'Código de Barras','') is distinct from p.barcode then nullif(c2.raw->>'Código de Barras','') end own from mv_product_city c2 join mv_products p on p.sku=c2.sku) d where d.sku=c.sku and d.city=c.city and c.barcode is distinct from d.own;
 return jsonb_build_object('version',run_id,'uploadedAt',stamped);
end$$;
revoke all on function public.import_mv(uuid,text,jsonb,uuid,text[],jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.import_mv(uuid,text,jsonb,uuid,text[],jsonb,jsonb) to service_role;
-- What the importer and latest.json work from, in one snapshot.
create function public.read_mv_state() returns jsonb language sql stable security definer set search_path=public set statement_timeout='60s' as $$
 select jsonb_build_object(
 'version',(select id from mv_imports order by uploaded_at desc limit 1),
 'imports',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'uploaded_at',uploaded_at)),'[]'::jsonb) from mv_imports),
 'products',(select coalesce(jsonb_agg(to_jsonb(p)-'import_id'),'[]'::jsonb) from mv_products p),
 'cities',(select coalesce(jsonb_agg(jsonb_build_object('sku',c.sku,'city',c.city,'name',c.name,'bc',c.raw->>'Código de Barras','import_id',c.import_id)),'[]'::jsonb) from mv_product_city c))
$$;
-- What matching reads: current products with their row in one city.
create function public.read_mv_catalog(p_city text) returns jsonb language sql stable security definer set search_path=public set statement_timeout='60s' as $$
 select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('city_row',to_jsonb(c)) order by p.id),'[]'::jsonb) from mv_products p join mv_product_city c on c.sku=p.sku and c.city=p_city where p.raw->>'retired_at' is null
$$;
-- Rows per city and when each city was last replaced, for the Masterview screen.
create function public.mv_city_status() returns table(city text,"rows" bigint,updated_at timestamptz) language sql stable security definer set search_path=public as $$
 select c.city,count(*),max(i.uploaded_at) from mv_product_city c join mv_imports i on i.id=c.import_id group by c.city
$$;
revoke all on function public.read_mv_state(),public.read_mv_catalog(text),public.mv_city_status() from public,anon,authenticated;
grant execute on function public.read_mv_state(),public.read_mv_catalog(text),public.mv_city_status() to service_role;
commit;
