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
| `INBOUND_WEBHOOK_SECRET` | Server | Bearer or `x-webhook-secret` for `POST /api/integrations/webhook/lead` |
| `DISABLE_AUTH` | Server | `true` = skip session verification in `(app)` layout |
| `NEXT_PUBLIC_AUTH_DISABLED` | Client + Edge | `true` = skip Firebase listeners + middleware auth |

See `.env.example` for the full list.

## Auth flow

1. User signs in with **Firebase Auth** (email/password or Google) on the client.  
2. Client calls **`POST /api/auth/session`** with a fresh **ID token**.  
3. Server verifies the token with **Admin SDK**, creates a **session cookie** (`__session`), and upserts **`users/{uid}`** in Firestore.  
4. **`middleware.ts`** redirects unauthenticated users to `/login`.  
5. **`(app)/layout.tsx`** calls **`requireSession()`** to verify the cookie on the server (Node).

Sign out clears the cookie and calls Firebase `signOut()`.

## Firestore & rules

- Rules file: `firestore.rules`  
- Deploy: `npm run firebase:deploy:rules` (requires [Firebase CLI](https://firebase.google.com/docs/cli))

Collections used in rules: `users`, `computedPermissions`, `leads`, `accounts`, `contacts`, `deals`, `departments`, `permissionOverrides`, `activityCounters`, `activityRecords`, `ingestQueue` (admin-only writes), `auditLog`.

## Website → CRM webhook

`POST /api/integrations/webhook/lead` with header **`Authorization: Bearer <INBOUND_WEBHOOK_SECRET>`** or **`x-webhook-secret: <secret>`**.

JSON body (all optional except you should send enough to process):

```json
{
  "source": "website",
  "contactEmail": "lead@example.com",
  "contactName": "Jane Doe",
  "companyName": "Acme",
  "channel": "website_form",
  "raw": {}
}
```

Writes an **`ingestQueue`** document via Admin SDK (clients cannot write this collection).

## Cloud Functions

Located in `functions/`. Build:

```bash
cd functions && npm install && npm run build
```

Exports:

- **`health`**: HTTP sanity check  
- **`recomputePermissionsOnUserWrite`**: on `users/{userId}` write, merges role + `permissionOverrides` into `computedPermissions/{userId}` (merge logic duplicated in `functions/src/mergePermissions.ts`; keep in sync with `src/lib/permissions/merge.ts` or extract to a shared package later).

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
