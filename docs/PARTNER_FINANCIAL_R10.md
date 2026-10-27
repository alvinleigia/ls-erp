# R10 phase 4C2a: receivable attribution

Receivables now use the shared partner reporting filters. This is generic order
and balance reporting; Real Estate is not required. No financial values, saved
documents, payment records, ownership or access grants are migrated or rewritten.

## Reporting basis

- **Salesperson type** describes the canonical opportunity's current assigned
  account: internal user or named external collaborator login. It is not the
  payment operator, receipt creator, introducing partner or current supervisor.
- **Partner introduction**, **Introducing collaborator** and **Supervisor at
  introduction** use the opportunity's immutable original evidence, inherited
  from an enquiry where applicable. Renaming, archiving, reassignment and current
  supervision never rewrite that evidence. Null means no recorded introduction.
- Existing confirmed/opened-order rules, search, currency, status, order and
  paging continue to apply. Each order is counted once even when a partner has
  several named logins. Rows, count, balances and ageing use the same filtered
  numeric SQL set. Currencies remain separate; no currency conversion is inferred.
- Posted receipt allocations reduce balances. Reversals use the existing ledger
  rules. Neither attribution nor a selector changes allocation or payment state.

The selector uses exactly the matching balance population, including order search,
currency and balance status. It cannot list a partner merely because an enquiry,
quotation, draft/unopened order or private directory record exists. The selector's
own search is independent from the order search (`q` versus `recordQuery`). Count,
page and selected-ID resolution use identical predicates. Archived evidence is
retained, with source snapshot labels and neutral missing-supervisor captions.

## Access and implementation

Existing receivables and sales-order Read remain mandatory. Ordinary balances
remain available to a finance user without opportunity Read. Applying an origin
filter additionally requires opportunity Read and intersects its normal record
scope. A financial share does not grant source Read or reveal a hidden origin.
The salesperson identity filter is separate from origin; it can narrow the
already-readable financial population without exposing private source fields.

The application source adapter in `application/receivables/service.ts` traverses
order -> quotation -> canonical opportunity. It applies shared attribution SQL
alongside existing financial record limits, native tenant/office/source RLS and
sharing. No partner fields are copied to child financial tables. Record details
and all writes retain their existing operation-specific authorization.

`receivableOverviewSet` supplies the one balance population to rows, summaries
and choices. `platform/collaborators/report-choices.ts` accepts an authorized
source projection and returns minimal source-backed labels, with no privileged
collaborator-directory lookup. The choice schema and filter controls are shared
with activity and sales reports. Contradictory filters fail validation.

The UI resets paging when attribution changes, explicitly resets all selected
filters and aborts superseded requests. Permission errors clear stale rows and
totals. Origin controls follow the server's current source-Read hint, while the
server independently authorizes every request. Mobile filter panels use the
existing bounded, scrollable control.

## Verification and release boundary

Run `npm.cmd run test:partner-financial` for the disposable local database suite.
After a local build, `npm.cmd run test:partner-financial:browser` also exercises
real Chrome using synthetic local accounts. No saved hosted session is read.
All three historical office/booking/daily compatibility fixture paths stay off.

Verified locally on 2026-10-27:

- **84 service/native checks pass together with zero skips**. Eight new financial
  cases cover independent owner/origin partitions, decimal and currency totals,
  all-page reconciliation, balance search/status, scoped choices, source Read,
  financial sharing, Restricted sources, receipts/reversals, saved evidence,
  reassignment, office removal, None and current module/account revocation.
- **Nine distinct real-Chrome flows pass** together: three new financial flows,
  three activity regressions and three sales/introduction regressions. Generic
  test tenants have Real Estate disabled and use explicit office grants. The three
  financial flows pass again after the final caption/selected-label assertion;
  the refreshed desktop/mobile captures were inspected.
- Desktop and 390px mobile captures were inspected, including the bounded filter
  panel and balances. The table scrolls within its card, with no page overflow.
- All **132 migration rehearsals** and **18 native stock checks** pass. No new
  migration or compatibility fixture. Build, TypeScript and lint pass.

Fixture validation failures and an incorrect None-rule assertion were corrected
before the full green run; no runtime permission or database guard was relaxed.
Ignored evidence is under `tmp/industry-release`: `phase4c2a-rehearsal.log`,
`phase4c2a-api.log`, `phase4c2a-build-final.log`, `phase4c2a-browser.log`, `phase4c2a-browser-final.log`,
`phase4c2a-lint.log` and `phase4c2a-tsc.log`. Screenshots are under
`test-results/local-access`. No client records or hosted sessions were used.

Phase 4C2b remains: CRM/document dashboard attribution and its matching links and
choices. Dashboard totals are unchanged by this slice. This is local `staging`
development only; hosted backup/restore rehearsal, pilot effective-access
comparison and production release gates remain required.
