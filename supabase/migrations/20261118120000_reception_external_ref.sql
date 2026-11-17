-- Lectura en recepción, phase 2: mh-recibo sends the photos itself (netlify/functions/recepcion.ts) and links each read
-- to its reception session. Only this app's objects are touched. Run in the SQL editor BEFORE deploying the code
-- (recepcion.ts writes documents.external_ref and calls reception_reads with p_external_ref).
begin;
-- The mh-recibo session_id ("mh-san-nicolas__pd-arca-continental__2026-11-16__1794846172226"); null for reads made in this app.
alter table public.documents add column external_ref text;
create index documents_external_ref on public.documents(external_ref) where external_ref is not null;
-- mh-recibo may upload WebP; the worker turns every photo into JPEG before the model call.
update storage.buckets set allowed_mime_types=array['image/jpeg','image/png','image/webp'] where id='invoices';

-- Same contract version 1 as before, with one added parameter and one added column (external_ref).
drop function public.reception_reads(uuid,timestamptz);
create function public.reception_reads(p_hub_id uuid default null,p_since timestamptz default null,p_external_ref text default null)
returns table(read_id uuid,contract_version integer,hub_id uuid,hub_name text,hub_city text,created_at timestamptz,status text,error text,requested_by uuid,
 supplier text,printed_supplier text,reference text,invoice_date date,totals_ok boolean,warnings jsonb,rows jsonb,external_ref text)
language sql stable security invoker set search_path=public as $$
 select d.id,1,h.id,h.name,h.city,d.created_at,
  case when j.status='complete' then 'done' when j.status in('failed','uncertain') or dead.dead then 'failed' else 'processing' end,
  case when j.status in('failed','uncertain') then j.error when dead.dead then 'La lectura no terminó.' end,
  coalesce(j.requested_by,s.created_by),
  nullif(j.raw_result->>'matchedSupplier',''),
  nullif(j.raw_result#>>'{transcription,supplier}',''),
  d.reference,d.invoice_date,
  case when jsonb_typeof(j.raw_result->'totalsOk')='boolean' then (j.raw_result->>'totalsOk')::boolean end,
  coalesce(d.warnings,'[]'::jsonb),
  case when j.status='complete' then coalesce(j.raw_result#>'{reception,rows}','[]'::jsonb) else '[]'::jsonb end,
  d.external_ref
 from documents d
 join receiving_sessions s on s.id=d.session_id and s.org_id=d.org_id
 join hubs h on h.id=s.hub_id and h.org_id=s.org_id
 left join extraction_jobs j on j.document_id=d.id and j.org_id=d.org_id
 cross join lateral (select coalesce((j.status='processing' and j.lease_until<now()) or (j.status='queued' and j.created_at<now()-interval '2 minutes'),false) dead) dead
 where d.purpose='recepcion' and (p_hub_id is null or s.hub_id=p_hub_id) and (p_since is null or d.created_at>=p_since)
  and (p_external_ref is null or d.external_ref=p_external_ref)
 order by d.created_at desc,d.id desc
 limit 500
$$;
revoke all on function public.reception_reads(uuid,timestamptz,text) from public,anon,authenticated;
grant execute on function public.reception_reads(uuid,timestamptz,text) to authenticated,service_role;
commit;
