-- Lectura en recepción: hubs scan the clean supplier invoice on arrival; mh-recibo (same project) reads the result
-- through public.reception_reads() and never touches invoice_rows/review. Only this app's own objects are touched.
-- Run in the SQL editor BEFORE deploying the code that writes documents.purpose (the app selects the column).
-- finish_extraction is unchanged: the worker puts purpose and the reception record in p_raw (extraction_jobs.raw_result).
begin;
alter table public.documents add column purpose text not null default 'captura' check(purpose in ('captura','recepcion'));
create index documents_recepcion on public.documents(created_at desc,id desc) where purpose='recepcion';

-- Contract version 1. One row per reception read, newest first; an invoice read twice comes back twice.
-- status: done | failed | processing (also a photo upload that never reached the reader). rows: raw_result.reception.rows as built by lean/reception.ts (empty unless done).
-- Security invoker: RLS decides what a caller sees (a signed-in member: the hubs they can access; service_role: all).
-- How mh-recibo authenticates is still open; see CLAUDE.md.
create function public.reception_reads(p_hub_id uuid default null,p_since timestamptz default null)
returns table(read_id uuid,contract_version integer,hub_id uuid,hub_name text,hub_city text,created_at timestamptz,status text,error text,requested_by uuid,
 supplier text,printed_supplier text,reference text,invoice_date date,totals_ok boolean,warnings jsonb,rows jsonb)
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
  case when j.status='complete' then coalesce(j.raw_result#>'{reception,rows}','[]'::jsonb) else '[]'::jsonb end
 from documents d
 join receiving_sessions s on s.id=d.session_id and s.org_id=d.org_id
 join hubs h on h.id=s.hub_id and h.org_id=s.org_id
 left join extraction_jobs j on j.document_id=d.id and j.org_id=d.org_id
 -- Same rules as the app's load: a lease that ran out, or a dispatch that never started, is a read that won't finish.
 cross join lateral (select coalesce((j.status='processing' and j.lease_until<now()) or (j.status='queued' and j.created_at<now()-interval '2 minutes'),false) dead) dead
 where d.purpose='recepcion' and (p_hub_id is null or s.hub_id=p_hub_id) and (p_since is null or d.created_at>=p_since)
 order by d.created_at desc,d.id desc
 limit 500
$$;
revoke all on function public.reception_reads(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.reception_reads(uuid,timestamptz) to authenticated,service_role;
commit;
