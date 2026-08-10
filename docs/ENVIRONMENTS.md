# Environments — separation rules

Migration step **W0.7**. Expands
[`Architecture fixes plan/nova-crm-implementation-guide.md`](../Architecture%20fixes%20plan/nova-crm-implementation-guide.md) §5
and [`NOVA-CRM-ENGINEERING-RULES.md`](../Architecture%20fixes%20plan/NOVA-CRM-ENGINEERING-RULES.md) §3
(“Staging never touches production data”).

**Signed off:** 2026-08-10 — local / staging / production must never share a database or production secrets.

## The three environments

| Environment | Purpose | Data | Deploys |
|-------------|---------|------|---------|
| **Local / dev** | Individual development | Compose Postgres + Redis (`docker compose up -d postgres redis`); seed/fake data only | Manual (`npm run dev`) |
| **Staging** | Pre-production validation, QA, demos | Realistic but **not** real customer data (synthetic or scrubbed) | Automatic on merge to `main` (once deploy pipeline exists) |
| **Production** | Real customers | Real | Manual-gated, tagged releases only |

## Hard rules (non-negotiable)

1. **Separate cloud projects/accounts per environment** — not folders inside one project.
2. **Separate databases entirely** — different Postgres instances, credentials, and network access. Never point staging (or local) at prod “just to test.”
3. **Separate Redis / cache** — local Compose Redis is for local only; staging and prod use their own managed Redis.
4. **Separate secrets** — production secrets must not be readable from staging or laptop `.env` files committed to git. Use each environment’s secrets manager / GitHub Environments.
5. **Separate third-party sandboxes where it matters** — email senders, AI providers, verification APIs: staging keys must not burn production quotas or touch real customer inboxes.

## Local defaults (Compose)

| Service | URL / connection |
|---------|------------------|
| Postgres 16 | `postgres://nova:nova_dev_password@localhost:5432/nova_crm` |
| Redis 7 | `redis://localhost:6379` |

Set `REDIS_URL` in local `.env.local` to use the Phase 0 cache helper (`src/lib/cache/redis.ts`).  
These credentials are **dev-only**. Do not reuse them in staging or production.

## Checklist before pointing any script at a DB

- [ ] `DATABASE_URL` host is clearly local, staging, or prod — never ambiguous
- [ ] Script is not using a production credential from a non-production shell
- [ ] Migrations go through Prisma Migrate (or equivalent) via CI for shared envs — no manual `ALTER` on prod
- [ ] Dual-write / ETL / reconcile jobs run against **staging** first

## Promotion flow (target)

```
feature/* → PR → CI (lint, typecheck, test, build) → merge to main
                                                      → staging deploy
                                                      → tag v* + approval
                                                      → production deploy
```

See also [`docs/BRANCHING.md`](BRANCHING.md).
