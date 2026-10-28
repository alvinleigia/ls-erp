# Shared booking composition - P4

Local staging-branch implementation. No hosted migration, push or deployment is
included. Booking is the tenant's terminology for the existing Sales Order; it
does not introduce a parallel commercial lifecycle or a Real Estate core model.

## Usage

1. Save the opportunity's participants and correspondence. Save a quotation
   revision to freeze those details and its commercial terms.
2. Open that revision and choose Create sales order (or the configured label,
   such as Create Booking). Review the saved customer, revision and consideration.
   Set the order date; it defaults to today in the tenant's time zone. Future
   dates are rejected. Saving creates a draft, not a payment or allocation.
3. Each new draft receives a tenant-unique reference, starting at `SO-000001`.
   The reference and date stay fixed through confirmation and cancellation.
   An existing active order is offered for opening rather than creating another.
4. On the order, Confirmation review lists missing participant fields against
   its frozen quotation revision. Correct the source, save a new revision,
   cancel the old draft and create a replacement if those facts need correction.
   Successful preview does not authorize confirmation: the server checks current
   permissions and requirements again at the actual transition.
5. Use Unit reservations for accessible unique units in that saved revision.
   Multiple units are separate holds/allocations under one order. Holds expire;
   allocation requires a confirmed agreement and an unexpired hold. Confirmation
   alone does not allocate. Releasing a unit alone does not cancel the agreement.
6. Open receivables and record payments through their existing authorized flow.
   Resolve posted payments before cancellation. Cancellation retains the order
   and releases its remaining holds/allocations through the existing transaction.
7. Search the order list by the readable reference, customer, title or technical
   ID. The list includes the calendar order date separately from creation time.

The order date is a declared commercial calendar date. Created/history times
record when the system action happened. A past order date never backdates an
audit event, unit hold, receipt or configuration acceptance. No CIF/application
number, legal ownership, automatic penalty or payment threshold is inferred.
The older date saved in quotation content is labelled Booking date on quotation;
it stays separate from the order's declared date and is never silently replaced.

## Storage, references and access

- Migration 135 adds nullable `SalesOrder.reference` and date-only `orderedOn`.
  Old rows remain null, without invented history. The normal view shows that a
  reference/date was not recorded; no alternate old/new service path is added.
- A fixed, tenant-bound native insertion trigger assigns references using the
  transactional `SalesOrderSequence` row. Counters have tenant identity, forced
  RLS and no runtime table privileges or policies; they are explicitly classified
  as internal numbering infrastructure. There is no counter browse/reset API.
- Allocation is atomic with the order, event and strict audit. A rolled-back
  insert does not consume a number. Successful cancellation does not release or
  reuse a number. Numbers increase per tenant without annual or office resets;
  the prefix is a stable commercial reference, independent of interface labels.
- Reference and order date are immutable natively, including for old null values.
  Ordinary source/snapshot/version/transition guards, all prior functions and
  policies remain unchanged. Runtime code accepts no supplied reference.
- Native inserts default the date from the database clock and tenant time zone
  (UTC if no settings exist), and reject future dates. The API uses the same
  calendar basis. Dates use ISO strings and native Postgres DATE; the UI uses
  the shared date-only formatter rather than converting midnight between zones.
- Creation review is a read-only source-authorized operation. It requires current
  Orders Read/Create and Quotations Read, using the same source adapter as save.
  It allocates no reference and accepts no caller customer, amount or snapshot.
  Its returned quotation ID/revision is captured by the dialog and submitted
  unchanged, even if the surrounding page later loads another revision.
- Create retains quotation locking and active-order idempotency. An explicit
  retry with a conflicting saved date returns a conflict, rather than silently
  changing that order. New revisions require cancellation/replacement as before.
- Reads/searches retain native tenant, office, source and Restricted visibility.
  References confer no access. Confirmation review is returned only when the
  current record permits confirmation, and exposes bounded missing-field labels,
  not configuration administration or directory permissions.
- The application composes the shared participant validator for both the review
  and actual confirmation. Confirmation retains fresh post-lock authorization,
  current requirements and immutable acceptance proof from P3. No business
  module imports a Real Estate implementation to enforce order metadata.

## Verification

- 116 native/unit/regression checks passed without skips. These cover reference
  concurrency/retries, counter privacy/audit rollback, tenant-calendar dates,
  immutable metadata and current confirmation feedback. The multi-unit,
  multi-customer case allocates two units under one agreement, posts one
  idempotent receipt, proves the exact outstanding balance, rejects cancellation
  with posted money and releases both allocations after correction/cancellation.
- Migration 135 passed forced rollback and exact preservation of all 134 prior
  tables, policies and functions. A populated pre-migration confirmed order,
  frozen source and history are included. Old null metadata cannot be rewritten;
  its existing cancellation transition remains valid. Counter privileges deny
  runtime reads/writes. The historical inventory rehearsal's 18 native checks
  also passed; these are separate evidence, not an additive headline test count.
- All six browser scenarios passed on the final build: the generic equipment
  Booking flow, both P3 customer-information/requirements cases, both P2 scoped
  participant editor cases and the original generic order lifecycle/access case.
- Four final screenshots were inspected: mobile booking review, desktop
  allocation, mobile reference search and a generic confirmed order on mobile.
  The 390px document does not overflow; tables retain their standard internal
  horizontal scrolling, and the modal's controls fit in the viewport. Order and
  quotation-recorded date captions are distinct. Core UI contains no CIF caption;
  the optional Real Estate participant preset remains separately composed.
- Final build including TypeScript, targeted ESLint and Git whitespace checks
  passed. The tested source hashes and build ID are retained with private evidence.

An earlier native run failed an obsolete equality assertion that included the
now-live confirmation review and a short-hold fixture started before finishing
confirmation setup. The assertion now compares immutable data separately from
current guidance; confirmation setup now precedes that short hold. Runtime
constraints and test timeouts were not relaxed. An intermediate overlapping UI
rebuild invalidated a browser run; it is excluded from acceptance. A subsequent
six-scenario pass was followed by wording polish, a fresh build and the final
six-scenario pass above.

Private evidence: `tmp/participants/p4-evidence/receipt.json`; native section of
`tmp/industry-release/ls-erp-sales-orders-0378563e4e34.log` (116/116; its subsequent
invalidated browser section is not a passing full run); final browser/rehearsal
log `tmp/industry-release/ls-erp-sales-orders-21ae0b91c742.log` (6/6).

Repeat locally with `npm run test:booking`; after a successful build, use
`npm run test:booking:browser` for the six synthetic browser scenarios. The
harness rejects hosted database URLs and removes only its owned test container.

Only disposable loopback PostgreSQL and synthetic browser identities are used.
Uploaded client documents and hosted customer records remain untouched.

## Next

P5 adds shared document issuance and the two Real Estate-owned letter providers.
Their issuance references, issuing-company configuration and approved content
remain distinct from the order reference. P6 rehearses pilot preservation and a
separately authorized hosted release. KYC uploads, electronic signatures and
ownership calculations remain outside this scope.
