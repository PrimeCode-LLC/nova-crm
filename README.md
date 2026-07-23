# Nova CRM (Relay)

Next.js 16 **App Router** sales CRM UI with **Firebase Auth**, **Firestore**, **session cookies** (Admin-verified), optional **Cloud Functions**, and **Firebase App Hosting** config.

## Quick start

```bash
cd crm
npm install
cp .env.example .env.local
# Fill NEXT_PUBLIC_FIREBASE_* and FIREBASE_ADMIN_* (see below)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Unauthenticated visitors are redirected to `/login`.

### UI-only dev (no Firebase Admin)

If you have not set **Firebase Admin** credentials yet, either:

1. Set **`NEXT_PUBLIC_AUTH_DISABLED=true`** and **`DISABLE_AUTH=true`** in `.env.local` to skip auth and middleware (mock sidebar user), or  
2. Configure Admin (recommended) so email/password sign-in can mint an httpOnly session cookie.

## Environment variables

| Variable | Where | Purpose |
|----------|--------|---------|
| `NEXT_PUBLIC_FIREBASE_*` | Client + server | Web SDK (`src/lib/firebase/client.ts`) |
| `FIREBASE_ADMIN_PROJECT_ID` | Server | Admin SDK |
| `FIREBASE_ADMIN_CLIENT_EMAIL` | Server | Service account email |
| `FIREBASE_ADMIN_PRIVATE_KEY` | Server | PEM private key (`\n` escaped as `\\n` in `.env`) |
| `PLATFORM_ADMIN_EMAILS` | Server | Comma-separated bootstrap operators for `/platform` |
| `SYSTEM_SMTP_HOST` / `_PORT` / `_USER` / `_PASS` / `_FROM` | Server | Outbound transactional mail (invitations, owner setup links). If unset, the UI shows the link for manual copy. |
| `NEXT_PUBLIC_SITE_URL` | Server | Origin used in invite links (falls back to host header) |
| `INBOUND_WEBHOOK_SECRET` | Server | Legacy single-tenant webhook secret. New per-tenant secrets live on the org doc. |
| `DISABLE_AUTH` | Server | `true` = skip session verification in `(app)` layout |
| `NEXT_PUBLIC_AUTH_DISABLED` | Client + Edge | `true` = skip Firebase listeners + middleware auth |

See `.env.example` for the full list.

## Auth & multi-tenant flow

The product is multi-tenant SaaS. See `docs/SAAS-ARCHITECTURE.md` for the full reference.

**Three signup branches** (`POST /api/auth/session`):

1. **`/signup?invite=<token>`** - joins an existing org. The token resolves to an `organizations/{orgId}/invites/{inviteId}` doc; on accept, a `members/{uid}` doc is written and the invite is marked `accepted`.
2. **Email matches a `pendingOwnerEmail`** - when an operator pre-seats an org from `/platform/organizations/new`, the first signup with that email auto-claims the workspace as `owner`.
3. **Plain `/signup` with a company name** - bootstraps a personal org, the signer becomes `owner` (legacy CRM `roleId` set to `director`, `isSuperAdmin: true`).

After any branch, the server stamps Firebase **custom claims** (`organizationId`, `orgRole`, `platformAdmin`) and the client forces an ID-token refresh + re-exchange so the session cookie carries the new claims. `firestore.rules` reads claims first and falls back to the user doc, so freshly-signed-up users have working access on the very first request.

`/onboarding` is a defensive page for users that ended up signed in without an org (legacy accounts, or platform admins).

**Sign out** clears the cookie and calls Firebase `signOut()`.

## Firestore & rules

- Rules file: `firestore.rules` - enforces tenant isolation. Every CRM doc must declare `organizationId == caller's org`. Server (Admin SDK) bypasses rules.
- Indexes: `firestore.indexes.json` - pre-declares the composite indexes that tenant-filtered queries will hit.
- Deploy: `npm run firebase:deploy:rules` and `firebase deploy --only firestore:indexes`

Collections used in rules:
- Tenant CRM: `leads`, `accounts`, `contacts`, `deals`, `departments`, `permissionOverrides`, `activityCounters`, `activityRecords`, `auditLog`
- Identity: `users`, `computedPermissions`
- SaaS: `organizations` (with subcollections `members`, `invites`, `audit`), `platformAdmins`
- Server-only: `ingestQueue`

## Org management

- **`/admin/team`** - owner / admin invite teammates, change roles, disable members. Talks to `/api/org/members` and `/api/org/invites`.
- **`/admin/users`** - legacy demo view of the org chart (mock data). Linked from /admin/team.
- **`/platform`** - operator console (gated by `platformAdmins` collection or `PLATFORM_ADMIN_EMAILS`). Create / edit organizations, manage other operators, run the legacy-user migration once after deploy.

## Website → CRM webhook

`POST /api/integrations/webhook/lead` with header **`Authorization: Bearer <secret>`** or **`x-webhook-secret: <secret>`**.

The body MUST include `organizationId` so the lead is stamped to the right tenant. The secret is checked against `organizations/{orgId}.inboundWebhookSecret` (per-tenant) with `INBOUND_WEBHOOK_SECRET` env as a legacy fallback.

```json
{
  "organizationId": "abc123",
  "source": "website",
  "contactEmail": "lead@example.com",
  "contactName": "Jane Doe",
  "companyName": "Acme",
  "channel": "website_form",
  "raw": {}
}
```

Writes a tenant-stamped doc to **`ingestQueue`** via Admin SDK (clients cannot write this collection).

## Social RSS scrapers (replaces n8n + Google Sheets)

- **Admin → Scrapers** (`/admin/scrapers`): manage rss.app feed URLs, seed ~46 default feeds from the legacy n8n workflow, run feeds manually.
- **Intake pool** (`/intake`): team browses new posts (7-day retention), promotes to **prospect** (open queue or assign to self), or dismisses.
- Promoted prospects use the existing **Claim** flow on `/prospects` when left in the open queue.
- Scheduled ingest: set `CRON_SECRET` on **App Hosting** and **Cloud Functions**, deploy functions (`runDueScrapers` every 15 minutes → `GET /api/cron/scrapers/run`). Per-feed interval and **Enabled** are stored in Firestore - disabled feeds are skipped. (`vercel.json` crons apply only on Vercel.)

Deploy Firestore indexes after pulling: `npm run firebase:deploy:rules` (rules + indexes).

## Cloud Functions

Located in `functions/`. Build:

```bash
cd functions && npm install && npm run build
```

Exports:

- **`health`**: HTTP sanity check  
- **`recomputePermissionsOnUserWrite`**: on `users/{userId}` write, merges role + `permissionOverrides` into `computedPermissions/{userId}`  
- **`runDueScrapers`**: every 15 minutes, calls App Hosting `/api/cron/scrapers/run` (due feeds only; honors disable + interval)  
- **`sendDueScheduledEmails`**: every 5 minutes, calls `/api/cron/scheduled-emails/send`  
- **`cleanupProspectImportTemporaryData`**: hourly import cleanup  

Set Cloud Function secret: `firebase functions:secrets:set CRON_SECRET` (same value as App Hosting). Optional param `SITE_URL` defaults to production origin.

Deploy: `npm run firebase:deploy:functions` from `crm/` (requires Blaze for callable HTTP/functions).

## Firebase project files

| File | Purpose |
|------|---------|
| `firebase.json` | Firestore + Functions |
| `.firebaserc` | Default project id (`novacrm-41ef8`; change if needed) |
| `apphosting.yaml` | App Hosting resource hints |
| `firestore.rules` / `firestore.indexes.json` | Security + indexes |

**App Hosting:** In the Firebase console, create an App Hosting backend and point the root at this **`crm`** directory so `next.config.ts` and `package.json` are at the backend root.

## Scripts

| Script | Command |
|--------|---------|
| `npm run dev` | Next dev server |
| `npm run build` | Production build |
| `npm run firebase:deploy:rules` | Deploy Firestore rules only |
| `npm run firebase:deploy:functions` | Deploy Cloud Functions |

## Product docs

See repo root `PROJECT-OVERVIEW.md` and the Cursor plan for domain model and roadmap.
