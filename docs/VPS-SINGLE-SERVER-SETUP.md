# Nova CRM — Single VPS setup guide (Ubuntu + Docker)

**Audience:** Non-technical operators (follow numbered steps) and technical operators (see appendices).  
**Goal:** Run Nova CRM on **one Ubuntu VPS** so login, CRM, dashboards, background jobs, and (optionally) email / AI / integrations all work.  
**Related:** [README.md](../README.md) · [ENVIRONMENTS.md](ENVIRONMENTS.md) · [NOVA-CRM-ENGINEERING-RULES.md](../Architecture%20fixes%20plan/NOVA-CRM-ENGINEERING-RULES.md) · [NOVA-CRM-P4-QUEUE-WORKER.md](../Architecture%20fixes%20plan/NOVA-CRM-P4-QUEUE-WORKER.md)

---

## 0. Read this first (two “full” modes)

Nova has two realistic production modes on a VPS. Pick one before you buy accounts or fill secrets.

| Mode | What you get | What you need |
|------|----------------|---------------|
| **A — Core CRM (Firebase off)** | Clerk login, accounts/contacts/leads/deals, dashboard KPIs, org members, platform admin, BullMQ worker for jobs that don’t need Firestore | Clerk + Postgres + Redis + web + worker |
| **B — Full product (Firebase residual on)** | Everything in A **plus** inbox/IMAP, scheduled/bulk email, open/click tracking, scrapers, content calendar, prospect drafts, team chat, notifications, AI knowledge/RAG (Firestore vectors), Instantly, MillionVerifier, calendar connections | Mode A **plus** Firebase project + Admin credentials + encryption keys + OAuth + mail/AI API keys |

> **Honest note:** With Firebase turned **off**, email, scrapers UI, chat, RAG, and several admin features are **unavailable** until those domains finish migrating off Firestore (see [README](../README.md) “What works vs what does not”). For a product that “fully works” including email and RAG **today**, use **Mode B**.

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
   web      — UI + API
   worker   — BullMQ jobs (IMAP, scheduled email, imports, scrapers, reminders, dashboard refresh)
   postgres — CRM database (RLS)
   redis    — cache + job queue
```

| Container | Image / file | Port (internal) | Health check |
|-----------|--------------|-----------------|--------------|
| Web | `Dockerfile` | 3000 | `GET /api/health` |
| Worker | `Dockerfile.worker` | 8081 | `GET /healthz` |
| Postgres | `pgvector/pgvector:pg16` | 5432 | `pg_isready` |
| Redis | `redis:7-alpine` | 6379 | `PING` |

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
| 6 | Firebase project (Mode B only) | Email, RAG, chat, scrapers, etc. | Firebase Console |
| 7 | Google Cloud OAuth (Mode B, recommended) | Gmail + Google Calendar | Google Cloud Console |
| 8 | AI API keys (Mode B) | Fit-check, RAG, drafts | OpenAI / Anthropic / Google |
| 9 | MillionVerifier / Instantly (optional) | Verify + cold outreach sync | Their dashboards |

---

## 3. Non-technical checklist (print this)

- [ ] VPS created, you can open a terminal (SSH) or your host’s web console
- [ ] Domain points to the VPS IP (wait up to 30–60 minutes for DNS)
- [ ] Clerk keys copied
- [ ] Mode A or Mode B chosen
- [ ] Someone technical (or you, following §5–§12) installs Docker and starts the app
- [ ] You can open `https://app.yourdomain.com/sign-in` and log in
- [ ] Health pages OK (§11)
- [ ] Backups scheduled (§12)

---

## 4. Architecture in plain language

1. **Users** open the website (web).
2. **Clerk** checks who they are.
3. **Postgres** stores CRM data (leads, deals, etc.) with per-organization security (RLS).
4. **Redis** remembers short-lived cache and holds a **job list**.
5. The **worker** is a separate program that does slow work (send emails, sync inboxes, imports) so the website stays fast.
6. A **timer (cron)** on the VPS wakes the app every few minutes: “please queue the next batch of emails / inbox sync.” The worker then does the work.

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

Your repo’s `docker-compose.yml` is oriented to **local** passwords. On the VPS, create a production overlay (example name: `docker-compose.prod.yml`) in `/opt/nova-crm` with this shape:

```yaml
# EXAMPLE — change passwords; do not commit real secrets
services:
  postgres:
    image: pgvector/pgvector:pg16
    restart: unless-stopped
    environment:
      POSTGRES_USER: nova
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: nova_crm
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./docker/postgres/init:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U nova -d nova_crm"]
      interval: 5s
      timeout: 5s
      retries: 10
    # no ports: section — keep DB private

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: ["redis-server", "--requirepass", "${REDIS_PASSWORD}", "--appendonly", "yes"]
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 5s
      timeout: 5s
      retries: 10

  web:
    build:
      context: .
      dockerfile: Dockerfile
    restart: unless-stopped
    env_file: .env.production
    environment:
      NODE_ENV: production
      DATABASE_URL: postgres://nova_app:${POSTGRES_APP_PASSWORD}@postgres:5432/nova_crm
      MIGRATE_DATABASE_URL: postgres://nova:${POSTGRES_PASSWORD}@postgres:5432/nova_crm
      REDIS_URL: redis://:${REDIS_PASSWORD}@redis:6379
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    expose:
      - "3000"

  worker:
    build:
      context: .
      dockerfile: Dockerfile.worker
    restart: unless-stopped
    env_file: .env.production
    environment:
      NODE_ENV: production
      DATABASE_URL: postgres://nova_app:${POSTGRES_APP_PASSWORD}@postgres:5432/nova_crm
      REDIS_URL: redis://:${REDIS_PASSWORD}@redis:6379
      WORKER_HEALTH_PORT: "8081"
      QUEUE_WORKER_V1: "true"
      QUEUE_IMPORT_CHUNKS_V1: "true"
      QUEUE_HEAVY_JOBS_V1: "true"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    expose:
      - "8081"

  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - web

volumes:
  postgres_data:
  redis_data:
  caddy_data:
  caddy_config:
```

**App role password:** Compose init script `docker/postgres/init/01-app-role.sql` creates `nova_app` with a **dev** password. For production you must either:

- change that password after first boot (`ALTER ROLE nova_app …`), **or**
- ship a production init SQL with a strong password (never commit the real password; inject at deploy time).

`DATABASE_URL` must use role **`nova_app`**. Migrations use **`nova`** via `MIGRATE_DATABASE_URL`.

Also put compose secrets in a root `.env` next to the compose file (or export them):

```bash
POSTGRES_PASSWORD=...
POSTGRES_APP_PASSWORD=...
REDIS_PASSWORD=...
```

---

## 7. Caddyfile (HTTPS)

`/opt/nova-crm/Caddyfile`:

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

Create `/opt/nova-crm/.env.production` with `chmod 600`. Never commit this file. Full variable reference: [`.env.example`](../.env.example).

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

Do **not** set Firebase env vars. Postgres + Clerk are always on.

Clerk dashboard: set allowed origins / redirect URLs to `https://app.yourdomain.com`.  
Google Cloud: enable Calendar API + Gmail scopes; add redirect  
`https://app.yourdomain.com/api/email/oauth/google` and  
`https://app.yourdomain.com/api/scheduling/oauth/google`.

---

## 9. First start

```bash
cd /opt/nova-crm

# Build and start
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build

# Apply database migrations (use migrate role)
docker compose -f docker-compose.prod.yml run --rm \
  -e DATABASE_URL="postgres://nova:${POSTGRES_PASSWORD}@postgres:5432/nova_crm" \
  -e MIGRATE_DATABASE_URL="postgres://nova:${POSTGRES_PASSWORD}@postgres:5432/nova_crm" \
  web npm run db:migrate:deploy
```

If `nova_app` password still matches init SQL, align `DATABASE_URL` / `ALTER ROLE` before the app serves traffic.

Ensure org/member rows exist in Postgres and Clerk user emails match `members.email` (or `externalId` = Nova uid). Without that, login succeeds at Clerk but workspace identity fails.

---

## 10. Cron jobs (replaces Cloud Functions timers)

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
| Mode B email | Connect mailbox in Settings → Email; wait for imap-sync | Inbox updates |
| Mode B tracking | Send tracked mail; open pixel hits `MAIL_TRACKING_BASE_URL` | Open recorded |
| Mode B AI | Admin → AI & knowledge | Retrieve / generate works (needs Firebase + keys today) |

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

| Feature | Mode | Needs |
|---------|------|--------|
| Clerk login / signup | A/B | Clerk keys |
| Accounts, contacts, leads, deals | A/B | Postgres flags + sole-writer |
| Dashboard KPIs | A/B | Summary flags + Redis + dashboard cron |
| Platform admin | A/B | `PLATFORM_ADMIN_EMAILS` |
| Prospect imports (queue) | A/B* | Worker + `QUEUE_IMPORT_CHUNKS_V1` (*FS metadata may still apply in mixed mode) |
| Scheduled / bulk email | **B** | Firebase residual + worker + scheduled-email cron + mailbox SMTP |
| IMAP inbox sync | **B** | Firebase + worker + imap-sync cron |
| Open / click rates | **B** | `MAIL_TRACKING_*` + HTTPS |
| Email verifier (MillionVerifier) | **B** | Org connection / API; outbound HTTPS |
| Instantly campaigns | **B** | Org Instantly secret + webhook |
| Scrapers | **B** | Firebase intake + scrapers cron + worker |
| Team chat / notifications | **B** | Firebase |
| AI / RAG knowledge | **B** | `pgvector` (`ai_document_embeddings`) + AI keys |
| Google/Microsoft calendar | **B** | OAuth clients + FS calendar connections |
| System invites email | A/B | Resend or `SYSTEM_SMTP_*` |

---

## 15. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Site won’t load HTTPS | DNS / firewall / Caddy | Check `A` record, `ufw`, `docker logs caddy` |
| 401 on cron | Wrong/missing `CRON_SECRET` | Match `.cron.env` and `.env.production` |
| Jobs never run | Worker down or queue flags off | Start worker; set all three `QUEUE_*_V1` |
| Login but empty workspace | No Postgres member for Clerk email | Insert/sync member; match email / externalId |
| Email features 503 / empty | Firebase disabled | Use Mode B or finish email migration |
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

AI/RAG is **not** on BullMQ yet (request/response on web). Embeddings live in Postgres `ai_document_embeddings` (`pgvector`).

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
| [README.md](../README.md) | Local quick start, Firebase-free matrix |
| [ENVIRONMENTS.md](ENVIRONMENTS.md) | Local / staging / prod separation |
| [NOVA-CRM-ENGINEERING-RULES.md](../Architecture%20fixes%20plan/NOVA-CRM-ENGINEERING-RULES.md) | Binding architecture |
| [NOVA-CRM-P4-QUEUE-WORKER.md](../Architecture%20fixes%20plan/NOVA-CRM-P4-QUEUE-WORKER.md) | Queue details |
| [NOVA-CRM-P5-AUTH-CLERK.md](../Architecture%20fixes%20plan/NOVA-CRM-P5-AUTH-CLERK.md) | Clerk |
| [NOVA-CRM-P6-DECOMMISSION-FIREBASE.md](../Architecture%20fixes%20plan/NOVA-CRM-P6-DECOMMISSION-FIREBASE.md) | CRM Postgres cutover |
| [`.env.example`](../.env.example) | Full variable reference |

---

*Document version: 2026-08-15. Update when deployables, flags, or Firebase residual list change.*
