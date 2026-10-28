# Shared participation - P2

Local implementation on the staging branch. Deployment and pilot release remain
separate acceptance steps; no hosted database has been changed.

## User flow

Open an existing opportunity and its Participants tab. The source contact/business
remains the main customer; use the ordinary opportunity editor to change it.
Edit participants to add repeatable people or businesses in Additional customer
or Representative roles. Real Estate supplies Primary applicant and Co-applicant
labels through the existing extension composition. Generic CRM works with Real
Estate disabled.

Save replaces the additional list atomically. Removing a row never deletes the
master. Accepted display details stay as saved; an explicit refresh obtains the
current readable active directory version. Unavailable saved rows can be retained
or removed. A role change is a new selection and requires current directory Read.
New contact creation and duplicate matching remain owned by the CRM directory.
Its existing email/phone uniqueness rules are unchanged; the shared snapshot
contract permits distinct people with shared communication values, but P2 does
not relax the master/import duplicate rules.

The editor opens read-only, uses the common edit panel/discard confirmation and
preserves drafts on conflicts. Reload explicitly discards the draft. The parent
editor reloads all source fields after saving before accepting its new version;
it does not attach a new version to stale title, assignment or extension fields.

## Persistence and authorization

Migration 133, `20261028000100_opportunity_participants`, adds only the native
CrmOpportunityParticipant child. Composite tenant/opportunity/person/business
foreign keys, an exclusive person-or-business constraint, bounded positions and
per-role uniqueness enforce relationship integrity. Source identity is immutable.
Forced tenant RLS plus restrictive source policies inherit opportunity office and
Restricted visibility; writes additionally require source sharing Edit. No old
policies, rows, profiles, assignments, office grants or module flags are changed.
No backfill or alternate runtime is introduced.

The source-owned adapter uses fresh Opportunities Read and Edit, including action
record limits. New/changed references and explicit refresh require Contacts Read
or Accounts Read through their existing scope. Search, count, paging and selected
caption resolution share the same active readable population. Directory Read is
not required to display already accepted source evidence and saved evidence never
grants directory access. Business selections copy name and source version only.

Replacement takes the security-administration tenant lock, the existing tenant
operation mutex and the source row lock. Fresh authority is resolved after the
security waits using Read Committed; all ordinary CRM transactions retain their
existing Serializable boundary. Optimistic source version, child replacement,
strict audit and activity history commit together. Audits contain references and
source versions, not copied email/phone details. The existing tenant lock helpers
are exposed independently of the global Prisma client for checked module use.

Up to 98 additional rows fit the shared maximum of 100 participants, including a
business customer and its source representative. Quotation revisions collect the
same captured primary source plus accepted additional evidence in their existing
transaction. Selected revisions and orders stay immutable. Participants never
multiply order, payment or receivable totals.

## Verification

- 43 participant/architecture/calculation checks passed.
- 94 native contract, participant, ownership, quotation, order, reservation and
  receivable regressions passed, with no skips. The 100-participant case includes
  confirmation, one receipt and one exact receivable balance, not multiplied rows.
- The 133-migration rehearsal passed forced rollback and exact preservation of
  all 132 preceding tables, existing policies and source functions.
- Two browser scenarios passed on the built app: generic desktop/mobile editing,
  stale source-field synchronization, conflict draft/reload, archived-reference
  removal, and Real Estate read-only labels without directory/Edit access.
- Build (including TypeScript), targeted ESLint and Git whitespace checks passed.
  Four screenshots were inspected: desktop editor, mobile conflict, mobile saved
  rows and the restricted read-only applicant view. Mobile document width stays
  within 390px; footer controls wrap without horizontal overflow.

The first full run passed 94 native checks but its first browser test timed out
because it addressed the existing fixed-choice menu as a combobox/option. The
correct button/menuitemradio locators then passed; no product workaround or
longer timeout was added. Earlier build-start and intermediate run logs remain
separate from passing acceptance evidence.

Private evidence: `tmp/participants/p2-evidence/receipt.json`; native log
`tmp/industry-release/ls-erp-sales-orders-cf6fd6789cd7.log` (94 native passes,
followed by the original locator failure); final browser/rehearsal log
`tmp/industry-release/ls-erp-sales-orders-459c538f760e.log` (2/2 browser passes).

All fixtures use disposable loopback PostgreSQL and synthetic browser accounts.
Neither hosted login sessions nor the uploaded pilot reference documents are used
as test data or committed.

## Remaining phases

P3 adds common information forms and bounded versioned requirements/presets.
P4 composes booking acceptance with the existing commercial/reservation flow.
P5 adds shared issuance with the two Real Estate-owned letter providers.
P6 rehearses pilot preservation and separately releases to staging/production.
KYC uploads, electronic signatures and ownership calculations remain outside scope.
