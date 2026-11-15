# Customer Verification activation controls

Step 1, 2026-11-16. Customer Verification is listed under **CRM and sales** in
the shared module controls used by both the platform tenant dialog and tenant
Settings > Modules. The existing creation-time module selector already lists it.

## Activation path

1. Platform administrator: Parent Console > Tenants > the intended tenant's
   actions > Manage modules > CRM and sales > Customer Verification > Allow.
   CRM must already be allowed. Follow the existing allowance behaviour: a newly
   allowed module starts enabled only when its dependencies are active. Repeated
   platform allowance does not override the tenant's later disabled choice.
2. Tenant administrator: Settings > Modules > CRM and sales > Customer
   Verification. Enable/Disable is available only while the platform allows it,
   and enabling requires active CRM. Staff and managers cannot change activation.
3. Once enabled, **Open Customer Verification** links to
   `/settings/verification`. Configure requirements and transaction checkpoints
   there, and assign collection/review access separately through access profiles.

Activation does not publish requirements, create verification cases, approve
customers, grant staff access or enable transaction checkpoints. Fresh tenants
have unpublished requirements and Off checkpoints. Existing saved configuration
is retained when a module is disabled; enabling again is not a reset.

Disabling or removing allowance requires confirmation. The dialog explicitly
warns that existing **Required** transaction checkpoints still apply afterwards.
Module disablement must not become a bypass for published transaction rules.

## Scope and verification

This increment changes shared UI grouping, explanatory text and tests only. It
adds no dependency, database migration, permission backfill or production setting
change. Ewissen activation and business requirement/reviewer choices remain
separate. The private production bucket was provisioned in the previous release.

Local verification: seven module-control browser scenarios, 18 focused unit/source
checks, TypeScript, ESLint and an isolated production build. Desktop/mobile
captures were inspected. Browser coverage includes every registered module being
reachable exactly once across the settings groups, dependency guards, restricted
viewer controls and confirmation/cancel behaviour.

Hosted staging acceptance is `tests/staging-access/verification-activation.spec.ts`.
It uses the guarded P13S fixture with only CRM initially allowed, then exercises
real platform allowance, tenant toggles, settings navigation and revocation through
the UI. It verifies unpublished requirements, Off checkpoints, unchanged other
module flags and denied manager/reviewer access without separate grants. Only a
new synthetic staging tenant is changed. No SQL seed/reset helper runs against a
hosted database. Deployment and final acceptance receipts are ignored under
`tmp/p13s-activation` and `tmp/p13s-staging`.
