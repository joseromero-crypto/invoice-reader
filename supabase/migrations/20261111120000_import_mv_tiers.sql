-- import_mv also saves each city file's "Tiers" cell into mv_product_city.tiers (trimmed text, empty = null).
-- The column itself belongs to inventario-conf (added there 2026-11-11); this file only replaces the function.
-- Same signature and grants as 20261105120000_masterview_shared.sql. Without the key in p_rows, tiers is null.
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
 if exists(select 1 from mv_incoming where not city=any(p_cities)) then raise exception 'Row outside the uploaded cities';end if;
 delete from mv_product_city c where c.city=any(p_cities) and not exists(select 1 from mv_incoming i where i.sku=c.sku and i.city=c.city);
 insert into mv_product_city(sku,city,retool_id,name,proveedor,sku_proveedor,unidad_compra,piezas_por_unidad,deshabilitar_compras,tiers,raw,import_id)
 select sku,city,retool_id,name,proveedor,sku_proveedor,unidad_compra,piezas_por_unidad,deshabilitar_compras,tiers,raw,run_id from mv_incoming
 on conflict(sku,city) do update set retool_id=excluded.retool_id,name=excluded.name,proveedor=excluded.proveedor,sku_proveedor=excluded.sku_proveedor,unidad_compra=excluded.unidad_compra,piezas_por_unidad=excluded.piezas_por_unidad,deshabilitar_compras=excluded.deshabilitar_compras,tiers=excluded.tiers,raw=excluded.raw,import_id=excluded.import_id;
 -- A city's barcode column holds only a difference from the product's; a changed base row can change it in any city.
 update mv_product_city c set barcode=d.own from(select c2.sku,c2.city,case when nullif(c2.raw->>'Código de Barras','') is distinct from p.barcode then nullif(c2.raw->>'Código de Barras','') end own from mv_product_city c2 join mv_products p on p.sku=c2.sku) d where d.sku=c.sku and d.city=c.city and c.barcode is distinct from d.own;
 return jsonb_build_object('version',run_id,'uploadedAt',stamped);
end$$;
revoke all on function public.import_mv(uuid,text,jsonb,uuid,text[],jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.import_mv(uuid,text,jsonb,uuid,text[],jsonb,jsonb) to service_role;
commit;
