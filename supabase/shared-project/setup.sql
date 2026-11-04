-- Invoice Reader setup for the shared armado-ch project (uuqqtksxlgkztenojufm).
-- Generated from supabase/migrations in filename order. Paste all of it into the SQL editor and run once.
-- It is one transaction: if the guard below finds a name already in use, nothing is applied.
begin;

do $guard$
declare hits text[];
begin
 select array_agg(x) into hits from (
  select 'table/index/view public.'||c.relname x from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any(array['organizations','members','catalog_imports','products','receiving_sessions','documents','source_pages','extraction_jobs','ai_daily_usage','invoice_rows','review_events','supplier_mappings','quantity_conversions','receipt_snapshots','hubs','hub_members','products_barcode','products_supplier_sku','receiving_hub_date'])
  union all select 'type public.'||t.typname from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' and t.typname=any(array['organizations','members','catalog_imports','products','receiving_sessions','documents','source_pages','extraction_jobs','ai_daily_usage','invoice_rows','review_events','supplier_mappings','quantity_conversions','receipt_snapshots','hubs','hub_members','products_barcode','products_supplier_sku','receiving_hub_date']) and t.typrelid=0
  union all select 'function public.'||p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array['is_member','can_access_hub','can_access_session','can_access_document','can_access_hub_as','seed_hubs','set_event_hub','stamp_catalog_column','claim_extraction','claim_extraction_v1','confirm_receiving_row','confirm_receiving_row_v1','confirm_receiving_batch','finish_extraction','finish_extraction_v1','snapshot_receipt','snapshot_receipt_v1','update_scan_metadata','import_masterview','read_catalog_snapshot'])
  union all select 'schema app_private' from pg_namespace where nspname='app_private'
  union all select 'bucket '||id from storage.buckets where id in ('invoices','catalogs')
  union all select 'storage policy '||policyname from pg_policies where schemaname='storage' and tablename='objects' and policyname in ('invoice_read','invoice_insert','catalog_admin_read','catalog_admin_insert')
 ) found;
 if hits is not null then raise exception 'Name collision, nothing applied: %',array_to_string(hits,', ');end if;
end$guard$;

-- ===== 202610270001_receiving.sql =====
-- Apply with Supabase CLI. No public enrollment; provision organizations/members as admin.
create extension if not exists pgcrypto;
create table public.organizations(id uuid primary key default gen_random_uuid(),name text not null);
create table public.members(org_id uuid references public.organizations on delete cascade,user_id uuid references auth.users on delete cascade,role text not null check(role in ('admin','receiver')),primary key(org_id,user_id));
create function public.is_member(p_org uuid) returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from members where org_id=p_org and user_id=auth.uid())$$;
create table public.catalog_imports(id uuid primary key default gen_random_uuid(),org_id uuid not null references public.organizations,source_hash text not null,report jsonb not null,created_at timestamptz not null default now(),unique(org_id,source_hash));
create table public.products(id uuid primary key default gen_random_uuid(),org_id uuid not null references public.organizations,external_id text not null,sku text not null,name text not null,supplier text not null,supplier_sku text,barcode text,unit text not null,raw jsonb not null,import_id uuid references public.catalog_imports,unique(org_id,external_id),unique(org_id,id));
create index products_barcode on public.products(org_id,barcode);
create index products_supplier_sku on public.products(org_id,supplier,supplier_sku);
create table public.receiving_sessions(id uuid primary key default gen_random_uuid(),org_id uuid not null references public.organizations,created_by uuid not null references auth.users,status text not null default 'open' check(status in ('open','reviewed_partial','reviewed')),created_at timestamptz not null default now(),unique(org_id,id));
create table public.documents(id uuid primary key default gen_random_uuid(),org_id uuid not null references public.organizations,session_id uuid not null,supplier text,reference text,expected_pages integer,warnings jsonb not null default '[]',printed_total numeric,created_at timestamptz not null default now(),unique(org_id,id),foreign key(org_id,session_id) references public.receiving_sessions(org_id,id));
create table public.source_pages(id uuid primary key default gen_random_uuid(),org_id uuid not null,document_id uuid not null,object_path text not null,content_hash text not null,page_number integer not null check(page_number>0),created_at timestamptz not null default now(),foreign key(org_id,document_id) references public.documents(org_id,id),unique(org_id,content_hash),unique(org_id,object_path),unique(document_id,page_number));
create table public.extraction_jobs(id uuid primary key default gen_random_uuid(),org_id uuid not null,document_id uuid not null,requested_by uuid not null references auth.users,status text not null default 'queued' check(status in ('queued','processing','complete','failed','uncertain')),attempts integer not null default 0,lease_until timestamptz,claim_token uuid,error text,raw_result jsonb,model text,prompt_version text,usage jsonb,duration_ms integer,estimated_cost_usd numeric,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),foreign key(org_id,document_id) references public.documents(org_id,id),unique(document_id));
create table public.ai_daily_usage(org_id uuid not null references public.organizations,day date not null default current_date,reserved_calls integer not null default 0,primary key(org_id,day));
create table public.invoice_rows(id uuid primary key default gen_random_uuid(),org_id uuid not null,document_id uuid not null,source_row integer not null,raw_source jsonb not null,review jsonb not null,unique(document_id,source_row),foreign key(org_id,document_id) references public.documents(org_id,id),unique(org_id,id));
create table public.review_events(id uuid primary key default gen_random_uuid(),org_id uuid not null references public.organizations,actor uuid not null references auth.users,row_id uuid,action text not null,before_value jsonb,after_value jsonb,created_at timestamptz not null default now());
create table public.supplier_mappings(org_id uuid not null references public.organizations,supplier text not null,supplier_sku text not null,product_id uuid not null,confirmed_by uuid not null references auth.users,confirmed_at timestamptz not null default now(),primary key(org_id,supplier,supplier_sku),foreign key(org_id,product_id) references public.products(org_id,id));
create table public.quantity_conversions(org_id uuid not null references public.organizations,product_id uuid not null,supplier text not null,source_unit text not null,factor numeric not null check(factor>0),confirmed_by uuid not null references auth.users,confirmed_at timestamptz not null default now(),primary key(org_id,product_id,supplier,source_unit),foreign key(org_id,product_id) references public.products(org_id,id));
create table public.receipt_snapshots(id uuid primary key default gen_random_uuid(),org_id uuid not null references public.organizations,session_id uuid not null,snapshot jsonb not null,created_by uuid not null references auth.users,created_at timestamptz not null default now(),foreign key(org_id,session_id) references public.receiving_sessions(org_id,id));
do $$declare t text;begin foreach t in array array['organizations','members','catalog_imports','products','receiving_sessions','documents','source_pages','extraction_jobs','ai_daily_usage','invoice_rows','review_events','supplier_mappings','quantity_conversions','receipt_snapshots'] loop execute format('alter table public.%I enable row level security',t);if t='organizations' then execute format('create policy member_read on public.%I for select to authenticated using(public.is_member(id))',t);else execute format('create policy member_read on public.%I for select to authenticated using(public.is_member(org_id))',t);end if;execute format('grant select on public.%I to authenticated',t);execute format('revoke insert,update,delete on public.%I from anon,authenticated',t);end loop;end$$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('invoices','invoices',false,10000000,array['image/jpeg','image/png']) on conflict(id) do nothing;
create policy invoice_read on storage.objects for select to authenticated using(bucket_id='invoices' and exists(select 1 from public.documents d where d.org_id::text=(storage.foldername(name))[1] and d.id::text=(storage.foldername(name))[2] and public.is_member(d.org_id)));
create policy invoice_insert on storage.objects for insert to authenticated with check(bucket_id='invoices' and exists(select 1 from public.documents d join public.receiving_sessions s on s.id=d.session_id where d.org_id::text=(storage.foldername(name))[1] and d.id::text=(storage.foldername(name))[2] and s.status='open' and public.is_member(d.org_id)));
-- All mutation functions are service-role only. They still verify the originating user.
create function public.claim_extraction(p_job uuid,p_actor uuid,p_limit integer) returns jsonb language plpgsql security definer set search_path=public as $$
declare j extraction_jobs; used integer;
begin
 select * into j from extraction_jobs where id=p_job for update;
 if not found or not exists(select 1 from members where org_id=j.org_id and user_id=p_actor) or j.requested_by<>p_actor then raise exception 'Forbidden';end if;
 if j.status<>'queued' then return null;end if;
 perform 1 from organizations where id=j.org_id for update;
 insert into ai_daily_usage(org_id,day) values(j.org_id,current_date) on conflict do nothing;
 select reserved_calls into used from ai_daily_usage where org_id=j.org_id and day=current_date;
 if p_limit<1 or p_limit>1000 then raise exception 'Invalid usage limit';end if;
 if used>=p_limit then raise exception 'Daily extraction limit reached';end if;
 if j.attempts>=2 then raise exception 'Retry limit reached';end if;
 update ai_daily_usage set reserved_calls=reserved_calls+1 where org_id=j.org_id and day=current_date;
 update extraction_jobs set status='processing',attempts=attempts+1,lease_until=now()+interval '12 minutes',claim_token=gen_random_uuid(),updated_at=now() where id=p_job;
 select * into j from extraction_jobs where id=p_job;
 return to_jsonb(j);
end$$;
create function public.confirm_receiving_row(p_actor uuid,p_org uuid,p_document uuid,p_row uuid,p_product uuid,p_quantity integer,p_identity boolean,p_mapping boolean,p_corrections jsonb default '{}'::jsonb) returns void language plpgsql security definer set search_path=public as $$
declare old invoice_rows; product products; updated jsonb; supplier_name text;
begin
 if not p_identity or p_quantity<0 or not exists(select 1 from members where org_id=p_org and user_id=p_actor) then raise exception 'Invalid confirmation';end if;
 select * into old from invoice_rows where id=p_row and org_id=p_org and document_id=p_document for update;
 if not found then raise exception 'Row not found';end if;
 perform 1 from documents d join receiving_sessions s on s.id=d.session_id where d.id=p_document and d.org_id=p_org and s.status='open' for update of s;
 if not found then raise exception 'Receipt is closed';end if;
 select * into product from products where id=p_product and org_id=p_org;
 if not found then raise exception 'Product not found';end if;
 updated=old.review||jsonb_build_object('product',jsonb_build_object('id',product.external_id,'sku',product.sku,'name',product.name,'supplier',product.supplier,'supplierSku',product.supplier_sku,'barcode',product.barcode,'unit',product.unit),'proposalEvidence',coalesce(old.review->'proposalEvidence',old.review->'evidence'),'evidence',jsonb_build_array('Identidad y cantidad verificadas por receptor'),'corrections',p_corrections,'actualQuantity',p_quantity,'confirmedQuantity',p_quantity,'confirmed',true,'resolvedFlags',coalesce(old.review->'resolvedFlags','[]')||coalesce(old.review->'flags','[]'),'flags','[]'::jsonb);
 update invoice_rows set review=updated where id=p_row;
 insert into review_events(org_id,actor,row_id,action,before_value,after_value) values(p_org,p_actor,p_row,'Confirmación física',old.review,updated);
 if p_mapping then
 select supplier into supplier_name from documents where id=p_document;
 if nullif(old.raw_source->>'supplierSku','') is null or supplier_name is null then raise exception 'Supplier and SKU required for mapping';end if;
 insert into supplier_mappings(org_id,supplier,supplier_sku,product_id,confirmed_by) values(p_org,supplier_name,old.raw_source->>'supplierSku',p_product,p_actor) on conflict(org_id,supplier,supplier_sku) do update set product_id=excluded.product_id,confirmed_by=p_actor,confirmed_at=now();
 insert into review_events(org_id,actor,row_id,action,after_value) values(p_org,p_actor,p_row,'Mapeo confirmado explícitamente',jsonb_build_object('product_id',p_product));
 end if;
end$$;
create function public.finish_extraction(p_job uuid,p_actor uuid,p_raw jsonb,p_rows jsonb,p_usage jsonb,p_model text,p_duration integer,p_cost numeric,p_token uuid) returns void language plpgsql security definer set search_path=public as $$
declare j extraction_jobs;r jsonb;
begin
 select * into j from extraction_jobs where id=p_job for update;
 if not found or j.status<>'processing' or j.claim_token is distinct from p_token or j.lease_until<now() or j.requested_by<>p_actor or not exists(select 1 from members where org_id=j.org_id and user_id=p_actor) then raise exception 'Invalid job';end if;
 update documents set supplier=p_raw->>'supplier',reference=p_raw->>'reference',expected_pages=(p_raw->>'printedPageCount')::integer,printed_total=case when p_raw->>'printedTotal' ~ '^\d+(\.\d{1,2})?$' then (p_raw->>'printedTotal')::numeric else null end,warnings=p_raw->'warnings' where id=j.document_id;
 for r in select * from jsonb_array_elements(p_rows) loop
 insert into invoice_rows(org_id,document_id,source_row,raw_source,review) values(j.org_id,j.document_id,(r->>'sourceRow')::integer,r->'raw',r-'raw');
 end loop;
 update extraction_jobs set status='complete',raw_result=p_raw,usage=p_usage,model=p_model,prompt_version='invoice-v1',duration_ms=p_duration,estimated_cost_usd=p_cost,lease_until=null,updated_at=now() where id=p_job;
end$$;
create function public.snapshot_receipt(p_actor uuid,p_org uuid,p_session uuid,p_partial boolean) returns uuid language plpgsql security definer set search_path=public as $$
declare snapshot_id uuid;payload jsonb;blocked boolean;
begin
 if not exists(select 1 from members where org_id=p_org and user_id=p_actor) then raise exception 'Forbidden';end if;
 perform 1 from receiving_sessions where id=p_session and org_id=p_org and status='open' for update;
 if not found then raise exception 'Session is not open';end if;
 select exists(select 1 from documents d left join extraction_jobs j on j.document_id=d.id where d.session_id=p_session and (j.status is distinct from 'complete' or jsonb_array_length(d.warnings)>0)) or exists(select 1 from invoice_rows r join documents d on d.id=r.document_id where d.session_id=p_session and (not (r.review->>'confirmed')::boolean or jsonb_array_length(r.review->'flags')>0)) into blocked;
 if blocked and not p_partial then raise exception 'Unresolved rows or incomplete documents';end if;
 select jsonb_agg(jsonb_build_object('document',to_jsonb(d),'rows',(select jsonb_agg(r.review) from invoice_rows r where r.document_id=d.id))) into payload from documents d where d.session_id=p_session;
 if not exists(select 1 from invoice_rows r join documents d on d.id=r.document_id where d.session_id=p_session and (r.review->>'confirmed')::boolean) then raise exception 'No confirmed rows';end if;
 insert into receipt_snapshots(org_id,session_id,snapshot,created_by) values(p_org,p_session,payload,p_actor) returning id into snapshot_id;
 update receiving_sessions set status=case when blocked then 'reviewed_partial' else 'reviewed' end where id=p_session;
 insert into review_events(org_id,actor,action,after_value) values(p_org,p_actor,'Recepción guardada',jsonb_build_object('snapshot_id',snapshot_id,'partial',blocked));return snapshot_id;
end$$;
revoke all on function public.claim_extraction(uuid,uuid,integer),public.confirm_receiving_row(uuid,uuid,uuid,uuid,uuid,integer,boolean,boolean,jsonb),public.finish_extraction(uuid,uuid,jsonb,jsonb,jsonb,text,integer,numeric,uuid),public.snapshot_receipt(uuid,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.claim_extraction(uuid,uuid,integer),public.confirm_receiving_row(uuid,uuid,uuid,uuid,uuid,integer,boolean,boolean,jsonb),public.finish_extraction(uuid,uuid,jsonb,jsonb,jsonb,text,integer,numeric,uuid),public.snapshot_receipt(uuid,uuid,uuid,boolean) to service_role;

-- ===== 202610270002_hubs.sql =====
-- Hubs share the organization's Masterview catalog; scans and history belong to one hub.
create table public.hubs(id uuid primary key default gen_random_uuid(),org_id uuid not null references public.organizations,name text not null,active boolean not null default true,created_at timestamptz not null default now(),unique(org_id,id),unique(org_id,name));
create table public.hub_members(org_id uuid not null,hub_id uuid not null,user_id uuid not null,primary key(hub_id,user_id),foreign key(org_id,hub_id) references public.hubs(org_id,id),foreign key(org_id,user_id) references public.members(org_id,user_id));
create function public.seed_hubs() returns trigger language plpgsql security definer set search_path=public as $$begin
 insert into hubs(org_id,name) select new.id,n from unnest(array['MH Contry','MH Cumbres','MH Guadalupe','MH San Nicolás','MH Avícola','MH Zapopan','MH Condesa','CH Guadalupe']) n on conflict do nothing;return new;end$$;
create trigger organization_hubs after insert on public.organizations for each row execute function public.seed_hubs();
insert into public.hubs(org_id,name) select o.id,n from public.organizations o cross join unnest(array['MH Contry','MH Cumbres','MH Guadalupe','MH San Nicolás','MH Avícola','MH Zapopan','MH Condesa','CH Guadalupe']) n;
alter table public.receiving_sessions add column hub_id uuid;
-- Existing scans are explicitly unassigned, never silently attributed to a real hub.
insert into public.hubs(org_id,name,active) select distinct org_id,'Por asignar (anteriores)',false from public.receiving_sessions;
update public.receiving_sessions s set hub_id=h.id from public.hubs h where s.org_id=h.org_id and h.name='Por asignar (anteriores)';
alter table public.receiving_sessions alter column hub_id set not null;
alter table public.receiving_sessions add foreign key(org_id,hub_id) references public.hubs(org_id,id);
create index receiving_hub_date on public.receiving_sessions(org_id,hub_id,created_at desc,id desc);
alter table public.documents add column invoice_date date,add column metadata_revision integer not null default 0;
alter table public.invoice_rows add column revision integer not null default 0;
alter table public.review_events add column hub_id uuid references public.hubs;
update public.review_events e set hub_id=s.hub_id from public.invoice_rows r join public.documents d on d.id=r.document_id join public.receiving_sessions s on s.id=d.session_id where e.row_id=r.id;
update public.review_events e set hub_id=s.hub_id from public.receipt_snapshots rs join public.receiving_sessions s on s.id=rs.session_id where e.after_value->>'snapshot_id'=rs.id::text and e.hub_id is null;
create function public.can_access_hub_as(p_hub uuid,p_actor uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from hubs h join members m on m.org_id=h.org_id and m.user_id=p_actor where h.id=p_hub and (m.role='admin' or exists(select 1 from hub_members hm where hm.hub_id=h.id and hm.user_id=p_actor)))$$;
create function public.can_access_hub(p_hub uuid) returns boolean language sql stable security definer set search_path=public as $$select can_access_hub_as(p_hub,auth.uid())$$;
create function public.can_access_session(p_session uuid) returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from receiving_sessions where id=p_session and can_access_hub(hub_id))$$;
create function public.can_access_document(p_document uuid) returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from documents where id=p_document and can_access_session(session_id))$$;
alter table public.hubs enable row level security;alter table public.hub_members enable row level security;
grant select on public.hubs,public.hub_members to authenticated;
revoke insert,update,delete on public.hubs,public.hub_members from anon,authenticated;
create policy hub_read on public.hubs for select to authenticated using(public.can_access_hub(id));
create policy hub_member_read on public.hub_members for select to authenticated using(public.can_access_hub(hub_id));
drop policy member_read on public.receiving_sessions;
create policy hub_read on public.receiving_sessions for select to authenticated using(public.can_access_hub(hub_id));
drop policy member_read on public.documents;
create policy hub_read on public.documents for select to authenticated using(public.can_access_session(session_id));
do $$declare t text;begin foreach t in array array['source_pages','extraction_jobs','invoice_rows'] loop execute format('drop policy member_read on public.%I',t);execute format('create policy hub_read on public.%I for select to authenticated using(public.can_access_document(document_id))',t);end loop;end$$;
drop policy member_read on public.receipt_snapshots;
create policy hub_read on public.receipt_snapshots for select to authenticated using(public.can_access_session(session_id));
drop policy member_read on public.review_events;
create policy hub_read on public.review_events for select to authenticated using(public.can_access_hub(hub_id));
create function public.set_event_hub() returns trigger language plpgsql security definer set search_path=public as $$begin
 if new.hub_id is null then
 select s.hub_id into new.hub_id from invoice_rows r join documents d on d.id=r.document_id join receiving_sessions s on s.id=d.session_id where r.id=new.row_id;
 if new.hub_id is null then select s.hub_id into new.hub_id from receipt_snapshots rs join receiving_sessions s on s.id=rs.session_id where rs.id::text=new.after_value->>'snapshot_id';end if;
 end if;return new;end$$;
create trigger review_event_hub before insert on public.review_events for each row execute function public.set_event_hub();
drop policy invoice_read on storage.objects;drop policy invoice_insert on storage.objects;
create policy invoice_read on storage.objects for select to authenticated using(bucket_id='invoices' and exists(select 1 from public.documents d where d.org_id::text=(storage.foldername(name))[1] and d.id::text=(storage.foldername(name))[2] and public.can_access_document(d.id)));
create policy invoice_insert on storage.objects for insert to authenticated with check(bucket_id='invoices' and exists(select 1 from public.documents d join public.receiving_sessions s on s.id=d.session_id where d.org_id::text=(storage.foldername(name))[1] and d.id::text=(storage.foldername(name))[2] and s.status='open' and public.can_access_document(d.id)));
-- Retain the original transaction implementations behind hub-aware, versioned wrappers.
alter function public.confirm_receiving_row(uuid,uuid,uuid,uuid,uuid,integer,boolean,boolean,jsonb) rename to confirm_receiving_row_v1;
revoke all on function public.confirm_receiving_row_v1(uuid,uuid,uuid,uuid,uuid,integer,boolean,boolean,jsonb) from service_role;
create function public.confirm_receiving_row(p_actor uuid,p_org uuid,p_document uuid,p_row uuid,p_product uuid,p_quantity integer,p_identity boolean,p_mapping boolean,p_corrections jsonb default '{}',p_expected_revision integer default null) returns void language plpgsql security definer set search_path=public as $$
declare current_revision integer;begin
 -- Consistent lock order (session before row) also prevents interleaved batch deadlocks.
 perform 1 from receiving_sessions s join documents d on d.session_id=s.id where d.id=p_document and d.org_id=p_org and can_access_hub_as(s.hub_id,p_actor) for update of s;
 if not found then raise exception 'Hub access denied';end if;
 select revision into current_revision from invoice_rows where id=p_row and org_id=p_org and document_id=p_document for update;
 if not found then raise exception 'Row not found';end if;
 if p_expected_revision is null or current_revision<>p_expected_revision then raise exception 'Revision conflict: another user changed this row';end if;
 perform confirm_receiving_row_v1(p_actor,p_org,p_document,p_row,p_product,p_quantity,p_identity,p_mapping,p_corrections);
 update invoice_rows set revision=revision+1 where id=p_row;
end$$;
create function public.confirm_receiving_batch(p_actor uuid,p_org uuid,p_document uuid,p_rows jsonb) returns void language plpgsql security definer set search_path=public as $$declare r jsonb;begin
 if jsonb_array_length(p_rows)<1 or jsonb_array_length(p_rows)>500 then raise exception 'Invalid batch size';end if;
 for r in select * from jsonb_array_elements(p_rows) loop
 if exists(select 1 from invoice_rows where id=(r->>'rowId')::uuid and org_id=p_org and document_id=p_document and jsonb_array_length(review->'flags')>0) then raise exception 'Pending rows need individual confirmation';end if;
 perform confirm_receiving_row(p_actor,p_org,p_document,(r->>'rowId')::uuid,(r->>'productId')::uuid,(r->>'quantity')::integer,true,false,'{}',(r->>'revision')::integer);
 end loop;
end$$;
alter function public.claim_extraction(uuid,uuid,integer) rename to claim_extraction_v1;
revoke all on function public.claim_extraction_v1(uuid,uuid,integer) from service_role;
create function public.claim_extraction(p_job uuid,p_actor uuid,p_limit integer) returns jsonb language plpgsql security definer set search_path=public as $$begin
 if not exists(select 1 from extraction_jobs j join documents d on d.id=j.document_id join receiving_sessions s on s.id=d.session_id where j.id=p_job and can_access_hub_as(s.hub_id,p_actor)) then raise exception 'Hub access denied';end if;
 return claim_extraction_v1(p_job,p_actor,p_limit);end$$;
alter function public.finish_extraction(uuid,uuid,jsonb,jsonb,jsonb,text,integer,numeric,uuid) rename to finish_extraction_v1;
revoke all on function public.finish_extraction_v1(uuid,uuid,jsonb,jsonb,jsonb,text,integer,numeric,uuid) from service_role;
create function public.finish_extraction(p_job uuid,p_actor uuid,p_raw jsonb,p_rows jsonb,p_usage jsonb,p_model text,p_duration integer,p_cost numeric,p_token uuid) returns void language plpgsql security definer set search_path=public as $$begin
 if not exists(select 1 from extraction_jobs j join documents d on d.id=j.document_id join receiving_sessions s on s.id=d.session_id where j.id=p_job and can_access_hub_as(s.hub_id,p_actor)) then raise exception 'Hub access denied';end if;
 perform finish_extraction_v1(p_job,p_actor,p_raw,p_rows,p_usage,p_model,p_duration,p_cost,p_token);
 update documents d set invoice_date=(p_raw->>'date')::date,metadata_revision=metadata_revision+1 from extraction_jobs j where j.id=p_job and d.id=j.document_id;
end$$;
alter function public.snapshot_receipt(uuid,uuid,uuid,boolean) rename to snapshot_receipt_v1;
revoke all on function public.snapshot_receipt_v1(uuid,uuid,uuid,boolean) from service_role;
create function public.snapshot_receipt(p_actor uuid,p_org uuid,p_session uuid,p_partial boolean) returns uuid language plpgsql security definer set search_path=public as $$begin
 if not exists(select 1 from receiving_sessions where id=p_session and org_id=p_org and can_access_hub_as(hub_id,p_actor)) then raise exception 'Hub access denied';end if;
 return snapshot_receipt_v1(p_actor,p_org,p_session,p_partial);end$$;
create function public.update_scan_metadata(p_actor uuid,p_org uuid,p_document uuid,p_supplier text,p_invoice_date date,p_expected_revision integer) returns void language plpgsql security definer set search_path=public as $$declare old documents;h uuid;begin
 select d.* into old from documents d join receiving_sessions s on s.id=d.session_id where d.id=p_document and d.org_id=p_org and can_access_hub_as(s.hub_id,p_actor) for update of d;
 if not found then raise exception 'Hub access denied';end if;
 if old.metadata_revision<>p_expected_revision then raise exception 'Revision conflict: metadata changed';end if;
 if nullif(trim(p_supplier),'') is null then raise exception 'Supplier required';end if;
 if exists(select 1 from extraction_jobs where document_id=p_document and status in ('queued','processing')) then raise exception 'Wait for extraction to complete';end if;
 select hub_id into h from receiving_sessions where id=old.session_id;
 update documents set supplier=trim(p_supplier),invoice_date=p_invoice_date,metadata_revision=metadata_revision+1 where id=p_document;
 insert into review_events(org_id,hub_id,actor,action,before_value,after_value) values(p_org,h,p_actor,'Datos de factura corregidos',jsonb_build_object('supplier',old.supplier,'invoiceDate',old.invoice_date),jsonb_build_object('supplier',trim(p_supplier),'invoiceDate',p_invoice_date));
end$$;
-- Re-scanning a deleted list or scanning the same file at another hub is allowed.
-- Within one document the same photo is still registered only once.
alter table public.source_pages drop constraint source_pages_org_id_content_hash_key;
alter table public.source_pages add unique(document_id,content_hash);
revoke all on function public.can_access_hub_as(uuid,uuid) from public,anon,authenticated;
grant execute on function public.can_access_hub_as(uuid,uuid) to service_role;
revoke all on function public.confirm_receiving_row(uuid,uuid,uuid,uuid,uuid,integer,boolean,boolean,jsonb,integer),public.confirm_receiving_batch(uuid,uuid,uuid,jsonb),public.claim_extraction(uuid,uuid,integer),public.finish_extraction(uuid,uuid,jsonb,jsonb,jsonb,text,integer,numeric,uuid),public.snapshot_receipt(uuid,uuid,uuid,boolean),public.update_scan_metadata(uuid,uuid,uuid,text,date,integer) from public,anon,authenticated;
grant execute on function public.confirm_receiving_row(uuid,uuid,uuid,uuid,uuid,integer,boolean,boolean,jsonb,integer),public.confirm_receiving_batch(uuid,uuid,uuid,jsonb),public.claim_extraction(uuid,uuid,integer),public.finish_extraction(uuid,uuid,jsonb,jsonb,jsonb,text,integer,numeric,uuid),public.snapshot_receipt(uuid,uuid,uuid,boolean),public.update_scan_metadata(uuid,uuid,uuid,text,date,integer) to service_role;

-- ===== 202610270003_catalog_upload.sql =====
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

-- ===== 20261028160041_private_rls_helpers.sql =====
-- Keep policy helpers outside the exposed REST schema. Server actor checks remain
-- service-role-only in public.can_access_hub_as for the existing functions API.
create schema if not exists app_private;
revoke all on schema app_private from public,anon,authenticated;
grant usage on schema app_private to authenticated,service_role;
alter function public.is_member(uuid) set schema app_private;
alter function public.can_access_hub(uuid) set schema app_private;
alter function public.can_access_session(uuid) set schema app_private;
alter function public.can_access_document(uuid) set schema app_private;
alter function public.seed_hubs() set schema app_private;
alter function public.set_event_hub() set schema app_private;
alter function public.stamp_catalog_column() set schema app_private;
-- Policies and triggers retain their function OIDs when functions move schemas.
revoke all on all functions in schema app_private from public,anon,authenticated;
grant execute on function app_private.is_member(uuid),app_private.can_access_hub(uuid),app_private.can_access_session(uuid),app_private.can_access_document(uuid) to authenticated,service_role;
-- Both schemas are trusted; callers have no CREATE privilege in app_private.
-- String-bodied helpers resolve nested helpers using this fixed search path.
-- Named one by one: this database is shared with other apps, whose functions must stay untouched.
do $$declare f record;begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private') and p.prosecdef and p.proname=any(array['can_access_document','can_access_hub','can_access_hub_as','can_access_session','claim_extraction','claim_extraction_v1','confirm_receiving_batch','confirm_receiving_row','confirm_receiving_row_v1','finish_extraction','finish_extraction_v1','import_masterview','is_member','read_catalog_snapshot','seed_hubs','set_event_hub','snapshot_receipt','snapshot_receipt_v1','stamp_catalog_column','update_scan_metadata']) loop
 execute format('alter function %s set search_path = public, app_private',f.signature);
 end loop;
end$$;

-- ===== 20261028235704_remove_daily_ai_cap.sql =====
-- Remove the daily AI cap. Keep counts for usage accounting, not admission control.
-- p_limit is deliberately ignored for compatibility with already-deployed workers.
-- The hub-authorized public wrapper and its service-role-only permissions stay unchanged.
create or replace function public.claim_extraction_v1(p_job uuid,p_actor uuid,p_limit integer)
returns jsonb language plpgsql security definer set search_path=public,app_private as $$
declare j extraction_jobs;
begin
 select * into j from extraction_jobs where id=p_job for update;
 if not found or not exists(select 1 from members where org_id=j.org_id and user_id=p_actor) or j.requested_by<>p_actor then raise exception 'Forbidden';end if;
 if j.status<>'queued' then return null;end if;
 perform 1 from organizations where id=j.org_id for update;
 if j.attempts>=2 then raise exception 'Retry limit reached';end if;
 insert into ai_daily_usage(org_id,day) values(j.org_id,current_date) on conflict do nothing;
 update ai_daily_usage set reserved_calls=reserved_calls+1 where org_id=j.org_id and day=current_date;
 update extraction_jobs set status='processing',attempts=attempts+1,lease_until=now()+interval '12 minutes',claim_token=gen_random_uuid(),updated_at=now() where id=p_job;
 select * into j from extraction_jobs where id=p_job;
 return to_jsonb(j);
end$$;
revoke all on function public.claim_extraction_v1(uuid,uuid,integer) from public,anon,authenticated,service_role;

-- ===== 20261102120000_lean_reader_no_attempt_fence.sql =====
-- Lean reader: no attempt fence. A failed read can be retried explicitly by the receiver.
-- The lease (claim token + 12 minute expiry) still keeps one job from being processed twice.
-- The hub-authorized public wrapper and its service-role-only permissions stay unchanged.
create or replace function public.claim_extraction_v1(p_job uuid,p_actor uuid,p_limit integer)
returns jsonb language plpgsql security definer set search_path=public,app_private as $$
declare j extraction_jobs;
begin
 select * into j from extraction_jobs where id=p_job for update;
 if not found or not exists(select 1 from members where org_id=j.org_id and user_id=p_actor) or j.requested_by<>p_actor then raise exception 'Forbidden';end if;
 if j.status<>'queued' then return null;end if;
 update extraction_jobs set status='processing',attempts=attempts+1,lease_until=now()+interval '12 minutes',claim_token=gen_random_uuid(),updated_at=now() where id=p_job;
 select * into j from extraction_jobs where id=p_job;
 return to_jsonb(j);
end$$;
revoke all on function public.claim_extraction_v1(uuid,uuid,integer) from public,anon,authenticated,service_role;

-- ===== 20261104120000_explicit_table_grants.sql =====
-- Shared armado-ch project: new tables get no automatic Data API grants, and older projects grant anon by default.
-- State every table's access explicitly: browser reads through RLS, the server writes, anon gets nothing.
do $$declare t text;begin foreach t in array array['organizations','members','catalog_imports','products','receiving_sessions','documents','source_pages','extraction_jobs','ai_daily_usage','invoice_rows','review_events','supplier_mappings','quantity_conversions','receipt_snapshots','hubs','hub_members'] loop
 execute format('revoke all on public.%I from anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('grant select,insert,update,delete on public.%I to service_role',t);
end loop;end$$;

-- ===== The one company (same id as the old project). Its trigger seeds the eight hubs. =====
insert into public.organizations(id,name) values('956effb3-2c8d-4ea2-a01f-d9fbdba2b315','Calii');

commit;

select (select count(*) from public.organizations) as organizations,(select count(*) from public.hubs) as hubs,(select count(*) from storage.buckets where id in ('invoices','catalogs')) as buckets;
