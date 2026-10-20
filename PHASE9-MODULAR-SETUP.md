# Phase 9 — Modular Member Access (preview)

This phase introduces a separate, responsive Member Access landing page for churches that already own a website. It does **not** require activating Sanctuary Studio or replacing their existing site.

## Configure

Edit `config.js` before deployment:

```js
modules: {messaging:true,membership:true,ministries:true,website:false,giving:false},
existingWebsiteUrl: 'https://your-church.org',
```

The `existingWebsiteUrl` must use HTTPS. Share the hosted `church-portal.html` URL or link to it from your existing website with a **Member Login** or **Church Connect** button.

## Test

1. Deploy the package to `redesign-preview`, not production.
2. Visit `church-portal.html`. Messaging and Membership appear; the website and giving modules are hidden if disabled.
3. Verify the **Return to church website** link opens the URL configured above.
4. Click Messaging and Membership; sign in with an approved member account. Confirm existing privacy and messaging workflows still function.
5. Test with an unapproved account to confirm that protected content is unavailable.

## Known limitations — important

- Module choices are **deployment configuration**, not yet paid subscriptions, server-enforced entitlements, or an in-app administrator control. Each church installation needs its own configuration.
- The existing Supabase schema is not production multi-tenant. Do **not** connect multiple independent churches to the same project without a tenant-isolation/RLS migration.
- Turning off a module in config.js only hides it from the member landing page; it is **not** authorization or security enforcement. Existing database RLS remains responsible for protecting private data.
- Push notifications while the browser is closed and the unresolved Sanctuary Studio publish issue are **not fixed** in this phase.
- A self-hosted church must deploy all files and configure its own compatible Supabase backend; a complete self-hosted installer is not yet included.
