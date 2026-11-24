-- import_mv writes only the city rows that are new or changed. It used to rewrite all ~18,400 on every upload, which kept
-- the shared database busy for up to a minute. mv_product_city.import_id now means "the import that last changed this row".
-- Same signature and grants. Needs the tiers column (inventario-conf). Run once in the SQL editor of armado-ch.
begin;
create or replace function public.import_mv(p_actor uuid,p_hash text,p_report jsonb,p_expected uuid,p_cities text[],p_products jsonb,p_rows jsonb) returns jsonb language plpgsql security definer set search_path=public set statement_timeout='300s' as $$
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
 create temp table mv_incoming on commit drop as select * from jsonb_to_recordset(p_rows) as x(sku text,city text,retool_id text,name text,proveedor text,sku_proveedor text,unidad_compra text,piezas_por_unidad numeric,deshabilitar_compras boolean,tiers text,raw jsonb);
 analyze mv_incoming;
 if exists(select 1 from mv_incoming where not city=any(p_cities)) then raise exception 'Row outside the uploaded cities';end if;
 delete from mv_product_city c where c.city=any(p_cities) and not exists(select 1 from mv_incoming i where i.sku=c.sku and i.city=c.city);
 -- Compared before writing: ON CONFLICT ... WHERE would still lock (and so write) every unchanged row.
 insert into mv_product_city(sku,city,retool_id,name,proveedor,sku_proveedor,unidad_compra,piezas_por_unidad,deshabilitar_compras,tiers,raw,import_id)
 select i.sku,i.city,i.retool_id,i.name,i.proveedor,i.sku_proveedor,i.unidad_compra,i.piezas_por_unidad,i.deshabilitar_compras,i.tiers,i.raw,run_id from mv_incoming i left join mv_product_city c on c.sku=i.sku and c.city=i.city
 where c.sku is null or (c.retool_id,c.name,c.proveedor,c.sku_proveedor,c.unidad_compra,c.piezas_por_unidad,c.deshabilitar_compras,c.tiers,c.raw) is distinct from (i.retool_id,i.name,i.proveedor,i.sku_proveedor,i.unidad_compra,i.piezas_por_unidad,i.deshabilitar_compras,i.tiers,i.raw)
 on conflict(sku,city) do update set retool_id=excluded.retool_id,name=excluded.name,proveedor=excluded.proveedor,sku_proveedor=excluded.sku_proveedor,unidad_compra=excluded.unidad_compra,piezas_por_unidad=excluded.piezas_por_unidad,deshabilitar_compras=excluded.deshabilitar_compras,tiers=excluded.tiers,raw=excluded.raw,import_id=excluded.import_id;
 -- A city's barcode column holds only a difference from the product's; a changed base row can change it in any city.
 update mv_product_city c set barcode=d.own from(select c2.sku,c2.city,case when nullif(c2.raw->>'Código de Barras','') is distinct from p.barcode then nullif(c2.raw->>'Código de Barras','') end own from mv_product_city c2 join mv_products p on p.sku=c2.sku where c2.import_id=run_id or p.import_id=run_id) d where d.sku=c.sku and d.city=c.city and c.barcode is distinct from d.own;
 return jsonb_build_object('version',run_id,'uploadedAt',stamped);
end$$;
revoke all on function public.import_mv(uuid,text,jsonb,uuid,text[],jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.import_mv(uuid,text,jsonb,uuid,text[],jsonb,jsonb) to service_role;
-- A city's date comes from the reports: its rows' import_id no longer moves when they didn't change.
create or replace function public.mv_city_status() returns table(city text,"rows" bigint,updated_at timestamptz) language sql stable security definer set search_path=public as $$
 select c.city,c.n,coalesce((select max(i.uploaded_at) from mv_imports i where i.report->'cities'->c.city->>'replaced'='true'),(select max(i.uploaded_at) from mv_imports i where i.id=c.latest)) from(select p.city,count(*) n,(array_agg(p.import_id))[1] latest from mv_product_city p group by p.city) c
$$;
revoke all on function public.mv_city_status() from public,anon,authenticated;
grant execute on function public.mv_city_status() to service_role;
commit;
