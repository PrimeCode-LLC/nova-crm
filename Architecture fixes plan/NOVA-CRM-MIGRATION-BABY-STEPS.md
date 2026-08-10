# Nova CRM — Migration baby steps (runbook)

Working checklist for the architecture migration. One baby step ≈ one PR. Do not start the next phase until the previous phase exit criteria are met.

Source plan: implementation guide §4 + `ENGINEERING_RULES` / `NOVA-CRM-ENGINEERING-RULES.md`.

**Locked defaults:** Prisma + Migrate · Compose Postgres 16 + Redis 7 · Phase 5 auth = Clerk (confirm at P5.0) · two deployables only (web + worker).

---

## Week 0 — Foundation

| ID | Status | Notes |
|----|--------|-------|
| W0.1 | [x] | `AGENTS.md` loads canonical engineering rules |
| W0.2 | [x] | `docs/BRANCHING.md` — `feature/*` → PR → `main` |
| W0.3 | [x] | Root `Dockerfile`, `Dockerfile.worker`, `docker-compose.yml`, `.dockerignore` |
| W0.4 | [x] | Compose postgres + redis only; verified healthy (`pg_isready` + Redis `PONG`) on 5432/6379 |
| W0.5 | [x] | `npm run typecheck` + `.github/workflows/ci.yml` (lint warnings allowed for React Compiler debt) |
| W0.6 | [ ] | **Blocked:** GitHub Free private repo — protection API 403. Steps in `docs/BRANCHING.md` after Team/Pro |
| W0.7 | [x] | `docs/ENVIRONMENTS.md` — local/staging/prod never share DB/secrets |

**Week 0 exit:** CI on PRs, local Postgres+Redis healthy, Docker files at root, rules enforced. *(W0.6 pending GitHub Team/Pro for private-repo branch protection.)*

---

## Later phases

Phase 0–6 steps live in the migration plan; expand checkboxes here as each phase starts.
