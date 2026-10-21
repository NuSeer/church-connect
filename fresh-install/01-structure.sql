-- Church Connect: new project setup, part 1 of 2 (structure). Generated from an export of an existing project; contains no data.
-- Run this FIRST in the new project's SQL Editor, then part 2.
set check_function_bodies = off;

create table if not exists public."cc_directory_members" (
  "id" uuid default gen_random_uuid() not null,
  "full_name" text not null,
  "phone" text,
  "email" text,
  "courtesy_title" text default 'Sis.'::text not null,
  "church_titles" text[] default '{}'::text[] not null,
  "primary_title" text,
  "notes" text,
  "sms_consent" boolean default false not null,
  "active" boolean default true not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "church_id" uuid not null,
  "gender" text,
  "photo_path" text,
  "photo_visible" boolean default false not null
);
create table if not exists public."cc_directory_ministries" (
  "member_id" uuid not null,
  "ministry_id" uuid not null,
  "is_leader" boolean default false not null
);
create table if not exists public."cc_platform_admins" (
  "user_id" uuid not null
);
create table if not exists public."cc_push_deliveries" (
  "message_id" uuid not null,
  "created_at" timestamp with time zone default now() not null
);
create table if not exists public."cc_staff_delegations" (
  "id" uuid default gen_random_uuid() not null,
  "user_id" uuid not null,
  "permission" text not null,
  "granted_by" uuid not null,
  "created_at" timestamp with time zone default now() not null,
  "church_id" uuid not null
);
create table if not exists public."cc_website_content" (
  "id" integer not null,
  "enabled" boolean default true not null,
  "published" jsonb default '{}'::jsonb not null,
  "draft" jsonb default '{}'::jsonb not null,
  "updated_at" timestamp with time zone default now() not null,
  "published_at" timestamp with time zone,
  "church_id" uuid not null
);
create table if not exists public."church_admins" (
  "user_id" uuid not null,
  "church_id" uuid not null
);
create table if not exists public."church_announcements" (
  "id" uuid default gen_random_uuid() not null,
  "title" text not null,
  "body" text default ''::text not null,
  "pinned" boolean default false not null,
  "published" boolean default true not null,
  "created_at" timestamp with time zone default now() not null,
  "church_id" uuid not null
);
create table if not exists public."church_events" (
  "id" uuid default gen_random_uuid() not null,
  "title" text not null,
  "description" text default ''::text not null,
  "starts_at" timestamp with time zone not null,
  "location" text default ''::text not null,
  "recurrence" text default 'none'::text not null,
  "published" boolean default true not null,
  "created_at" timestamp with time zone default now() not null,
  "church_id" uuid not null,
  "source" text,
  "external_id" text
);
create table if not exists public."church_giving_links" (
  "id" uuid default gen_random_uuid() not null,
  "title" text not null,
  "description" text default ''::text not null,
  "url" text not null,
  "active" boolean default true not null,
  "created_at" timestamp with time zone default now() not null,
  "church_id" uuid not null
);
create table if not exists public."church_organization_preferences" (
  "id" boolean default true not null,
  "group_term" text default 'Ministry'::text not null,
  "church_id" uuid not null
);
create table if not exists public."church_settings" (
  "id" boolean default true not null,
  "donation_history_enabled" boolean default false not null,
  "church_id" uuid not null
);
create table if not exists public."church_subscriptions" (
  "church_id" uuid not null,
  "plan" text default 'trial'::text not null,
  "status" text default 'trialing'::text not null,
  "trial_ends_at" timestamp with time zone,
  "current_period_end" timestamp with time zone,
  "updated_at" timestamp with time zone default now() not null
);
create table if not exists public."churches" (
  "id" uuid default gen_random_uuid() not null,
  "name" text not null,
  "slug" text not null,
  "created_at" timestamp with time zone default now() not null,
  "events_feed_url" text,
  "events_timezone" text default 'America/New_York'::text not null,
  "events_synced_at" timestamp with time zone,
  "events_sync_status" text
);
create table if not exists public."conversation_members" (
  "conversation_id" uuid not null,
  "user_id" uuid not null
);
create table if not exists public."conversation_read_states" (
  "conversation_id" uuid not null,
  "user_id" uuid not null,
  "last_read_at" timestamp with time zone default now() not null
);
create table if not exists public."conversations" (
  "id" uuid default gen_random_uuid() not null,
  "kind" text not null,
  "ministry_id" uuid,
  "created_at" timestamp with time zone default now() not null,
  "church_id" uuid not null
);
create table if not exists public."donation_records" (
  "id" uuid default gen_random_uuid() not null,
  "donor_id" uuid not null,
  "amount" numeric(12,2) not null,
  "currency" text default 'USD'::text not null,
  "provider" text not null,
  "donated_at" timestamp with time zone not null,
  "reference" text,
  "church_id" uuid not null
);
create table if not exists public."member_church_titles" (
  "user_id" uuid not null,
  "title_mode" text default 'none'::text not null,
  "titles" text[] default '{}'::text[] not null,
  "primary_title" text,
  "courtesy_title" text default 'Sis.'::text not null,
  "verified_titles" text[] default '{}'::text[] not null,
  "updated_at" timestamp with time zone default now() not null
);
create table if not exists public."member_profiles" (
  "user_id" uuid not null,
  "display_name" text default ''::text not null,
  "bio" text default ''::text not null,
  "directory_visible" boolean default false not null,
  "directory_contact_visible" boolean default false not null,
  "contact_email" text,
  "approved" boolean default false not null,
  "created_at" timestamp with time zone default now() not null,
  "church_id" uuid not null,
  "gender" text,
  "photo_path" text,
  "photo_visible" boolean default false not null
);
create table if not exists public."member_push_subscriptions" (
  "id" bigint generated always as identity not null,
  "user_id" uuid not null,
  "endpoint" text not null,
  "p256dh" text not null,
  "auth" text not null,
  "user_agent" text,
  "created_at" timestamp with time zone default now() not null
);
create table if not exists public."member_roles" (
  "user_id" uuid not null,
  "role" text not null,
  "church_id" uuid not null
);
create table if not exists public."member_sms_preferences" (
  "user_id" uuid not null,
  "phone" text,
  "opted_in" boolean default false not null,
  "has_app" boolean default true not null,
  "updated_at" timestamp with time zone default now() not null
);
create table if not exists public."member_updates" (
  "id" uuid default gen_random_uuid() not null,
  "title" text not null,
  "body" text default ''::text not null,
  "ministry_id" uuid,
  "created_by" uuid,
  "created_at" timestamp with time zone default now(),
  "church_id" uuid not null
);
create table if not exists public."messages" (
  "id" uuid default gen_random_uuid() not null,
  "conversation_id" uuid not null,
  "sender_id" uuid not null,
  "body" text not null,
  "created_at" timestamp with time zone default now() not null
);
create table if not exists public."ministries" (
  "id" uuid default gen_random_uuid() not null,
  "name" text not null,
  "description" text default ''::text not null,
  "created_at" timestamp with time zone default now(),
  "color" text default '#64748b'::text not null,
  "church_id" uuid not null
);
create table if not exists public."ministry_activities" (
  "id" uuid default gen_random_uuid() not null,
  "ministry_id" uuid not null,
  "title" text not null,
  "details" text default ''::text not null,
  "starts_at" timestamp with time zone not null,
  "created_at" timestamp with time zone default now()
);
create table if not exists public."ministry_join_requests" (
  "user_id" uuid not null,
  "ministry_id" uuid not null,
  "status" text default 'pending'::text not null,
  "requested_at" timestamp with time zone default now() not null
);
create table if not exists public."ministry_members" (
  "ministry_id" uuid not null,
  "user_id" uuid not null,
  "is_leader" boolean default false not null
);

alter table public.cc_staff_delegations add constraint "cc_staff_delegations_user_id_permission_key" UNIQUE (user_id, permission);
alter table public.churches add constraint "churches_slug_key" UNIQUE (slug);
alter table public.member_push_subscriptions add constraint "member_push_subscriptions_endpoint_key" UNIQUE (endpoint);
alter table public.cc_directory_members add constraint "cc_directory_members_pkey" PRIMARY KEY (id);
alter table public.cc_directory_ministries add constraint "cc_directory_ministries_pkey" PRIMARY KEY (member_id, ministry_id);
alter table public.cc_platform_admins add constraint "cc_platform_admins_pkey" PRIMARY KEY (user_id);
alter table public.cc_push_deliveries add constraint "cc_push_deliveries_pkey" PRIMARY KEY (message_id);
alter table public.cc_staff_delegations add constraint "cc_staff_delegations_pkey" PRIMARY KEY (id);
alter table public.cc_website_content add constraint "cc_website_content_pkey" PRIMARY KEY (church_id, id);
alter table public.church_admins add constraint "church_admins_pkey" PRIMARY KEY (user_id);
alter table public.church_announcements add constraint "church_announcements_pkey" PRIMARY KEY (id);
alter table public.church_events add constraint "church_events_pkey" PRIMARY KEY (id);
alter table public.church_giving_links add constraint "church_giving_links_pkey" PRIMARY KEY (id);
alter table public.church_organization_preferences add constraint "church_organization_preferences_pkey" PRIMARY KEY (church_id, id);
alter table public.church_settings add constraint "church_settings_pkey" PRIMARY KEY (church_id, id);
alter table public.church_subscriptions add constraint "church_subscriptions_pkey" PRIMARY KEY (church_id);
alter table public.churches add constraint "churches_pkey" PRIMARY KEY (id);
alter table public.conversation_members add constraint "conversation_members_pkey" PRIMARY KEY (conversation_id, user_id);
alter table public.conversation_read_states add constraint "conversation_read_states_pkey" PRIMARY KEY (conversation_id, user_id);
alter table public.conversations add constraint "conversations_pkey" PRIMARY KEY (id);
alter table public.donation_records add constraint "donation_records_pkey" PRIMARY KEY (id);
alter table public.member_church_titles add constraint "member_church_titles_pkey" PRIMARY KEY (user_id);
alter table public.member_profiles add constraint "member_profiles_pkey" PRIMARY KEY (user_id);
alter table public.member_push_subscriptions add constraint "member_push_subscriptions_pkey" PRIMARY KEY (id);
alter table public.member_roles add constraint "member_roles_pkey" PRIMARY KEY (user_id, role);
alter table public.member_sms_preferences add constraint "member_sms_preferences_pkey" PRIMARY KEY (user_id);
alter table public.member_updates add constraint "member_updates_pkey" PRIMARY KEY (id);
alter table public.messages add constraint "messages_pkey" PRIMARY KEY (id);
alter table public.ministries add constraint "ministries_pkey" PRIMARY KEY (id);
alter table public.ministry_activities add constraint "ministry_activities_pkey" PRIMARY KEY (id);
alter table public.ministry_join_requests add constraint "ministry_join_requests_pkey" PRIMARY KEY (user_id, ministry_id);
alter table public.ministry_members add constraint "ministry_members_pkey" PRIMARY KEY (ministry_id, user_id);
alter table public.cc_directory_members add constraint "cc_directory_contact" CHECK (((phone IS NULL) OR (length(phone) <= 30)));
alter table public.cc_directory_members add constraint "cc_directory_email" CHECK (((email IS NULL) OR (length(email) <= 254)));
alter table public.cc_directory_members add constraint "cc_directory_gender_ck" CHECK (((gender IS NULL) OR (gender = ANY (ARRAY['female'::text, 'male'::text]))));
alter table public.cc_directory_members add constraint "cc_directory_members_courtesy_title_check" CHECK ((courtesy_title = ANY (ARRAY['Bro.'::text, 'Sis.'::text])));
alter table public.cc_directory_members add constraint "cc_directory_members_full_name_check" CHECK (((length(TRIM(BOTH FROM full_name)) >= 2) AND (length(TRIM(BOTH FROM full_name)) <= 150)));
alter table public.cc_directory_members add constraint "cc_directory_photo_path_ck" CHECK (((photo_path IS NULL) OR (photo_path = ((((church_id)::text || '/dir-'::text) || (id)::text) || '.jpg'::text))));
alter table public.cc_directory_members add constraint "cc_directory_primary_title" CHECK (((primary_title IS NULL) OR (primary_title = ANY (church_titles))));
alter table public.cc_staff_delegations add constraint "cc_staff_delegations_permission_check" CHECK ((permission = ANY (ARRAY['membership_view'::text, 'membership_manage'::text, 'ministry_view'::text, 'ministry_manage'::text, 'events_manage'::text, 'announcements_manage'::text, 'trustees_view'::text])));
alter table public.cc_website_content add constraint "cc_website_content_id_check" CHECK ((id = 1));
alter table public.church_announcements add constraint "church_announcements_title_check" CHECK (((length(title) >= 1) AND (length(title) <= 180)));
alter table public.church_events add constraint "church_events_recurrence_check" CHECK ((recurrence = ANY (ARRAY['none'::text, 'weekly'::text, 'monthly'::text])));
alter table public.church_events add constraint "church_events_title_check" CHECK (((length(title) >= 1) AND (length(title) <= 180)));
alter table public.church_giving_links add constraint "church_giving_links_title_check" CHECK (((length(title) >= 1) AND (length(title) <= 120)));
alter table public.church_giving_links add constraint "church_giving_links_url_check" CHECK ((url ~ '^https://[^[:space:]]+$'::text));
alter table public.church_organization_preferences add constraint "church_organization_preferences_group_term_check" CHECK ((group_term = ANY (ARRAY['Ministry'::text, 'Department'::text])));
alter table public.church_organization_preferences add constraint "church_organization_preferences_id_check" CHECK (id);
alter table public.church_settings add constraint "church_settings_id_check" CHECK (id);
alter table public.church_subscriptions add constraint "church_subscriptions_status_check" CHECK ((status = ANY (ARRAY['trialing'::text, 'active'::text, 'past_due'::text, 'canceled'::text])));
alter table public.churches add constraint "churches_name_check" CHECK (((length(TRIM(BOTH FROM name)) >= 2) AND (length(TRIM(BOTH FROM name)) <= 150)));
alter table public.churches add constraint "churches_slug_check" CHECK ((slug ~ '^[a-z0-9-]{2,50}$'::text));
alter table public.conversations add constraint "conversations_check" CHECK ((((kind = 'direct'::text) AND (ministry_id IS NULL)) OR ((kind = 'ministry'::text) AND (ministry_id IS NOT NULL))));
alter table public.conversations add constraint "conversations_kind_check" CHECK ((kind = ANY (ARRAY['direct'::text, 'ministry'::text])));
alter table public.donation_records add constraint "donation_records_amount_check" CHECK ((amount >= (0)::numeric));
alter table public.member_church_titles add constraint "member_church_titles_courtesy_title_check" CHECK ((courtesy_title = ANY (ARRAY['Bro.'::text, 'Sis.'::text])));
alter table public.member_church_titles add constraint "member_church_titles_title_mode_check" CHECK ((title_mode = ANY (ARRAY['title'::text, 'none'::text])));
alter table public.member_profiles add constraint "member_profiles_gender_ck" CHECK (((gender IS NULL) OR (gender = ANY (ARRAY['female'::text, 'male'::text]))));
alter table public.member_profiles add constraint "member_profiles_photo_path_ck" CHECK (((photo_path IS NULL) OR (photo_path = ((((church_id)::text || '/'::text) || (user_id)::text) || '.jpg'::text))));
alter table public.member_roles add constraint "member_roles_role_check" CHECK ((role = ANY (ARRAY['pastor'::text, 'administrator'::text, 'ministry_leader'::text, 'finance'::text])));
alter table public.messages add constraint "messages_body_check" CHECK (((char_length(body) >= 1) AND (char_length(body) <= 4000)));
alter table public.ministries add constraint "ministries_color_hex" CHECK ((color ~ '^#[0-9A-Fa-f]{6}$'::text));
alter table public.ministry_join_requests add constraint "ministry_join_requests_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])));
alter table public.member_church_titles add constraint "primary_is_selected" CHECK (((primary_title IS NULL) OR (primary_title = ANY (titles))));
alter table public.member_sms_preferences add constraint "sms_opt_in_requires_phone" CHECK (((NOT opted_in) OR (phone IS NOT NULL)));
alter table public.member_sms_preferences add constraint "sms_phone_format" CHECK (((phone IS NULL) OR (phone ~ '^\+[1-9][0-9]{7,14}$'::text)));
alter table public.cc_directory_members add constraint "cc_directory_members_church_id_fkey" FOREIGN KEY (church_id) REFERENCES churches(id) ON DELETE CASCADE;
alter table public.cc_directory_ministries add constraint "cc_directory_ministries_member_id_fkey" FOREIGN KEY (member_id) REFERENCES cc_directory_members(id) ON DELETE CASCADE;
alter table public.cc_directory_ministries add constraint "cc_directory_ministries_ministry_id_fkey" FOREIGN KEY (ministry_id) REFERENCES ministries(id) ON DELETE CASCADE;
alter table public.cc_platform_admins add constraint "cc_platform_admins_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.cc_staff_delegations add constraint "cc_staff_delegations_church_id_fkey" FOREIGN KEY (church_id) REFERENCES churches(id) ON DELETE CASCADE;
alter table public.cc_staff_delegations add constraint "cc_staff_delegations_granted_by_fkey" FOREIGN KEY (granted_by) REFERENCES auth.users(id);
alter table public.cc_staff_delegations add constraint "cc_staff_delegations_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.cc_website_content add constraint "cc_website_content_church_id_fkey" FOREIGN KEY (church_id) REFERENCES churches(id) ON DELETE CASCADE;
alter table public.church_admins add constraint "church_admins_church_id_fkey" FOREIGN KEY (church_id) REFERENCES churches(id) ON DELETE CASCADE;
alter table public.church_admins add constraint "church_admins_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.church_announcements add constraint "church_announcements_church_id_fkey" FOREIGN KEY (church_id) REFERENCES churches(id) ON DELETE CASCADE;
alter table public.church_events add constraint "church_events_church_id_fkey" FOREIGN KEY (church_id) REFERENCES churches(id) ON DELETE CASCADE;
alter table public.church_giving_links add constraint "church_giving_links_church_id_fkey" FOREIGN KEY (church_id) REFERENCES churches(id) ON DELETE CASCADE;
alter table public.church_organization_preferences add constraint "church_organization_preferences_church_id_fkey" FOREIGN KEY (church_id) REFERENCES churches(id) ON DELETE CASCADE;
alter table public.church_settings add constraint "church_settings_church_id_fkey" FOREIGN KEY (church_id) REFERENCES churches(id) ON DELETE CASCADE;
alter table public.church_subscriptions add constraint "church_subscriptions_church_id_fkey" FOREIGN KEY (church_id) REFERENCES churches(id) ON DELETE CASCADE;
alter table public.conversation_members add constraint "conversation_members_conversation_id_fkey" FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE;
alter table public.conversation_members add constraint "conversation_members_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.conversation_read_states add constraint "conversation_read_states_conversation_id_fkey" FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE;
alter table public.conversation_read_states add constraint "conversation_read_states_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.conversations add constraint "conversations_church_id_fkey" FOREIGN KEY (church_id) REFERENCES churches(id) ON DELETE CASCADE;
alter table public.conversations add constraint "conversations_ministry_id_fkey" FOREIGN KEY (ministry_id) REFERENCES ministries(id) ON DELETE CASCADE;
alter table public.donation_records add constraint "donation_records_church_id_fkey" FOREIGN KEY (church_id) REFERENCES churches(id) ON DELETE CASCADE;
alter table public.donation_records add constraint "donation_records_donor_id_fkey" FOREIGN KEY (donor_id) REFERENCES auth.users(id);
alter table public.member_church_titles add constraint "member_church_titles_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.member_profiles add constraint "member_profiles_church_id_fkey" FOREIGN KEY (church_id) REFERENCES churches(id) ON DELETE CASCADE;
alter table public.member_profiles add constraint "member_profiles_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.member_push_subscriptions add constraint "member_push_subscriptions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.member_roles add constraint "member_roles_church_id_fkey" FOREIGN KEY (church_id) REFERENCES churches(id) ON DELETE CASCADE;
alter table public.member_roles add constraint "member_roles_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.member_sms_preferences add constraint "member_sms_preferences_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.member_updates add constraint "member_updates_church_id_fkey" FOREIGN KEY (church_id) REFERENCES churches(id) ON DELETE CASCADE;
alter table public.member_updates add constraint "member_updates_created_by_fkey" FOREIGN KEY (created_by) REFERENCES auth.users(id);
alter table public.member_updates add constraint "member_updates_ministry_id_fkey" FOREIGN KEY (ministry_id) REFERENCES ministries(id) ON DELETE CASCADE;
alter table public.messages add constraint "messages_conversation_id_fkey" FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE;
alter table public.messages add constraint "messages_sender_id_fkey" FOREIGN KEY (sender_id) REFERENCES auth.users(id);
alter table public.ministries add constraint "ministries_church_id_fkey" FOREIGN KEY (church_id) REFERENCES churches(id) ON DELETE CASCADE;
alter table public.ministry_activities add constraint "ministry_activities_ministry_id_fkey" FOREIGN KEY (ministry_id) REFERENCES ministries(id) ON DELETE CASCADE;
alter table public.ministry_join_requests add constraint "ministry_join_requests_ministry_id_fkey" FOREIGN KEY (ministry_id) REFERENCES ministries(id) ON DELETE CASCADE;
alter table public.ministry_join_requests add constraint "ministry_join_requests_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.ministry_members add constraint "ministry_members_ministry_id_fkey" FOREIGN KEY (ministry_id) REFERENCES ministries(id) ON DELETE CASCADE;
alter table public.ministry_members add constraint "ministry_members_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS cc_church_settings_church_idx ON public.church_settings USING btree (church_id);
CREATE INDEX IF NOT EXISTS cc_donation_records_church_idx ON public.donation_records USING btree (church_id);
CREATE INDEX IF NOT EXISTS push_user_idx ON public.member_push_subscriptions USING btree (user_id);
CREATE INDEX IF NOT EXISTS cc_cc_website_content_church_idx ON public.cc_website_content USING btree (church_id);
CREATE INDEX IF NOT EXISTS cc_church_admins_church_idx ON public.church_admins USING btree (church_id);
CREATE INDEX IF NOT EXISTS cc_church_events_church_idx ON public.church_events USING btree (church_id);
CREATE UNIQUE INDEX IF NOT EXISTS church_events_website_uq ON public.church_events USING btree (church_id, source, external_id);
CREATE INDEX IF NOT EXISTS cc_church_announcements_church_idx ON public.church_announcements USING btree (church_id);
CREATE INDEX IF NOT EXISTS cc_church_giving_links_church_idx ON public.church_giving_links USING btree (church_id);
CREATE INDEX IF NOT EXISTS cc_member_roles_church_idx ON public.member_roles USING btree (church_id);
CREATE INDEX IF NOT EXISTS cc_ministries_church_idx ON public.ministries USING btree (church_id);
CREATE UNIQUE INDEX IF NOT EXISTS unique_ministry_conversation ON public.conversations USING btree (ministry_id) WHERE (ministry_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS cc_conversations_church_idx ON public.conversations USING btree (church_id);
CREATE INDEX IF NOT EXISTS cc_member_updates_church_idx ON public.member_updates USING btree (church_id);
CREATE INDEX IF NOT EXISTS cc_member_profiles_church_idx ON public.member_profiles USING btree (church_id);
CREATE INDEX IF NOT EXISTS cc_church_organization_preferences_church_idx ON public.church_organization_preferences USING btree (church_id);
CREATE INDEX IF NOT EXISTS cc_cc_staff_delegations_church_idx ON public.cc_staff_delegations USING btree (church_id);
CREATE INDEX IF NOT EXISTS cc_cc_directory_members_church_idx ON public.cc_directory_members USING btree (church_id);

CREATE OR REPLACE FUNCTION public.has_church_role(r text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(select 1 from public.member_roles where user_id=(select auth.uid()) and role=r)
 or (r in ('administrator','pastor') and public.is_church_admin()); $function$;
CREATE OR REPLACE FUNCTION public.is_approved_member(u uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(select 1 from public.member_profiles where user_id=u and approved=true); $function$;
CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
  tbl name;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        SELECT c.relname INTO tbl FROM pg_catalog.pg_class c WHERE c.oid = cmd.objid;
        EXECUTE format('alter table if exists %I.%I enable row level security', cmd.schema_name, tbl);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;
CREATE OR REPLACE FUNCTION public.is_church_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists(select 1 from public.church_admins where user_id = (select auth.uid()));
$function$;
CREATE OR REPLACE FUNCTION public.is_ministry_member(m uuid, u uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(select 1 from public.ministry_members where ministry_id=m and user_id=u); $function$;
CREATE OR REPLACE FUNCTION public.is_ministry_leader(m uuid, u uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(select 1 from public.ministry_members where ministry_id=m and user_id=u and is_leader=true)
 or public.has_church_role('administrator') or public.has_church_role('pastor'); $function$;
CREATE OR REPLACE FUNCTION public.can_read_conversation(c uuid, u uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select public.is_approved_member(u) and exists(
 select 1 from public.conversations x where x.id=c and (
 (x.kind='direct' and exists(select 1 from public.conversation_members cm where cm.conversation_id=c and cm.user_id=u))
 or (x.kind='ministry' and public.is_ministry_member(x.ministry_id,u)))); $function$;
CREATE OR REPLACE FUNCTION public.start_direct_chat(recipient uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cid uuid; me uuid := auth.uid();
begin
 if me is null or recipient=me or not public.is_approved_member(me) or not public.is_approved_member(recipient) then raise exception 'Not authorized'; end if;
 if not public.cc_same_church_user(recipient) then raise exception 'Recipient is not available'; end if;
 if not public.cc_church_writable(public.cc_my_church_id()) then raise exception 'This church''s subscription is not active'; end if;
 if not exists(select 1 from public.member_profiles where user_id=recipient and directory_visible=true) then raise exception 'Recipient is not available'; end if;
 perform pg_advisory_xact_lock(hashtext(least(me::text,recipient::text)||greatest(me::text,recipient::text)));
 select c.id into cid from public.conversations c join public.conversation_members a on a.conversation_id=c.id and a.user_id=me
 join public.conversation_members b on b.conversation_id=c.id and b.user_id=recipient
 where c.kind='direct' and (select count(*) from public.conversation_members x where x.conversation_id=c.id)=2 limit 1;
 if cid is null then
  insert into public.conversations(kind,church_id) values('direct',public.cc_my_church_id()) returning id into cid;
  insert into public.conversation_members(conversation_id,user_id) values(cid,me),(cid,recipient);
 end if;
 return cid;
end $function$;
CREATE OR REPLACE FUNCTION public.set_member_approval(u uuid, v boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if not public.has_church_role('administrator') then raise exception 'Not authorized'; end if;
 if not public.cc_same_church_user(u) then raise exception 'Member not found'; end if;
 update public.member_profiles set approved=v where user_id=u;
end $function$;
CREATE OR REPLACE FUNCTION public.cc_create_ministry_activity(p_ministry_id uuid, p_title text, p_details text, p_starts_at timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid;
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 if not public.cc_church_writable(public.cc_my_church_id()) then raise exception 'This church''s subscription is not active'; end if;
 if not exists(select 1 from public.ministries where id=p_ministry_id and church_id=public.cc_my_church_id()) then raise exception 'Ministry not found'; end if;
 if length(trim(coalesce(p_title,''))) not between 2 and 180 then raise exception 'Activity title must be 2–180 characters'; end if;
 if length(coalesce(p_details,''))>2000 then raise exception 'Details too long'; end if;
 if p_starts_at is null then raise exception 'Start date is required'; end if;
 insert into public.ministry_activities(ministry_id,title,details,starts_at)
 values(p_ministry_id,trim(p_title),nullif(trim(coalesce(p_details,'')),''),p_starts_at) returning id into v_id;
 return v_id;
end $function$;
CREATE OR REPLACE FUNCTION public.cc_is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(select 1 from public.church_admins where user_id=auth.uid());
$function$;
CREATE OR REPLACE FUNCTION public.create_my_profile(n text, p_church uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v uuid;
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 v:=coalesce(p_church,(select id from public.churches where (select count(*) from public.churches)=1));
 if v is null or not exists(select 1 from public.churches where id=v) then raise exception 'Choose a church to join'; end if;
 if not public.cc_church_writable(v) then raise exception 'This church is not accepting new members right now'; end if;
 insert into public.member_profiles(user_id,display_name,church_id) values(auth.uid(),left(trim(n),100),v) on conflict(user_id) do nothing;
end $function$;
CREATE OR REPLACE FUNCTION public.cc_verify_titles(p_user_id uuid, p_titles text[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare permitted text[] := array['Pastor','First Lady','Minister','Elder','Missionary','Mother','Evangelist','Deacon','Deaconess'];
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Not authorized'; end if;
 if not public.cc_same_church_user(p_user_id) then raise exception 'Member not found'; end if;
 if exists(select 1 from unnest(coalesce(p_titles,'{}'::text[])) t where not t=any(permitted)) then raise exception 'Invalid title'; end if;
 insert into public.member_church_titles(user_id,verified_titles) values(p_user_id,coalesce(p_titles,'{}'::text[]))
 on conflict(user_id) do update set verified_titles=excluded.verified_titles;
end; $function$;
CREATE OR REPLACE FUNCTION public.cc_save_website_draft(p_content jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 if not public.cc_church_writable(public.cc_my_church_id()) then raise exception 'This church''s subscription is not active'; end if;
 if jsonb_typeof(p_content) <> 'object' or pg_column_size(p_content)>30000 then raise exception 'Invalid or oversized content'; end if;
 insert into public.cc_website_content(church_id,id,draft) values(public.cc_my_church_id(),1,p_content)
 on conflict(church_id,id) do update set draft=excluded.draft,updated_at=now();
end $function$;
CREATE OR REPLACE FUNCTION public.cc_publish_website()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 if not public.cc_church_writable(public.cc_my_church_id()) then raise exception 'This church''s subscription is not active'; end if;
 update public.cc_website_content set published=draft,published_at=now(),updated_at=now() where id=1 and church_id=public.cc_my_church_id();
 if not found then raise exception 'Save a draft first'; end if;
end $function$;
CREATE OR REPLACE FUNCTION public.cc_toggle_website(p_enabled boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 insert into public.cc_website_content(church_id,id,enabled) values(public.cc_my_church_id(),1,p_enabled)
 on conflict(church_id,id) do update set enabled=excluded.enabled,updated_at=now();
end $function$;
CREATE OR REPLACE FUNCTION public.cc_phone_sms_recipients(p_conversation_id uuid, p_without_app boolean DEFAULT true)
 RETURNS TABLE(phone text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if auth.uid() is null or not public.can_read_conversation(p_conversation_id,auth.uid()) then
  raise exception 'Not authorized for this conversation';
 end if;
 return query
 select distinct sp.phone from public.member_sms_preferences sp
 join public.conversation_members cm on cm.user_id=sp.user_id and cm.conversation_id=p_conversation_id
 join public.member_profiles mp on mp.user_id=sp.user_id and mp.approved=true
 where sp.opted_in and sp.phone is not null and sp.user_id<>auth.uid()
 and (not p_without_app or not sp.has_app);
end $function$;
CREATE OR REPLACE FUNCTION public.my_conversation_unread_counts()
 RETURNS TABLE(conversation_id uuid, unread_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 with accessible as (select c.id from public.conversations c where public.can_read_conversation(c.id,auth.uid()))
 select a.id,count(m.conversation_id)::bigint from accessible a
 left join public.conversation_read_states r on r.conversation_id=a.id and r.user_id=auth.uid()
 left join public.messages m on m.conversation_id=a.id and m.sender_id<>auth.uid() and m.created_at>coalesce(r.last_read_at,'1970-01-01'::timestamptz)
 group by a.id
$function$;
CREATE OR REPLACE FUNCTION public.cc_save_directory_member(p_id uuid, p_name text, p_phone text, p_email text, p_courtesy text, p_titles text[], p_primary text, p_notes text, p_sms_consent boolean, p_ministry_ids uuid[], p_active boolean DEFAULT true)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid; v_church uuid:=public.cc_my_church_id(); allowed text[]:=array['Pastor','First Lady','Minister','Elder','Missionary','Mother','Evangelist','Deacon','Deaconess'];
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 if not public.cc_church_writable(public.cc_my_church_id()) then raise exception 'This church''s subscription is not active'; end if;
 if length(trim(coalesce(p_name,''))) not between 2 and 150 then raise exception 'Name must be 2–150 characters'; end if;
 if p_courtesy not in ('Bro.','Sis.') then raise exception 'Invalid courtesy title'; end if;
 if exists(select 1 from unnest(coalesce(p_titles,'{}'::text[])) t where not t=any(allowed)) then raise exception 'Invalid church title'; end if;
 if p_primary is not null and not p_primary=any(coalesce(p_titles,'{}'::text[])) then raise exception 'Primary title must be selected'; end if;
 if length(coalesce(p_notes,''))>2000 then raise exception 'Notes too long'; end if;
 if length(coalesce(p_phone,''))>30 or length(coalesce(p_email,''))>254 then raise exception 'Contact information too long'; end if;
 if exists(select 1 from unnest(coalesce(p_ministry_ids,'{}'::uuid[])) m where not exists(select 1 from public.ministries where id=m and church_id=v_church)) then raise exception 'Invalid ministry'; end if;
 if p_id is null then
  insert into public.cc_directory_members(church_id,full_name,phone,email,courtesy_title,church_titles,primary_title,notes,sms_consent,active)
  values(v_church,trim(p_name),nullif(trim(coalesce(p_phone,'')),''),nullif(trim(coalesce(p_email,'')),''),p_courtesy,coalesce(p_titles,'{}'::text[]),p_primary,nullif(trim(coalesce(p_notes,'')),''),coalesce(p_sms_consent,false),coalesce(p_active,true)) returning id into v_id;
 else
  update public.cc_directory_members set full_name=trim(p_name),phone=nullif(trim(coalesce(p_phone,'')),''),email=nullif(trim(coalesce(p_email,'')),''),courtesy_title=p_courtesy,church_titles=coalesce(p_titles,'{}'::text[]),primary_title=p_primary,notes=nullif(trim(coalesce(p_notes,'')),''),sms_consent=coalesce(p_sms_consent,false),active=coalesce(p_active,true),updated_at=now() where id=p_id and church_id=v_church returning id into v_id;
  if v_id is null then raise exception 'Directory member not found'; end if;
 end if;
 delete from public.cc_directory_ministries where member_id=v_id and ministry_id<>all(coalesce(p_ministry_ids,'{}'::uuid[]));
 insert into public.cc_directory_ministries(member_id,ministry_id)
 select v_id,m from (select distinct unnest(coalesce(p_ministry_ids,'{}'::uuid[])) m) x on conflict do nothing;
 return v_id;
end $function$;
CREATE OR REPLACE FUNCTION public.cc_directory_sms_recipients(p_conversation_id uuid)
 RETURNS TABLE(phone text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_ministry uuid;
begin
 if auth.uid() is null or not public.can_read_conversation(p_conversation_id,auth.uid()) then
  raise exception 'Not authorized for this conversation';
 end if;
 select c.ministry_id into v_ministry from public.conversations c where c.id=p_conversation_id and c.kind='ministry';
 if v_ministry is null then return; end if;
 if not (public.cc_is_admin() or exists(select 1 from public.ministry_members m where m.ministry_id=v_ministry and m.user_id=auth.uid() and m.is_leader)) then
  raise exception 'Only administrators and ministry leaders can text staff-entered members';
 end if;
 return query
 select distinct n.p from (
  select case
   when length(regexp_replace(d.phone,'\D','','g'))=10 then '+1'||regexp_replace(d.phone,'\D','','g')
   when length(regexp_replace(d.phone,'\D','','g'))=11 and regexp_replace(d.phone,'\D','','g') like '1%' then '+'||regexp_replace(d.phone,'\D','','g')
   when d.phone like '+%' and length(regexp_replace(d.phone,'\D','','g')) between 8 and 15 then '+'||regexp_replace(d.phone,'\D','','g')
  end as p
  from public.cc_directory_members d
  join public.cc_directory_ministries dm on dm.member_id=d.id and dm.ministry_id=v_ministry
  where d.active and d.sms_consent and d.phone is not null
 ) n where n.p is not null;
end $function$;
CREATE OR REPLACE FUNCTION public.cc_my_church_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select coalesce(
  (select church_id from public.church_admins where user_id=(select auth.uid()) limit 1),
  (select church_id from public.member_profiles where user_id=(select auth.uid()) limit 1));
$function$;
CREATE OR REPLACE FUNCTION public.cc_same_church_user(u uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(select 1 from public.member_profiles p where p.user_id=u and p.church_id=public.cc_my_church_id());
$function$;
CREATE OR REPLACE FUNCTION public.cc_church_writable(p_church uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(select 1 from public.church_subscriptions s where s.church_id=p_church and s.status in ('trialing','active')
  and (s.status<>'trialing' or s.trial_ends_at is null or s.trial_ends_at>now()));
$function$;
CREATE OR REPLACE FUNCTION public.cc_is_platform_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(select 1 from public.cc_platform_admins where user_id=(select auth.uid()));
$function$;
CREATE OR REPLACE FUNCTION public.cc_manage_member(p_user_id uuid, p_action text, p_ministry_id uuid DEFAULT NULL::uuid, p_leader boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Not authorized'; end if;
 if not public.cc_same_church_user(p_user_id) then raise exception 'Member not found'; end if;
 if p_ministry_id is not null and not exists(select 1 from public.ministries where id=p_ministry_id and church_id=public.cc_my_church_id()) then raise exception 'Ministry not found'; end if;
 if p_action='approve_member' then
  update public.member_profiles set approved=true where user_id=p_user_id;
 elsif p_action='suspend_member' then
  if p_user_id=auth.uid() then raise exception 'You cannot suspend yourself'; end if;
  update public.member_profiles set approved=false where user_id=p_user_id;
  delete from public.ministry_members where user_id=p_user_id;
 elsif p_action='approve_ministry' then
  if p_ministry_id is null then raise exception 'Ministry required'; end if;
  if not exists(select 1 from public.member_profiles where user_id=p_user_id and approved=true) then raise exception 'Approve member first'; end if;
  insert into public.ministry_members(ministry_id,user_id,is_leader) values(p_ministry_id,p_user_id,false) on conflict(ministry_id,user_id) do nothing;
  update public.ministry_join_requests set status='approved' where ministry_id=p_ministry_id and user_id=p_user_id;
 elsif p_action='reject_ministry' then
  update public.ministry_join_requests set status='rejected' where ministry_id=p_ministry_id and user_id=p_user_id and status='pending';
 elsif p_action='remove_ministry' then
  delete from public.ministry_members where ministry_id=p_ministry_id and user_id=p_user_id;
  delete from public.ministry_join_requests where ministry_id=p_ministry_id and user_id=p_user_id;
 elsif p_action='set_leader' then
  update public.ministry_members set is_leader=p_leader where ministry_id=p_ministry_id and user_id=p_user_id;
  if not found then raise exception 'Approve ministry membership first'; end if;
 else raise exception 'Unknown action'; end if;
end; $function$;
CREATE OR REPLACE FUNCTION public.cc_set_staff_delegation(p_user_id uuid, p_permission text, p_enabled boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 if p_permission not in ('membership_view','membership_manage','ministry_view','ministry_manage','events_manage','announcements_manage','trustees_view') then raise exception 'Unknown permission'; end if;
 if not exists(select 1 from public.member_profiles where user_id=p_user_id and approved=true and church_id=public.cc_my_church_id()) then raise exception 'Select an approved registered member'; end if;
 if p_enabled then
  insert into public.cc_staff_delegations(user_id,permission,granted_by,church_id) values(p_user_id,p_permission,auth.uid(),public.cc_my_church_id()) on conflict(user_id,permission) do nothing;
 else
  delete from public.cc_staff_delegations where user_id=p_user_id and permission=p_permission and church_id=public.cc_my_church_id();
 end if;
end $function$;
CREATE OR REPLACE FUNCTION public.cc_manage_ministry(p_id uuid, p_name text, p_action text DEFAULT 'save'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid; v_church uuid:=public.cc_my_church_id();
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 if not public.cc_church_writable(public.cc_my_church_id()) then raise exception 'This church''s subscription is not active'; end if;
 if p_action='save' then
  if length(trim(coalesce(p_name,''))) not between 2 and 100 then raise exception 'Name must be 2–100 characters'; end if;
  if p_id is null then insert into public.ministries(church_id,name) values(v_church,trim(p_name)) returning id into v_id;
  else update public.ministries set name=trim(p_name) where id=p_id and church_id=v_church returning id into v_id;
  end if;
  if v_id is null then raise exception 'Ministry not found'; end if;
  return v_id;
 else raise exception 'Unsupported ministry action'; end if;
end $function$;
CREATE OR REPLACE FUNCTION public.cc_set_directory_ministry_leader(p_member_id uuid, p_ministry_id uuid, p_is_leader boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 if not exists(select 1 from public.cc_directory_members where id=p_member_id and church_id=public.cc_my_church_id())
  or not exists(select 1 from public.ministries where id=p_ministry_id and church_id=public.cc_my_church_id()) then raise exception 'Directory assignment not found'; end if;
 update public.cc_directory_ministries set is_leader=coalesce(p_is_leader,false) where member_id=p_member_id and ministry_id=p_ministry_id;
 if not found then raise exception 'Directory assignment not found'; end if;
end $function$;
CREATE OR REPLACE FUNCTION public.cc_public_website(p_church uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select case when enabled then published else jsonb_build_object('enabled',false) end
 from public.cc_website_content where id=1 and church_id=coalesce(p_church,(select id from public.churches order by created_at limit 1));
$function$;
CREATE OR REPLACE FUNCTION public.cc_platform_create_church(p_name text, p_slug text, p_admin_user uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v uuid;
begin
 if not public.cc_is_platform_admin() then raise exception 'Platform administrator access required'; end if;
 insert into public.churches(name,slug) values(trim(p_name),lower(trim(p_slug))) returning id into v;
 insert into public.church_subscriptions(church_id,plan,status,trial_ends_at) values(v,'trial','trialing',now()+interval '30 days');
 insert into public.church_settings(church_id,id) values(v,true);
 insert into public.church_organization_preferences(church_id,id) values(v,true);
 insert into public.member_profiles(user_id,display_name,approved,church_id) values(p_admin_user,'Church administrator',true,v)
  on conflict(user_id) do update set church_id=v,approved=true;
 insert into public.church_admins(user_id,church_id) values(p_admin_user,v) on conflict(user_id) do update set church_id=v;
 return v;
end $function$;
CREATE OR REPLACE FUNCTION public.cc_platform_set_subscription(p_church uuid, p_plan text, p_status text, p_period_end timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if not public.cc_is_platform_admin() then raise exception 'Platform administrator access required'; end if;
 if p_status not in ('trialing','active','past_due','canceled') then raise exception 'Unknown status'; end if;
 insert into public.church_subscriptions(church_id,plan,status,current_period_end) values(p_church,coalesce(p_plan,'trial'),p_status,p_period_end)
 on conflict(church_id) do update set plan=excluded.plan,status=excluded.status,current_period_end=excluded.current_period_end,updated_at=now();
end $function$;
CREATE OR REPLACE FUNCTION public.cc_can_broadcast()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select auth.uid() is not null
  and exists(select 1 from public.member_profiles p where p.user_id=auth.uid() and p.approved=true and p.church_id=public.cc_my_church_id())
  and (public.has_church_role('administrator') or public.has_church_role('pastor'));
$function$;
CREATE OR REPLACE FUNCTION public.cc_member_access()
 RETURNS TABLE(user_id uuid, is_admin boolean, is_pastor boolean, is_me boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 return query
 select p.user_id,
  exists(select 1 from public.church_admins a where a.user_id=p.user_id),
  exists(select 1 from public.member_roles r where r.user_id=p.user_id and r.role='pastor'),
  p.user_id=auth.uid()
 from public.member_profiles p where p.church_id=public.cc_my_church_id();
end $function$;
CREATE OR REPLACE FUNCTION public.cc_send_broadcast(p_title text, p_body text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid; v_church uuid:=public.cc_my_church_id();
begin
 if not public.cc_can_broadcast() then raise exception 'Only administrators and pastors can send a church-wide broadcast'; end if;
 if not public.cc_church_writable(v_church) then raise exception 'This church''s subscription is not active'; end if;
 if length(trim(coalesce(p_title,''))) not between 2 and 120 then raise exception 'Title must be 2–120 characters'; end if;
 if length(trim(coalesce(p_body,''))) not between 1 and 2000 then raise exception 'Message must be 1–2000 characters'; end if;
 -- Abuse guard: a church-wide message goes to everyone, so cap how often it can be sent.
 if (select count(*) from public.member_updates u where u.church_id=v_church and u.ministry_id is null and u.created_at>now()-interval '1 hour')>=10 then
  raise exception 'Too many broadcasts in the last hour. Please wait before sending another.';
 end if;
 insert into public.member_updates(church_id,title,body,ministry_id,created_by)
 values(v_church,trim(p_title),trim(p_body),null,auth.uid()) returning id into v_id;
 return v_id;
end $function$;
CREATE OR REPLACE FUNCTION public.cc_broadcast_sms_recipients(p_without_app boolean DEFAULT true)
 RETURNS TABLE(phone text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_church uuid:=public.cc_my_church_id();
begin
 if not public.cc_can_broadcast() then raise exception 'Only administrators and pastors can send a church-wide broadcast'; end if;
 return query
 select distinct n.p from (
  select sp.phone as p
  from public.member_sms_preferences sp
  join public.member_profiles mp on mp.user_id=sp.user_id and mp.approved=true and mp.church_id=v_church
  where sp.opted_in and sp.phone is not null and sp.user_id<>auth.uid() and (not p_without_app or not sp.has_app)
  union all
  select case
   when length(regexp_replace(d.phone,'\D','','g'))=10 then '+1'||regexp_replace(d.phone,'\D','','g')
   when length(regexp_replace(d.phone,'\D','','g'))=11 and regexp_replace(d.phone,'\D','','g') like '1%' then '+'||regexp_replace(d.phone,'\D','','g')
   when d.phone like '+%' and length(regexp_replace(d.phone,'\D','','g')) between 8 and 15 then '+'||regexp_replace(d.phone,'\D','','g')
  end
  from public.cc_directory_members d
  where d.church_id=v_church and d.active and d.sms_consent and d.phone is not null
 ) n where n.p is not null;
end $function$;
CREATE OR REPLACE FUNCTION public.cc_set_events_feed(p_url text, p_timezone text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_url text:=nullif(trim(coalesce(p_url,'')),''); v_host text;
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 if v_url is not null then
  if length(v_url)>500 or v_url !~* '^https://[a-z0-9.-]+(:[0-9]+)?(/[^\s]*)?$' then raise exception 'Use a full https:// web address'; end if;
  v_host:=lower(substring(v_url from '^https://([^/:]+)'));
  if v_host !~ '\.' or v_host ~ '^[0-9.]+$' or v_host in ('localhost') or v_host ~ '\.(local|internal|localhost)$' then raise exception 'Use the public address of your church website'; end if;
 end if;
 if p_timezone is not null and not exists(select 1 from pg_timezone_names where name=p_timezone) then raise exception 'Unknown time zone'; end if;
 update public.churches set events_feed_url=v_url, events_timezone=coalesce(p_timezone,events_timezone),
  events_sync_status=case when v_url is null then null else 'Waiting for first sync' end, events_synced_at=null
 where id=public.cc_my_church_id();
end $function$;
CREATE OR REPLACE FUNCTION public.cc_set_pastor_access(p_user_id uuid, p_enabled boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_church uuid:=public.cc_my_church_id();
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 if not public.cc_church_writable(v_church) then raise exception 'This church''s subscription is not active'; end if;
 if p_user_id=auth.uid() then raise exception 'You cannot change your own access'; end if;
 if not exists(select 1 from public.member_profiles where user_id=p_user_id and approved=true and church_id=v_church) then raise exception 'Select an approved member of your church'; end if;
 if p_enabled then
  insert into public.member_roles(user_id,role,church_id) select p_user_id,'pastor',v_church
   where not exists(select 1 from public.member_roles where user_id=p_user_id and role='pastor');
  insert into public.church_admins(user_id,church_id) select p_user_id,v_church
   where not exists(select 1 from public.church_admins where user_id=p_user_id);
 else
  if not exists(select 1 from public.member_roles where user_id=p_user_id and role='pastor') then raise exception 'This person was not given pastor access here'; end if;
  delete from public.member_roles where user_id=p_user_id and role='pastor';
  delete from public.church_admins where user_id=p_user_id;
 end if;
end $function$;
CREATE OR REPLACE FUNCTION public.cc_photo_access(p_name text, p_write boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := auth.uid(); v_file text; v_id uuid; v_dir boolean;
begin
 if v_uid is null then return false; end if;
 if (storage.foldername(p_name))[1] is distinct from public.cc_my_church_id()::text then return false; end if;
 v_file := regexp_replace(storage.filename(p_name), '\.(jpg|jpeg|png|webp)$', '');
 v_dir := v_file like 'dir-%';
 begin v_id := (case when v_dir then substr(v_file, 5) else v_file end)::uuid; exception when others then return false; end;
 if v_dir then
  return public.cc_is_admin() and exists(select 1 from public.cc_directory_members d where d.id = v_id and d.church_id = public.cc_my_church_id());
 end if;
 if not exists(select 1 from public.member_profiles p where p.user_id = v_id and p.church_id = public.cc_my_church_id()) then return false; end if;
 if v_uid = v_id then return true; end if;                       -- your own photo: read, replace, delete
 if public.cc_is_admin() then return true; end if;               -- administrators: read, replace, delete
 if p_write then return false; end if;                           -- nobody else may change it
 return public.is_approved_member(v_uid)                         -- other members: only if shared and both approved
    and exists(select 1 from public.member_profiles p where p.user_id = v_id and p.photo_visible and p.approved);
end $function$;
CREATE OR REPLACE FUNCTION public.cc_set_directory_profile(p_id uuid, p_gender text, p_photo_path text, p_photo_visible boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_church uuid := public.cc_my_church_id();
begin
 if auth.uid() is null or not public.cc_is_admin() then raise exception 'Administrator access required'; end if;
 if p_gender is not null and p_gender not in ('female','male') then raise exception 'Gender must be female or male'; end if;
 if p_photo_path is not null and p_photo_path <> v_church::text || '/dir-' || p_id::text || '.jpg' then raise exception 'Invalid photo location'; end if;
 update public.cc_directory_members set gender = p_gender, photo_path = p_photo_path, photo_visible = (p_photo_path is not null and coalesce(p_photo_visible, false)), updated_at = now()
  where id = p_id and church_id = v_church;
 if not found then raise exception 'Directory member not found'; end if;
end $function$;

alter table public."cc_directory_members" alter column "church_id" set default cc_my_church_id();
alter table public."cc_staff_delegations" alter column "church_id" set default cc_my_church_id();
alter table public."cc_website_content" alter column "church_id" set default cc_my_church_id();
alter table public."church_admins" alter column "church_id" set default cc_my_church_id();
alter table public."church_announcements" alter column "church_id" set default cc_my_church_id();
alter table public."church_events" alter column "church_id" set default cc_my_church_id();
alter table public."church_giving_links" alter column "church_id" set default cc_my_church_id();
alter table public."church_organization_preferences" alter column "church_id" set default cc_my_church_id();
alter table public."church_settings" alter column "church_id" set default cc_my_church_id();
alter table public."conversations" alter column "church_id" set default cc_my_church_id();
alter table public."donation_records" alter column "church_id" set default cc_my_church_id();
alter table public."member_profiles" alter column "church_id" set default cc_my_church_id();
alter table public."member_roles" alter column "church_id" set default cc_my_church_id();
alter table public."member_updates" alter column "church_id" set default cc_my_church_id();
alter table public."ministries" alter column "church_id" set default cc_my_church_id();

alter table public."cc_directory_members" enable row level security;
alter table public."cc_directory_ministries" enable row level security;
alter table public."cc_platform_admins" enable row level security;
alter table public."cc_push_deliveries" enable row level security;
alter table public."cc_staff_delegations" enable row level security;
alter table public."cc_website_content" enable row level security;
alter table public."church_admins" enable row level security;
alter table public."church_announcements" enable row level security;
alter table public."church_events" enable row level security;
alter table public."church_giving_links" enable row level security;
alter table public."church_organization_preferences" enable row level security;
alter table public."church_settings" enable row level security;
alter table public."church_subscriptions" enable row level security;
alter table public."churches" enable row level security;
alter table public."conversation_members" enable row level security;
alter table public."conversation_read_states" enable row level security;
alter table public."conversations" enable row level security;
alter table public."donation_records" enable row level security;
alter table public."member_church_titles" enable row level security;
alter table public."member_profiles" enable row level security;
alter table public."member_push_subscriptions" enable row level security;
alter table public."member_roles" enable row level security;
alter table public."member_sms_preferences" enable row level security;
alter table public."member_updates" enable row level security;
alter table public."messages" enable row level security;
alter table public."ministries" enable row level security;
alter table public."ministry_activities" enable row level security;
alter table public."ministry_join_requests" enable row level security;
alter table public."ministry_members" enable row level security;

drop policy if exists "Admins see their own role" on public."church_admins";
create policy "Admins see their own role" on public."church_admins" as permissive for select to authenticated using ((user_id = ( SELECT auth.uid() AS uid)));
drop policy if exists "Public events read" on public."church_events";
create policy "Public events read" on public."church_events" as permissive for select to anon, authenticated using ((published OR is_church_admin()));
drop policy if exists "Admin events insert" on public."church_events";
create policy "Admin events insert" on public."church_events" as permissive for insert to authenticated with check (is_church_admin());
drop policy if exists "Admin events update" on public."church_events";
create policy "Admin events update" on public."church_events" as permissive for update to authenticated using (is_church_admin()) with check (is_church_admin());
drop policy if exists "Admin events delete" on public."church_events";
create policy "Admin events delete" on public."church_events" as permissive for delete to authenticated using (is_church_admin());
drop policy if exists "Public announcements read" on public."church_announcements";
create policy "Public announcements read" on public."church_announcements" as permissive for select to anon, authenticated using ((published OR is_church_admin()));
drop policy if exists "Admin announcements insert" on public."church_announcements";
create policy "Admin announcements insert" on public."church_announcements" as permissive for insert to authenticated with check (is_church_admin());
drop policy if exists "Admin announcements update" on public."church_announcements";
create policy "Admin announcements update" on public."church_announcements" as permissive for update to authenticated using (is_church_admin()) with check (is_church_admin());
drop policy if exists "Admin announcements delete" on public."church_announcements";
create policy "Admin announcements delete" on public."church_announcements" as permissive for delete to authenticated using (is_church_admin());
drop policy if exists "Public active giving links" on public."church_giving_links";
create policy "Public active giving links" on public."church_giving_links" as permissive for select to anon, authenticated using ((active OR is_church_admin()));
drop policy if exists "Admin giving links insert" on public."church_giving_links";
create policy "Admin giving links insert" on public."church_giving_links" as permissive for insert to authenticated with check (is_church_admin());
drop policy if exists "Admin giving links update" on public."church_giving_links";
create policy "Admin giving links update" on public."church_giving_links" as permissive for update to authenticated using (is_church_admin()) with check (is_church_admin());
drop policy if exists "Admin giving links delete" on public."church_giving_links";
create policy "Admin giving links delete" on public."church_giving_links" as permissive for delete to authenticated using (is_church_admin());
drop policy if exists "profiles readable by self, admins, or opted-in directory" on public."member_profiles";
create policy "profiles readable by self, admins, or opted-in directory" on public."member_profiles" as permissive for select to authenticated using (((user_id = auth.uid()) OR has_church_role('administrator'::text) OR has_church_role('pastor'::text) OR (approved AND directory_visible AND is_approved_member(auth.uid()))));
drop policy if exists "cc_admin_read_profiles" on public."member_profiles";
create policy "cc_admin_read_profiles" on public."member_profiles" as permissive for select to authenticated using (cc_is_admin());
drop policy if exists "profile owner update" on public."member_profiles";
create policy "profile owner update" on public."member_profiles" as permissive for update to authenticated using ((user_id = auth.uid())) with check ((user_id = auth.uid()));
drop policy if exists "admins approve profiles" on public."member_profiles";
create policy "admins approve profiles" on public."member_profiles" as permissive for update to authenticated using (has_church_role('administrator'::text)) with check (has_church_role('administrator'::text));
drop policy if exists "roles read own or admin" on public."member_roles";
create policy "roles read own or admin" on public."member_roles" as permissive for select to authenticated using (((user_id = auth.uid()) OR has_church_role('administrator'::text)));
drop policy if exists "ministries read approved" on public."ministries";
create policy "ministries read approved" on public."ministries" as permissive for select to authenticated using ((is_approved_member(auth.uid()) OR has_church_role('administrator'::text)));
drop policy if exists "ministries admin manage" on public."ministries";
create policy "ministries admin manage" on public."ministries" as permissive for all to authenticated using (has_church_role('administrator'::text)) with check (has_church_role('administrator'::text));
drop policy if exists "ministry members read their group or admin" on public."ministry_members";
create policy "ministry members read their group or admin" on public."ministry_members" as permissive for select to authenticated using ((is_ministry_member(ministry_id, auth.uid()) OR has_church_role('administrator'::text)));
drop policy if exists "ministry members admin manage" on public."ministry_members";
create policy "ministry members admin manage" on public."ministry_members" as permissive for all to authenticated using (has_church_role('administrator'::text)) with check (has_church_role('administrator'::text));
drop policy if exists "activities visible to group" on public."ministry_activities";
create policy "activities visible to group" on public."ministry_activities" as permissive for select to authenticated using ((is_ministry_member(ministry_id, auth.uid()) OR has_church_role('administrator'::text)));
drop policy if exists "activities leaders manage" on public."ministry_activities";
create policy "activities leaders manage" on public."ministry_activities" as permissive for all to authenticated using (is_ministry_leader(ministry_id, auth.uid())) with check (is_ministry_leader(ministry_id, auth.uid()));
drop policy if exists "conversations participant read" on public."conversations";
create policy "conversations participant read" on public."conversations" as permissive for select to authenticated using (can_read_conversation(id, auth.uid()));
drop policy if exists "conversation members participant read" on public."conversation_members";
create policy "conversation members participant read" on public."conversation_members" as permissive for select to authenticated using (can_read_conversation(conversation_id, auth.uid()));
drop policy if exists "messages participants read" on public."messages";
create policy "messages participants read" on public."messages" as permissive for select to authenticated using (can_read_conversation(conversation_id, auth.uid()));
drop policy if exists "messages participants send" on public."messages";
create policy "messages participants send" on public."messages" as permissive for insert to authenticated with check (((sender_id = auth.uid()) AND can_read_conversation(conversation_id, auth.uid())));
drop policy if exists "updates group read" on public."member_updates";
create policy "updates group read" on public."member_updates" as permissive for select to authenticated using ((is_approved_member(auth.uid()) AND ((ministry_id IS NULL) OR is_ministry_member(ministry_id, auth.uid()))));
drop policy if exists "updates leaders create" on public."member_updates";
create policy "updates leaders create" on public."member_updates" as permissive for insert to authenticated with check (((created_by = auth.uid()) AND (((ministry_id IS NULL) AND has_church_role('administrator'::text)) OR ((ministry_id IS NOT NULL) AND is_ministry_leader(ministry_id, auth.uid())))));
drop policy if exists "settings admin read" on public."church_settings";
create policy "settings admin read" on public."church_settings" as permissive for select to authenticated using ((has_church_role('administrator'::text) OR has_church_role('finance'::text)));
drop policy if exists "Member creates request" on public."ministry_join_requests";
create policy "Member creates request" on public."ministry_join_requests" as permissive for insert to authenticated with check (((user_id = auth.uid()) AND (status = 'pending'::text)));
drop policy if exists "Read group terminology" on public."church_organization_preferences";
create policy "Read group terminology" on public."church_organization_preferences" as permissive for select to authenticated using (true);
drop policy if exists "donation read only authorized" on public."donation_records";
create policy "donation read only authorized" on public."donation_records" as permissive for select to authenticated using (((EXISTS ( SELECT 1
   FROM church_settings
  WHERE ((church_settings.id = true) AND (church_settings.donation_history_enabled = true)))) AND ((donor_id = auth.uid()) OR has_church_role('finance'::text) OR has_church_role('administrator'::text))));
drop policy if exists "donation finance write" on public."donation_records";
create policy "donation finance write" on public."donation_records" as permissive for insert to authenticated with check ((has_church_role('finance'::text) OR has_church_role('administrator'::text)));
drop policy if exists "Member reads own titles" on public."member_church_titles";
create policy "Member reads own titles" on public."member_church_titles" as permissive for select to authenticated using (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM church_admins a
  WHERE (a.user_id = auth.uid())))));
drop policy if exists "Member creates own titles" on public."member_church_titles";
create policy "Member creates own titles" on public."member_church_titles" as permissive for insert to authenticated with check (((user_id = auth.uid()) AND (COALESCE(array_length(verified_titles, 1), 0) = 0)));
drop policy if exists "Member edits own titles" on public."member_church_titles";
create policy "Member edits own titles" on public."member_church_titles" as permissive for update to authenticated using ((user_id = auth.uid())) with check ((user_id = auth.uid()));
drop policy if exists "Member reads own requests" on public."ministry_join_requests";
create policy "Member reads own requests" on public."ministry_join_requests" as permissive for select to authenticated using (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM church_admins a
  WHERE (a.user_id = auth.uid())))));
drop policy if exists "cc_admin_read_memberships" on public."ministry_members";
create policy "cc_admin_read_memberships" on public."ministry_members" as permissive for select to authenticated using (cc_is_admin());
drop policy if exists "cc_admin_read_requests" on public."ministry_join_requests";
create policy "cc_admin_read_requests" on public."ministry_join_requests" as permissive for select to authenticated using (cc_is_admin());
drop policy if exists "cc_admin_read_titles" on public."member_church_titles";
create policy "cc_admin_read_titles" on public."member_church_titles" as permissive for select to authenticated using (cc_is_admin());
drop policy if exists "cc_directory_admin_read" on public."cc_directory_members";
create policy "cc_directory_admin_read" on public."cc_directory_members" as permissive for select to authenticated using (cc_is_admin());
drop policy if exists "cc_directory_ministries_admin_read" on public."cc_directory_ministries";
create policy "cc_directory_ministries_admin_read" on public."cc_directory_ministries" as permissive for select to authenticated using (cc_is_admin());
drop policy if exists "cc_org_admin_update" on public."church_organization_preferences";
create policy "cc_org_admin_update" on public."church_organization_preferences" as permissive for update to authenticated using (cc_is_admin()) with check (cc_is_admin());
drop policy if exists "cc_ministry_admin_color_update" on public."ministries";
create policy "cc_ministry_admin_color_update" on public."ministries" as permissive for update to authenticated using (cc_is_admin()) with check (cc_is_admin());
drop policy if exists "cc_delegations_admin_read" on public."cc_staff_delegations";
create policy "cc_delegations_admin_read" on public."cc_staff_delegations" as permissive for select to authenticated using ((cc_is_admin() OR (user_id = auth.uid())));
drop policy if exists "cc_website_admin_read" on public."cc_website_content";
create policy "cc_website_admin_read" on public."cc_website_content" as permissive for select to authenticated using (cc_is_admin());
drop policy if exists "church_media_admin_upload" on storage."objects";
create policy "church_media_admin_upload" on storage."objects" as permissive for insert to authenticated with check (((bucket_id = 'church-media'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text) AND (EXISTS ( SELECT 1
   FROM church_admins a
  WHERE (a.user_id = auth.uid())))));
drop policy if exists "church_media_public_read" on storage."objects";
create policy "church_media_public_read" on storage."objects" as permissive for select to public using ((bucket_id = 'church-media'::text));
drop policy if exists "push_self_select" on public."member_push_subscriptions";
create policy "push_self_select" on public."member_push_subscriptions" as permissive for select to authenticated using ((user_id = auth.uid()));
drop policy if exists "push_self_insert" on public."member_push_subscriptions";
create policy "push_self_insert" on public."member_push_subscriptions" as permissive for insert to authenticated with check (((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM member_profiles p
  WHERE ((p.user_id = auth.uid()) AND (p.approved = true))))));
drop policy if exists "cc_subscription_update" on public."ministries";
create policy "cc_subscription_update" on public."ministries" as restrictive for update to authenticated using (true) with check (cc_church_writable(church_id));
drop policy if exists "push_self_update" on public."member_push_subscriptions";
create policy "push_self_update" on public."member_push_subscriptions" as permissive for update to authenticated using ((user_id = auth.uid())) with check ((user_id = auth.uid()));
drop policy if exists "push_self_delete" on public."member_push_subscriptions";
create policy "push_self_delete" on public."member_push_subscriptions" as permissive for delete to authenticated using ((user_id = auth.uid()));
drop policy if exists "sms_read_self" on public."member_sms_preferences";
create policy "sms_read_self" on public."member_sms_preferences" as permissive for select to authenticated using ((user_id = auth.uid()));
drop policy if exists "sms_insert_self" on public."member_sms_preferences";
create policy "sms_insert_self" on public."member_sms_preferences" as permissive for insert to authenticated with check ((user_id = auth.uid()));
drop policy if exists "sms_update_self" on public."member_sms_preferences";
create policy "sms_update_self" on public."member_sms_preferences" as permissive for update to authenticated using ((user_id = auth.uid())) with check ((user_id = auth.uid()));
drop policy if exists "read own markers" on public."conversation_read_states";
create policy "read own markers" on public."conversation_read_states" as permissive for select to authenticated using (((user_id = auth.uid()) AND can_read_conversation(conversation_id, auth.uid())));
drop policy if exists "insert own markers" on public."conversation_read_states";
create policy "insert own markers" on public."conversation_read_states" as permissive for insert to authenticated with check (((user_id = auth.uid()) AND can_read_conversation(conversation_id, auth.uid())));
drop policy if exists "update own markers" on public."conversation_read_states";
create policy "update own markers" on public."conversation_read_states" as permissive for update to authenticated using (((user_id = auth.uid()) AND can_read_conversation(conversation_id, auth.uid()))) with check (((user_id = auth.uid()) AND can_read_conversation(conversation_id, auth.uid())));
drop policy if exists "cc_churches_read" on public."churches";
create policy "cc_churches_read" on public."churches" as permissive for select to anon, authenticated using (true);
drop policy if exists "cc_subscription_read" on public."church_subscriptions";
create policy "cc_subscription_read" on public."church_subscriptions" as permissive for select to authenticated using ((((church_id = cc_my_church_id()) AND cc_is_admin()) OR cc_is_platform_admin()));
drop policy if exists "cc_tenant_select" on public."church_events";
create policy "cc_tenant_select" on public."church_events" as restrictive for select to authenticated using ((published OR (church_id = cc_my_church_id())));
drop policy if exists "cc_tenant_insert" on public."church_events";
create policy "cc_tenant_insert" on public."church_events" as restrictive for insert to authenticated with check (((church_id = cc_my_church_id()) AND cc_church_writable(church_id)));
drop policy if exists "cc_tenant_update" on public."church_events";
create policy "cc_tenant_update" on public."church_events" as restrictive for update to authenticated using ((church_id = cc_my_church_id())) with check (((church_id = cc_my_church_id()) AND cc_church_writable(church_id)));
drop policy if exists "cc_tenant_delete" on public."church_events";
create policy "cc_tenant_delete" on public."church_events" as restrictive for delete to authenticated using ((church_id = cc_my_church_id()));
drop policy if exists "cc_tenant_select" on public."church_announcements";
create policy "cc_tenant_select" on public."church_announcements" as restrictive for select to authenticated using ((published OR (church_id = cc_my_church_id())));
drop policy if exists "cc_tenant_insert" on public."church_announcements";
create policy "cc_tenant_insert" on public."church_announcements" as restrictive for insert to authenticated with check (((church_id = cc_my_church_id()) AND cc_church_writable(church_id)));
drop policy if exists "cc_tenant_update" on public."church_announcements";
create policy "cc_tenant_update" on public."church_announcements" as restrictive for update to authenticated using ((church_id = cc_my_church_id())) with check (((church_id = cc_my_church_id()) AND cc_church_writable(church_id)));
drop policy if exists "cc_tenant_delete" on public."church_announcements";
create policy "cc_tenant_delete" on public."church_announcements" as restrictive for delete to authenticated using ((church_id = cc_my_church_id()));
drop policy if exists "cc_tenant_select" on public."church_giving_links";
create policy "cc_tenant_select" on public."church_giving_links" as restrictive for select to authenticated using ((active OR (church_id = cc_my_church_id())));
drop policy if exists "cc_tenant_insert" on public."church_giving_links";
create policy "cc_tenant_insert" on public."church_giving_links" as restrictive for insert to authenticated with check (((church_id = cc_my_church_id()) AND cc_church_writable(church_id)));
drop policy if exists "cc_tenant_update" on public."church_giving_links";
create policy "cc_tenant_update" on public."church_giving_links" as restrictive for update to authenticated using ((church_id = cc_my_church_id())) with check (((church_id = cc_my_church_id()) AND cc_church_writable(church_id)));
drop policy if exists "cc_tenant_delete" on public."church_giving_links";
create policy "cc_tenant_delete" on public."church_giving_links" as restrictive for delete to authenticated using ((church_id = cc_my_church_id()));
drop policy if exists "cc_tenant_all" on public."church_admins";
create policy "cc_tenant_all" on public."church_admins" as restrictive for all to authenticated using ((church_id = cc_my_church_id())) with check ((church_id = cc_my_church_id()));
drop policy if exists "cc_tenant_all" on public."member_profiles";
create policy "cc_tenant_all" on public."member_profiles" as restrictive for all to authenticated using ((church_id = cc_my_church_id())) with check ((church_id = cc_my_church_id()));
drop policy if exists "cc_tenant_all" on public."member_roles";
create policy "cc_tenant_all" on public."member_roles" as restrictive for all to authenticated using ((church_id = cc_my_church_id())) with check ((church_id = cc_my_church_id()));
drop policy if exists "cc_tenant_all" on public."ministries";
create policy "cc_tenant_all" on public."ministries" as restrictive for all to authenticated using ((church_id = cc_my_church_id())) with check ((church_id = cc_my_church_id()));
drop policy if exists "cc_subscription_insert" on public."member_updates";
create policy "cc_subscription_insert" on public."member_updates" as restrictive for insert to authenticated with check (cc_church_writable(church_id));
drop policy if exists "cc_tenant_all" on public."conversations";
create policy "cc_tenant_all" on public."conversations" as restrictive for all to authenticated using ((church_id = cc_my_church_id())) with check ((church_id = cc_my_church_id()));
drop policy if exists "cc_tenant_all" on public."church_settings";
create policy "cc_tenant_all" on public."church_settings" as restrictive for all to authenticated using ((church_id = cc_my_church_id())) with check ((church_id = cc_my_church_id()));
drop policy if exists "cc_tenant_all" on public."church_organization_preferences";
create policy "cc_tenant_all" on public."church_organization_preferences" as restrictive for all to authenticated using ((church_id = cc_my_church_id())) with check ((church_id = cc_my_church_id()));
drop policy if exists "cc_tenant_all" on public."donation_records";
create policy "cc_tenant_all" on public."donation_records" as restrictive for all to authenticated using ((church_id = cc_my_church_id())) with check ((church_id = cc_my_church_id()));
drop policy if exists "cc_tenant_all" on public."cc_directory_members";
create policy "cc_tenant_all" on public."cc_directory_members" as restrictive for all to authenticated using ((church_id = cc_my_church_id())) with check ((church_id = cc_my_church_id()));
drop policy if exists "cc_tenant_all" on public."cc_website_content";
create policy "cc_tenant_all" on public."cc_website_content" as restrictive for all to authenticated using ((church_id = cc_my_church_id())) with check ((church_id = cc_my_church_id()));
drop policy if exists "cc_tenant_all" on public."member_updates";
create policy "cc_tenant_all" on public."member_updates" as restrictive for all to authenticated using ((church_id = cc_my_church_id())) with check ((church_id = cc_my_church_id()));
drop policy if exists "cc_tenant_all" on public."cc_staff_delegations";
create policy "cc_tenant_all" on public."cc_staff_delegations" as restrictive for all to authenticated using ((church_id = cc_my_church_id())) with check ((church_id = cc_my_church_id()));
drop policy if exists "cc_subscription_insert" on public."ministries";
create policy "cc_subscription_insert" on public."ministries" as restrictive for insert to authenticated with check (cc_church_writable(church_id));
drop policy if exists "cc_subscription_update" on public."member_updates";
create policy "cc_subscription_update" on public."member_updates" as restrictive for update to authenticated using (true) with check (cc_church_writable(church_id));
drop policy if exists "cc_subscription_insert" on public."conversations";
create policy "cc_subscription_insert" on public."conversations" as restrictive for insert to authenticated with check (cc_church_writable(church_id));
drop policy if exists "cc_subscription_update" on public."conversations";
create policy "cc_subscription_update" on public."conversations" as restrictive for update to authenticated using (true) with check (cc_church_writable(church_id));
drop policy if exists "cc_subscription_insert" on public."cc_directory_members";
create policy "cc_subscription_insert" on public."cc_directory_members" as restrictive for insert to authenticated with check (cc_church_writable(church_id));
drop policy if exists "cc_subscription_update" on public."cc_directory_members";
create policy "cc_subscription_update" on public."cc_directory_members" as restrictive for update to authenticated using (true) with check (cc_church_writable(church_id));
drop policy if exists "cc_tenant_all" on public."ministry_members";
create policy "cc_tenant_all" on public."ministry_members" as restrictive for all to authenticated using ((EXISTS ( SELECT 1
   FROM ministries m
  WHERE ((m.id = ministry_members.ministry_id) AND (m.church_id = cc_my_church_id()))))) with check ((EXISTS ( SELECT 1
   FROM ministries m
  WHERE ((m.id = ministry_members.ministry_id) AND (m.church_id = cc_my_church_id())))));
drop policy if exists "cc_tenant_all" on public."ministry_activities";
create policy "cc_tenant_all" on public."ministry_activities" as restrictive for all to authenticated using ((EXISTS ( SELECT 1
   FROM ministries m
  WHERE ((m.id = ministry_activities.ministry_id) AND (m.church_id = cc_my_church_id()))))) with check ((EXISTS ( SELECT 1
   FROM ministries m
  WHERE ((m.id = ministry_activities.ministry_id) AND (m.church_id = cc_my_church_id())))));
drop policy if exists "cc_tenant_all" on public."ministry_join_requests";
create policy "cc_tenant_all" on public."ministry_join_requests" as restrictive for all to authenticated using ((EXISTS ( SELECT 1
   FROM ministries m
  WHERE ((m.id = ministry_join_requests.ministry_id) AND (m.church_id = cc_my_church_id()))))) with check ((EXISTS ( SELECT 1
   FROM ministries m
  WHERE ((m.id = ministry_join_requests.ministry_id) AND (m.church_id = cc_my_church_id())))));
drop policy if exists "cc_photo_read" on storage."objects";
create policy "cc_photo_read" on storage."objects" as permissive for select to authenticated using (((bucket_id = 'member-photos'::text) AND cc_photo_access(name, false)));
drop policy if exists "cc_tenant_all" on public."cc_directory_ministries";
create policy "cc_tenant_all" on public."cc_directory_ministries" as restrictive for all to authenticated using ((EXISTS ( SELECT 1
   FROM cc_directory_members d
  WHERE ((d.id = cc_directory_ministries.member_id) AND (d.church_id = cc_my_church_id()))))) with check ((EXISTS ( SELECT 1
   FROM cc_directory_members d
  WHERE ((d.id = cc_directory_ministries.member_id) AND (d.church_id = cc_my_church_id())))));
drop policy if exists "cc_tenant_all" on public."conversation_members";
create policy "cc_tenant_all" on public."conversation_members" as restrictive for all to authenticated using ((EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((c.id = conversation_members.conversation_id) AND (c.church_id = cc_my_church_id()))))) with check ((EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((c.id = conversation_members.conversation_id) AND (c.church_id = cc_my_church_id())))));
drop policy if exists "cc_tenant_all" on public."messages";
create policy "cc_tenant_all" on public."messages" as restrictive for all to authenticated using ((EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((c.id = messages.conversation_id) AND (c.church_id = cc_my_church_id()))))) with check ((EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((c.id = messages.conversation_id) AND (c.church_id = cc_my_church_id())))));
drop policy if exists "cc_subscription_insert" on public."messages";
create policy "cc_subscription_insert" on public."messages" as restrictive for insert to authenticated with check ((EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((c.id = messages.conversation_id) AND cc_church_writable(c.church_id)))));
drop policy if exists "cc_tenant_all" on public."member_church_titles";
create policy "cc_tenant_all" on public."member_church_titles" as restrictive for all to authenticated using (cc_same_church_user(user_id)) with check (cc_same_church_user(user_id));
drop policy if exists "cc_photo_insert" on storage."objects";
create policy "cc_photo_insert" on storage."objects" as permissive for insert to authenticated with check (((bucket_id = 'member-photos'::text) AND cc_photo_access(name, true)));
drop policy if exists "cc_photo_update" on storage."objects";
create policy "cc_photo_update" on storage."objects" as permissive for update to authenticated using (((bucket_id = 'member-photos'::text) AND cc_photo_access(name, true))) with check (((bucket_id = 'member-photos'::text) AND cc_photo_access(name, true)));
drop policy if exists "cc_photo_delete" on storage."objects";
create policy "cc_photo_delete" on storage."objects" as permissive for delete to authenticated using (((bucket_id = 'member-photos'::text) AND cc_photo_access(name, true)));

revoke all on public."cc_directory_members" from anon, authenticated;
revoke all on public."cc_directory_ministries" from anon, authenticated;
revoke all on public."cc_platform_admins" from anon, authenticated;
revoke all on public."cc_push_deliveries" from anon, authenticated;
revoke all on public."cc_staff_delegations" from anon, authenticated;
revoke all on public."cc_website_content" from anon, authenticated;
revoke all on public."church_admins" from anon, authenticated;
revoke all on public."church_announcements" from anon, authenticated;
revoke all on public."church_events" from anon, authenticated;
revoke all on public."church_giving_links" from anon, authenticated;
revoke all on public."church_organization_preferences" from anon, authenticated;
revoke all on public."church_settings" from anon, authenticated;
revoke all on public."church_subscriptions" from anon, authenticated;
revoke all on public."churches" from anon, authenticated;
revoke all on public."conversation_members" from anon, authenticated;
revoke all on public."conversation_read_states" from anon, authenticated;
revoke all on public."conversations" from anon, authenticated;
revoke all on public."donation_records" from anon, authenticated;
revoke all on public."member_church_titles" from anon, authenticated;
revoke all on public."member_profiles" from anon, authenticated;
revoke all on public."member_push_subscriptions" from anon, authenticated;
revoke all on public."member_roles" from anon, authenticated;
revoke all on public."member_sms_preferences" from anon, authenticated;
revoke all on public."member_updates" from anon, authenticated;
revoke all on public."messages" from anon, authenticated;
revoke all on public."ministries" from anon, authenticated;
revoke all on public."ministry_activities" from anon, authenticated;
revoke all on public."ministry_join_requests" from anon, authenticated;
revoke all on public."ministry_members" from anon, authenticated;
grant SELECT on public."cc_directory_members" to authenticated;
grant SELECT on public."cc_directory_ministries" to authenticated;
grant SELECT on public."cc_staff_delegations" to authenticated;
grant SELECT on public."cc_website_content" to authenticated;
grant DELETE, INSERT, SELECT, UPDATE on public."church_admins" to authenticated;
grant SELECT on public."church_announcements" to anon;
grant DELETE, INSERT, SELECT, UPDATE on public."church_announcements" to authenticated;
grant SELECT on public."church_events" to anon;
grant DELETE, INSERT, SELECT, UPDATE on public."church_events" to authenticated;
grant SELECT on public."church_giving_links" to anon;
grant DELETE, INSERT, SELECT, UPDATE on public."church_giving_links" to authenticated;
grant DELETE, INSERT, SELECT, UPDATE on public."church_organization_preferences" to authenticated;
grant DELETE, INSERT, SELECT, UPDATE on public."church_settings" to authenticated;
grant REFERENCES, SELECT, TRIGGER on public."church_subscriptions" to anon;
grant REFERENCES, SELECT, TRIGGER on public."church_subscriptions" to authenticated;
grant REFERENCES, SELECT, TRIGGER on public."churches" to anon;
grant REFERENCES, SELECT, TRIGGER on public."churches" to authenticated;
grant DELETE, INSERT, SELECT, UPDATE on public."conversation_members" to authenticated;
grant DELETE, INSERT, SELECT, UPDATE on public."conversation_read_states" to authenticated;
grant DELETE, INSERT, SELECT, UPDATE on public."conversations" to authenticated;
grant DELETE, INSERT, SELECT, UPDATE on public."donation_records" to authenticated;
grant DELETE, SELECT on public."member_church_titles" to authenticated;
grant DELETE, INSERT, SELECT on public."member_profiles" to authenticated;
grant DELETE, INSERT, SELECT, UPDATE on public."member_push_subscriptions" to authenticated;
grant DELETE, INSERT, SELECT, UPDATE on public."member_roles" to authenticated;
grant DELETE, INSERT, SELECT, UPDATE on public."member_sms_preferences" to authenticated;
grant DELETE, INSERT, SELECT, UPDATE on public."member_updates" to authenticated;
grant DELETE, INSERT, SELECT, UPDATE on public."messages" to authenticated;
grant DELETE, INSERT, SELECT, UPDATE on public."ministries" to authenticated;
grant DELETE, INSERT, SELECT, UPDATE on public."ministry_activities" to authenticated;
grant DELETE, INSERT, SELECT on public."ministry_join_requests" to authenticated;
grant DELETE, INSERT, SELECT, UPDATE on public."ministry_members" to authenticated;

-- live updates (messages, events, announcements) for the app
do $$ begin alter publication supabase_realtime add table public.messages, public.church_events, public.church_announcements; exception when others then raise notice 'live updates not enabled: %', sqlerrm; end $$;
