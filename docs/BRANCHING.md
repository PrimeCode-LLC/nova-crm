# Git branching model

Permanent Nova CRM branch policy (2026):

| Branch | Role |
|--------|------|
| **`main`** | Firebase/reference implementation. **Frozen.** Do not deploy to VPS. Do not merge `feature/remove-firebase` into `main`. |
| **`feature/remove-firebase`** | PostgreSQL + Clerk + BullMQ **production** implementation. Sole VPS CI/CD branch. |
| **`feature/*` (other)** | Short-lived work; merge via PR into the appropriate target branch. |

## Production flow

```
feature/remove-firebase
    → CI (.github/workflows/ci.yml)
    → GHCR immutable images (:${{ github.sha }})
    → manual approval (GitHub Environment: production)
    → VPS pull by SHA (scripts/deploy-vps.sh)
    → migrate → web + worker + cron + caddy
    → smoke tests
```

**Never** deploy `main` to the VPS.

## Firebase reference (`main`)

- Firebase App Hosting, Cloud Functions, Firestore rules, and reference CRM code live on `main`.
- CI on `main` (if enabled) is for reference only — not VPS production.
- Do not merge the PostgreSQL production branch back into `main`.

## Production branch (`feature/remove-firebase`)

- All production CI checks, Docker builds, GHCR publish, and deploy workflows target this branch.
- Open PRs **into** `feature/remove-firebase` for production changes.
- VPS runs immutable GHCR images — not `git pull` + `docker compose up --build`.

## Enforcement

- Deploy workflow hard-guards `github.ref == 'refs/heads/feature/remove-firebase'`.
- `scripts/deploy-vps.sh` and `scripts/rollback-vps.sh` reject any `DEPLOY_REF` other than `feature/remove-firebase`.
- GitHub **Environment `production`** requires manual approval before deploy (configure in repo Settings → Environments).

When GitHub Team/Pro is available, add branch protection on `feature/remove-firebase` requiring CI `checks` to pass before merge.
