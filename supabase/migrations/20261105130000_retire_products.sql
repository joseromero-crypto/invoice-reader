-- Run only after the code that reads mv_products is deployed: the live site stops working on the old code once this runs.
-- Stops without changing anything if a learned mapping has no Masterview product.
begin;
do $$declare result jsonb;begin
 result=public.mv_remap_learned();
 if jsonb_array_length(result->'unmapped')>0 then raise exception 'Unmapped rows, nothing retired: %',result->'unmapped';end if;
end$$;
alter table public.supplier_mappings drop column product_id;
alter table public.supplier_mappings alter column mv_product_id set not null;
alter table public.quantity_conversions drop column product_id;
alter table public.quantity_conversions alter column mv_product_id set not null;
alter table public.quantity_conversions add primary key(org_id,mv_product_id,supplier,source_unit);
drop trigger invoice_catalog_column on public.invoice_rows;
drop function app_private.stamp_catalog_column();
create or replace function public.confirm_receiving_row_v1(p_actor uuid,p_org uuid,p_document uuid,p_row uuid,p_product uuid,p_quantity integer,p_identity boolean,p_mapping boolean,p_corrections jsonb default '{}'::jsonb) returns void language plpgsql security definer set search_path=public,app_private as $$
declare old invoice_rows; product jsonb; updated jsonb; supplier_name text;
begin
 if not p_identity or p_quantity<0 or not exists(select 1 from members where org_id=p_org and user_id=p_actor) then raise exception 'Invalid confirmation';end if;
 select * into old from invoice_rows where id=p_row and org_id=p_org and document_id=p_document for update;
 if not found then raise exception 'Row not found';end if;
 perform 1 from documents d join receiving_sessions s on s.id=d.session_id where d.id=p_document and d.org_id=p_org and s.status='open' for update of s;
 if not found then raise exception 'Receipt is closed';end if;
 select jsonb_build_object('id',p.id,'sku',p.sku,'name',coalesce(c.name,p.name),'supplier',coalesce(c.proveedor,''),'supplierSku',c.sku_proveedor,'barcode',coalesce(c.barcode,p.barcode),'unit',coalesce(p.calii_unit,'desconocida')) into product from mv_products p left join mv_product_city c on c.sku=p.sku and c.city=p.base_city where p.id=p_product;
 if product is null then raise exception 'Product not found';end if;
 updated=old.review||jsonb_build_object('product',product,'proposalEvidence',coalesce(old.review->'proposalEvidence',old.review->'evidence'),'evidence',jsonb_build_array('Identidad y cantidad verificadas por receptor'),'corrections',p_corrections,'actualQuantity',p_quantity,'confirmedQuantity',p_quantity,'confirmed',true,'resolvedFlags',coalesce(old.review->'resolvedFlags','[]')||coalesce(old.review->'flags','[]'),'flags','[]'::jsonb);
 update invoice_rows set review=updated where id=p_row;
 insert into review_events(org_id,actor,row_id,action,before_value,after_value) values(p_org,p_actor,p_row,'Confirmación física',old.review,updated);
 if p_mapping then
 select supplier into supplier_name from documents where id=p_document;
 if nullif(old.raw_source->>'supplierSku','') is null or supplier_name is null then raise exception 'Supplier and SKU required for mapping';end if;
 insert into supplier_mappings(org_id,supplier,supplier_sku,mv_product_id,confirmed_by) values(p_org,supplier_name,old.raw_source->>'supplierSku',p_product,p_actor) on conflict(org_id,supplier,supplier_sku) do update set mv_product_id=excluded.mv_product_id,confirmed_by=p_actor,confirmed_at=now();
 insert into review_events(org_id,actor,row_id,action,after_value) values(p_org,p_actor,p_row,'Mapeo confirmado explícitamente',jsonb_build_object('product_id',p_product));
 end if;
end$$;
drop function public.mv_remap_learned();
drop function public.import_masterview(uuid,uuid,text,jsonb,jsonb,uuid);
drop function public.read_catalog_snapshot(uuid);
alter table public.organizations drop column catalog_revision;
drop table public.products;
drop table public.catalog_imports;
commit;
