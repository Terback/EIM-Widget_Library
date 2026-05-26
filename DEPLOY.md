# Widget Library — Deployment Guide

A static frontend that talks to the company's Appwrite backend
(`https://appwrite-ihub.eimtechnology.com`). No build step, no Node runtime
needed on the host — just serve the `public/` folder as static files.

## What to deploy

Everything in the `public/` folder:

```
public/
├── index.html
├── app.js
├── appwrite-config.js
├── style.css
└── (no other assets — Appwrite Web SDK is loaded from jsdelivr CDN)
```

## Hosting requirements

- Any HTTP server capable of serving static files
  (nginx, Apache, Caddy, S3+CloudFront, Cloudflare Pages, Appwrite Sites, …)
- HTTPS (Appwrite requires secure context for cross-origin cookies)
- A public hostname (e.g. `widgets.eimtechnology.com`)

## Steps

1. **Serve** the contents of `public/` at the target hostname.

   Example nginx snippet:
   ```nginx
   server {
       listen 443 ssl http2;
       server_name widgets.eimtechnology.com;
       root /var/www/widget-library;     # path containing index.html
       index index.html;
       try_files $uri /index.html;       # SPA-style fallback
       # SSL config omitted
   }
   ```

2. **Whitelist the hostname in Appwrite** — this is required, the frontend
   will fail with a CORS error otherwise.
   - Appwrite Console → project **WidgetLibrary** → **Overview** → **Platforms**
   - Add a new Web platform (or edit the existing `localhost` one)
   - Hostname: the production hostname (e.g. `widgets.eimtechnology.com`)

3. **Verify** by opening `https://widgets.eimtechnology.com` in a browser:
   - Page loads, widget cards visible
   - Admin Login → use the password set on the `admin` Appwrite Auth user
   - Browser DevTools console should be clean (no CORS or 401 errors)

## Updating

Just replace the files in `public/` — there's no server-side cache.
Frontend cache: tell users to hard-reload (Ctrl+Shift+R) or bump the
`?v=` query string on `<script src="app.js?v=...">` in `index.html`
to force fresh load.

## Backend (already deployed in Appwrite — do not touch)

- Project ID: `6a14b1f90002c3cdb277`
- Database: `main`
  - Table `widgets` (widget metadata)
  - Table `categories` (category list)
- Storage bucket: `widgets` (uploaded HTML files)
- Auth user: `admin@eim.local` (admin role)

Permissions are already configured on each resource:
- `Any` role: Read only (so unauthenticated visitors can browse)
- `User: admin` role: Full CRUD (for the upload/edit/delete UI)
