#!/usr/bin/env python3
"""Builds the setup files for a NEW, EMPTY Supabase project from an export of the shape of an existing project.
   Usage: python tools/build-fresh-install.py <structure2.json> [output-folder]
   Writes  01-structure.sql   (tables, rules, functions, permissions exactly as exported)
           02-features-and-seed.sql (every repo migration in order, so the project matches the latest code, plus the first church)
   Contains no member data: the export only describes the database's shape."""
import json, sys, os, re

src = sys.argv[1]
out = sys.argv[2] if len(sys.argv) > 2 else 'fresh-install'
repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
d = json.loads(open(src, encoding='utf-8-sig').read())
if isinstance(d, str): d = json.loads(d)
os.makedirs(out, exist_ok=True)
Q = lambda s: '"' + s.replace('"', '""') + '"'

def table_ref(name):                      # 'church_events' / 'public.church_events' / '"x"'
    n = name.replace('"', '')
    return n if '.' in n else 'public.' + n

lines = ['-- Church Connect: new project setup, part 1 of 2 (structure). Generated from an export of an existing project; contains no data.',
         '-- Run this FIRST in the new project\'s SQL Editor, then part 2.', 'set check_function_bodies = off;', '']

# 1. tables (defaults that call our own functions are added after the functions exist)
late_defaults = []
for t in d['tables']:
    cols = []
    for c in t['columns']:
        s = f'{Q(c["name"])} {c["type"]}'
        if c.get('identity'): s += ' generated ' + ('always' if c['identity'] == 'a' else 'by default') + ' as identity'
        elif c.get('default'):
            if re.search(r'\b(cc_|has_church|is_church|is_approved|can_read)', c['default']): late_defaults.append((t['table'], c['name'], c['default']))
            else: s += ' default ' + c['default']
        if c['not_null']: s += ' not null'
        cols.append(s)
    lines.append(f'create table if not exists public.{Q(t["table"])} (\n  ' + ',\n  '.join(cols) + '\n);')
lines.append('')

# 2. constraints: keys and checks first, foreign keys last (they need the other tables)
kinds = {'p': 0, 'u': 0, 'c': 1, 'f': 2}
for c in sorted(d['constraints'], key=lambda c: kinds.get(c['type'], 3)):
    tr = table_ref(c["table"])
    lines.append(f"do $cc$ begin if not exists (select 1 from pg_constraint where conname = '{c['name']}' and conrelid = '{tr}'::regclass) then "
                 f'alter table {tr} add constraint {Q(c["name"])} {c["def"]}; end if; end $cc$;')
lines.append('')

# 3. indexes that are not already created by a constraint
cnames = {c['name'] for c in d['constraints']}
for i in d['indexes']:
    if i['name'] in cnames: continue
    lines.append(re.sub(r'^CREATE (UNIQUE )?INDEX', lambda m: f'CREATE {m.group(1) or ""}INDEX IF NOT EXISTS', i['def']) + ';')
lines.append('')

# 4. functions (the exact definitions), then the defaults that use them
for f in d['functions']:
    lines.append(f['definition'].rstrip().rstrip(';') + ';')
lines.append('')
for t, c, df in late_defaults:
    lines.append(f'alter table public.{Q(t)} alter column {Q(c)} set default {df};')
lines.append('')

# 5. row-level security and every policy (permissive and restrictive)
for t in d['tables']:
    if t['rls_on']: lines.append(f'alter table public.{Q(t["table"])} enable row level security;')
lines.append('')
for p in d['policies']:
    roles = ', '.join('public' if r == 'public' else r for r in (p['roles'] or ['public']))
    s = f'create policy {Q(p["name"])} on {p["schema"]}.{Q(p["table"])} as {p["permissive"].lower()} for {p["command"].lower()} to {roles}'
    if p.get('using'): s += f' using ({p["using"]})'
    if p.get('with_check'): s += f' with check ({p["with_check"]})'
    lines.append(f'drop policy if exists {Q(p["name"])} on {p["schema"]}.{Q(p["table"])};')
    lines.append(s + ';')
lines.append('')

# 6. permissions exactly as exported (start from nothing, so new-project defaults do not leave anything extra)
for t in d['tables']:
    lines.append(f'revoke all on public.{Q(t["table"])} from anon, authenticated;')
grants = {}
for g in d['grants']: grants.setdefault((g['table'], g['role']), []).append(g['privilege'])
for (tb, role), pv in sorted(grants.items()):
    lines.append(f'grant {", ".join(sorted(pv))} on public.{Q(tb)} to {role};')
lines.append('')
lines.append('-- live updates (messages, events, announcements) for the app')
lines.append("do $$ begin alter publication supabase_realtime add table public.messages, public.church_events, public.church_announcements; exception when others then raise notice 'live updates not enabled: %', sqlerrm; end $$;")
open(os.path.join(out, '01-structure.sql'), 'w', encoding='utf-8', newline='\n').write('\n'.join(lines) + '\n')

# ---- part 2: all repo migrations in order (each is safe to re-run), then the first church
order = ['phase4-migration.sql', 'membership-migration.sql', 'directory-ministry-migration.sql', 'ministry-colors-migration.sql', 'phase3-4-migration.sql',
         'messaging-migration.sql', 'phase5-website-migration.sql', 'phase8-media-migration.sql', 'phase10-sms-migration.sql', 'phase11-push-migration.sql',
         'phase12-hardening-migration.sql', 'multichurch-migration.sql', 'broadcast-migration.sql', 'events-sync-migration.sql', 'photos-security-migration.sql',
         'platform-migration.sql', 'colors-migration.sql', 'webmaster-migration.sql', 'webmaster-requests-migration.sql', 'ministry-phone-migration.sql', 'messaging-upgrade.sql', 'messaging-plus-migration.sql', 'church-groups-migration.sql']
p2 = ['-- Church Connect: new project setup, part 2 of 2 (features and first church). Run AFTER part 1.', '']
for f in order:
    p2.append(f'-- ===== {f} =====')
    text = open(os.path.join(repo, f), encoding='utf-8').read().replace('\r\n', '\n').rstrip() + '\n'
    # early steps seeded a one-row settings table for a single-church database; here the multi-church step seeds one row per church
    text = re.sub(r"insert into public\.church_organization_preferences\(id\) values\(true\) on conflict do nothing;", "-- (one-row-per-church settings are seeded by the multi-church step below)", text)
    p2.append(text)
p2.append("""-- ===== the first church of this project =====
update public.churches set name = 'Church Connect' where name = 'Your Church';
""")
open(os.path.join(out, '02-features-and-seed.sql'), 'w', encoding='utf-8', newline='\n').write('\n'.join(p2))
print('tables', len(d['tables']), '| constraints', len(d['constraints']), '| policies', len(d['policies']), '| functions', len(d['functions']), '| grants', len(grants))
for n in ('01-structure.sql', '02-features-and-seed.sql'): print(n, os.path.getsize(os.path.join(out, n)), 'bytes')
