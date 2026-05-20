# Custom domain — current state

> **As of 2026-05-20: the app's canonical domain is `https://owner.edullent.com`.**
> All metadata, manifest, TWA config, CSP, and links point there.

The previous `owner-dashboard-blue.vercel.app` URL still resolves (Vercel keeps it
as a project alias) and is whitelisted in `vercel.json` CSP `connect-src` as a
fallback, but every link, share preview, JSON-LD identifier, and TWA host now
uses `owner.edullent.com`.

---

## Where the canonical domain is referenced

If you ever change the canonical domain again, update these 6 files in sync:

| File | What to change |
|---|---|
| `index.html` | `<link rel="canonical">`, `og:url`, `og:image`, `twitter:image`, `apple-touch-startup-image` paths (relative — keep), JSON-LD `@id` + `url` + `logo.url` + `screenshot` |
| `bubblewrap/twa-manifest.json` | `host`, `iconUrl`, `maskableIconUrl`, `webManifestUrl`, `fullScopeUrl`, each `shortcuts[].iconUrl` |
| `vite.config.ts` | `proxy["/api"].target` (dev server only) |
| `vercel.json` | `Content-Security-Policy` → `connect-src` whitelist |
| `public/.well-known/README.md` | example verification URL |
| `public/robots.txt` | the commented `Sitemap:` line |

A single global find-replace works:
```bash
cd owner-dashboard
grep -rl "owner.edullent.com" --include="*.ts" --include="*.tsx" --include="*.html" --include="*.json" --include="*.md" \
  | grep -v node_modules | grep -v dist \
  | xargs sed -i 's|owner.edullent.com|new.domain.com|g'
```

---

## Vercel project — verify primary domain

1. Vercel dashboard → `owner-dashboard-blue` project → Settings → **Domains**.
2. `owner.edullent.com` should be marked **Primary** ✅. If not, click the
   "..." menu next to it → Set as Primary.
3. `owner-dashboard-blue.vercel.app` should be kept as a non-primary alias OR
   set up as a 301 redirect to the new primary.
4. Both should show **Valid Configuration** with auto-issued SSL.

---

## DNS health check

```bash
dig owner.edullent.com CNAME +short
# expected: cname.vercel-dns.com.   (or similar Vercel CNAME)

curl -I https://owner.edullent.com/
# expected: HTTP/2 200 (and the security headers from vercel.json)

curl https://owner.edullent.com/.well-known/assetlinks.json
# expected: the JSON with your TWA fingerprint
```

If any of these fail post-deploy, the domain hasn't propagated yet OR Vercel
hasn't completed cert issuance. Wait 5-10 min and retry.

---

## TWA implications

The Android TWA built via `bubblewrap/` is tied to its `host` field. As long
as `bubblewrap/twa-manifest.json` points at `owner.edullent.com` AND
`https://owner.edullent.com/.well-known/assetlinks.json` returns the matching
SHA-256 fingerprint, the TWA hides the URL bar.

**Don't change `host`** in twa-manifest.json after publishing to Play Store —
re-publishing under a new host = new package = new app listing (lose reviews).

---

## If you ever want to add ANOTHER domain (multi-tenant style)

You can serve the same PWA from multiple domains by:
1. Adding each domain to Vercel → Domains.
2. Adding each domain's URL to `vercel.json` CSP `connect-src` (so Firebase /
   Resend calls aren't blocked from that origin).
3. Adding each domain's `.well-known/assetlinks.json` to ITS Vercel project
   (Vercel auto-serves the file from `public/`, so this just works if all
   domains are aliases of the same project).

Each domain still hits the same Vercel build + same Firebase project — no
new infra cost.
