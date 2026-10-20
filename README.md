# ✝ Your Church — Ministry Web Dashboard

A complete, modern web platform for churches and ministries.
Built with 20 years of ministry experience in mind.

## Quick Start

1. Open `ministry-dashboard.html` in a browser to see your public site
2. Open `admin-dashboard.html` — password: `church2024` (change this!)
3. Customize your church name, address, events, and giving links
4. Deploy to Netlify (free) by dragging this folder to netlify.com

## Files

| File | What It Is |
|------|------------|
| `ministry-dashboard.html` | Public church website |
| `admin-dashboard.html` | Admin panel (password protected) |
| `service-worker.js` | PWA offline + push notifications |
| `manifest.json` | Mobile app install config |
| `IMPLEMENTATION-GUIDE.md` | Full setup instructions |

## Features

**Public Site**
- Church identity, mission, leadership
- Event calendar and weekly announcements  
- Multi-platform giving (Givelify, Cash App, PayPal, Venmo)
- "Why We Give" scripture section
- Prayer request form
- Membership / visitor interest form
- Volunteer signup
- Contact form
- Fully mobile responsive (PWA installable)

**Admin Panel** (password: `church2024`)
- Dashboard with stats (members, prayer requests, events, volunteers)
- Event management (add, edit, delete)
- Announcement management
- Sermon archive
- Member directory
- Prayer request review and archive
- Volunteer coordination
- Push/Email/SMS notification sender
- Giving overview by platform

## Change Admin Password

In `admin-dashboard.html`, find:
```js
const ADMIN_PASS = 'church2024';
```
Replace with your own password.

## Deploy Free

Drag this folder to **netlify.com** — your site is live in 60 seconds.
Custom domain optional (~$12/year from namecheap.com).

---
*See IMPLEMENTATION-GUIDE.md for full instructions.*
