# Nova CRM — Single VPS setup guide (Ubuntu + Docker)

**Audience:** Non-technical operators (follow numbered steps) and technical operators (see appendices).  
**Goal:** Run Nova CRM on **one Ubuntu VPS** so login, CRM, dashboards, background jobs, email, AI, and integrations all work on Clerk + Postgres + Redis. Firebase is not used.  
**Related:** [README.md](../README.md) · [ENVIRONMENTS.md](ENVIRONMENTS.md) · [NOVA-CRM-ENGINEERING-RULES.md](../Architecture%20fixes%20plan/NOVA-CRM-ENGINEERING-RULES.md) · [NOVA-CRM-P4-QUEUE-WORKER.md](../Architecture%20fixes%20plan/NOVA-CRM-P4-QUEUE-WORKER.md)

---

## 0. Read this first

The production stack is one mode: **Clerk + PostgreSQL (pgvector, RLS) + Redis + web + worker + migrate + cron + Caddy**.

Core CRM (login, accounts/contacts/leads/deals, dashboards, org members, chat, notifications) works once Clerk + Postgres + Redis are up. Email, scrapers, calendar, and AI need extra API keys — they still store data in Postgres, not a second database.

Recommended VPS (example): **Ubuntu 24.04 LTS**, ~**18 GB RAM**, **8 CPU**, **240 GB SSD**, public IP + domain. Do **not** use Windows Server.

---

## 1. What will run on the VPS

```text
Internet
   │
   ▼
Caddy (HTTPS)  →  app.yourdomain.com  →  web (Next.js :3000)
                                      →  t.yourdomain.com (optional mail tracking) → same web

Inside Docker (private network):
   web      — UI + API + SSE realtime
   worker   — BullMQ jobs (IMAP, scheduled email, imports, scrapers, reminders, dashboard refresh)
   postgres — CRM + workspace + email + embeddings (RLS + pgvector)
   redis    — cache + job queue + pub/sub
   cron     — dispatches /api/cron/queue/dispatch
   migrate  — one-shot Prisma migrate (run before first start)
```

| Container | Image / file | Port (internal) | Health check |
|-----------|--------------|-----------------|--------------|
| Web | `Dockerfile` | 3000 | `GET /api/health` |
| Worker | `Dockerfile.worker` | 8081 | `GET /healthz` |
| Migrate | `Dockerfile.migrate` | — | one-shot |
| Cron | `alpine:3.20` | — | dispatches every minute |
| Postgres | `pgvector/pgvector:pg16` | 5432 | `pg_isready` |
| Redis | `redis:7-alpine` | 6379 | `PING` |
| Caddy | `caddy:2-alpine` | 80 / 443 | HTTPS |

**Rule:** Never publish Postgres or Redis to the public internet. Only 80/443 (and SSH) on the firewall.

---

## 2. Shopping list (accounts & domain)

Do these before or during setup. Non-technical: create accounts; technical: note API keys.

| # | Item | Required for | Where to get it |
|---|------|--------------|-----------------|
| 1 | VPS with Ubuntu 24.04 | Everything | Your host (Hetzner, DigitalOcean, Contabo, etc.) |
| 2 | Domain + DNS `A` record → VPS IP | HTTPS, login redirects | Your registrar |
| 3 | Clerk application | Login / signup | https://dashboard.clerk.com |
| 4 | Strong passwords for Postgres + Redis | Database security | Password manager |
| 5 | Resend **or** SMTP for system emails | Invites / resets | Resend or any SMTP |
| 6 | Google Cloud OAuth (recommended) | Gmail + Google Calendar | Google Cloud Console |
| 7 | AI API keys (optional) | Fit-check, RAG, drafts | OpenAI / Anthropic / Google |
| 8 | MillionVerifier / Instantly (optional) | Verify + cold outreach sync | Their dashboards |

---

## 3. Non-technical checklist (print this)

- [ ] VPS created, you can open a terminal (SSH) or your host’s web console
- [ ] Domain points to the VPS IP (wait up to 30–60 minutes for DNS)
- [ ] Clerk keys copied
- [ ] Optional keys chosen (SMTP/Resend, Google OAuth, AI) if you need those features
- [ ] Someone technical (or you, following §5–§12) installs Docker and starts the app
- [ ] You can open `https://app.yourdomain.com/sign-in` and log in
- [ ] Health pages OK (§11)
- [ ] Backups scheduled (§12)

---

## 4. Architecture in plain language

1. **Users** open the website (web).
2. **Clerk** checks who they are.
3. **Postgres** stores CRM, workspace, email, and AI data with per-organization security (RLS). Embeddings use **pgvector**.
4. **Redis** remembers short-lived cache, holds a **job list**, and fans out chat/notification events.
5. The **worker** is a separate program that does slow work (send emails, sync inboxes, imports) so the website stays fast.
6. A **timer (cron)** wakes the app every minute: “please queue the next batch of emails / inbox sync.” The worker then does the work.

You always run **two app programs** (web + worker), not one.

---

## 5. Prepare the Ubuntu server

Connect with SSH (replace user/IP):

```bash
ssh deploy@YOUR_VPS_IP
```

### 5.1 Update the system

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y ca-certificates curl git ufw
```

### 5.2 Firewall (important)

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

### 5.3 Install Docker (official)

Follow Docker’s current Ubuntu install docs, or:

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
```

Log out and SSH back in, then verify:

```bash
docker version
docker compose version
```

### 5.4 App folder

```bash
sudo mkdir -p /opt/nova-crm
sudo chown $USER:$USER /opt/nova-crm
cd /opt/nova-crm
git clone YOUR_REPO_URL .
# or upload a release zip / use CI to deploy images
```

---

## 6. Production Compose file

Use the repo file **[`docker-compose.prod.yml`](../docker-compose.prod.yml)** (do not invent a second overlay). It starts postgres, redis, web, worker, cron, and Caddy. Local `docker-compose.yml` is for development passwords only.

Harden secrets in a root `.env` next to the compose file (never commit real values):

```bash
POSTGRES_PASSWORD=...
POSTGRES_USER=nova
POSTGRES_DB=nova_crm
NOVA_APP_PASSWORD=...
DATABASE_URL=postgres://nova_app:...@postgres:5432/nova_crm
MIGRATE_DATABASE_URL=postgres://nova:...@postgres:5432/nova_crm
CRON_SECRET=...
SITE_DOMAIN=app.yourdomain.com
```

**App role password:** Prisma migration `20260811093000_nova_app_role` creates `nova_app`. The **`migrate`** container then runs `ALTER ROLE nova_app WITH PASSWORD` using `NOVA_APP_PASSWORD` from `.env.production`. Set a strong value; `DATABASE_URL` must use the same password. Always run **`migrate` before `up -d`** on first deploy and after password rotation.

`DATABASE_URL` must use role **`nova_app`**. Migrations use **`nova`** via `MIGRATE_DATABASE_URL`.

---

## 7. Caddyfile (HTTPS)

Repo default is [`docker/caddy/Caddyfile`](../docker/caddy/Caddyfile). Set `SITE_DOMAIN` (compose interpolates `{$SITE_DOMAIN:localhost}`). For Let’s Encrypt on a public VPS, use a host-based Caddyfile such as:

```caddy
app.yourdomain.com {
  reverse_proxy web:3000
}

# Optional dedicated tracking host (open/click rates)
t.yourdomain.com {
  reverse_proxy web:3000
}
```

Replace hostnames. Caddy obtains Let’s Encrypt certificates automatically when DNS points here and ports 80/443 are open.

---

## 8. Environment file (`.env.production`)

Create `/opt/nova-crm/.env.production` with `chmod 600`. Never commit this file. Start from [`.env.production.example`](../.env.production.example); full variable reference: [`.env.example`](../.env.example).

### 8.1 Required

```bash
# Public URLs
NEXT_PUBLIC_SITE_URL=https://app.yourdomain.com
SITE_URL=https://app.yourdomain.com
NEXT_PUBLIC_SITE_NAME=Nova CRM

# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_...
CLERK_SECRET_KEY=sk_live_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up

# Platform operators (comma-separated)
PLATFORM_ADMIN_EMAILS=you@yourcompany.com

# Cron / queue
CRON_SECRET=generate-a-long-random-string
QUEUE_WORKER_V1=true
QUEUE_IMPORT_CHUNKS_V1=true
QUEUE_HEAVY_JOBS_V1=true

# System email (pick one)
RESEND_API_KEY=re_...
RESEND_FROM="Nova CRM <noreply@yourdomain.com>"
# OR SYSTEM_SMTP_* from .env.example

# Encrypt mailbox / AI / integration secrets at rest (32 random bytes, base64)
EMAIL_SECRETS_KEY_BASE64=...
AI_SECRETS_KEY_BASE64=...

# Open / click tracking
MAIL_TRACKING_BASE_URL=https://t.yourdomain.com
MAIL_TRACKING_SECRET=...

# Google mail + calendar (redirect URIs must match SITE_URL)
GOOGLE_CALENDAR_CLIENT_ID=...
GOOGLE_CALENDAR_CLIENT_SECRET=...
# Optional mail-only overrides: GOOGLE_MAIL_CLIENT_ID / GOOGLE_MAIL_CLIENT_SECRET

# Optional
# MICROSOFT_CALENDAR_CLIENT_ID=
# MICROSOFT_CALENDAR_CLIENT_SECRET=
# INSTANTLY_WEBHOOK_SECRET=
# INBOUND_WEBHOOK_SECRET=
# NOVA_EXTENSION_IDS=
```

Postgres + Clerk are always on. Do not add Firebase env vars.

Clerk dashboard: set allowed origins / redirect URLs to `https://app.yourdomain.com`.  
Google Cloud: enable Calendar API + Gmail scopes; add redirect  
`https://app.yourdomain.com/api/email/oauth/google` and  
`https://app.yourdomain.com/api/scheduling/oauth/google`.

---

## 9. First start

```bash
cd /opt/nova-crm

# Apply database migrations + sync nova_app password (Dockerfile.migrate)
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm migrate

# Build and start web, worker, cron, Caddy
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

`DATABASE_URL` must match `NOVA_APP_PASSWORD` after migrate completes.

Ensure org/member rows exist in Postgres and Clerk user emails match `members.email` (or `externalId` = Nova uid). Without that, login succeeds at Clerk but workspace identity fails.

---

## 10. Cron jobs

`docker-compose.prod.yml` includes a **cron sidecar** that calls `POST /api/cron/queue/dispatch` every minute (see [`docker/cron/crontab`](../docker/cron/crontab)). That is the default production path. Host crontab below is optional if you are not using the sidecar.

Create `/opt/nova-crm/scripts/cron-dispatch.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=/dev/null
source /opt/nova-crm/.cron.env   # contains CRON_SECRET and APP_URL only
JOB="$1"
curl -fsS -X POST \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  -H "Content-Type: application/json" \
  -d "{\"job\":\"${JOB}\"}" \
  "${APP_URL}/api/cron/queue/dispatch"
```

`/opt/nova-crm/.cron.env` (`chmod 600`):

```bash
CRON_SECRET=same-as-env-production
APP_URL=https://app.yourdomain.com
```

```bash
chmod +x /opt/nova-crm/scripts/cron-dispatch.sh
crontab -e
```

Add (UTC; adjust if needed):

```cron
*/5 * * * * /opt/nova-crm/scripts/cron-dispatch.sh imap-sync
2-59/5 * * * * /opt/nova-crm/scripts/cron-dispatch.sh scheduled-email
7-59/15 * * * * /opt/nova-crm/scripts/cron-dispatch.sh scrapers
0 * * * * /opt/nova-crm/scripts/cron-dispatch.sh content-reminders
* * * * * /opt/nova-crm/scripts/cron-dispatch.sh dashboard-summary
```

Requires `QUEUE_WORKER_V1` + `QUEUE_HEAVY_JOBS_V1` and a **running worker**.

| Job | Feature |
|-----|---------|
| `imap-sync` | Inbox heads sync |
| `scheduled-email` | Bulk / scheduled outbound sends |
| `scrapers` | RSS / scraper runs |
| `content-reminders` | Content capture reminders |
| `dashboard-summary` | KPI summary refresh |

Imports use BullMQ when `QUEUE_IMPORT_CHUNKS_V1` is on (enqueued from the app, not this cron list).

---

## 11. Verify everything works

| Check | How | Expect |
|-------|-----|--------|
| Website | Browser → `https://app.yourdomain.com` | Login page / marketing |
| Web health | `curl -fsS https://app.yourdomain.com/api/health` | `{"ok":true,...}` |
| Worker health | `docker compose -f docker-compose.prod.yml exec worker wget -qO- http://127.0.0.1:8081/healthz` | OK |
| Login | `/sign-in` with Clerk user mapped to a Postgres member | Dashboard loads |
| CRM | Create/list a lead | Persists |
| Queue | `docker compose … logs -f worker` after a cron tick | Jobs processed |
| Chat / notifications | Team chat + bell | Live via SSE |
| Email | Connect mailbox in Settings → Email; wait for imap-sync | Inbox updates |
| Tracking | Send tracked mail; open pixel hits `MAIL_TRACKING_BASE_URL` | Open recorded |
| AI | Admin → AI & knowledge (needs provider keys) | Retrieve / generate works |

---

## 12. Backups (do not skip)

Provider “every 2 weeks” is not enough for a CRM.

Daily dump example:

```bash
mkdir -p /var/backups/nova
# cron daily:
docker compose -f /opt/nova-crm/docker-compose.prod.yml exec -T postgres \
  pg_dump -U nova nova_crm | gzip > /var/backups/nova/nova_crm-$(date +%F).sql.gz
```

Copy backups **off the VPS** (S3, Backblaze, another machine). Test restore once on a scratch database.

Also back up `.env.production` in a password manager / secrets vault (not in git).

---

## 13. Day-2 operations

| Task | Command / action |
|------|------------------|
| View logs | `docker compose -f docker-compose.prod.yml logs -f web worker` |
| Restart | `docker compose -f docker-compose.prod.yml restart web worker` |
| Update app | `git pull` → `docker compose … up -d --build` → migrate if needed |
| Disk / RAM | `df -h`, `docker stats` |
| Staging | **Separate** VPS + DB + secrets ([ENVIRONMENTS.md](ENVIRONMENTS.md)) |

Engineering rules: no hand edits on prod for “quick fixes”; deploy the same Docker images; migrations via Prisma only.

---

## 14. Feature map (what needs what)

All features store data in **Postgres**. Extra keys only enable the integration.

| Feature | Needs |
|---------|--------|
| Clerk login / signup | Clerk keys |
| Accounts, contacts, leads, deals | Postgres + `POST /api/org/crm-write` |
| Dashboard KPIs | Redis + dashboard cron |
| Platform admin | `PLATFORM_ADMIN_EMAILS` |
| Team chat / notifications | Redis + SSE `/api/realtime/stream` |
| Prospect imports (queue) | Worker + `QUEUE_IMPORT_CHUNKS_V1` |
| Scheduled / bulk email | Worker + scheduled-email cron + mailbox SMTP |
| IMAP inbox sync | Worker + imap-sync cron |
| Open / click rates | `MAIL_TRACKING_*` + HTTPS |
| Email verifier (MillionVerifier) | Org connection / API; outbound HTTPS |
| Instantly campaigns | Org Instantly secret + webhook |
| Scrapers | Scrapers cron + worker |
| AI / RAG knowledge | `pgvector` (`ai_document_embeddings`) + AI keys |
| Google/Microsoft calendar | OAuth clients |
| System invites email | Resend or `SYSTEM_SMTP_*` |

---

## 15. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Site won’t load HTTPS | DNS / firewall / Caddy | Check `A` record, `ufw`, `docker logs caddy` |
| 401 on cron | Wrong/missing `CRON_SECRET` | Match `.cron.env` and `.env.production` |
| Jobs never run | Worker down or queue flags off | Start worker; set all three `QUEUE_*_V1` |
| Login but empty workspace | No Postgres member for Clerk email | Insert/sync member; match email / externalId |
| Email features empty | Missing mailbox secrets / worker / cron | Connect mailbox; confirm worker + cron |
| DB connection errors | Wrong role/password | App = `nova_app`; migrate = `nova` |
| Redis auth errors | Password mismatch | Align `REDIS_URL` and Redis `requirepass` |
| Outbound mail fails | Provider blocks VPS IP | Use reputable SMTP/ESP; check blacklists |

---

## Appendix A — RAM guide (~18 GB box)

| Service | Suggest |
|---------|---------|
| Postgres | 6–8 GB |
| Redis | ~1 GB |
| Web | 2–3 GB |
| Worker | 2–4 GB |
| OS + Caddy + headroom | ~3 GB |

---

## Appendix B — BullMQ queues (technical)

See [NOVA-CRM-P4-QUEUE-WORKER.md](../Architecture%20fixes%20plan/NOVA-CRM-P4-QUEUE-WORKER.md).

| Queue | Purpose |
|-------|---------|
| `nova-import-chunks` | Prospect import chunks |
| `nova-imap-sync` | IMAP |
| `nova-scheduled-email` | Due sends |
| `nova-scrapers` | Scrapers |
| `nova-content-reminders` | Content reminders |
| `nova-dashboard-summary` | KPI drain |
| `nova-hello` | Smoke test |

AI/RAG embeddings live in Postgres `ai_document_embeddings` (`pgvector`). Generate/retrieve currently runs on the web tier.

---

## Appendix C — Security checklist

- [ ] SSH keys only; disable password root login
- [ ] UFW: 22, 80, 443 only
- [ ] Strong unique Postgres/Redis/Clerk/cron secrets
- [ ] `.env.production` mode `600`, not in git
- [ ] Postgres/Redis not published publicly
- [ ] Staging never uses production DB credentials
- [ ] `DISABLE_AUTH` / `NEXT_PUBLIC_AUTH_DISABLED` **never** in production

---

## Appendix D — Related docs

| Doc | Why |
|-----|-----|
| [README.md](../README.md) | Local quick start and architecture |
| [ENVIRONMENTS.md](ENVIRONMENTS.md) | Local / staging / prod separation |
| [NOVA-CRM-ENGINEERING-RULES.md](../Architecture%20fixes%20plan/NOVA-CRM-ENGINEERING-RULES.md) | Binding architecture |
| [NOVA-CRM-P4-QUEUE-WORKER.md](../Architecture%20fixes%20plan/NOVA-CRM-P4-QUEUE-WORKER.md) | Queue details |
| [NOVA-CRM-P5-AUTH-CLERK.md](../Architecture%20fixes%20plan/NOVA-CRM-P5-AUTH-CLERK.md) | Clerk |
| [NOVA-CRM-P6-DECOMMISSION-FIREBASE.md](../Architecture%20fixes%20plan/NOVA-CRM-P6-DECOMMISSION-FIREBASE.md) | Historical CRM Postgres cutover (Phase 7 complete) |
| [`.env.example`](../.env.example) | Full variable reference |

---

*Document version: 2026-08-19. Stack: Clerk + Postgres + Redis + web + worker. No Firebase.*
