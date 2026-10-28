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
