# ERP standardization

## First increment - 2026-10-03

The GitHub repository is renamed to `alvinleigia/ls-erp`, preserving repository
ID 1279282190. Local origin points to the renamed repository. Package identity
and structured log service name are `ls-erp`; the application title remains
Leiweissen ERP. Existing test-account email addresses and historical deployment
references are identifiers, not branding, and remain unchanged.

The working directory remains `C:/xampp/htdocs/ls-salon` for this active workspace.
The Vercel project and live tenant domains are separate hosting identifiers; this
increment does not change tenant URLs or authentication configuration.

Vercel Git reconnection was completed by the user and verified on 2026-10-03:
project `prj_qY27BxXafWCTenEyiYArTrxTQ0tR` links to `alvinleigia/ls-erp`,
repository ID 1279282190, production branch `main`. The Vercel project display
name is still `ls-salon`; no application deployment was made.

Invitations and appointment invoice email/PDF defaults use the resolved tenant
name. Empty names fall back to Leiweissen ERP. Tenant names and invitation links
are HTML-escaped in email templates. Existing INVOICE_HEADER_LINES is only a
legacy fallback for PDF callers that supply no tenant name. Email delivery still
requires the configured MAIL_FROM address; no invented sender domain is used.

## Shared UI

`components/erp` now owns page headers, sections, surfaces, filters, controls,
server-backed record selectors, pagination, record tabs, read-only fields,
menus and focused edit panels. CRM entry points delegate to these components.
CRM action/tab/link permissions stay in the CRM adapters. Access-role settings
uses the neutral components directly without depending on CRM presentation.

This is an extraction of the tested layout, not a completed rewrite of the
legacy Inventory, Services, Appointments, Leaves or Shifts screens. No schema
migration is required for this increment.

## Following increments

1. Extend module allowances and API action permissions to each legacy module
   after documenting its dependencies and preserving existing tenant access.
2. Adopt the shared UI in Inventory, then Services, Appointments, Leaves/Shifts,
   and Dashboard/Reports. Preserve workflows, server pagination and indexed
   queries; test each module before rollout.
3. Continue the access-control record-scope work in TENANT_ACCESS_CONTROL.md.
   Moving presentation components does not grant additional record access.

Live domain migration needs its own host-routing, authentication and email-link
cutover plan. Do not replace hostnames or persisted identifiers by global search
and replace.

## Validation

Production build, TypeScript and targeted ESLint passed. All 30 intercepted
browser regressions and 20 permission/navigation unit checks passed. Mobile
role and project edit-panel screenshots were inspected. Tenant invitation
branding, fallback and HTML escaping were checked without sending email.
Code changes are committed locally only; the GitHub repository rename and origin
update are complete. Push and deployment remain pending. No migrations or business-data changes were required.
