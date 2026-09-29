# CRM quotations and payment plans

Implemented on 2026-09-29, after checkpoint `df1b560` was pushed and deployed.
The quotation migration was applied to the hosted database on 2026-09-29; Prisma
confirmed all 86 migrations are up to date. Application release is authorized via main.
The user deferred the complete hosted CRM workflow review until after this work.

## Where to use it

- **CRM > Configuration > Quotation templates**: managers create, edit or archive
  reusable pricing, charge and instalment templates.
- Open an **Opportunity > Quotations and payment plans > New document**.
- Fill the document or explicitly apply a template. Template replacement requires
  confirmation and preserves the opportunity/customer link and current dates.
- **Save document** creates version 1. **Save new version** adds an immutable
  snapshot. Version pagination opens previous, read-only versions.
- **Download saved PDF** downloads that saved version, not unsaved form changes.

## Reference coverage

The supplied BLISS AQUA payment plan can be represented with:

- Project/subproject/developer labels supplied by the optional Real Estate
  adapter, plus labelled details such as plot number, facing or unit reference.
- Priced lines with quantity/area, unit, rate and computed amount. The sample's
  247 sq. m × 15,000 produces 3,705,000 total consideration before other changes.
- Included or extra fixed/percentage charges; percentage bases are explicitly
  base price or total consideration. Included percentage charges use base price
  to avoid circular calculations. Discount is a fixed amount.
- Optional charge groups and subtotals, including the sample's 215,300 combined
  stamp-duty/registration amount. Group totals are separated by included/extra
  treatment so they cannot be confused with consideration.
- Pending charges with conditions, such as maintenance per sq. m/month. Unknown
  amounts are clearly excluded from the total known amount.
- Instalments covering 100% of consideration: the example's 10/10/25/25/20/10
  percentages and 0/30/90/170/220/300 days from booking. A booking date is optional;
  without it the document prints relative due terms instead of invented dates.
- Separate extra-charge due conditions, bank/account/type/branch/routing details,
  remarks, website, PNG logo, registration reference and QR registration URL.

The printed reference's statutory amounts do not exactly match its percentage
labels. No legal rate, rounding rule or cap was inferred: use confirmed fixed
amounts or an explicitly configured percentage. Automatic statutory tax/cap rules,
payments, receipts, bank reconciliation and accounting remain separate later work.
This feature does not reserve a unit, confirm a booking or create payment records.

## Storage, calculations and access

Migration: `20260929180000_crm_quotations` adds three tables only:
`CrmQuotationTemplate`, `CrmQuotation` and `CrmQuotationRevision`.
Tenant-qualified foreign keys, forced RLS and supporting indexes apply to all.
The database trigger rejects update/delete of saved revisions. The application
only inserts revisions and optimistically advances the quotation version, in the
same serializable transaction as required audit and opportunity history.

Snapshots preserve price inputs, computed totals, template identity/version,
customer/project details, author name, terms and business display settings.
Template or customer/project edits cannot rewrite earlier versions. Industry
context is provided by the extension boundary; core CRM imports no Real Estate
implementation. Module-off new documents omit industry context; historical
snapshots remain available to the current opportunity owner/manager.

Staff permissions follow opportunity assignment; teams do not widen access.
Managers configure templates; staff can use active templates on their records.
Every read/save/PDF request checks current CRM and tenant access. Template archive
does not affect existing snapshots. No external fetches occur for logos or QR
links: logos are bounded embedded PNG data and links are encoded locally.

Exact fixed-point arithmetic rounds monetary results at the currency's precision.
Cumulative instalment allocation avoids negative rounding residuals and always
reconciles to consideration. Four-decimal input quantity/rate/percentage values
are supported; calculated totals are bounded below 1 trillion currency units.
Documents are bounded to 30 priced lines, 30 charges, 30 instalments, 15 extra
details, 10,000 terms characters, and a PNG up to 290 KB/2000×2000 pixels.

Document lists read indexed header rows with server pagination, not snapshot JSON.
A snapshot is fetched only for an authorized individual version. PDF generation
uses a bundled, OFL-licensed Noto Sans font, word wrapping, page breaks, repeating
table headers and page numbers. Unsupported characters produce a clear error
rather than silently disappearing. Additional script-specific fonts may be added
when multilingual PDF coverage is needed.

## Focused local checks

- Production build, TypeScript and targeted lint checks passed. The PDF route's
  deployment trace includes the bundled Noto Sans font.
- Five calculation scenarios: reference totals/subtotals, bases and discount,
  low-value currency rounding, invalid input/schedules and calendar dates.
- Seven real-database scenarios: template permissions/archive, staff/tenant/RLS/FK
  isolation, immutable snapshots, concurrent stale saves, audit rollback,
  module-off behaviour and bounded listing.
- A 1,006-document fixture returned five headers using eight SQL statements and
  no revision-payload query. This is a query-count check, not a hosted latency claim.
- Actual migration from the checkpoint schema preserved an existing enquiry's
  contact, owner, version 7 and custom-field value. The seven database scenarios
  also passed against that upgraded schema.
- A local browser scenario covers template configuration/application, opportunity
  entry, document save, inline validation, PDF download, revision navigation, and
  mobile controls.
  Desktop/mobile screenshots and the three-page sample PDF were visually reviewed.
- Existing 25 CRM unit/boundary scenarios passed. Full hosted CRM regression remains
  deferred, as requested; no hosted leads were created or changed by these tests.

## Release

The additive quotation migration is applied. Deploy this release from main.
Preserve existing CRM Test leads for the later end-to-end review. No seed/reset or
fixture script may target the hosted database. Application rollback may retain
the additive tables, snapshots and trigger; never delete saved versions as part
of rollback. The earlier four-phase checkpoint is already deployed separately.
