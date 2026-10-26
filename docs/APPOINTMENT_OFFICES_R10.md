# R10: appointment and booking office ownership

## Phase 2D5A: native ownership (local)

Appointments and booking orders have required tenant and office identities.
Children inherit the booking order's office: service/product lines, coupon/tax
snapshots and linked operational appointments. Neither identity nor source links
can be moved by editing payloads. Restrictive database policies apply in addition
to existing tenant, module and composable action permissions. Staff/Manager labels
and directory access do not grant booking access.

New independent records require the office/version captured when the form opens.
The server binds it on a transaction connection for preflight and rechecks it under
the shared scheduling lock before saving. A stale form returns 409 and retains
its draft. Editing an existing record uses its saved office, including when the
user changes their workspace preference. A linked appointment uses its order's
office rather than the workspace preference.

New, moved or reactivated bookings require an active employee with an office
grant and a dated workplace covering the whole slot. Calendar dates use the tenant
time zone and treat an exact midnight end as exclusive. Existing assignments and
financial snapshots are retained for non-scheduling edits. Hidden bookings and
leave still prevent conflicting bookings through the private integrity adapters;
ordinary Read visibility cannot decide whether a slot is free.

## Financial and audit boundaries

- List/detail, linked lines and invoice exports follow the saved office. The
  protected office label contains only its company/name/active state; business
  users do not need company-directory administration access.
- Closed offices allow saved Read and PDF export; mutations and invoice email
  require an active office and fresh action/module access. The UI labels a closed
  booking order and suppresses its mutation/email controls.
- Service/product prices, coupons, taxes and invoice branding stay frozen under
  the existing financial edit rules. A deferred database check verifies that
  operational appointments and their service lines agree at commit, allowing
  the existing transaction to synchronize them in either order.
- A Create grant can create a new order's children but cannot append financial
  children to an old order. Edit and Archive remain distinct permissions.
- Bulk appointment commands reject hidden selections atomically and partition
  audit identities and before/after arrays by office. Readers cannot see another
  office's records through a combined bulk audit.
- Coupon usage limits count all offices through a protected aggregate without
  returning hidden order identities. Renaming/deleting a used coupon also checks
  hidden usage; historical coupon codes cannot be detached from their usage.
  Ordinary coupon usage displays/reports retain their scoped source visibility.

## Migration 127

`20261026001600_appointment_offices` is an unreleased, transactional migration.
Existing appointments/orders are assigned to their tenant's initial office;
linked appointments inherit their order's office. Missing historical tenant IDs
are inferred only from agreeing native customer/staff/service relationships.
Inconsistent source links or cross-tenant product references abort the migration.
No runtime compatibility adapter, tenant exception or grant expansion is added.

The rehearsal compares every prior business table and preserves IDs, timestamps,
financial values, branding, staff assignments, source links, permissions, policies
and existing function grants. Only the explicit ownership fields, inferred tenant
identity and appointment audit ownership metadata may differ. It also deliberately
corrupts a historical link to prove a clean abort, then forces a later SQL failure
to verify complete rollback and policy/function restoration.

## Verification and next slice

Verification commands:

```powershell
npm.cmd run test:appointment-offices
npm.cmd run test:appointment-offices:browser
node scripts/test-sales-orders.cjs --availability-boundary
npm.cmd run build
```

Local verification on 2026-10-26: 11 native ownership tests passed. The real-sign-in
Chrome scenario passed stale-draft rejection, fresh creation, saved-office edits,
manager office filtering and hidden invoice denial. Draft and source-office
screenshots were inspected. All 176 private-availability, booking, workforce access
and workforce rule regressions passed without skips. The final production build,
TypeScript, changed-file ESLint (zero warnings) and whitespace checks passed.

All fixture data lives in disposable local PostgreSQL. Browser scenarios use real
sign-ins against the local production build, never hosted client accounts.

Phase 2D5B still needs the paged office/date-scoped appointment staff pickers,
retained saved-assignee handling and office-aware browsing/filter controls. This
slice enforces native ownership before that UI work; existing generic appointment
staff selectors may still offer choices that the server rejects. Inventory stock
ownership and remaining operational/report/release checks also remain pending.
Do not deploy the accumulated R10 migrations or describe all modules as released.
