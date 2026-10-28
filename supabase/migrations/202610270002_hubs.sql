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
