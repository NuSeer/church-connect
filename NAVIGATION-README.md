# Editable Starter Navigation

In Sanctuary Studio > Navigation Menu, administrators can rename, hide, reorder, delete and add menu links. Changes are stored in the existing website draft/published JSON in Supabase, so no additional SQL migration is required.

Starter links: About, Announcements, Events, Calendar, Give, News & Events, Sign In. The starter set appears only when no saved `navigation` array exists. An empty array remains empty after saving. Removing a link does not delete the associated content section.

After uploading this package to the preview branch, open Sanctuary Studio, remove one menu item, Save draft, Publish, and View Live. If a publish error appears, copy the exact message.

This package does not automatically deploy to GitHub or validate your live Supabase settings.
