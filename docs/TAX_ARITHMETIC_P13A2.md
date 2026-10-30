# P13A2 shared exact tax rates and arithmetic

The shared tax foundation is independent of industries and modules. Country
registration/component rules stay in localization code. This increment replaces
binary percentage arithmetic in current operational consumers; it does not enable
statutory GST invoices or reinterpret commercial quotation charges.

## Shared contract

`platform/tax/arithmetic.ts` provides canonical decimal text, exact percentage
rounding, inclusive-price extraction, exact rate sums and allocation by largest
remainders. Amounts are integer minor units defined by the caller. The helper
contains no currency, industry, country, permissions or database lookups.

- Appointment service/product lines retain per-component rounding. Inclusive
  prices retain their gross amount and allocate the extracted tax exactly.
- Inventory purchases retain combined-rate rounding per line.
- Services previews retain their combined-rate display policy.
- Equal allocation remainders retain input order. Allocations reconcile exactly,
  including fractional weights and large safe integer amounts.
- The arithmetic performs no source selection. Each module still authorizes its
  own records, module activation, office and source references before pricing.

For example, the synthetic rate 64.6% on 250 minor units is exactly 161.5, which
rounds half up to 162. The old binary calculation produced 161. New calculations
use the exact result. This is a mechanical test rate, not a legal tax default.

## One exact rate directory

`Tax.percent`, frozen `AppointmentOrderTax.percent` and frozen purchase-line
`taxPercent` use unconstrained PostgreSQL numeric, represented by Prisma Decimal.
The API returns exact decimal strings in these fields. Very small values may use
exponent notation; the shared arithmetic accepts and normalizes either form.
There is no parallel
float field or industry-specific rate directory.

Tax create/update accepts JSON numbers or exact strings, canonicalizing without
converting submitted strings through Number. New master rates must be between
0 and 100, with at most 12 meaningful decimal places. Validation rejects excess
precision rather than rounding it into a permitted rate. The UI retains entered
text and shows validation errors normally. Native constraints enforce the same
bounds before storage can round anything.

Frozen historical percentages retain all their finite non-negative decimal
digits, including old aggregated float residues. They do not acquire the new
master-rate precision limit. Their previously saved tax/total minor units remain
authoritative on reads, metadata, scheduling and receipt transitions. Only an
explicit supported financial edit performs a new calculation.

## Migration 142

The migration converts each old finite float through its shortest round-trip
decimal text. It aborts on invalid/non-finite percentages or a master rate that
would require rounding to meet the 12-place contract. Review such source data
before retrying; the migration never repairs or rounds it automatically.

No amounts, tax IDs, links, names, timestamps, snapshots, policies, grants or
stored functions are updated. No historical invoice/PDF is regenerated. The
populated migration rehearsal compares all 152 preceding tables and policies,
all prior functions, forces rollback, rejects an invalid-precision master rate,
and verifies preservation of old fractional residues and tiny finite values.

## Scope that remains separate

Recipient tax identities, source-approved supply/place-of-supply facts, statutory
partial tax allocations, GST numbering/PDFs and electronic-invoicing integration
remain later P13 increments. Existing quotations and commercial invoices retain
their accepted agreement, fixed-point commercial arithmetic and saved allocations.
No charge is reclassified as GST from its caption. Fixed amount discount entry
and other non-tax numeric fields are not converted by this increment.

## Verification

`npm.cmd run test:tax-arithmetic` exercises the isolated native migration and
operational/API/permission regressions. Build first, then run
`npm.cmd run test:tax-arithmetic:browser` for exact rate entry, Services preview,
purchase pricing/history preservation and the existing tax-profile flows.

Numeric storage follows PostgreSQL's distinction between exact numeric and
inexact floating-point types. See the [PostgreSQL 17 numeric documentation](https://www.postgresql.org/docs/17/datatype-numeric.html).

## Staging verification - 30 October 2026

Runtime `1f4ee10` is READY on all four staging aliases. Migration 142 preserves
all 152 prior tables' data, all policies and all prior stored function definitions.
The populated migration and forced rollback rehearsal passed, including invalid
master precision and historical fractional/tiny rate preservation. The fresh
encrypted application archive was decrypted/hash checked and its restore list
inspected; this is not a full restore rehearsal.

COPY transfers stalled through the pooler during backup. Only the two identified
read-only backup sessions were terminated. A standard pg_dump custom archive
using `--inserts --rows-per-insert=500` completed successfully; migration began
only after archive verification. No application fallback or data repair was added.

All 123 unit/native/API/permission cases, three browser flows, build and lint
passed. Two older test fixtures were updated to use their existing explicit
office grant/captured context contract; application access rules were unchanged.
Hosted QA verified 12-place string round trips, excess precision rejection, the
same exact Services/purchase result, preserved purchase amounts after a master
change, foreign-tenant denial, and inspected desktop/mobile screens. Temporary
purchase/catalogue records were canceled/inactivated and the new rate archived.

Production deployment `dpl_EkQhmuCQqrwuxoRgR5vMMDx9kuFG`, its three aliases,
GitHub main `4546cb2` and the root production project link remain unchanged.
