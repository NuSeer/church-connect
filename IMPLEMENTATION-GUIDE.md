# Your Church — Implementation Guide

## What's Included

| File | Purpose |
|------|---------|
| `ministry-dashboard.html` | Public-facing church website |
| `admin-dashboard.html` | Password-protected admin panel |
| `service-worker.js` | PWA offline support & push notifications |
| `manifest.json` | Makes the site installable as a mobile app |
| `IMPLEMENTATION-GUIDE.md` | This guide |
| `README.md` | Quick start overview |

---

## Step 1 — Customize Your Content

Open `ministry-dashboard.html` and replace the following:

- `Your Church` → your church name (throughout both files)
- `123 Church Street · Your City, VA 23000` → your actual address
- `(757) 000-0000` → your phone number
- Giving links → your actual Givelify/Cash App/PayPal/Venmo handles
- Service times (Sunday 8:00 AM & 10:30 AM · Wednesday 7:00 PM)
- Leadership names, roles, and bios
- Announcement and event content

---

## Step 2 — Change the Admin Password

Open `admin-dashboard.html` and find this line near the bottom:

```js
const ADMIN_PASS = 'church2024';
```

Replace `church2024` with your own secure password. Keep it private.

---

## Step 3 — Deploy (Choose One)

### Option A — Free: GitHub Pages
1. Create a free GitHub account at github.com
2. Create a new repository (e.g., `your-church-site`)
3. Upload all files to the repository
4. Go to Settings → Pages → Source: main branch / root
5. Your site goes live at: `yourusername.github.io/your-church-site`

### Option B — Free: Netlify (Easiest, Recommended)
1. Go to netlify.com and create a free account
2. Drag and drop your church-app folder onto the Netlify dashboard
3. Your site is live instantly with a Netlify URL
4. Optional: connect a custom domain (e.g., yourchurch.org)

### Option C — Free: Vercel
1. Go to vercel.com and create a free account
2. Import your GitHub repository or drag and drop your folder
3. Your site is live within seconds

### Option D — Your Own Domain + Hosting
1. Purchase a domain at Namecheap, GoDaddy, or Google Domains (~$12/year)
2. Get web hosting at Bluehost, SiteGround, or DreamHost (~$5–10/month)
3. Upload your files via FTP or the hosting file manager
4. Point your domain to your hosting provider

---

## Step 4 — Enable Push Notifications

Push notifications require HTTPS (not http). Any of the deployment options above provide HTTPS automatically.

To actually send notifications you need to set up Web Push:

1. Install web-push: `npm install web-push`
2. Generate VAPID keys:
   ```bash
   npx web-push generate-vapid-keys
   ```
3. Store the keys and use a backend (Node.js, Firebase Functions, etc.) to send pushes
4. For a simpler alternative, use **OneSignal** (free tier):
   - Sign up at onesignal.com
   - Add your site and follow their setup wizard
   - Replace the service worker with their SDK

---

## Step 5 — Set Up SMS (Optional)

For the SMS channel in the admin notification panel:

### Using Twilio (Recommended)
1. Sign up at twilio.com (free trial includes test credits)
2. Get a phone number (~$1/month)
3. Use their API or a serverless function to send SMS

### Simpler Alternative: TextMagic or EZTexting
These have simple dashboards you can use without coding.

---

## Step 6 — Connect Giving Platforms

Update the giving links in `ministry-dashboard.html`:

```html
<!-- Replace these href values with your actual links -->
<a href="https://www.givelify.com/give/YOUR-PAGE" ...>Give via Givelify</a>
<a href="https://cash.app/$YOURHANDLE" ...>Cash App</a>
<a href="https://paypal.me/YOURHANDLE" ...>PayPal</a>
<a href="https://venmo.com/YOURHANDLE" ...>Venmo</a>
```

---

## Step 7 — Make It Installable as a Mobile App (PWA)

The `manifest.json` and `service-worker.js` are already set up. To complete:

1. Create two icon files and add them to your folder:
   - `icon-192.png` (192×192 pixels)
   - `icon-512.png` (512×512 pixels)
   - Use your church logo — free tools: canva.com or iconizer.net
2. Deploy to HTTPS (GitHub Pages, Netlify, Vercel all qualify)
3. Visitors on mobile will see "Add to Home Screen" prompt automatically
4. On Android, it installs as a full app icon

---

## Step 8 — Add Real Photos

Replace the emoji leader avatars with real photos:

1. Upload photos to your server or use a free host like Cloudinary
2. In the leadership section of `ministry-dashboard.html`, replace:
   ```html
   <div class="leader-avatar">👨‍⚕️</div>
   ```
   With:
   ```html
   <img class="leader-avatar" src="path/to/photo.jpg" alt="Pastor Name" style="object-fit:cover;">
   ```

---

## Frequently Asked Questions

**Do I need to know how to code?**
No — all customization is just replacing text in the files. Any text editor (Notepad, TextEdit, VS Code) works.

**Can members submit forms and have the data actually saved?**
The current version shows a success message but doesn't save to a database. To save data, you'd need a backend service. Options:
- **Formspree** (free) — add `action="https://formspree.io/f/YOUR-ID"` to any form
- **Google Forms** — embed a Google Form inside the page
- **PocketBase** — free self-hosted database (see your previous project)

**How do I get a custom domain?**
Purchase at namecheap.com or godaddy.com, then follow your hosting provider's instructions to point the domain to your site.

**Is this secure?**
The admin password is frontend-only, which is fine for basic protection. For higher security, add a backend login system (Firebase Auth, Supabase Auth, or any Node.js/PHP solution).

**Can I edit the content without touching code?**
Yes — a future version could add a CMS (content management system). For now, editing the HTML files directly is the method. It's simpler than it sounds.

---

## Support

Built specifically for ministry leaders with 20+ years of experience in mind.
For customization help, consult your technology consultant or a local web developer.
