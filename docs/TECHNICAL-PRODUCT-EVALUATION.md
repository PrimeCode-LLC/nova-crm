# Nova CRM (Relay) — Technical Product Evaluation Document

**Document purpose:** Factual reference for architecture, frontend, backend, scaling, and performance evaluation.  
**Product names in codebase:** Nova CRM, Relay (Cloud Functions package name: `relay-crm-functions`).  
**Production origin (App Hosting):** `https://nova.stellixsoft.com`  
**Firebase project id:** `novacrm-41ef8`  
**Document generated from:** repository source of truth under `crm/` (package versions, routes, collections, functions, providers, config files).  
**Related internal references:** `README.md`, `docs/SAAS-ARCHITECTURE.md`

---

## Table of contents

1. [Product summary](#1-product-summary)
2. [Repository layout](#2-repository-layout)
3. [Technology stack and dependencies](#3-technology-stack-and-dependencies)
4. [System architecture](#4-system-architecture)
5. [Multi-tenancy, auth, and access control](#5-multi-tenancy-auth-and-access-control)
6. [Data model](#6-data-model)
7. [Product features](#7-product-features)
8. [Application routes (UI)](#8-application-routes-ui)
9. [API surface](#9-api-surface)
10. [Frontend architecture](#10-frontend-architecture)
11. [Backend and server-side processing](#11-backend-and-server-side-processing)
12. [Background jobs, crons, events, and client sync](#12-background-jobs-crons-events-and-client-sync)
13. [Email subsystem](#13-email-subsystem)
14. [AI subsystem](#14-ai-subsystem)
15. [Browser extension (Intent Radar)](#15-browser-extension-intent-radar)
16. [Integrations](#16-integrations)
17. [Security model](#17-security-model)
18. [Scaling and performance characteristics](#18-scaling-and-performance-characteristics)
19. [Deployment and operations](#19-deployment-and-operations)
20. [Testing](#20-testing)
21. [Environment configuration](#21-environment-configuration)
22. [Known documented gaps](#22-known-documented-gaps)

---

## 1. Product summary

Nova is a **multi-tenant, multi-channel sales CRM** delivered as a Next.js web application with:

| Capability area | What the product provides |
|-----------------|---------------------------|
| CRM core | Leads, prospects, accounts (companies), contacts, deals, pipeline kanban, notes, touchpoints, timeline, tasks, labels |
| Prospecting | Intake pool (RSS), prospect queue, prospect drafts, prospecting strategies, buyer personas, Intent Radar browser extension, Fit Check |
| Outreach | Instantly cold-email campaigns, SMTP send, scheduled sequences/followups, open/click tracking, reply intelligence |
| Inbox | IMAP/Gmail mailboxes, inbound sync, bounce handling, mailbox delegations, org send policy / capacity |
| Scheduling | Availability, booking links, meetings, Google Calendar OAuth, public `/book/...` pages |
| Content | Content calendar, brands, captures, AI drafting/planning |
| Collaboration | Team chat, notifications, activity/audit logs |
| Admin | Org settings, people/roles/permissions/hierarchy, channels, AI/RAG, scrapers, imports, intent playbook |
| Platform ops | `/platform` console for tenants, seats/plans metadata, platform admins |
| Marketing site | Public landing, features, pricing, blog, legal |

**Tenancy model (v1):** one Firebase Auth user belongs to **exactly one organization** at a time. Platform operators are a separate layer.

---

## 2. Repository layout

```
crm/
├── src/                    # Next.js App Router application
│   ├── app/                # Routes: (app), (auth), (marketing), (platform), book, api, auth
│   ├── components/         # UI by domain (leads, inbox, dashboard, admin, …)
│   ├── lib/                # Domain logic, Firebase, email, AI, permissions, …
│   ├── hooks/              # React hooks (scheduling queries, mailbox utilization, …)
│   ├── stores/             # Zustand stores (email, channel admin, demo chat/notifs)
│   └── content/            # Marketing blog content
├── functions/              # Firebase Cloud Functions (Node 22)
├── packages/nova-scoring/  # Shared scoring library (@nova/scoring)
├── extension/              # Chrome/Edge MV3 Intent Radar extension
├── packs/                  # Strategy pack JSON (+ private tenant packs, extension zip)
├── scripts/                # Dev/import/export utilities
├── docs/                   # Architecture and this evaluation document
├── firestore.rules
├── firestore.indexes.json  # 89 composite indexes + 3 field overrides
├── firebase.json
├── apphosting.yaml         # Firebase App Hosting run/env config
├── vercel.json             # Present; crons array is empty
└── package.json            # npm workspaces: packages/*, extension
```

**Workspaces** (`package.json`):

- Root app: `crm`
- `@nova/scoring` → `packages/nova-scoring`
- `@nova/intent-radar-extension` → `extension`

---

## 3. Technology stack and dependencies

### 3.1 Runtime platforms

| Layer | Technology | Version / config |
|-------|------------|------------------|
| Web app framework | Next.js (App Router) | `16.2.7` |
| UI library | React / React DOM | `19.2.4` |
| Language | TypeScript | `^5` |
| Hosting (production config in repo) | Firebase App Hosting | `apphosting.yaml` |
| Primary database | Cloud Firestore | rules + indexes in repo |
| Auth | Firebase Authentication + Admin session cookies | httpOnly `__session`, 5-day cookie |
| Background compute | Firebase Cloud Functions | `firebase-functions` `^7.3.0`, Node **22** |
| Optional alternate host artifacts | `vercel.json` | `"crons": []` (no Vercel Cron jobs configured) |

**App Hosting runConfig** (`apphosting.yaml`):

| Setting | Value |
|---------|-------|
| `minInstances` | 1 |
| `maxInstances` | 3 |
| `concurrency` | 80 |
| `cpu` | 1 |
| `memoryMiB` | 1024 |

### 3.2 Frontend dependencies (primary)

| Package | Role |
|---------|------|
| `next`, `react`, `react-dom` | App framework |
| `geist` | Fonts |
| `tailwindcss` `^4`, `@tailwindcss/postcss`, `tw-animate-css` | Styling |
| `shadcn` + `@base-ui/react`, `@radix-ui/*` | Component system (`components.json` style: `base-nova`, neutral, Lucide) |
| `lucide-react` | Icons |
| `class-variance-authority`, `clsx`, `tailwind-merge` | Class utilities |
| `next-themes` | Theme switching |
| `@tanstack/react-query` (+ devtools) | Server-state for selected domains (scheduling, drafts, members) |
| `@tanstack/react-table` | Tables |
| `@dnd-kit/*` | Drag-and-drop (pipeline) |
| `react-hook-form`, `@hookform/resolvers`, `zod` | Forms / validation |
| `recharts` | Charts |
| `cmdk` | Command palette |
| `sonner` | Toasts |
| `date-fns`, `react-day-picker` | Dates |
| `zustand` | Client stores (email inbox state, channel admin, demo) |
| `firebase` | Client Auth + Firestore listeners |
| `streamdown` + `@streamdown/*` | Markdown rendering (AI surfaces) |
| `ai`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@ai-sdk/google` | AI SDK v6 orchestration |

### 3.3 Backend / email / data dependencies (primary)

| Package | Role |
|---------|------|
| `firebase-admin` | Server Auth, Firestore, session cookies, Admin SDK writes |
| `imapflow` | IMAP client (inbox sync, fetch, mutate) |
| `nodemailer` | SMTP send + MIME composition |
| `mailparser` | Parse inbound MIME |
| `exceljs`, `papaparse` | Import/export CSV/XLSX |
| `rss-parser` | RSS scraper feeds |
| `@nova/scoring` | Intent/quality scoring + strategy matching (shared with extension) |

**Next.js `serverExternalPackages`** (not bundled by Turbopack; required at runtime):  
`mailparser`, `@zone-eu/mailsplit`, `imapflow`, `nodemailer`, `iconv-lite`, `html-to-text`, `libmime`, `encoding-japanese`.

### 3.4 Dev / quality dependencies

| Package | Role |
|---------|------|
| `eslint`, `eslint-config-next` | Lint |
| `vitest` | Unit / integration tests |
| `firebase-tools` | Deploy rules/indexes/functions; emulators |
| `@firebase/rules-unit-testing` | Rules tests (where used) |

### 3.5 Cloud Functions dependencies

| Package | Role |
|---------|------|
| `firebase-admin` | Admin SDK inside functions |
| `firebase-functions` | HTTP, Firestore, scheduled triggers |

### 3.6 Extension dependencies

| Package | Role |
|---------|------|
| React 19 | Side panel UI |
| Vite + `@crxjs/vite-plugin` | MV3 build |
| `@nova/scoring` | On-page strategy/intent scoring |

### 3.7 Why these choices (as implemented in the codebase)

| Concern | Implementation choice | Evidence in repo |
|---------|----------------------|------------------|
| Interactive CRM lists | Client Firestore `onSnapshot` with org filter | `use-live-workspace-firestore.ts`, `workspace-listener-groups.ts` |
| Sensitive mutations / secrets | Next.js Route Handlers + Admin SDK | `src/app/api/**`, mailbox/AI secrets encryption |
| Scheduled work on App Hosting | Firebase Scheduler functions HTTP-call App Hosting cron routes | `functions/src/appHostingCron.ts`, `src/app/api/cron/**` |
| Multi-provider AI | Vercel AI SDK + per-org encrypted provider keys | `src/lib/ai/provider-router.ts` |
| Email deliverability tooling | Direct IMAP/SMTP + Instantly API + MillionVerifier | `src/lib/email/*`, `src/lib/outreach/*`, integrations APIs |
| Shared scoring logic | npm workspace package consumed by app + extension | `packages/nova-scoring` |

---

## 4. System architecture

### 4.1 High-level diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         Clients                                          │
│  Browser (Nova web)          Chrome/Edge (Intent Radar)   Public bookers │
└──────────────┬───────────────────────────┬───────────────────┬────────────┘
               │ HTTPS                     │ HTTPS            │ HTTPS
               ▼                           ▼                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  Next.js on Firebase App Hosting (min 1 / max 3 instances)               │
│  ├── proxy.ts          cookie gate for protected paths                   │
│  ├── RSC layouts       session + org membership checks                   │
│  ├── Client shell      Firestore listeners + DeferredAppSync             │
│  └── /api/*            Route Handlers (Node; email pkgs externalized)    │
└───────┬────────────────────────────┬─────────────────────┬───────────────┘
        │ Admin SDK                  │                     │
        ▼                            ▼                     ▼
┌───────────────────┐    ┌─────────────────────┐   ┌──────────────────────┐
│ Cloud Firestore   │    │ Firebase Auth       │   │ External services    │
│ (+ security rules)│    │ (ID tokens → cookie)│   │ IMAP/SMTP, Google,   │
└─────────▲─────────┘    └─────────────────────┘   │ Instantly, AI APIs,  │
          │                                         │ MillionVerifier,     │
          │ triggers / scheduled                    │ Resend (optional)    │
┌─────────┴─────────┐                               └──────────────────────┘
│ Cloud Functions   │
│ us-central1       │──HTTP GET──► App Hosting /api/cron/* (Bearer CRON_SECRET)
│ maxInstances: 10  │
└───────────────────┘
```

### 4.2 Request path types

| Path type | Mechanism |
|-----------|-----------|
| Marketing / legal / blog | Static/SSR pages under `(marketing)` |
| Authenticated CRM UI | `(app)` layout → `requireSession` → `WorkspaceModeProvider` → module route gate |
| Public booking | `/book/[orgSlug]/[linkSlug]` + `/api/scheduling/public/...` |
| Browser extension | Dedicated `/api/extension/*` + `/extension-login` |
| Platform operator UI | `/platform/*` gated by platform admin check |
| Cron | Firebase scheduled function → App Hosting cron route |

### 4.3 Dual data-access pattern

1. **Client-direct Firestore** for live CRM documents the security rules allow (leads, deals, notes, etc.).
2. **Server Admin SDK** for collections denied to clients (scheduling core, scrapers, import jobs, mailbox secrets, AI secrets, extension sessions, org membership writes, send ledger, etc.).

---

## 5. Multi-tenancy, auth, and access control

### 5.1 Three layers

| Layer | Identity | Responsibility |
|-------|----------|----------------|
| Platform admin | `platformAdmins/{uid}` and/or `PLATFORM_ADMIN_EMAILS` | Create/edit orgs, manage operators, migration tools |
| Organization (tenant) | `organizations/{orgId}` | Isolated data plane; plan/seat metadata; settings |
| Member | `organizations/{orgId}/members/{uid}` | Day-to-day CRM use |

**Org member roles:** `owner` | `admin` | `manager` | `member`  
**CRM workspace roles (`roleId`):** `director` | `manager` | `team_lead` | `salesperson` | `prospecting` | `content_team` (plus deprecated `data_scraper`)  
**Plans (metadata):** `free` | `pro` | `enterprise` — no payment provider integration in repo  
**Org status:** `trial` | `active` | `suspended`

### 5.2 Auth flow

1. Client signs in with Firebase Auth (email/password; Google available in auth UI paths).
2. Client POSTs Firebase **ID token** to `/api/auth/session`.
3. Server verifies token (Admin SDK), resolves organization:
   - invite token → join org  
   - existing membership → reuse  
   - pending owner email → claim platform-seeded org  
   - company name on signup → create personal org as owner  
   - else → org-less → `/onboarding`
4. Server sets **custom claims**: `organizationId`, `orgRole`, `platformAdmin`.
5. Server mints Firebase **session cookie** → httpOnly `__session` (5 days).
6. On fresh signup/claim, API may return `needsClaimRefresh`; client refreshes ID token and re-posts session.
7. `src/proxy.ts` redirects unauthenticated users away from protected prefixes.
8. `(app)` layout calls `requireSession` and membership checks (e.g. pending join → `/join/pending`).

**Local bypass:** `DISABLE_AUTH` + `NEXT_PUBLIC_AUTH_DISABLED` skip auth (dev only).

### 5.3 Permissions (RBAC)

Implemented under `src/lib/permissions/`:

| Concept | Detail |
|---------|--------|
| Modules | ~38 module keys (dashboard, leads, prospects, intake, fit_check, content_calendar, email_outreach, admin modules, …) |
| Module verbs | `view` \| `create` \| `edit` \| `delete` |
| Data scopes | `none` \| `own` \| `team` \| `department` \| `all` |
| Actions | ~40 action keys (reassign, export, Instantly campaign ops, mailbox view/send-as, scrapers, AI manage, …) |
| Role catalog | Per-org `organizations/{orgId}/roles` |
| Overrides | `permissionOverrides` collection |
| Computed | `computedPermissions/{uid}` (self-read in rules; Cloud Function legacy recompute on user write) |
| Feature grants | Per-user `featureGrants` for admin features without raising CRM role (`src/lib/admin-features.ts`) |

**Hierarchy:** `managerId` + denormalized `managerAncestorIds` / `ownerManagerIds` on owned CRM docs; composite indexes use `array-contains` on manager id arrays. Repair APIs: `/api/org/repair-hierarchy`, `/api/org/restamp-owner-managers`.

### 5.4 Seat counting

- `organizations.seatsUsed` / `maxUsers` (`null` = unlimited)
- Increment/decrement on member create/disable/re-enable/delete
- Invite accept checks seat availability server-side

---

## 6. Data model

Canonical collection ids: `src/lib/firestore/collections.ts`  
Canonical TypeScript shapes: `src/lib/types.ts` (~1250 lines) plus domain-specific type modules.

### 6.1 Top-level collections (60)

| Group | Collections |
|-------|-------------|
| Identity / access | `users`, `computedPermissions`, `departments`, `permissionOverrides`, `platformAdmins` |
| CRM core | `leads`, `accounts`, `contacts`, `deals`, `notes`, `followups`, `followupPlans`, `leadTasks`, `touchpoints`, `timelineEvents`, `labels` |
| Activity | `orgActivityEvents`, `activityCounters`, `activityRecords`, `auditLog`, `errorLogs` |
| Outreach / mail | `profiles`, `campaigns`, `scriptLibrary`, `leadMailMessages`, `replyActions`, `mailTrackingMessages` |
| Prospecting | `buyerPersonas`, `prospectingStrategies`, `strategyAssignments`, `ingestQueue`, `importJobs`, `importJobChunks`, `importIdentityKeys`, `scraperFeeds`, `scraperRawItems` |
| Scheduling | `schedulingLinks`, `meetings`, `availabilitySchedules`, `calendarDelegations`, `mailboxDelegations`, `calendarConnections` |
| Chat / notify | `workspaceChatChannels`, `workspaceChatMessages`, `workspaceChatReads`, `userNotifications` |
| SaaS / extension | `organizations`, `extensionAuthCodes`, `extensionSessions`, `extensionAuthRateLimits`, `extensionFindings` |
| Drafts | `prospectDrafts`, `prospectDraftSources`, `prospectDraftLocks`, `prospectDraftReservations` |
| Content | `contentBrands`, `contentItems`, `contentCaptures`, `contentPlans` |

### 6.2 Organization subcollections

Under `organizations/{orgId}/`:

`members`, `invites`, `audit`, `aiSettings`, `aiProviderSecrets`, `aiPrompts`, `aiLibraries`, `aiDocuments`, `aiUsageDaily`, `aiUsageEvents`, `aiCache`, `aiBriefHistory`, `opportunityScans`, `integrationSecrets`, `roles`, `sendLedger`

### 6.3 Tenant contract

Documents in `TENANT_COLLECTIONS` **must** include `organizationId`.  
Helpers: `stampForCreate` / `stampForUpdate` in `src/lib/firestore/tenant-write.ts`.

### 6.4 Lead / pipeline domain (summary)

| Concept | Values / notes |
|---------|----------------|
| Channels | `cold_email`, `linkedin_outbound`, `linkedin_1to1`, `personalized_email`, `website_form`, `upwork`, `job_apply` |
| Pipeline stages | Progression through stages ending in `won` / `lost` (10 stages in types) |
| Prospect vs lead | `intakeKind` / prospect visibility fields; promote/demote APIs |
| Intent | Quality score 0–100, temperature cold/warm/hot, playbook signals |
| Outreach linkage | Instantly fields, scheduled emails, reply/open tracking, bounce counters |

### 6.5 Indexes

`firestore.indexes.json`: **89** composite indexes, **3** field overrides.  
Includes hierarchy `array-contains` indexes, scheduled email status+time, scrapers, imports, prospect drafts, mail tracking, and a **vector** collection-group index on `chunks.embedding` (dimension **1536**) for RAG.

---

## 7. Product features

### 7.1 Dashboard and operations

- KPI / funnel / pipeline distribution views
- Owner ops board and fullscreen **wall** display (`/dashboard/wall`)
- AI dashboard brief (`/api/ai/dashboard-brief`)
- Reply intelligence analytics (`/dashboard/reply-intelligence`)
- Mailbox utilization panel (capacity vs policy)
- Charts: email volume, followup schedule

### 7.2 Leads and prospects

- Leads table with filters, bulk schedule sequences, bulk build sequences
- Lead detail: overview, emails, followups, tasks, timeline, intent/quality
- Prospects queue with claim/qualify
- Prospect ↔ lead promote/demote (`/api/org/prospects/.../push-to-lead`, `/api/org/leads/.../move-back-to-prospect`)
- Prospect drafts (AI/extension) with complete flow
- My Strategy workbench for assigned prospecting strategies

### 7.3 Intake and scrapers

- Admin-managed RSS feeds (`/admin/scrapers`)
- Cron ingest into `scraperRawItems` (7-day staging pool epoch)
- Intake UI: browse, promote to prospect (open queue or assignee), dismiss
- Team intake filter defaults

### 7.4 Accounts, contacts, deals, pipeline

- Company and contact CRUD surfaces with owner hierarchy
- Deals with value/probability
- Kanban pipeline (`@dnd-kit`) for stage moves
- Stage history API

### 7.5 Followups, sequences, tasks

- Followup queue with assignee/date filters
- Followup plans (multi-step sequences) with pause-on-reply behavior
- Scheduled followup emails tied to mailbox capacity / org send policy
- Lead tasks

### 7.6 Inbox and reply intelligence

- Multi-mailbox IMAP inbox UI
- Compose/send via SMTP
- Cron-persisted inbound heads + on-page IMAP refresh
- Bounce watcher → contact/lead bounce state + tasks
- Reply-action queue (AI classify / draft / analytics)
- Open and click tracking (`/api/t/o/[token]`, `/api/t/c/[token]`)
- Mailbox and scheduling delegations

### 7.7 Outreach (Instantly)

- Campaign list/wizard/detail
- Connection, accounts, activate/pause, push leads, sync leads/stats, options
- Instantly webhook ingestion
- CRM campaign documents with stats fields

### 7.8 Scheduling

- Availability schedules
- Booking links
- Meetings (create, place with optional ICS, from invite)
- Google Calendar OAuth connect + sync
- Optional Microsoft calendar env vars (UI ready)
- Public booking at `/book/[orgSlug]/[linkSlug]`

### 7.9 Content calendar

- Brands, items, captures, plans
- Platforms: LinkedIn, X, Instagram, Reddit
- Workflow statuses through published
- AI: normalize capture, plan suggest, draft generate, graphics brief
- Capture duty reminders (hourly cron)

### 7.10 Fit Check

- Paste opportunity → RAG against fit knowledge libraries
- Verdict dimensions (`pursue` | `maybe` | `pass`), gaps, hooks
- Discussion messages on scans
- Profile-linked categories and libraries
- Storage: `organizations/{orgId}/opportunityScans`

### 7.11 Intent playbook and scoring

- Org-level intent playbook (signals, weights, qualification, opportunity routes)
- Lead quality scoring via `@nova/scoring`
- Strategy match for page text / personas / firmographics
- Extension AI evaluate path (`intent_radar_evaluate`)

### 7.12 Scripts, labels, profiles, channels

- Scripts library (call/email templates)
- CRM labels
- Outreach/ICP profiles (channels, fit-check categories, knowledge links)
- Channel admin: enable/disable channels, funnel stages, custom channels

### 7.13 Collaboration

- Team chat channels/DMs with unread tracking
- User notifications + optional alert sounds
- Activity counters/records and org activity feed
- Audit logs and audit analytics

### 7.14 Imports and exports

- Bulk prospect import (CSV/XLSX): preview → confirm → durable jobs/chunks
- Limits (as coded): max **10,000** rows / **20 MB**; chunk worker max **40** rows/chunk, **3** attempts
- Policies: `add_new` | `update_non_empty` | `replace`
- Export paths gated by export permissions
- Strategy pack import/export (Admin → Strategies)
- Instantly lead import/push helpers

### 7.15 Admin and platform

- Organization settings (timezone, send policy, …)
- People, invites, join links, provision login
- Hierarchy, departments/teams, roles, permissions
- AI & knowledge admin
- Intent playbook, buyer personas, strategies
- Scrapers, import console
- Platform: org CRUD, admins, migrate-existing-users

### 7.16 Marketing site

- Landing, features, pricing, about, contact
- Blog index/posts
- Privacy and terms

---

## 8. Application routes (UI)

### 8.1 Authenticated CRM (`(app)`)

| Path | Feature |
|------|---------|
| `/dashboard` | Ops overview |
| `/dashboard/reply-intelligence` | Reply AI analytics |
| `/dashboard/wall` | Fullscreen wall |
| `/leads`, `/leads/[id]` | Leads |
| `/prospects`, `/prospects/drafts`, `/prospects/drafts/[id]` | Prospects / drafts |
| `/my-strategy` | Strategy workbench |
| `/intake` | RSS intake pool |
| `/fit-check` | Opportunity fit |
| `/pipeline` | Kanban |
| `/accounts`, `/accounts/[id]` | Companies |
| `/contacts`, `/contacts/[id]` | Contacts |
| `/deals`, `/deals/[id]` | Deals |
| `/followups` | Followups |
| `/scheduling` | Scheduling hub |
| `/tasks` | Tasks |
| `/content`, `/content/[itemId]`, `/content/brands`, `/content/capture` | Content calendar |
| `/scripts` | Scripts |
| `/outreach`, `/outreach/[id]` | Instantly outreach |
| `/inbox` | Email inbox |
| `/notifications` | Notifications |
| `/team-chat` | Team chat |
| `/replies` | Inbound replies list |
| `/activity` | Activity / funnel diagnostics |
| `/settings` | User/settings |
| `/admin/*` | Admin hub (organization, people, hierarchy, permissions, roles, logs, departments, channels, profiles, AI, labels, intent playbook, strategies, buyer personas, import, scrapers) |

Redirects: `/admin/team` & `/admin/users` → `/admin/people`; `/admin/campaigns` → `/outreach`.

### 8.2 Auth (`(auth)`)

`/login`, `/signup`, `/forgot-password`, `/reset-password`, `/onboarding`, `/join/pending`, `/extension-login`

### 8.3 Marketing (`(marketing)`)

`/`, `/features`, `/pricing`, `/about`, `/contact`, `/blog`, `/blog/[slug]`, `/legal/privacy`, `/legal/terms`

### 8.4 Platform (`(platform)`)

`/platform`, `/platform/organizations`, `/platform/organizations/new`, `/platform/organizations/[orgId]`, `/platform/admins`

### 8.5 Other

| Path | Purpose |
|------|---------|
| `/book/[orgSlug]/[linkSlug]` | Public booking |
| `/auth` | Compat redirect to dashboard or login |

**Approximate page count:** 83 `page.tsx` routes.

---

## 9. API surface

**Approximate count:** 149 `route.ts` handlers under `src/app/api/`.

### 9.1 Groups

| Prefix | Responsibility |
|--------|----------------|
| `/api/auth/*` | Session, logout, me, onboarding, invite/join preview, password reset |
| `/api/ai/*` | Analysis, email reply, content AI, RAG, settings, usage, Fit Check |
| `/api/email/*` | Mailboxes, IMAP/SMTP, send, scheduled, bounce, reply-actions, capacity, tracking record |
| `/api/t/*` | Open/click tracking endpoints |
| `/api/cron/*` | Scrapers, scheduled emails, IMAP heads sync, content reminders |
| `/api/org/*` | Settings, members, invites, roles, scrapers, imports, audit, hierarchy repair, scripts, … |
| `/api/platform/*` | Tenant and operator management |
| `/api/integrations/*` | Lead webhook, Instantly, MillionVerifier |
| `/api/prospect-drafts/*` | Draft CRUD / complete |
| `/api/scheduling/*` | Availability, links, meetings, calendars, public book |
| `/api/extension/*` | Extension auth, bootstrap, drafts, findings, AI evaluate |

### 9.2 Selected long-running route limits

| Route | `maxDuration` |
|-------|---------------|
| `/api/cron/scrapers/run` | 300s |
| `/api/cron/scheduled-emails/send` | 300s |
| `/api/cron/inbox-imap/sync` | 300s |
| `/api/cron/content-capture-reminders` | 120s |
| `/api/org/scraper-feeds` | 300s |
| `/api/integrations/millionverifier/verify` | 300s |

Several import/admin pages set `dynamic = "force-dynamic"`.

---

## 10. Frontend architecture

### 10.1 App shell

`(app)/layout.tsx`:

- Verifies session
- Loads org membership / org settings (e.g. send policy)
- Mounts `WorkspaceModeProvider`, team-chat unread, inbox notifications, `DeferredAppSync`
- Sidebar + topbar + module route gate

### 10.2 Live workspace data

`useLiveWorkspaceFirestore`:

- Firestore `onSnapshot` queries filtered by `organizationId`
- Core ready gate requires snapshots for `users`, `leads`, `followups`
- Caps: activityRecords 200, orgActivityEvents 120, timelineEvents 400

**Route-scoped listener groups** (`workspace-listener-groups.ts`):

| Group | Collections | Attached when navigating to |
|-------|-------------|-----------------------------|
| `core` (always) | users, leads, followups, leadTasks, labels | App shell |
| `directory` | accounts, contacts, profiles | leads, prospects, inbox, accounts, contacts, deals, intake |
| `deals` | deals | dashboard, deals, pipeline, account/lead detail |
| `plans` | followupPlans | followups, leads, prospects, inbox, dashboard, scheduling |
| `timeline` | timelineEvents | dashboard, lead detail |
| `leadDetail` | notes, touchpoints | lead detail |
| `activity` | activityCounters, activityRecords, orgActivityEvents | dashboard, activity, admin profiles |
| `campaigns` | campaigns | dashboard, outreach, leads, prospects, admin campaigns |

Groups stick for the session once attached.

### 10.3 Workspace modes

`WorkspaceModeProvider` supports **live Firebase** vs **in-memory demo** mode (cookies for mode/persona). Demo uses dedicated Zustand stores for chat/notifications.

### 10.4 TanStack Query

Used selectively (not for core CRM entities):

- Scheduling bookable hosts / links / meetings
- Prospect drafts APIs
- Org members lists

Defaults (`query-provider.tsx`): `staleTime` 30s, `refetchOnWindowFocus` false, `retry` 1.

### 10.5 Zustand stores

| Store | Domain |
|-------|--------|
| `email-account-store` | Mailboxes, folders, flags, scheduled process-due helpers, view-as |
| `channel-admin-store` | Channel enablement (persisted) |
| Demo chat / notifications stores | Demo mode only |
| Inbox notification overrides | Local read/unread/dismiss overrides |

### 10.6 UI system

- shadcn **base-nova** style, neutral base color, CSS variables
- Geist fonts
- Lucide icons
- Recharts for analytics charts
- AI text surfaces use Streamdown / AI Elements components under `src/components/ai-elements`

### 10.7 Next config frontend-relevant settings

- `productionBrowserSourceMaps: true`
- `experimental.optimizePackageImports` for lucide-react, date-fns, recharts, react-table, base-ui
- Remote images: Google user content + Firebase Storage

---

## 11. Backend and server-side processing

### 11.1 Next.js Route Handlers

Primary server surface for:

- Auth session minting and org bootstrap
- Encrypted secret storage (email IMAP/SMTP, AI provider keys, integration secrets)
- IMAP/SMTP operations that must not expose credentials to the browser as plaintext
- Cron job bodies
- AI generation / RAG indexing
- Import job orchestration
- Platform and org admin mutations
- Extension auth and draft APIs

### 11.2 Firebase Admin SDK

Used for Firestore writes that bypass security rules, Auth user management (password reset complete, claims), and session cookies.

### 11.3 Cloud Functions (`functions/`)

Region default: **`us-central1`**. Global `maxInstances: 10`.

| Export | Trigger | Behavior |
|--------|---------|----------|
| `health` | HTTP | `{ ok, service: "relay-crm-functions" }` |
| `recomputePermissionsOnUserWrite` | Firestore `users/{userId}` write | Legacy merge role + overrides → `computedPermissions` (skips if modules already set) |
| `reconcileFollowupPlanOnFollowupWrite` | Firestore `followups/{followupId}` write | Complete/reactivate `followupPlans` when steps settle |
| `processProspectImportChunk` | Firestore `importJobChunks/{chunkId}` update | Claim queued chunks; create/update accounts/contacts/leads |
| `cleanupProspectImportTemporaryData` | Scheduled **every 60 minutes** | Delete expired import chunks/identity keys |
| `runDueScrapers` | Scheduled **every 15 minutes** | GET `{SITE_URL}/api/cron/scrapers/run` with `Authorization: Bearer CRON_SECRET` |
| `sendDueScheduledEmails` | Scheduled **every 5 minutes** | GET `/api/cron/scheduled-emails/send` |
| `syncInboxImapHeads` | Scheduled **every 5 minutes** (1 GiB memory) | GET `/api/cron/inbox-imap/sync` |
| `sendContentCaptureReminders` | Scheduled **every 1 hour** | GET `/api/cron/content-capture-reminders` |

**No Pub/Sub triggers** are defined in `functions/`.

### 11.4 Next.js `after()` usage

`/api/org/audit/track` uses `after` from `next/server` to record audit after the response is sent.

`waitUntil` is **not** used in the repository.

---

## 12. Background jobs, crons, events, and client sync

### 12.1 Server scheduled jobs (production path)

```
Firebase Cloud Scheduler (via firebase-functions onSchedule)
        │
        ▼
Cloud Function HTTP client
        │  Authorization: Bearer CRON_SECRET
        ▼
App Hosting Next.js route /api/cron/...
        │
        ▼
Business logic (Firestore Admin + IMAP/SMTP/RSS/AI as needed)
```

| Job | Interval | Endpoint |
|-----|----------|----------|
| Due RSS scrapers | 15 min | `/api/cron/scrapers/run` |
| Due scheduled emails | 5 min | `/api/cron/scheduled-emails/send` |
| IMAP inbox heads sync | 5 min | `/api/cron/inbox-imap/sync` |
| Content capture reminders | 1 hour | `/api/cron/content-capture-reminders` |
| Import temp cleanup | 60 min | Runs **inside** Cloud Function (no App Hosting hop) |

`vercel.json` crons are **empty**; production scheduling is Firebase → App Hosting, not Vercel Cron.

### 12.2 Firestore-triggered events (Cloud Functions)

| Event | Effect |
|-------|--------|
| User document write | Permission recompute (legacy path) |
| Followup write | Followup plan reconciliation |
| Import chunk update | Chunk processing worker |

### 12.3 Client-side background sync providers

Mounted via `DeferredAppSync` (idle-deferred) and related always-on providers:

| Provider | Cadence / trigger | Behavior |
|----------|-------------------|----------|
| `email-account-sync` | On auth / mount | Hydrate mailbox metadata from API |
| `inbox-background-sync` | Heads poll ~**180s**; on `/inbox` light IMAP ~**5 min** | Prefer cron-persisted heads; reduce IMAP load |
| `scheduled-email-send-sync` | **Dev only** ~**120s** | Calls `/api/email/scheduled/process-due` (prod uses CF cron) |
| `email-bounce-watcher` | Inbox row changes | Detect DSN/hard bounce → mark entities, create tasks |
| `followup-plan-reply-watcher` | Reply detection | Pause sequences, cancel scheduled mail, stamp reply fields |
| `followup-due-notification-sync` | Due followups | Idempotent daily `userNotifications` |
| `lead-response-time-sync` | Lead/email context | Backfill `responseTimeMinutes` |
| `channel-admin-sync` | Org channelAdmin | Sync to zustand |
| `activity-audit-tracker` | Navigation | POST page-view audits |
| `platform-notifications-alert-sync` | New unread notifications | Optional chime |
| `global-error-listener` | `window` errors | POST error logs |
| Auth session sync | Auth state | Keep session cookie aligned |

### 12.4 Real-time client subscriptions (non-cron)

- Workspace CRM collections via listener groups
- `userNotifications` shared provider
- Team chat channels/messages/reads for unread

### 12.5 Tracking and inbound webhooks (event ingress)

| Ingress | Endpoint | Effect |
|---------|----------|--------|
| Email open pixel | `GET /api/t/o/[token]` | Record open |
| Email click | `GET /api/t/c/[token]` | Record click + redirect |
| Website lead webhook | `POST /api/integrations/webhook/lead` | Write `ingestQueue` (Admin SDK) |
| Instantly webhook | `POST /api/integrations/webhook/instantly` | Campaign/reply sync handling |

---

## 13. Email subsystem

### 13.1 Components

| Component | Implementation |
|-----------|----------------|
| Per-user / assigned mailboxes | Profiles + encrypted secrets (`EMAIL_SECRETS_KEY_BASE64`) |
| IMAP | `imapflow` — fetch headers/bodies/attachments, mutate flags/folders, append sent |
| SMTP | `nodemailer` — outbound send, scheduled send |
| Gmail | OAuth XOAUTH2 (`/api/email/oauth/google`) |
| System transactional mail | `SYSTEM_SMTP_*` via nodemailer **or** Resend API |
| Org send policy | Weekly windows, weekday-only flag, optional daily ceiling (`org-send-policy.ts`) |
| Capacity / utilization | Mailbox schedule capacity + org `sendLedger` |
| Tracking | HMAC tokens; optional dedicated `MAIL_TRACKING_BASE_URL` |
| Delegations | Mailbox view-as / send-as |

### 13.2 Dual sync design

1. **Server cron** persists inbound heads to Firestore for all connected mailboxes.
2. **Client** hydrates from those heads periodically; performs deeper IMAP only while the user is on `/inbox`.

This reduces concurrent IMAP connections from every open browser tab.

### 13.3 Scheduled outbound mail

- Documents in `scheduledEmails` (collection + collection-group indexes on status + `scheduledAt`)
- Processed by cron every 5 minutes in production
- Dev browser poller available for local testing without Cloud Functions

---

## 14. AI subsystem

### 14.1 Stack

- **Vercel AI SDK** (`ai` ^6) with provider packages for OpenAI, Anthropic, Google
- Per-organization API keys stored encrypted in `aiProviderSecrets`
- Usage tracked in `aiUsageDaily` / `aiUsageEvents`
- Prompts configurable via `aiPrompts` / admin UI
- RAG: libraries, documents, chunk embeddings (1536-dim vector index), fit-knowledge seeding

### 14.2 Default models (`provider-router.ts`)

| Provider | Default chat model |
|----------|--------------------|
| OpenAI | `gpt-4o-mini` |
| Anthropic | `claude-3-5-haiku-20241022` |
| Google | `gemini-2.0-flash` |

Embeddings default: OpenAI `text-embedding-3-small` (as used in AI types/settings).

### 14.3 Feature keys

`dashboard_brief`, `lead_analyze`, `intent_suggest`, `followup_suggest`, `email_reply`, `email_reply_classify`, `prospect_draft_extract`, `opportunity_fit`, `opportunity_fit_discuss`, `intent_radar_evaluate`, `content_capture_normalize`, `content_plan_suggest`, `content_draft_generate`, `content_graphics_brief`, `rag_index`

### 14.4 Knowledge scoping

Libraries can be scoped by org/channel/profile/campaign/content brand and surfaces such as `content`, `outreach`, `fit_check`, `intent_radar`, `lead_ai`.

---

## 15. Browser extension (Intent Radar)

| Item | Detail |
|------|--------|
| Package | `@nova/intent-radar-extension` |
| Form factor | Chrome/Edge Manifest V3 side panel |
| Build | Vite + `@crxjs/vite-plugin` |
| Shared logic | `@nova/scoring` |
| Auth | Extension ID allowlist (`NOVA_EXTENSION_IDS` / `NOVA_EXTENSION_DEV_IDS`); PKCE/session against Nova APIs — Firebase credentials not bundled |
| Production extension id (App Hosting env) | `kiggclhehjjlembdafbpkjeindbhbemk` |
| Capabilities | Scan visible page text against assigned strategies; selection capture; create/complete prospect drafts; AI evaluate; findings |
| API | `/api/extension/access`, `bootstrap`, `auth/*`, `drafts`, `findings`, `ai-evaluate` |
| Pack artifact | `packs/nova-intent-radar-v0.1.0-live.zip` |

---

## 16. Integrations

| Integration | Purpose | Auth / secret |
|-------------|---------|---------------|
| Instantly | Cold email campaigns, webhooks, sync | Org `integrationSecrets` / `instantlyWebhookSecret`; env fallback `INSTANTLY_WEBHOOK_SECRET` |
| MillionVerifier | Batch email verification | Org connection + API key |
| Google Calendar | Availability busy times / event sync | OAuth client id/secret |
| Google Mail | Workspace mailbox XOAUTH2 | Same or `GOOGLE_MAIL_*` overrides |
| Microsoft Calendar | Optional Outlook/365 (env present) | `MICROSOFT_CALENDAR_*` |
| Inbound lead webhook | Website → `ingestQueue` | Per-org `inboundWebhookSecret` + legacy `INBOUND_WEBHOOK_SECRET` |
| Resend | Optional system email | `RESEND_API_KEY` / `RESEND_FROM` |
| RSS.app-style feeds | Social/content intake | Feed URLs in `scraperFeeds` |

---

## 17. Security model

| Control | Implementation |
|---------|----------------|
| Transport | HTTPS at hosting edge |
| Session | httpOnly `__session` cookie; Admin-verified Firebase session cookie |
| Edge gate | `proxy.ts` presence check of cookie on protected prefixes |
| Tenant isolation | Firestore rules: `organizationId` must match caller claims/user doc; org status trial/active; membership active |
| Client write denylist | Scheduling, scrapers, imports, secrets, extension auth, mail tracking, org membership writes, etc. denied to clients |
| Secrets at rest | Base64 encryption keys for email and AI secrets |
| Invite tokens | Packed token; only SHA-256 of secret stored; 7-day TTL |
| Cron | Bearer `CRON_SECRET` |
| Extension | Fixed extension ID allowlist |
| Tracking tokens | HMAC (`MAIL_TRACKING_SECRET` or email secrets key fallback) |
| Platform admin | Env bootstrap + Firestore registry |
| Audit | Org subcollection audit + CRM `auditLog` / activity APIs |
| Source maps | Enabled in production builds (`productionBrowserSourceMaps`) |

---

## 18. Scaling and performance characteristics

This section lists **observable configuration and code patterns** that affect scale and performance. It does not include load-test results (none are checked into the repo).

### 18.1 Compute scaling

| Component | Limits / knobs |
|-----------|----------------|
| App Hosting | 1–3 instances, concurrency 80, 1 vCPU, 1 GiB RAM; minInstances 1 keeps warm capacity |
| Cloud Functions | Global maxInstances 10; IMAP sync function allocated 1 GiB |
| Cron route timeouts | Up to 300 seconds on heavy jobs |
| Import worker | 40 rows per chunk, 3 attempts; hourly cleanup of temporary data |

### 18.2 Data plane scaling patterns

| Pattern | Detail |
|---------|--------|
| Tenant partition key | `organizationId` on all tenant CRM docs |
| Hierarchy queries | Denormalized manager id arrays + composite indexes |
| Listener fan-out control | Route-based listener groups; sticky once loaded |
| Snapshot caps | Hard caps on high-volume activity/timeline listeners |
| Import durability | Chunked jobs in Firestore processed by Functions |
| RAG | Vector index dim 1536 on chunk embeddings |

### 18.3 Email scaling patterns

| Pattern | Detail |
|---------|--------|
| Shared head sync | Server cron writes heads; clients poll instead of continuous IMAP |
| Inbox-gated IMAP | Fuller IMAP activity when user is on `/inbox` |
| Org send policy | Windows + optional daily ceiling via `sendLedger` |
| Mailbox utilization APIs | Capacity visibility for operators |

### 18.4 Frontend performance patterns

| Pattern | Detail |
|---------|--------|
| Package import optimization | lucide-react, date-fns, recharts, react-table, base-ui |
| Deferred background work | Idle-deferred provider mount |
| Sparse React Query | Avoids double-fetching live Firestore entities |
| Externalized email CJS | Avoids Turbopack bundling failures / large server bundles for IMAP/SMTP |

### 18.5 Multi-tenant SaaS scaling notes (factual from design)

- Seat caps enforced server-side when `maxUsers` set
- Plan field is metadata only (no metering/billing pipeline in code)
- One org per user in v1 (simplifies query scoping; no cross-org membership)
- Platform operators manage tenants centrally

### 18.6 Potential hotspots implied by architecture (for evaluators to test)

These are architectural concentration points visible from design (not measured SLOs):

1. Firestore read fan-out as listener groups accumulate during a long session  
2. IMAP provider rate limits under many mailboxes × 5-minute cron  
3. Scheduled email burst processing every 5 minutes within 300s timeout  
4. AI / RAG indexing cost and latency under concurrent Fit Check / content / reply jobs  
5. App Hosting maxInstances = 3 under concurrent cron + interactive traffic  
6. Import of near-limit 10k-row files through chunk workers  

---

## 19. Deployment and operations

### 19.1 Application host

- Firebase App Hosting backend rooted at `crm/`
- Env baked/available via `apphosting.yaml` + console secrets (`CRON_SECRET`, Firebase Admin, etc.)

### 19.2 Firebase deploy scripts (root `package.json`)

| Script | Action |
|--------|--------|
| `firebase:deploy:rules` | Firestore rules |
| `firebase:deploy:indexes` | Firestore indexes |
| `firebase:deploy:firestore` | Rules + indexes |
| `firebase:deploy:functions` | Cloud Functions |
| `firebase:deploy` | Rules + functions |

### 19.3 Local development

| Command | Purpose |
|---------|---------|
| `npm run dev` | Next.js Turbopack dev server |
| `npm run dev:webpack` | Webpack fallback |
| `npm run build` / `start` | Production build/serve |
| `npm run test` | Vitest |
| `npm run test:prospect-drafts:emulator` | Emulator-backed draft tests |
| `npm run dev:import-local` | Functions build + emulator import worker path |
| `npm run extension:dev` / `extension:build` | Extension |

### 19.4 Emulators

`firebase.emulator-test.json` used for Firestore/Functions emulator test scripts.

---

## 20. Testing

| Layer | Tooling |
|-------|---------|
| Unit / integration | Vitest (`vitest.config.ts`) |
| Examples in tree | Email policy/timing, content calendar, org timezone, workspace listeners, prospect drafts emulator, import activity, Functions import worker tests |
| Rules | `@firebase/rules-unit-testing` available |
| Lint | ESLint + `eslint-config-next` |

---

## 21. Environment configuration

Documented in `.env.example` (names only):

### Required for full production behavior

| Variable group | Purpose |
|----------------|---------|
| `NEXT_PUBLIC_FIREBASE_*` | Client Firebase |
| `FIREBASE_ADMIN_*` | Server Admin SDK |
| `SITE_URL` / `NEXT_PUBLIC_SITE_URL` | Absolute origin (OAuth, invites, cron target) |
| `CRON_SECRET` | Cron auth (App Hosting + Functions) |
| `EMAIL_SECRETS_KEY_BASE64` | Mailbox secret encryption (referenced in code; generate alongside AI key) |
| `AI_SECRETS_KEY_BASE64` | AI key encryption |

### Optional / feature-specific

| Variable group | Purpose |
|----------------|---------|
| `SYSTEM_SMTP_*` or `RESEND_*` | Transactional mail |
| `MAIL_TRACKING_*` | Tracking origin/HMAC |
| `NOVA_EXTENSION_*` | Extension allowlists |
| `GOOGLE_CALENDAR_*` / `GOOGLE_MAIL_*` / `MICROSOFT_CALENDAR_*` | Calendar/mail OAuth |
| `INBOUND_WEBHOOK_SECRET` | Legacy webhook |
| `INSTANTLY_WEBHOOK_SECRET` | Instantly fallback |
| `PLATFORM_ADMIN_EMAILS` | Bootstrap operators |
| `DISABLE_AUTH` / `NEXT_PUBLIC_AUTH_DISABLED` | Local UI-only mode |

---

## 22. Known documented gaps

From `docs/SAAS-ARCHITECTURE.md` (may lag current feature completeness; listed here as published product notes):

- **`planId` is descriptive only** — no Stripe/billing integration
- **Owner UID transfer** after initial assignment is not a product flow
- **No email-verification gate** beyond Firebase defaults before org attachment
- Historical note in that doc about some list pages / mock data may be outdated relative to live Firestore listeners now present in the app shell — evaluators should verify against current routes rather than that gap list alone

---

## Appendix A — Dependency inventory (root `package.json`)

### Runtime dependencies

`@ai-sdk/anthropic`, `@ai-sdk/google`, `@ai-sdk/openai`, `@base-ui/react`, `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`, `@hookform/resolvers`, `@nova/scoring`, `@radix-ui/react-label`, `@radix-ui/react-slot`, `@streamdown/cjk`, `@streamdown/code`, `@streamdown/math`, `@streamdown/mermaid`, `@tanstack/react-query`, `@tanstack/react-query-devtools`, `@tanstack/react-table`, `@types/papaparse`, `ai`, `class-variance-authority`, `clsx`, `cmdk`, `date-fns`, `exceljs`, `firebase`, `firebase-admin`, `geist`, `imapflow`, `lucide-react`, `mailparser`, `next`, `next-themes`, `nodemailer`, `papaparse`, `react`, `react-day-picker`, `react-dom`, `react-hook-form`, `recharts`, `rss-parser`, `shadcn`, `sonner`, `streamdown`, `tailwind-merge`, `tw-animate-css`, `zod`, `zustand`

### Dev dependencies

`@emnapi/core`, `@emnapi/runtime`, `@firebase/rules-unit-testing`, `@tailwindcss/postcss`, `@types/mailparser`, `@types/node`, `@types/nodemailer`, `@types/react`, `@types/react-dom`, `eslint`, `eslint-config-next`, `firebase-tools`, `tailwindcss`, `typescript`, `vitest`

### Overrides

`postcss`, `uuid`, `@emnapi/core`, `@emnapi/runtime`

---

## Appendix B — Strategy packs

| Asset | Purpose |
|-------|---------|
| `packs/template.empty.json` | Empty pack shape |
| `packs/sample-b2b-saas.json` | Sample B2B SaaS pack (also installable from Admin UI) |
| `packs/private/*.json` | Tenant-specific ICPs (intended private; may be gitignored) |
| `scripts/export-strategy-packs.ts` | Pack regeneration helper |

Pack contents: buyer personas + prospecting strategies (signals, checklists, daily targets).

---

## Appendix C — Navigation module map

Sidebar sections (`src/lib/nav.ts`) expose:

**Workspace:** Dashboard, Reply intelligence, Leads, Prospects, My Strategy, Intake pool, Fit Check, Pipeline, Companies, Contacts, Deals, Followups, Scheduling, Tasks, Content, Scripts, Email outreach, Inbox, Notifications, Team chat  

**Configuration clusters:** Organization & access, Access & channels, Programs & data, Personal — each item gated by workspace role and/or `featureGrants`.

---

*End of document. For operator SaaS tenancy detail (claims refresh, invite packing, seat bump semantics), see also `docs/SAAS-ARCHITECTURE.md`.*
