<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes: APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:nova-engineering-rules -->
Also follow `ENGINEERING_RULES.md` (Nova CRM architecture contract: Postgres target, no client-side metric aggregation, queue/worker for background work, RLS, no new Firebase dependencies without an explicit exception). If a request conflicts with those rules, flag the conflict before implementing.
<!-- END:nova-engineering-rules -->
