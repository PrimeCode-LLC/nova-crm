This application is live production. It holds irreplaceable tenant CRM data that took a team of 20 about 20 months to collect. Do not risk existing data or break the running product.

Follow `AGENTS.md` and `Architecture fixes plan/NOVA-CRM-PRODUCTION-AGENT-RULES.md`.

- Never run destructive SQL/migrations, unconstrained deletes/updates, or data rewrites. Schema changes must be additive. Never use production credentials from local or staging.
- Test the change and the existing features it could affect before calling work done. Verify UI in the browser when behavior is user-visible.
- New features must not change existing behavior by default. Do not repurpose existing fields, routes, or flags.
- Do not over-engineer. Smallest change that meets the stated requirement. Match existing patterns.
- For new features or behavior changes: ask clarifying questions until requirements are clear. Recommend a simpler/safer approach before coding if you see one. Do not invent business rules.
- Before finishing, confirm: most efficient? most secure? any regression? over-engineered?
