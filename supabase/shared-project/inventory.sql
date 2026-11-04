-- Read-only. Lists what already exists in the shared project. Changes nothing.
with ours(name) as (values ('organizations'),('members'),('catalog_imports'),('products'),('receiving_sessions'),('documents'),('source_pages'),('extraction_jobs'),('ai_daily_usage'),('invoice_rows'),('review_events'),('supplier_mappings'),('quantity_conversions'),('receipt_snapshots'),('hubs'),('hub_members'),('invoices'),('catalogs'),('app_private'))
select kind,name,detail,case when name in (select name from ours) then 'COLLISION' else '' end as flag from (
 select 'table' kind,c.relname::text name,case c.relkind when 'r' then 'table' when 'v' then 'view' when 'm' then 'matview' when 'p' then 'partitioned' else 'foreign' end detail from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in('r','v','m','p','f')
 union all select 'function',p.proname::text,case when p.prosecdef then 'security definer' else '' end from pg_proc p join pg_namespace n on n.oid=p.pronamespace left join pg_depend d on d.objid=p.oid and d.deptype='e' where n.nspname='public' and d.objid is null
 union all select 'trigger',t.tgname::text,'on '||t.tgrelid::regclass::text from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and (n.nspname='public' or (n.nspname,c.relname) in (('auth','users'),('storage','objects')))
 union all select 'bucket',id,case when public then 'public' else 'private' end from storage.buckets
 union all select 'storage policy',policyname::text,'' from pg_policies where schemaname='storage' and tablename='objects'
 union all select 'schema',nspname::text,'' from pg_namespace where nspname='app_private'
 union all select 'auth users',count(*)::text,'existing logins' from auth.users
) x order by flag desc,kind,name;
