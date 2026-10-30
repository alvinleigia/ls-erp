# P13A company tax configuration

This increment provides reviewed configuration, not statutory tax invoicing.
It does not change existing quotations, orders, invoices, appointment taxes,
payments, numbering or saved PDF files. No registration or rate is inferred from
an industry, company name, property category or historical charge caption.

## Tenant administrator workflow

1. Open **Settings > Company tax profiles** and choose an issuing company.
2. Under **Registrations**, add the regular PAN-based GSTIN, registered legal
   name/address, category and effective dates. E-invoicing starts as **Not
   assessed**; explicitly review its applicability. Confirm the review checkbox
   to save. GSTIN validation checks structure/check digit offline, not GSTN status
   or legal-name matching.
3. Under **Office mappings**, select an active registration belonging to that
   office's company. Clear its mapping before archiving a registration. A mapping
   does not grant permissions or establish validity for every transaction date.
4. Configure percentage rates in the existing **Taxes** directory. Under **Tax
   profiles**, name each business supply, select its explicit treatment,
   classification, pricing basis and supported intra/inter-state components.
   Use business-approved classifications and rates. Property and brokerage
   profiles are examples of business choices, not built-in tax determinations.
5. Review and publish. Enabling a profile marks its configuration available for
   future consumers; it does not enable statutory issuance. Reopen it to inspect
   reviewed version history. Subsequent saves create another immutable version.

Taxable treatments require configured component rates. Nil-rated, exempt,
zero-rated and non-GST treatments are distinct choices. Exempt/non-GST profiles
require an approved basis. Zero-rated profiles explicitly distinguish collection
with/without payment of tax. Only percentage CESS is represented in this increment.
Unsupported cases must await their own verified localization support.

Changing a master rate never rewrites a saved profile version. The profile warns
when its source rates change or become inactive. A new review captures current
rate facts. Disable a profile to withdraw its configuration while retaining
history. In-use rate deletion is blocked; archive the rate instead.

Company, GSTIN and profile code identities stay fixed. Archive an incorrect
registration and create its replacement. Concurrent changes return a conflict;
the editor retains the unsaved form and offers an explicit reload that discards
edits. Lists and histories are paginated.

## Shared architecture and boundaries

- `platform/tax` owns company registrations, office bindings and immutable
  reviewed profiles. India GSTIN validation belongs to its India localization.
  Real Estate does not own common tax configuration.
- All six tables use forced tenant RLS and actual active Tenant Admin authority.
  A Manager/Staff custom profile does not grant security administration. Resource
  ownership, navigation, audit registration and API authorization share the
  existing platform contracts.
- Every service mutation reauthorizes inside its transaction, checks the expected
  version, writes immutable review evidence and records a strict audit event.
  Native constraints protect identity, revision coherence, exact captured rate
  facts, same-company office references and immutable history.
  Every intermediate review in a multi-change transaction is checked as well as
  the final head. Missing intermediate history or component evidence rolls back
  the transaction; complete atomic reviews remain supported.
- Published components reference the one existing tenant rate directory, storing
  exact decimal text and decimal evidence. P13A2 now standardizes the directory,
  operational frozen percentages and shared tax arithmetic; see
  [the arithmetic contract](TAX_ARITHMETIC_P13A2.md). Existing amounts stay frozen.
- Historical commercial records remain commercial. This migration adds six empty
  tables and indexes; it backfills no registrations, tax treatments or grants.
  There is no tenant-specific override or historical runtime fallback.
- Later invoice consumers must read only the necessary approved tax evidence
  through their authorized source adapter. Configuration Read never grants
  customer/company/source access; business-source users must not need the full
  security-administration directory to consume an approved configuration.

## Remaining P13 work

Recipient registrations, reviewed source tax facts,
place-of-supply decisions, line/partial tax allocation, statutory numbering,
statutory PDFs and applicable electronic-invoicing integration are not activated
by this increment. See [the P13 plan](GST_LOCALIZATION_P13_PLAN.md).

## Verification commands

- `npm.cmd run test:tax-configuration`: populated migration/forced rollback,
  tax workflow/native isolation, ownership admission and invoice/receivable
  regression checks in a disposable localhost database.
- `npm.cmd run build`, then `npm.cmd run test:tax-configuration:browser`:
  isolated real-browser registration, office mapping, profile version/conflict,
  changed-source-rate and admin-boundary checks.

These commands never read hosted database credentials or seed a hosted database.

## Staging verification - 30 October 2026

Runtime `3883abd` is READY on all four staging aliases. Database migration 141
(`728b451`) adds the per-version proof correction; it changes no application
code. All 51 native/unit/regression tests pass, including the intermediate-review
cases and existing invoice/partial-billing/receivable workflows. Two isolated
browser flows, the build and lint pass. The earlier two receivable timeouts under
concurrent build load passed separately and in the final complete 51-case run.

Migration 140 preserves all 146 prior tables, policies and functions exactly and
adds six empty forced-RLS tables. Migration 141 preserves all 152 tables/policies
and changes only the new tax-review proof function. Both forced rollback
rehearsals pass. Staging has a verified readable encrypted application backup;
this archive verification is not a full restore rehearsal.

Hosted QA verified registration creation, office mapping, frozen profile values,
changed-rate warnings, cross-tenant denial and cross-origin rejection. After the
master rate changed from a synthetic 18 to 20, version 1 still displayed 18.
Desktop/mobile top, history and footer screenshots were inspected; the controls
are reachable without page overflow. Temporary QA profiles/rates were disabled,
office mappings cleared, and their registration/office/company archived. Review
history remains. No customer tax treatment was inferred.

Production deployment `dpl_EkQhmuCQqrwuxoRgR5vMMDx9kuFG`, its three aliases,
GitHub main `4546cb2` and the root production project link remain unchanged.
