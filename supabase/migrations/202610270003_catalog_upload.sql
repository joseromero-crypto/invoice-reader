-- One shared Masterview catalog per company. Importing never rewrites receipt snapshots.
alter table public.organizations add column catalog_revision uuid references public.catalog_imports;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('catalogs','catalogs',false,15000000,array['text/csv','text/plain','application/octet-stream','application/vnd.ms-excel']) on conflict(id) do nothing;
create policy catalog_admin_read on storage.objects for select to authenticated using(bucket_id='catalogs' and exists(select 1 from public.members m where m.org_id::text=(storage.foldername(name))[1] and m.user_id=auth.uid() and m.role='admin'));
create policy catalog_admin_insert on storage.objects for insert to authenticated with check(bucket_id='catalogs' and array_length(storage.foldername(name),1)=1 and exists(select 1 from public.members m where m.org_id::text=(storage.foldername(name))[1] and m.user_id=auth.uid() and m.role='admin'));
create function public.import_masterview(p_org uuid,p_actor uuid,p_hash text,p_report jsonb,p_products jsonb,p_expected_revision uuid) returns jsonb language plpgsql security definer set search_path=public as $$
declare current_revision uuid;run_id uuid;added integer;updated integer;unchanged integer;total integer;begin
 if not exists(select 1 from members where org_id=p_org and user_id=p_actor and role='admin') then raise exception 'Catalog administrator required';end if;
 select catalog_revision into current_revision from organizations where id=p_org for update;
 if not found then raise exception 'Organization not found';end if;
 if current_revision is distinct from p_expected_revision then raise exception 'Revision conflict: catalog changed';end if;
 if jsonb_array_length(p_products)<1 or jsonb_array_length(p_products)>20000 then raise exception 'Invalid product count';end if;
 if exists(select 1 from jsonb_array_elements(p_products) p where nullif(trim(p->>'id'),'') is null or nullif(trim(p->>'sku'),'') is null or nullif(trim(p->>'name'),'') is null or jsonb_typeof(p->'raw') is distinct from 'object') then raise exception 'Invalid catalog product';end if;
 if (select count(*) from jsonb_array_elements(p_products))<>(select count(distinct p->>'id') from jsonb_array_elements(p_products) p) then raise exception 'Duplicate catalog IDs';end if;
 select count(*) filter(where old.id is null),count(*) filter(where old.id is not null and (old.name,old.sku,old.supplier,old.supplier_sku,old.barcode,old.unit,old.raw) is distinct from (p->>'name',p->>'sku',p->>'supplier',p->>'supplierSku',p->>'barcode',p->>'unit',p->'raw')),count(*) filter(where old.id is not null and (old.name,old.sku,old.supplier,old.supplier_sku,old.barcode,old.unit,old.raw) is not distinct from (p->>'name',p->>'sku',p->>'supplier',p->>'supplierSku',p->>'barcode',p->>'unit',p->'raw')) into added,updated,unchanged from jsonb_array_elements(p_products) p left join products old on old.org_id=p_org and old.external_id=p->>'id';
 insert into catalog_imports(org_id,source_hash,report) values(p_org,p_hash,p_report||jsonb_build_object('actor',p_actor,'added',added,'updated',updated,'unchanged',unchanged)) on conflict(org_id,source_hash) do update set report=excluded.report returning id into run_id;
 insert into products(org_id,external_id,sku,name,supplier,supplier_sku,barcode,unit,raw,import_id)
 select p_org,p->>'id',p->>'sku',p->>'name',p->>'supplier',p->>'supplierSku',p->>'barcode',p->>'unit',p->'raw',run_id from jsonb_array_elements(p_products) p
 on conflict(org_id,external_id) do update set sku=excluded.sku,name=excluded.name,supplier=excluded.supplier,supplier_sku=excluded.supplier_sku,barcode=excluded.barcode,unit=excluded.unit,raw=excluded.raw,import_id=excluded.import_id;
 update organizations set catalog_revision=run_id where id=p_org;
 select count(*) into total from products where org_id=p_org;
 return jsonb_build_object('version',run_id,'added',added,'updated',updated,'unchanged',unchanged,'count',total);
end$$;
revoke all on function public.import_masterview(uuid,uuid,text,jsonb,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.import_masterview(uuid,uuid,text,jsonb,jsonb,uuid) to service_role;
create function public.stamp_catalog_column() returns trigger language plpgsql security definer set search_path=public as $$declare label text;begin
 if jsonb_typeof(new.review->'product')='object' and new.review->'product'->>'nameColumn' is null then
 select coalesce(i.report->>'nameColumn','Item') into label from products p left join catalog_imports i on i.id=p.import_id where p.org_id=new.org_id and p.external_id=new.review->'product'->>'id' and p.name=new.review->'product'->>'name';
 if label is not null then new.review=jsonb_set(new.review,'{product,nameColumn}',to_jsonb(label));end if;
 end if;return new;end$$;
create trigger invoice_catalog_column before insert or update of review on public.invoice_rows for each row execute function public.stamp_catalog_column();

-- A single MVCC snapshot prevents an import between paginated catalog reads.
create function public.read_catalog_snapshot(p_org uuid) returns jsonb language sql stable security definer set search_path=public as $$
 select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('catalog_imports',jsonb_build_object('report',i.report)) order by p.id),'[]'::jsonb) from products p left join catalog_imports i on i.id=p.import_id where p.org_id=p_org
$$;
revoke all on function public.read_catalog_snapshot(uuid) from public,anon,authenticated;
grant execute on function public.read_catalog_snapshot(uuid) to service_role;
