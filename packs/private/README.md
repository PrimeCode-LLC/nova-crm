# Private strategy packs
#
# Tenant-specific ICPs (e.g. Stellix Soft). Not product defaults.
#
# Layout (all gitignored except this README):
#   *.json              - portable packs for Admin → Import pack
#   seeds/person*-seed.ts - TypeScript sources that generate those JSON files
#
# Generate / refresh packs:
#
#   npx --yes tsx scripts/export-strategy-packs.ts
#
# Then Import pack from Admin → Strategies.
#
# Do not commit real customer ICPs into the SaaS product repo.
