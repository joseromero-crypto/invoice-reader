-- Shared armado-ch project: new tables get no automatic Data API grants, and older projects grant anon by default.
-- State every table's access explicitly: browser reads through RLS, the server writes, anon gets nothing.
do $$declare t text;begin foreach t in array array['organizations','members','catalog_imports','products','receiving_sessions','documents','source_pages','extraction_jobs','ai_daily_usage','invoice_rows','review_events','supplier_mappings','quantity_conversions','receipt_snapshots','hubs','hub_members'] loop
 execute format('revoke all on public.%I from anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('grant select,insert,update,delete on public.%I to service_role',t);
end loop;end$$;
