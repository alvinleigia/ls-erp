# Shared document issuance - P5

Local staging-branch implementation. No hosted migration, push, deployment or
client-data mutation is included. The shared engine serves registered native
sources; Real Estate supplies its own letter providers and eligibility rules.

## Usage

1. A Tenant Admin opens Settings > Company document templates. Choose the
   issuing operating company and document type, review the address, contact,
   opening, terms, signatory caption and optional tenant document logo. Enable
   issuance explicitly and acknowledge review before publishing. Starter values
   are disabled; no company is enabled automatically. Publication appends a
   version rather than rewriting old wording.
2. Save the opportunity's intended customer participants and correspondence,
   then save a quotation revision. Its identities, terms and selected catalogue
   evidence are frozen. Create and confirm the order through the existing flow.
3. On the order, use Issued documents > Prepare document. Download the draft
   preview to review its facts. Confirm issuance to archive the exact PDF.
   Preparation and draft downloads do not store a file or record an issuance.
4. Use Download issued PDF for a historical version. Downloads authorize current
   access and return that exact stored file; they never regenerate it from live
   contacts, balances or revised templates.
5. To correct letter wording, publish the reviewed template change, then prepare
   a replacement with a reason. It must replace the current version. The original
   remains available in history and the chain cannot branch. A changed source,
   template or access grant requires fresh review before issuance.

Template publication remains actual Tenant Admin administration, even when a
Manager has custom Edit permissions. Published-template Read can be delegated;
its company choices expose only companies with published templates. That does
not grant access to the company directory or its membership controls.

## Providers and boundaries

- **Order acknowledgement:** a common document for confirmed orders. It works
  with Real Estate disabled, with accepted customer roles, exact commercial
  lines, consideration, known extra charges, instalments and pending-charge notes.
- **Booking intimation letter:** Real Estate applicant captions, project/phase,
  saved units, area and location. Every property unit must currently be held
  without expiry or allocated to the issuing order. A recorded booking does not
  imply allocation, receipt of money or legal transfer.
- **Unit allotment letter:** every saved property unit must be allocated to that
  order. Its financial adapter separately authorizes Receivables and Payments
  Read and their record limits. An unopened account is explicitly unverified,
  with null balances rather than invented zeroes. An opened account uses the
  existing canonical posted-receipt allocations and receivable schedule.

Pending additional charges remain labelled To be confirmed. Existing finance
rules still prevent opening receivables until those charges are resolved through
an authorized replacement quotation/order. Issuing a letter never creates or
changes an allocation, receipt, amount due, applicant liability or ownership share.
There is no copied deposit threshold or pilot interest/forfeiture policy.

All intended accepted applicants are printed. The issuer is the order's saved
source office and operating company, never a caller-selected company or the
quotation's free-text supplier label. A signatory caption is plain approved text;
it does not capture a signature. The shared renderer contains no property fields,
HTML execution, template expressions or arbitrary remote image URLs.

National identifiers such as PAN/Aadhaar are not collected or printed by this
increment. KYC uploads, electronic signing, ownership calculations, application
approval workflows and automatic legal/monetary policies remain outside scope.
These are standardized configurable letters, not a pixel-for-pixel copy of a
pilot application's forms. Approved issuer wording is required before live use.

## Frozen property facts and corrections

New authorized Real Estate catalogue selections capture minimal property evidence
through the extension hook: project/phase identities and captions, location,
category and area. Generic quotations and orders do not acquire property columns.
Existing accepted item references remain unchanged, including when an optional
module or directory action is unavailable.

Refresh saved item details is an explicit quotation-draft action. It rechecks
current catalogue/project Read and exact item version, and captures evidence in a
new revision. The request-only refresh flag is removed before calculation and
storage. Refreshing an already accepted held unit makes no new reservation claim;
new selections retain all existing availability checks.

An old order without complete saved participant or property evidence cannot issue
a new letter by looking up current facts and pretending they were historically
accepted. Correct its source, save a new revision and use the normal cancellation/
replacement-order path. No historical source is backfilled on read. Current known
changes to printed property facts also require this explicit correction. Ordinary
catalogue price/description version changes do not alone invalidate unchanged
accepted property facts. Historical downloads retain their file while rechecking
access to the protected property/financial sources.

## Authorization, storage and concurrency

- New permission resources are Order documents Read/Create/Export (source-owned
  by Sales Order) and Company document templates Read/Edit (shared configuration).
  New actions do not expand existing saved profiles. Order documents also require
  Sales Orders Read, source record limits, office membership, Restricted visibility,
  provider actions and each active module. Template publication requires actual
  Tenant Admin in addition to the configured actions.
- A limited native issuer projection exposes only the readable order's issuing
  company and office identity/version/archived state. A second projection exposes
  only published-template company captions for delegated configuration Read. Both
  retain tenant and active-actor binding; the source projection also enforces
  native office and Restricted-source privacy. They confer no business action or
  general structure-directory access. Existing company policies remain unchanged.
- Shared issuance refreshes authority under the tenant/security/source locks.
  Preparation hashes the source, template, company/office and provider evidence.
  Rendering and upload happen outside database transactions; a fresh authorized
  preparation must match before storing the issuance and strict audit atomically.
  Replayed request UUIDs return their immutable result; reused UUIDs with changed
  payloads fail. Concurrent chains have one winner.
- Known failed transactions remove unused uploads. A lost commit acknowledgement
  retains the candidate because it may be the committed file; retry resolves the
  saved request before uploading again. Cleanup is conservative rather than
  risking deletion of a successfully issued document. Exceptional orphan cleanup
  remains an operational reconciliation task.
- Source-owned SalesOrderDocument rows have native tenant/source FKs, immutable
  snapshots/archives, same-source/type predecessor links and unique versions,
  references and request IDs. BusinessDocumentTemplate versions are immutable.
  Forced RLS retains native tenant, office and source privacy. Native guards check
  confirmed reference/date, issuing company, current enabled template and chain.
  Application actions/profile record limits remain fresh server checks.
- The existing private Supabase tenant-documents bucket stores one PDF per issued
  version at an immutable order/document path. Upload uses upsert false, max 10 MB;
  downloads use 60-second signed links. Prepared payloads are bounded to 512 KiB;
  rendering is bounded to 100 pages, repeats table headings and splits only rows
  too tall for a fresh page. Unsupported font characters fail explicitly.
- Migration 136 adds only the two empty tables and their guards/projections.
  Existing source rows, assignments, sharing, profiles, module activation, money,
  policies and application function bodies are not rewritten.

## Verification

- The regression run passed 134 checks without failures or skips. Following the
  final independent-scope tightening, all 12 focused document/access cases passed;
  the scoped-issuer case then also proved actual non-admin issuance/download
  without company-directory permission. These counts overlap and are not added.
- The native cases include immutable company versions, delegated template Read,
  separate parent/action scopes, same-request and competing-request races,
  replacement chains, exact stored downloads, strict audit rollback, lost commit
  acknowledgement, module/profile revocation during rendering, native tenant/
  office/Restricted privacy, live property holds/allocation, two co-applicants,
  two units, exact instalment collections, pending charges, stale financial facts
  and explicit property evidence refresh without changing old orders.
- Migration 136 passed forced late rollback and exact preservation of all 135
  preceding tables, policies and prior application functions. The new tables
  start empty and existing profiles/modules/data remain unchanged. The historical
  inventory rehearsal's 18 native checks also passed separately.
- Both final two-page Real Estate letters were rendered and all four pages
  visually inspected. A generic one-page document and the ten-page long-table
  case were also inspected, including oversized-cell continuation and repeated
  headings. Text checks confirm multiple applicants, saved units, instalments
  and exact posted balances. No client reference values were copied into tests.
- The final optimized build (including TypeScript), targeted ESLint and Git
  whitespace checks passed. No hosted application or database was used.

Browser tests use real application routes, rendering, native transactions and
RLS against disposable loopback PostgreSQL with synthetic users. Only the external
Storage transport is substituted in the guarded local server; it contains no
application authorization/issuance mocks and cannot target a hosted database.

The initial browser run passed seven scenarios and stopped the generic document
scenario on an ambiguous alert selector matching Next's hidden route announcer.
Its corrected focused rerun passed. The final clean suite passed all eight
scenarios on the final build, including the generic document replacement flow,
two-unit Real Estate letters and the preceding booking/participant/order flows.
Four final desktop/mobile document screenshots were visually inspected; mobile
preparation waits for the preview and the 390px document does not overflow.
Runtime guards were not relaxed to make a test pass.

Private evidence lives under `tmp/participants/p5-evidence/receipt.json`. The
regression/migration run is `tmp/industry-release/ls-erp-sales-orders-599f11055b96.log`;
its initial browser section is not a passing complete suite. The final access
checks are in `tmp/participants/p5-native-access-final.log` and
`tmp/participants/p5-native-scopes.log`. The final browser log is
`tmp/industry-release/ls-erp-sales-orders-2a98d4d06acf.log` (8/8).

Repeat native checks with `npm run test:documents`. After a successful build, use
`npm run test:documents:browser` for the document and preceding participant/booking
browser flows. Do not rebuild while a browser suite is running.

## Next

P6 rehearses the pilot upgrade against a fresh protected copy and reconciles IDs,
values, source snapshots, assignments, sharing, money and effective access before
staging acceptance and a separately authorized production release. It also checks
recovery/archive coverage for the new source-owned document rows. No live data is
modified to manufacture historical metadata or to make a letter eligible.
