# R7.1 - Shared Sales Orders: implementation scope

Status: planned, not implemented. R6 production branding/PDF release is complete.
The R6 recovery companion is implemented locally; see STORAGE_RECOVERY.md.

## First increment

Create a draft sales order from an accessible saved quotation revision. Preserve
the selected customer identity, agreed lines, calculation, currency and source
revision in a server-created snapshot. A separate explicit action confirms the
order; an authorized cancellation records its reason and actor. Saving, previewing
or issuing a quotation does not create or confirm an order.

Keep this increment industry-neutral. Use a new owning `modules/sales-orders/`
module and application composition for the Sales Documents source adapter. Do not
reuse AppointmentOrder or add property fields to the shared order model. A future
Real Estate reservation extension can associate a property unit with the order.
Tenant terminology may display Sales Order as Booking without changing its rules.

## Proposed rules to implement and test

- Separate optional `salesOrders` activation, dependent on Sales Documents and its
  existing CRM dependency. Platform allowance and tenant enablement both apply;
  migration must not automatically activate existing tenants.
- Explicit read, create, confirm and cancel permissions. Apply current tenant and
  opportunity record scope on every request, forced RLS and composite tenant FKs.
  Deactivating a dependency must follow the existing dependent-module rules.
- States: Draft, Confirmed, Cancelled. Confirmation is explicit. Cancelled is
  terminal; retain records and history rather than deleting or reopening them.
- Server copies a selected saved revision. No caller-supplied customer/price/total
  snapshot. New quotation revisions never change existing orders. In this first
  increment, changing agreed commercial terms requires cancelling the draft and
  creating one from the corrected quotation revision.
- One non-cancelled order per quotation, enforced in the database. Repeated or
  concurrent creation requests return the same order for the same source revision;
  a conflicting revision returns a conflict. Cancellation permits a replacement.
- Version checks and row locks protect confirmation/cancellation. Transitions and
  audit events commit atomically. Show the source revision, state, actor and time.
- Quotation issuance and order confirmation are distinct actions. Do not require
  PDF storage to create a draft or silently interpret PDF issuance as acceptance.
- Confirmation in R7.1 records the commercial agreement only: it does not reserve
  property, decrement stock, create appointments, record money received or close
  the opportunity automatically. Explain that boundary where users confirm.
- Reuse existing decimal calculation and currency rules; never convert agreed
  values to JavaScript floating-point calculations or reuse appointment cents as
  a general financial model.

## Delivery sequence

1. Additive schema/migration, module and permission registration; tests for existing
   data preservation, no automatic activation, RLS and tenant foreign keys.
2. Source adapter and create/read/list/confirm/cancel service with transactional
   auditing, pagination, current permissions and record scopes.
3. Shared list/detail UI, quotation Create Sales Order entry point, confirmation
   dialogs, cancellation reason and order history. Use existing access-aware page
   components and terminology; check desktop/mobile layouts.
4. Isolated integration/concurrency tests and synthetic staging workflows. Record
   hosted evidence separately. No production migration or deployment as part of
   local implementation; review and release after staging verification.

Reservations/expiry/unique-unit allocation belong to R7.2. Receivables, payment
allocations, reversals, accounting and payment gateways belong to later work.
Do not silently extend this first increment into fulfilment or accounting.
