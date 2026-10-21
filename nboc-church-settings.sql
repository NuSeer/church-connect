-- ONLY for the New Beginnings Outreach Center project (the one that holds the church's real members). Run AFTER platform-migration.sql.
-- Gives the church its real name and website. (You can also do this from Administration Center -> Church settings.)
update public.churches set name = 'New Beginnings Outreach Center COGIC'
 where id = (select id from public.churches order by created_at limit 1) and name = 'Your Church';
update public.churches set website_url = 'https://newbeginningsoutreachctrcogic.org'
 where website_url is null and name = 'New Beginnings Outreach Center COGIC';
