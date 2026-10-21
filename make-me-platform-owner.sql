-- Run in the NEW demo project, AFTER you have signed in once at the app with your email (so your profile exists).
-- Makes that account an approved member, a church administrator and the PLATFORM OWNER (it can create churches and demo churches).
-- Replace YOUR-EMAIL-HERE with your sign-in email in all three places (keep the quotes). Safe to run twice.
insert into public.cc_platform_admins(user_id)
select id from auth.users where lower(email) = lower('YOUR-EMAIL-HERE') on conflict do nothing;

update public.member_profiles set approved = true
 where user_id = (select id from auth.users where lower(email) = lower('YOUR-EMAIL-HERE'));

insert into public.church_admins(user_id, church_id)
select u.id, p.church_id from auth.users u join public.member_profiles p on p.user_id = u.id
 where lower(u.email) = lower('YOUR-EMAIL-HERE') and not exists (select 1 from public.church_admins a where a.user_id = u.id);
