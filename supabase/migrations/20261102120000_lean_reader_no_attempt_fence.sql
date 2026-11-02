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
