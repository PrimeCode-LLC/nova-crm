# Strategy packs

Portable JSON packs for prospecting strategies + linked buyer personas.

| File | Purpose |
|------|---------|
| `template.empty.json` | Canonical empty template — match this shape for every new pack |
| `sample-b2b-saas.json` | Neutral product sample (also installed via **Install sample pack**) |
| `private/*.json` | Tenant-specific ICPs (gitignored) — generate then **Import pack** |
| `private/seeds/` | Private seed sources for those packs (gitignored) |

## Regenerate

```bash
npx --yes tsx scripts/export-strategy-packs.ts
```

## Import / Export

In the app: **Admin → Strategies**

- **Import pack** — upload a `.json` pack (creates new ids for this org)
- **Export** / **Export pack** — download a live strategy as a pack
- **Pack template** — download `template.empty.json`
- **Install sample pack** — installs the neutral B2B SaaS sample only

Private Stellix packs live under `private/` and are not product defaults.
