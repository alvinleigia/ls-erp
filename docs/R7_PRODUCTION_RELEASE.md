# R7 production release

Release authorized on 23 October 2026. Scope: shared Sales Orders, unique-unit
reservations, receivables, balances and ageing, collection follow-ups, storage
recovery tooling and the client usage guide. Production activation and custom
role assignments remain explicit; this release does not enable modules for tenants.

## Release gates

- 59 isolated integration tests passed with all 106 migrations replayed.
- 28 navigation, access, terminology and encrypted storage recovery checks passed.
- Five hosted staging workflows passed: orders, reservations, payments and
  reversals, overview, and collection follow-ups. Representative desktop/mobile
  screenshots inspected. These writes used only the allowlisted staging QA tenants.
- A fresh production backup restored successfully: 108 tables, data and financial
  totals matched. Three previously reviewed CHECK expression parenthesis changes
  were confirmed equivalent.
- All four pending migrations rehearsed against that isolated production copy;
  all 107 existing business tables preserved. New tables have forced RLS and the
  runtime grants were checked. Existing activities retain null collection links.
- Encrypted storage backup verified; both object bytes and all matching database
  storage references recovered successfully. No archived production quotation PDFs
  existed at this capture; PDF recovery is covered by synthetic tests.

## Cutover sequence

1. Verify Vercel project `ls-erp`, its `main` production branch and all three
   production aliases. Baseline is `c0905b4`, schema history 102 migrations.
2. Complete a successful build. Briefly pause the runtime database role, drain
   connections, and capture a final encrypted database and storage backup.
3. Verify the final database restore and storage archive. Apply only:
   `20261022000100_sales_orders`, `20261023000100_unit_reservations`,
   `20261023000200_order_receivables`, `20261023000300_collection_follow_ups`.
4. Verify data preservation, migration checksums, forced RLS and runtime grants.
   Restore application access. The additive schema supports the existing app
   while the new deployment builds.
5. Fast-forward main to the reviewed staging release, push, verify the deployment
   commit and aliases, then run read-only production smoke checks.

## Recovery

Keep the encrypted database and storage archives together under the ignored local
backup directories. Keys are wrapped to this Windows account; this is not an
off-device disaster-recovery copy. The user previously chose project-local storage.
Before new R7 writes, the previous Vercel deployment remains the application rollback
target on the additive schema. Do not drop new tables or restore a database over live
data as an automatic rollback. If a migration/data verification fails, inspect the
private receipt before reopening; preserve all evidence and reconcile changes.

Private operational receipts are in `tmp/r7-production`; no credentials, customer
rows, browser sessions or backup archives belong in Git. Production write tests are
outside this release check; existing tenant data is verified read-only.

## Result

Production schema upgraded from 102 to 106 migrations on 23 October 2026.
All 107 existing business tables matched before and after, including module flags,
roles and financial records. Runtime access is restored. The nine added tables have
forced RLS; the actual non-bypass runtime connection sees zero rows without tenant
context. Supabase's operator cannot SET ROLE to the runtime identity, so this check
used a separate authenticated runtime connection instead of changing memberships.

The final database archive was restored with all 108 baseline tables matching and
no foreign-key violations. Its paired storage archive was authenticated successfully.
Private receipts retain backup identifiers, checksums and restoration evidence.

The deployment commit, production alias confirmation and final read-only smoke
results are recorded in `tmp/r7-production/deployment.json` and
`tmp/r7-production/smoke-after.json`. Existing modules are not automatically enabled.
The client guide is the pre-release edition and explicitly marks R7 as a preview;
its release labels should be revised when distributing a post-release edition.
