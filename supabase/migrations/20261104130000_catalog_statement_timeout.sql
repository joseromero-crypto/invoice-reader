-- The API's default statement timeout is too short for a whole Masterview in one transaction.
-- PostgREST applies a function's statement_timeout to the call, so only these two get more time.
alter function public.import_masterview(uuid,uuid,text,jsonb,jsonb,uuid) set statement_timeout='120s';
alter function public.read_catalog_snapshot(uuid) set statement_timeout='60s';
