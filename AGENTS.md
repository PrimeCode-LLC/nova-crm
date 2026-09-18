<!-- BEGIN:nova-production-agent-rules -->
# Nova CRM — Production agent rules (binding)

This app is live production with irreplaceable tenant data. Loaded every session. If a request conflicts, flag it before implementing.

@Architecture fixes plan/NOVA-CRM-PRODUCTION-AGENT-RULES.md
<!-- END:nova-production-agent-rules -->

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes: APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:nova-engineering-rules -->
# Nova CRM — Engineering Rules (binding)

Canonical contract (loaded every session). If a request conflicts with these rules, flag the conflict before implementing.

@Architecture fixes plan/NOVA-CRM-ENGINEERING-RULES.md
<!-- END:nova-engineering-rules -->
