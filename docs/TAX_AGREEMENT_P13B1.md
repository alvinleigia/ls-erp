# P13B1 shared agreement calculation and saved-profile preview

This increment provides the reusable calculation contract needed before source
tax approval and invoice posting. It does not attach GST to existing commercial
agreements or change their amounts, charges, billing allocations or PDF bytes.

## Try the preview

In **Settings > Company tax profiles**, choose a company, open **Tax profiles**
and select **Preview calculations** beside a saved profile.

Enter a currency, line price and eligible discount. The saved profile determines
whether the price includes tax and which percentage components are available.
Choose one of its configured jurisdiction variants. A profile without charged
components uses the explicit no-components choice. This choice is a simulation;
it does not establish place of supply or tax eligibility.

**Calculate preview** shows the exact net, each component, tax and gross totals.
An optional **First portion gross** illustrates a partial allocation and the
exact remaining balances. It creates no partial invoice or financial record.
An eligible discount is supplied explicitly; the calculator does not decide
whether a commercial discount legally reduces the taxable value.

The preview always uses the published profile version and its frozen rates.
Changed directory rates produce a warning. Publish a new reviewed version to
capture them. A changed profile returns a conflict; entered amounts remain until
**Reload saved profile** refreshes the version. Changing inputs hides the prior
result, so it cannot appear to describe different values. Excess meaningful
currency precision is rejected rather than rounded during input conversion.

Disabled profiles and archived companies can be simulated but are clearly
identified as inactive; previewing does not activate them. The endpoint retains
the actual Tenant Admin and tax-configuration Read boundary. A caller cannot
submit its own rates, price basis or an unconfigured jurisdiction variant.

## Shared calculation contract

`platform/tax/agreement.ts` is independent of modules, industries, countries,
database access and current master-data lookups. Callers supply already-resolved,
authorized line amounts and eligible discounts in integer currency minor units.
Quantity/unit-price calculation and eligibility belong to the owning source.

The format-1 result captures currency, minor-unit precision, explicit
`LINE_EXACT_V1` policy, stable line identities, original amount, discount, price
basis, canonical component codes/rates, net, tax and gross values. Values are
JSON-safe and retain no mutable input references. All bounds use exact decimal
or BigInt arithmetic; aggregate overflow, duplicate identities/codes and invalid
rates fail before a result is returned.

- Exclusive prices: subtract the eligible line discount, then round each flat
  percentage component half up using the existing shared arithmetic helpers.
- Inclusive prices: preserve the exact discounted gross, round extracted net
  half up, then distribute its tax remainder among components by exact rate
  weights. Canonical ASCII code order resolves equal remainders deterministically.
- Uncharged and fully discounted lines retain their values without inventing
  exempt, nil-rated or unregistered statutory classifications.
- Policy and format are explicit so future supported computation policies can
  be introduced without silently interpreting old calculations differently.

`allocateTaxPortion` uses the remaining frozen net/component balances. Prior
consumption must identify the same line and every component, reconcile exactly
and remain within the frozen amounts. Each portion is non-negative and the final
portion consumes the precise remainder of every bucket. `addTaxPortions` combines
matching portions without binary floating-point totals. Portions can depend on
billing order; future posting must persist actual allocations and credit their
original components, rather than recalculate historical portions.

Independent cumulative rounding can make a one-cent bill allocate two tax cents
and a negative net cent. Remaining-balance apportionment avoids that defect.
This is an explicit calculation/allocation policy, not a statement of statutory
eligibility or an implemented invoice ledger. Native posting, cancellation and
credit guards still need to be integrated before tax-aware billing is enabled.

The current profile preview supports its existing flat percentage components.
Fixed, compound, tax-on-tax and withholding calculations are not silently mapped
to this policy. Odoo likewise separates pricing inclusion and computation
configuration; see its [official tax computation documentation](https://www.odoo.com/documentation/19.0/applications/finance/accounting/taxes/tax_computation.html).

## Scope and verification

Source approval must next bind supplier registration, recipient identity/status,
dated supply/place evidence and reviewed profile versions through source-specific
authorization. It must reconcile the new breakdown to the reviewed agreement,
without adding GST again to historical commercial charges. Frozen invoice
allocations, credit/reversal integration and statutory issuance remain pending.

`npm.cmd run test:tax-agreement` runs the disposable localhost suite. After a
build, append `-- --browser-only` for its browser flows. Tests include fractional
rates, currencies with different minor units, overflow, inclusive/exclusive
discounts, one-cent portions, 300 deterministic split sequences, invalid prior
allocations, stale profiles, frozen-rate warnings and administrative/tenant
bounds. Existing commercial invoice, advance, credit, PDF and partial-billing
tests remain part of the regression suite. No schema migration is added.
