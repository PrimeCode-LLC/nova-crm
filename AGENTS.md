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

<!-- BEGIN:graphify -->
# Graphify knowledge graph (always-on)

This project has a knowledge graph at `graphify-out/` (god nodes, communities, cross-file edges). Cursor also loads `.cursor/rules/graphify.mdc` every session.

**Before exploring with Grep/Glob/Read for architecture or “where is X” questions:**
- Prefer `graphify query "<question>"`, `graphify path "<A>" "<B>"`, or `graphify explain "<concept>"`
- Read `graphify-out/GRAPH_REPORT.md` for broad orientation; use `graphify-out/wiki/index.md` if present
- Only skip the graph when `graphify-out/graph.json` does not exist yet, or when you already oriented and need exact line edits

**Keep the graph fresh:**
- After code changes: `npm run graphify:update` (or `python -m graphify update .`) — AST-only, no API cost
- Full rebuild: `npm run graphify:build` (or `python -m graphify extract . --code-only`)
- Watch mode: `npm run graphify:watch`
- Git hooks (`post-commit` / `post-checkout`) rebuild after commits and branch switches
<!-- END:graphify -->
