# Multi-tenant SaaS architecture

Reference for the Next.js + Firebase Auth + Firestore layering added to this CRM: **platform operators**, **customer organizations (tenants)**, and **members** inside each tenant.

## 1. Mental model

Three roles (not to confuse with CRM workspace roles like `director` / `salesperson`):

| Layer | Who | Responsibility |
|--------|-----|------------------|
| **Platform admin** | You / staff (`platformAdmins` + `PLATFORM_ADMIN_EMAILS`) | Run `/platform`: create tenants, plans, seats, migration, other operators |
| **Organization** | One SaaS customer (`organizations/{orgId}`) | Isolated data plane; billing/plan metadata; seat caps |
| **Member** | End user in Firebase Auth, doc in `organizations/{orgId}/members/{uid}` | Day-to-day CRM use inside exactly one org (v1) |

```
                    ┌─────────────────────────┐
                    │   Platform admins       │
                    │   (SaaS operator)       │
                    └───────────┬─────────────┘
                                │ manages
              ┌─────────────────┼─────────────────┐
              ▼                 ▼                 ▼
       ┌────────────┐    ┌────────────┐    ┌────────────┐
       │ Org A      │    │ Org B      │    │ Org C      │
       │ (tenant)   │    │ (tenant)   │    │ (tenant)   │
       └─────┬──────┘    └─────┬──────┘    └─────┬──────┘
             │ members         │                 │
        ┌────┴────┐       ┌────┴────┐       ┌────┴────┐
        │ M1 M2.. │       │ M3 ..   │       │ M4 ..   │
        └─────────┘       └─────────┘       └─────────┘
```

---

## 2. Data model (Firestore)

Canonical TypeScript shapes live in `crm/src/lib/types.ts`. Collection names are centralized in `crm/src/lib/firestore/collections.ts`.

### Top-level collections

**`users/{uid}`** - Global profile row keyed by Firebase Auth uid.

- **email**, **displayName**, **status** (`active` | `inactive` | `pip`)
- **organizationId** - Current tenant (when enrolled)
- **orgRole** - Cached copy of org role (`owner` | `admin` | `manager` | `member`); authoritative membership is under `organizations/.../members`
- **roleId** - Legacy CRM role (`Role`: director, manager, etc.)
- **company** - Display name from signup (workspace name), not the Firestore org id
- **isSuperAdmin** - Workspace-level flag (org owners get this on bootstrap)
- **createdAt** / **updatedAt** (timestamps)

**`organizations/{orgId}`** - Tenant record (create/update for sensitive fields is server-only; clients may read their own org).

- **name**, **slug** (unique), **status** (`trial` | `active` | `suspended`)
- **planId** (`free` | `pro` | `enterprise`) - Label only today; no payment integration
- **ownerUid**, **primaryEmail**, **pendingOwnerEmail** (pre-seeded owner before first login)
- **seatsUsed**, **maxUsers** (`null`/undefined = unlimited cap)
- **trialEndsAt**, **settings** (`billingEmail`, `operatorNotes`, optional **`inboundWebhookSecret`** for `POST /api/integrations/webhook/lead`), timestamps

Platform **GET** JSON never returns `settings.inboundWebhookSecret`; responses include **`hasInboundWebhookSecret`** instead. Partial **`settings`** updates merge with the existing map server-side so unrelated keys are not wiped.

**`platformAdmins/{uid}`** - Operator registry (Firestore doc id = Auth uid). Fields include **email**, **role** (`owner` | `admin`), **active**, **createdAt**, **createdByUid**. No direct client writes; API/layout use Admin SDK + guards.

**`computedPermissions/{userId}`** - Server-maintained; rules allow self-read only.

**`ingestQueue`** - Server-only queue (`allow read, write: if false`).

### Subcollections under `organizations/{orgId}`

**`members/{uid}`** - Authoritative membership (doc id = Auth uid).

- **uid**, **organizationId**, **email**, **displayName**, **role**, **status** (`active` | `invited` | `disabled`)
- **invitedByUid**, **joinedAt**, optional **disabledAt**

**`invites/{inviteId}`** - Pending invitations.

- **email**, **role**, **tokenHash** (SHA-256 of secret), **status**, **expiresAt**, **createdAt**, **createdByUid**, optional **acceptedAt** / **acceptedByUid**

**`audit/{eventId}`** - Append-only tenant audit (written via Admin SDK). Each doc includes **organizationId**, **actorUid**, **event** (see `AuditEvent` in `crm/src/lib/firestore/audit.ts`), **meta**, **createdAt**.

### Tenant CRM collections

These collection ids are listed in `TENANT_COLLECTIONS` in `collections.ts`:

`leads`, `accounts`, `contacts`, `deals`, `departments`, `permissionOverrides`, `activityCounters`, `activityRecords`, `auditLog` (top-level CRM audit, distinct from org subcollection audit).

**Contract:** every document written to those collections **must** include **`organizationId`** matching the tenant. Security rules enforce reads/writes against the caller’s org; stamping is done in server code (see §7).

---

## 3. Auth flow - `/api/auth/session`

`POST` accepts JSON `{ idToken, company?, inviteToken? }`, verifies the ID token (rejects if older than one hour), then resolves org membership and mirrors fields onto `users/{uid}`, sets custom claims, and mints the session cookie.

Documented branches for **how a session gets an organization** (full precedence is in-code):

```85:92:crm/src/app/api/auth/session/route.ts
  // ────────────── 1. Decide which org this session belongs to ──────────────
  // Order of precedence:
  //   (a) explicit invite token  → join that org
  //   (b) existing membership    → reuse
  //   (c) pending owner email    → claim platform-seeded org
  //   (d) signup with company    → create personal org, become owner
  //   (e) anything else          → stay org-less (will land on onboarding)
```

**(a) Invite - `inviteToken` in body (from `/signup?invite=…`)**

- Resolves invite via `lookupInviteByTokenServer`, checks email match, **seat availability** (`hasSeatAvailableServer`), then `upsertMemberServer` with the invite’s role and `markInviteAcceptedServer`.
- User joins the existing org; **does not** pass `company` when an invite is present (signup UI omits company field for invite flow).

**(b) Existing membership** (runs when no org was set by invite)

- `findMembershipForUserServer(uid)` via `collectionGroup("members")` - returning users keep their org.

**(c) Pending owner email**

- If still no org: `findOrganizationByPendingEmailServer(email)`; on match, `claimPendingOrgOwnerServer` then `upsertMemberServer` as **owner** with `invitedByUid: "platform-seed"`.

**(d) Plain signup - `company` name**

- If still no org and `company` is provided: `createOrganizationServer` then `upsertMemberServer` as owner (`invitedByUid: "owner-bootstrap"`).

**(e) No org**

- User remains without `organizationId` until they complete onboarding or use an invite later.

### Onboarding fallback

If the user is authenticated but has **no** organization (e.g. signed in without going through company field or invite), **`/onboarding`** collects a workspace name and **`POST /api/auth/onboarding`** runs server-side: creates org, `upsertMemberServer`, updates `users/{uid}`, **`setAppClaims`**. Client reloads so the next request picks up claims (this path does not use `needsClaimRefresh` on the session route; it sets claims after org creation).

---

## 4. Custom claims (`AppClaims`)

Defined in `crm/src/lib/auth/claims.ts`:

```10:17:crm/src/lib/auth/claims.ts
export type AppClaims = {
  /** Tenant id this user belongs to. Absent until the user has joined or created an org. */
  organizationId?: string;
  /** Member role inside the org. */
  orgRole?: OrgMemberRole;
  /** Mirrors `platformAdmins` - convenience for the rules layer. */
  platformAdmin?: boolean;
};
```

**Why:** Firestore security rules read `request.auth.token.organizationId` (and role) **without an extra `get()`**, keeping evaluation cheap and deterministic for tenant isolation.

**Why fresh signups need a token refresh:** `setAppClaims` runs **after** the client’s current ID token was minted. The session cookie is built from **that same** id token via `createSessionCookie(idToken, ...)`, so the embedded JWT still lacks the new claims until the client obtains a **new** ID token.

The API returns **`needsClaimRefresh: true`** when membership/org was created or invite accepted (`isFreshSignup`). The client helper forces a refresh and re-posts:

```40:56:crm/src/lib/auth/client-session.ts
  if (data.needsClaimRefresh) {
    const auth = getFirebaseAuth();
    const user = auth.currentUser;
    if (user) {
      const fresh = await user.getIdToken(true);
      const re = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: fresh }),
      });
```

Second round-trip rebuilds the cookie from a token that includes `organizationId` / `orgRole`. For normal logins, claims rarely change; Firebase refreshes ID tokens periodically anyway.

---

## 5. Firestore rules - tenant isolation

Helper functions (quoted from `crm/firestore.rules`):

```25:38:crm/firestore.rules
    function callerOrgId() {
      return signedIn()
        ? (request.auth.token.organizationId != null
            ? request.auth.token.organizationId
            : userDoc().organizationId)
        : null;
    }

    function callerOrgRole() {
      return signedIn()
        ? (request.auth.token.orgRole != null
            ? request.auth.token.orgRole
            : userDoc().orgRole)
        : null;
    }
```

```45:69:crm/firestore.rules
    function isOrgAtLeast(role) {
      let r = callerOrgRole();
      return role == 'member'
        ? r in ['owner', 'admin', 'manager', 'member']
        : role == 'manager'
          ? r in ['owner', 'admin', 'manager']
          : role == 'admin'
            ? r in ['owner', 'admin']
            : r == 'owner';
    }

    function inCallerOrg(data) {
      return data.organizationId != null
        && data.organizationId == callerOrgId();
    }

    function isCreatingInOwnOrg() {
      return request.resource.data.organizationId == callerOrgId();
    }

    function tenantUnchanged() {
      return request.resource.data.organizationId == resource.data.organizationId;
    }
```

**Behavior:**

- **`callerOrgId` / `callerOrgRole`** - Prefer JWT claims; **fallback to `users/{uid}`** so brand-new sessions work before the refreshed token propagates.
- **Tenant CRM collections** - Reads require `resource.data.organizationId == callerOrgId()`. Creates must set `organizationId` to the caller’s org; updates cannot change `organizationId`.
- **`organizations` and subcollections** - Members may read their org doc and member list; writes to org metadata, invites, and membership are **denied** to clients (Admin SDK / API routes only).
- **`platformAdmins`** - No client access.

**Admin SDK:** Backend routes using the Firebase Admin SDK **bypass** security rules entirely; rules constrain only direct Firestore access from clients.

---

## 6. Tenant write helpers - `stampForCreate` / `stampForUpdate`

`crm/src/lib/firestore/tenant-write.ts`:

```3:15:crm/src/lib/firestore/tenant-write.ts
/**
 * Helper for stamping `organizationId` + audit timestamps on every tenant
 * write. Use this in every server route that writes to a `TENANT_COLLECTIONS`
 * collection (leads, accounts, contacts, deals, activityCounters, …).
 *
 * Example:
 *   await db.collection("leads").add(stampForCreate(orgId, payload, uid));
 *   await ref.update(stampForUpdate(payload, uid));
 *
 * Stamping at write time is the *only* layer that prevents a buggy client
 * from leaking data across tenants - the Firestore rules check `organizationId`
 * matches the user's claim, but they can't *invent* the field for you.
 */
```

Every CRM write path that targets tenant collections should use these helpers so **`organizationId`** and timestamps (and optional actor fields) stay consistent with rules expectations.

---

## 7. Invitations

- **Token format:** `<orgId>.<inviteId>.<secret>` - `packInviteToken` / `unpackInviteToken` in `crm/src/lib/platform/invites-server.ts`.
- **Stored value:** **SHA-256** hash of **secret** only (`hashInviteToken`).
- **Accept URL:** `/signup?invite=<token>` - see `inviteAcceptUrl` in `crm/src/lib/invite-link.ts`.
- **TTL:** **7 days** (`INVITE_TTL_DAYS = 7`).
- **Email:** `sendSystemEmail` uses **`SYSTEM_SMTP_*`**; if not configured, API responses surface a note to copy the link manually (same pattern for org-invite and platform-create flows).

---

## 8. Seat counting

- **`bumpOrganizationSeatsServer(orgId, delta)`** - `FieldValue.increment` on `organizations/{orgId}.seatsUsed` (`organizations-server.ts`).
- Called when:
  - **New active member** (`upsertMemberServer` first create, non-disabled)
  - **Disable member** (decrement)
  - **Re-enable** from disabled (increment)
  - **Delete member** if they counted as active

- **`hasSeatAvailableServer(orgId)`** - Loads org; if **`maxUsers`** is **null/undefined**, unlimited; else **`seatsUsed >= maxUsers`** rejects with an error string.

---

## 9. Operator console (`/platform/*`)

- **Gating:** `requirePlatformAdminSession` → `isUserPlatformAdmin(uid, email)`:
  - **`PLATFORM_ADMIN_EMAILS`** (comma-separated) **or**
  - **`platformAdmins/{uid}`** with **`active !== false`**

- **Routes (UI):** Overview `/platform`, organizations list/detail/create, `/platform/admins`, migration control on the overview page.

- **Capabilities:**
  - **Create orgs** with optional **`ownerEmail`**: if Firebase already has that user, they are linked immediately (`ownerUid`, member row, user doc patch, `setAppClaims`); else **`pendingOwnerEmail`** until first matching signup.
  - **Edit plan, status, seats,** etc., via platform APIs (server-side `updateOrganizationServer` and related).
  - **Manage platform admins** (Firestore-backed list; env bootstrap documented on the overview page).
  - **Migrate legacy users:** `POST /api/platform/migrate-existing-users` - idempotent; creates a personal org for each `users/*` document without membership; stamps claims.

---

## 10. Deploy checklist

1. **`SYSTEM_SMTP_HOST`**, **`SYSTEM_SMTP_PORT`**, **`SYSTEM_SMTP_SECURE`**, **`SYSTEM_SMTP_USER`**, **`SYSTEM_SMTP_PASS`**, **`SYSTEM_SMTP_FROM`** - Without these, invite and owner-setup emails are not sent; UIs still expose copy/manual links where implemented.
2. **`NEXT_PUBLIC_SITE_URL`** - Stable absolute origin for invite and setup links in production (`getRequestOrigin` prefers this over host headers).
3. **`firebase deploy --only firestore:rules,firestore:indexes`** - Ship rules and any composite indexes required by queries (e.g. collection group / org queries).
4. **`PLATFORM_ADMIN_EMAILS`** - Set **before** first production deploy so at least one operator can open `/platform` if `platformAdmins` is still empty.
5. **One-shot migration** - From `/platform`, run **migrate existing users** once if you have pre-multi-tenant accounts without `organizationId`/membership.

---

## 11. Known gaps / next steps

- **CRM list pages** (leads, accounts, contacts, deals, etc.) may still be backed by **mock or non–tenant-scoped data**. When real CRUD lands, reads must filter by **`organizationId`** and writes must use **`stampForCreate` / `stampForUpdate`**.
- **No Stripe (or other) billing** - **`planId`** is descriptive only.
- **Owner transfer** - Changing **`ownerUid`** after initial assignment is not implemented as a product flow; member **roles** can change, but ownership UID is not swapped by UI.
- **No email-verification gate** before completing signup / org attachment beyond Firebase’s own behavior.

---

*Last aligned with the codebase layout under `crm/` (types, collections, session route, rules, platform servers).*
