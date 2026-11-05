-- A confirmed row keeps the Item of the hub's city (it's the text copied to Retool), not the base city's. Safe to run before or after the code.
-- Run after 20261105130000_retire_products.sql.
create or replace function public.confirm_receiving_row_v1(p_actor uuid,p_org uuid,p_document uuid,p_row uuid,p_product uuid,p_quantity integer,p_identity boolean,p_mapping boolean,p_corrections jsonb default '{}'::jsonb) returns void language plpgsql security definer set search_path=public,app_private as $$
declare old invoice_rows; product jsonb; updated jsonb; supplier_name text; hub_city text;
begin
 if not p_identity or p_quantity<0 or not exists(select 1 from members where org_id=p_org and user_id=p_actor) then raise exception 'Invalid confirmation';end if;
 select * into old from invoice_rows where id=p_row and org_id=p_org and document_id=p_document for update;
 if not found then raise exception 'Row not found';end if;
 perform 1 from documents d join receiving_sessions s on s.id=d.session_id where d.id=p_document and d.org_id=p_org and s.status='open' for update of s;
 if not found then raise exception 'Receipt is closed';end if;
 select h.city into hub_city from documents d join receiving_sessions s on s.id=d.session_id join hubs h on h.id=s.hub_id where d.id=p_document;
 select jsonb_build_object('id',p.id,'sku',p.sku,'name',coalesce(c.name,p.name),'supplier',coalesce(c.proveedor,''),'supplierSku',c.sku_proveedor,'barcode',coalesce(c.barcode,p.barcode),'unit',coalesce(p.calii_unit,'desconocida')) into product from mv_products p left join lateral (select * from mv_product_city x where x.sku=p.sku and x.city in (hub_city,p.base_city) order by x.city is not distinct from hub_city desc limit 1) c on true where p.id=p_product;
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
