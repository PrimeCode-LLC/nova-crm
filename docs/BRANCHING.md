# Git branching model

Trunk-based development (not GitFlow). Matches
[`Architecture fixes plan/nova-crm-implementation-guide.md`](../Architecture%20fixes%20plan/nova-crm-implementation-guide.md) §2.1 and migration step **W0.2**.

## Branches

| Branch | Purpose |
|--------|---------|
| `main` | Always deployable. **No direct pushes.** Merge only via pull request. |
| `feature/*` | Short-lived work branches. One concern per PR into `main`. |
| Tags (`v*`) | Optional production release markers cut from `main`. |

## Rules

1. Create work from an up-to-date `main`:
   ```bash
   git checkout main && git pull
   git checkout -b feature/<short-description>
   ```
2. Open a PR into `main`. Do not push commits straight to `main`.
3. Prefer small PRs (one baby step / one revertible change).
4. Delete the feature branch after merge.

## Enforcement

- **Convention (now):** everyone uses `feature/*` + PRs. This repo documents that as the required workflow.
- **GitHub branch protection (W0.6) — blocked on current plan:**
  - Org `PrimeCode-LLC` is on **GitHub Free**. Private repos cannot enable classic branch protection or rulesets (API returns HTTP 403: upgrade to Pro / make public).
  - **Required settings once Team/Pro (or public) is available:**
    1. Protect `main`
    2. Require a pull request before merging (dismiss stale reviews optional)
    3. Require status checks to pass: **CI / checks** (workflow job `checks` from `.github/workflows/ci.yml`)
    4. Do not allow force pushes or deletions on `main`
  - Until then: treat any direct push to `main` as a process violation; merge only via PR.
  - Re-run after upgrade:
    ```bash
    gh api -X PUT repos/PrimeCode-LLC/nova-crm/branches/main/protection \
      -H "Accept: application/vnd.github+json" \
      -f required_status_checks='{"strict":true,"contexts":["checks"]}' \
      -F enforce_admins=true \
      -f required_pull_request_reviews='{"required_approving_review_count":0}' \
      -F restrictions=null \
      -F allow_force_pushes=false \
      -F allow_deletions=false
    ```
    (Adjust via GitHub UI if the REST payload shape differs for your plan.)
