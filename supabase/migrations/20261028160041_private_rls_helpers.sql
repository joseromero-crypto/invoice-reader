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
