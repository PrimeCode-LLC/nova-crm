# Phase 5 — Auth migration (Clerk)

Companion to [`NOVA-CRM-MIGRATION-BABY-STEPS.md`](NOVA-CRM-MIGRATION-BABY-STEPS.md). Rule: ENGINEERING_RULES — Auth is not Firebase Auth; session is short-lived httpOnly / server-verified.

## P5.0 — Decision (recorded 2026-08-12)

| Topic | Decision |
|-------|----------|
| Provider | **Clerk** (`@clerk/nextjs`) |
| Clerk Organizations | **Off** — Nova owns tenancy (`organizations` / `members` + RLS). Revisit only for enterprise SAML/SCIM later. |
| SSO / SAML | Later (when a customer needs it); ship email/password + Google first |
| Identity vs tenant | Clerk = identity; Nova = `organization_id`, roles, invites, platform admin |
| UID bridge (target) | Prefer Clerk `externalId` = existing Firebase `uid` so member rows stay stable |
| Parallel period | Flag `auth_clerk_v1` — Firebase login remains until soak + P5.5 |
| Chrome extension | Stay on Firebase Auth for now; migrate in a follow-up after web cutover |
| Google Calendar OAuth | Unchanged (separate from login) |

### Env vars

| Variable | Role |
|----------|------|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Browser / SDK |
| `CLERK_SECRET_KEY` | Server only |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | Default `/sign-in` |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | Default `/sign-up` |
| `AUTH_CLERK_V1` / `NEXT_PUBLIC_AUTH_CLERK_V1` | Feature flag (`true` = Clerk path available) |
| `CLERK_WEBHOOK_SECRET` | Optional; user sync webhooks (later) |

Local: put keys in `.env.local` (never commit). Use separate Clerk applications for staging/prod when those environments go live.

### Clerk Dashboard checklist (dev)

1. Authentication **on**; Organizations **off**
2. Enable Email + password and Google (match current Firebase methods)
3. Allowed origin / redirect: `http://localhost:3000` (+ staging/prod URLs later)
4. Paths: sign-in `/sign-in`, sign-up `/sign-up`

## Baby steps

| ID | Goal |
|----|------|
| P5.1 | Install Clerk; flag; `ClerkProvider`; `/sign-in` `/sign-up`; proxy runs `clerkMiddleware` when flag on; Firebase path unchanged when flag off |
| P5.2 | Map Clerk user ↔ member ↔ `organization_id` via `externalId` + email bridge (`resolveClerkIdentity`) |
| P5.3 | `requireSession` / protected routes prefer Clerk session cookies |
| P5.4 | Platform-admin + invite/onboarding on Clerk |
| P5.5 | Disable Firebase Auth after soak |


## P5.2 — Identity bridge (implemented)

- `findMembershipByEmailServer` — Postgres (RLS bypass) then Firestore `members.email`
- `resolveClerkIdentity` — Clerk user → Nova `uid` / `organizationId` / `orgRole`
- Syncs Clerk `externalId` = Firebase/Nova uid and `publicMetadata.{novaUid,organizationId,orgRole}`
- `getClerkAppSession` uses the resolver; `resolveLiveTenantForSession` also falls back to email


## Clerk → Firebase client bridge

Until Firestore client listeners are retired, Clerk login mints a Firebase
**custom token** (`POST /api/auth/clerk-firebase-bridge`) and the client calls
`signInWithCustomToken`. That restores Firestore Auth rules while Nova uid /
org come from the P5.2 identity bridge.


## P5.3–P5.5 (completed)

- **P5.3:** `getVerifiedSession` prefers Clerk when `auth_clerk_v1` is on; `requireTenantSession` uses live membership resolution.
- **P5.4:** Invite/join tokens stash across Clerk UI; `POST /api/auth/clerk-complete-membership`; onboarding writes Clerk `publicMetadata`; invite/join URLs use `/sign-up` when flag on. Platform admin still uses `PLATFORM_ADMIN_EMAILS` + `platformAdmins` against the bridged Nova uid/email.
- **P5.5:** `/login` and `/signup` redirect to Clerk. Firebase Auth is **not** used for interactive login; the custom-token bridge remains so Firestore client listeners keep working until Phase 6.
