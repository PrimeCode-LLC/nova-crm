# Nova CRM — Production agent rules (binding)

**Canonical path:** `Architecture fixes plan/NOVA-CRM-PRODUCTION-AGENT-RULES.md`  
**Loaded every session via:** `AGENTS.md`, `.cursor/rules/nova-crm-production-agent-rules.mdc`, `.agents/rules/`, `GEMINI.md`, `CLAUDE.md`, `.github/copilot-instructions.md`.

This application is **live production**. The CRM holds a large amount of irreplaceable tenant data that took a team of 20 about 20 months to collect. Treat every change as able to destroy that data or take the product down. These rules bind Cursor, Claude, Antigravity, Gemini, Copilot, and any other coding agent. They are constraints, not suggestions.

If a request conflicts with these rules: name the rule, propose the safer alternative, and proceed with the risky approach only after an explicit user override.

---

## 1. Never endanger existing data

Existing rows, files, and tenant records must survive every change.

- Do **not** run destructive SQL or ORM operations against real data: `DROP` / `TRUNCATE`, unconstrained `DELETE` / `UPDATE`, `prisma migrate reset`, seed/reset of shared databases, or "cleanup" scripts that rewrite production-like rows.
- Schema changes must be **additive** (expand/contract). Do not drop columns, tables, enums, or indexes that existing code or data still uses. Do not backfill or rewrite existing rows unless the user explicitly approved a reversible plan.
- Never point local tools, scripts, or `.env` at production credentials. Staging must not use production data or production secrets.
- Do not "fix" data in place to make a feature work. Change code, not customer records.
- Prefer nullable new columns, new tables, and dual-read/dual-write over mutating existing columns.

## 2. Test before you call the work done

This app is in production. Untested changes are not done.

- Run the tests that cover what you changed, and the existing paths that share that code, state, schema, or API.
- For UI, layout, routing, or client-visible behavior: verify in the browser the way a user would (not a screenshot-only check). If browser tools are unavailable, say what you could not verify.
- Do not skip tests to save time. If you cannot test something, say so and stop before claiming completion.
- Additive, backward-compatible changes only. No breaking API/route/schema contracts without an explicit, tested migration path.

## 3. New work must not break existing features

A new feature is not finished if an old one regressed.

- Before changing a shared component, API, worker, Prisma model, or helper, find its callers and keep existing behavior as the default.
- Do not repurpose existing fields, routes, queue names, or flags for a new meaning.
- Hunt regressions: empty states, error states, other routes that read the same state, and tenant isolation.

## 4. Do not over-engineer

Smallest change that meets the stated requirement.

- Match existing patterns in this repo. No new package, table, queue, service, abstraction, or framework unless the requirement cannot be met without it.
- Do not build for hypothetical future cases the user did not ask for.
- Prefer a few straightforward files over a new layer of indirection.

## 5. Do not assume — clarify, then recommend

Before implementing a **new feature** or a **behavior change**, do not guess product intent.

- Ask clarifying questions until the requirement is unambiguous (who, what, where in the app, what must not change, success criteria).
- If you see a simpler, safer, or more efficient approach, recommend it **before** coding and wait if it changes the plan.
- If the user already gave a complete, unambiguous instruction in this conversation (typo, agreed follow-up, explicit "do X exactly"), implement it — do not re-ask questions they already answered.
- Never invent business rules, data migrations, or UX behavior to fill gaps.

## 6. Required self-check before finishing

Answer all four before you stop. If any answer is "no" or "not sure," fix it or tell the user.

1. **Efficient** — Is this the most efficient way to do it?
2. **Secure** — Is this the most secure way? (authz, validation, tenant isolation, no secrets, no extra data exposure)
3. **Regressions** — Did this break any previous feature? How did you check?
4. **Optimized / not over-engineered** — Is this the most optimized way? Did we over-engineer anything?

Do not mark the task complete until these are answered in your work, even if you do not paste the checklist in the user-facing reply.
