-- READ-ONLY. Run in the Supabase SQL Editor of the church's CURRENT project, then export / copy the one result cell and save it as
-- structure2.json in your Downloads folder. It lists the SHAPE of the database (tables, rules, functions) - no member data, no passwords.
select jsonb_pretty(jsonb_build_object(
 'tables', (select jsonb_agg(jsonb_build_object('table', c.relname, 'rls_on', c.relrowsecurity,
    'columns', (select jsonb_agg(jsonb_build_object('name', a.attname, 'type', format_type(a.atttypid, a.atttypmod), 'not_null', a.attnotnull,
                  'default', pg_get_expr(d.adbin, d.adrelid), 'identity', nullif(a.attidentity, '')) order by a.attnum)
                from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
                where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped)) order by c.relname)
   from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'),
 'constraints', (select jsonb_agg(jsonb_build_object('table', c.conrelid::regclass::text, 'name', c.conname, 'type', c.contype, 'def', pg_get_constraintdef(c.oid)) order by c.contype desc, c.conname)
   from pg_constraint c join pg_namespace n on n.oid = c.connamespace where n.nspname = 'public'),
 'indexes', (select jsonb_agg(jsonb_build_object('table', tablename, 'name', indexname, 'def', indexdef)) from pg_indexes where schemaname = 'public'),
 'policies', (select jsonb_agg(jsonb_build_object('schema', schemaname, 'table', tablename, 'name', policyname, 'permissive', permissive, 'command', cmd, 'roles', roles, 'using', qual, 'with_check', with_check))
   from pg_policies where schemaname in ('public', 'storage')),
 'functions', (select jsonb_agg(jsonb_build_object('name', p.proname, 'args', pg_get_function_identity_arguments(p.oid), 'security_definer', p.prosecdef, 'definition', pg_get_functiondef(p.oid)))
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f'),
 'grants', (select jsonb_agg(jsonb_build_object('table', table_name, 'role', grantee, 'privilege', privilege_type))
   from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'authenticated')),
 'publication', (select jsonb_agg(jsonb_build_object('pub', pubname, 'table', tablename)) from pg_publication_tables where schemaname = 'public'),
 'buckets', (select jsonb_agg(jsonb_build_object('id', id, 'public', public, 'limit', file_size_limit, 'mimes', allowed_mime_types)) from storage.buckets),
 'extensions', (select jsonb_agg(extname) from pg_extension)
)) as structure;
