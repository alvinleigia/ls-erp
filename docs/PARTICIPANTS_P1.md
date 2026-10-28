# Shared participants - P1 foundation

Date: 2026-10-28. Implemented and verified locally on the `staging` branch.
This is the first increment of
[the shared customer/booking plan](CUSTOMER_PARTICIPANTS_BOOKING_PLAN.md).
No hosted deployment, migration, business-data backfill or permission change.

## Implemented contract

`platform/participants` owns a strict, versioned participant snapshot and its
builder. It has no CRM, Real Estate or application imports. Stable transaction
roles are Customer, Additional customer and Representative. References distinguish
people from businesses; identical ID strings in those namespaces are not the
same party. Collections are bounded to 100 rows, with exactly one main customer
and no duplicate party/role rows. This is not a fixed co-applicant count.

The builder rejects foreign-tenant, missing, unexpected or ambiguous resolved
sources. It copies only the explicit saved identity/communication fields and
source version; no account privileges, legal ownership, payment liability or
workforce status are inferred. Shared phone/email do not merge two selected IDs.
The source adapter remains responsible for actual authorization and source reads;
the builder is not an authorization or global customer-lookup service.

## First application consumer

CRM provides the existing customer relationship through an application-installed
Sales Documents contract. A new quotation revision now captures the stable person
ID; a linked business account is the main commercial participant and its existing
contact is the sales representative. This is not a legal signing-authority claim.
Business means the customer account, not the issuing operating company.

Customer display values and participant evidence come from the same scoped source
read, avoiding mismatched identities across two reads during reassignment. Only
the business name already exposed through the source relationship is copied;
its private directory phone/email are not loaded or copied.

The client cannot submit participant snapshots as quotation content or save input.
The server prepares them inside the existing authorized save transaction, and the
existing saved-revision/audit operation commits them. Orders copy the exact
selected revision. No changes to order creation, calculation, financial state,
reservation state, sharing rules or office ownership are made.

Existing revisions are not rewritten or enriched on read. If an old saved revision
has no participant IDs, its existing snapshot remains the evidence; the current
opportunity contact is not used to invent its historical identity. Snapshot
history is not a second old/new runtime implementation.

## Real Estate and document ownership

There are no property-specific fields or applicant rules in this implementation.
The plan assigns applicant labels, property projections, booking-intimation and
unit-allotment template content/eligibility to Real Estate. Shared document
issuance and the common participant editor are subsequent increments.

The plan maps the required inputs for both supplied PDFs to their owners. It does
not implicitly add KYC file uploads, electronic signature capture, legal ownership
shares, automatic penalties or an independent application approval workflow.

## Verification

Commands:

```powershell
npm.cmd run test:participants
node --require ./tests/register.cjs --test tests/participants.test.cjs tests/crm-extensions.test.cjs tests/quotation-calculation.test.cjs
npm.cmd run test:sales-orders
npm.cmd run build
```

The pure checks cover individual and business purchases, several additional
participants, shared family communication details, transaction-specific roles,
copy isolation, version/size limits, ambiguous/foreign sources and request-body
injection. Native integration checks cover identity capture, business/person
separation without Real Estate, order snapshot copying, later source reassignment
and historical versions without IDs, alongside existing access/financial cases.

Final verification: **43 unit/architecture/calculation checks and all 64 native
integration checks passed**. The existing 132-migration preservation/rollback
rehearsals, including 18 native Inventory checks, passed in the disposable local
database. The production build (including TypeScript) and targeted ESLint passed.
No UI changed and no browser/hosted visual acceptance is claimed.

Investigation evidence:
The first full local run passed 62/63 cases; the receivables ageing case expired
its 20-second transaction. A repeat without concurrent compilation passed 62/64,
including all three new integration cases, but two receivables overview cases
expired. A temporary session-only JIT-off diagnostic also failed those cases; it
was not retained as a test or application workaround, and does not establish JIT
as the cause. An isolated checkout of the released application passed 61/61;
its ageing case took about 41 seconds over its multiple list calls.

The overview previously evaluated the same complete scoped balance set in three
separate statements for items, summaries and currencies. It now obtains all three
from one statement, preserving native access predicates, decimal arithmetic,
search/filter populations, numeric sorting and deterministic page ordering.
No timeout, database setting or accounting transition was relaxed. The original
financial assertions then passed with default settings against the optimized
statement. This is functional regression evidence, not a throughput benchmark.
Failed and baseline receipts remain evidence, not passing counts.

Private run logs:

- `tmp/industry-release/ls-erp-sales-orders-78480af1f427.log`: first candidate, 62/63.
- `tmp/industry-release/ls-erp-sales-orders-5daf09819830.log`: repeat, 62/64.
- `tmp/industry-release/ls-erp-sales-orders-a0698a3d9d89.log`: temporary diagnostic, 62/64.
- `tmp/participants/p1-evidence/baseline-sales-orders.log`: released-code comparison, 61/61.
- `tmp/industry-release/ls-erp-sales-orders-2a1ca62a6f6d.log`: final default-settings run, **64/64**.

The source schema/migration inventory is unchanged. Native fixtures and owned
containers were disposable; no local fixture/reset script ran against a hosted
database. No module activation, profile permission or client data was rewritten.

## Next increment

P2 adds native source-owned participant storage, the access-aware repeating editor
and selected-reference choices. Until that increment is complete, users cannot
add co-applicants through a new UI/API. P1 supplies the shared contract and first
saved-identity consumer; it is not a complete CIF screen or PDF feature.
