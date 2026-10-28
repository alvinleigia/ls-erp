# R10 hosted appointments and inventory acceptance

Phase 6D3 verified on 2026-10-28: **168 hosted checks**, **57 cleanup checks** and
**95 independent read-only audit checks** completed. Setup used a further 38
ordinary API checks. These counts include HTTP/status and behavioral assertions,
not separate end-to-end scenarios. No application, schema or deployment change
was needed; production was not modified.

## Target and fixture

All writes targeted fresh synthetic IDs in the existing staging QA tenant A;
QA tenant B supplied isolation checks. The READY candidate remains `525b853`,
deployment `dpl_6NfY4xSqeUewfepB3Fhp6gzqZdMg`, on all three staging aliases.
Staging has 132 applied migrations, no pending/rolled-back attempts, and an
ordinary runtime role without superuser/BYPASSRLS authority. Production remains
on `dpl_FdMekGVQcdDYNqegF8cy58rAJq2a`.

Setup created an operating company with East/West offices, six accounts, two
profiles, one product/category/supplier and one service/category. Two fresh Staff
accounts received Flexible employee profiles, explicit office grants, future
workplace placements and dated availability. All setup used the normal APIs;
no hosted SQL fixtures, seeds or resets ran. Existing account grants, settings
and module flags were not changed. Required modules were already active.

The booking date was 2036-02-05 in the saved Asia/Kolkata timezone. Explicitly
dated test workplaces and slots kept the fixture separate from current staff
availability and avoided inventing employee eligibility through a job label.

## Inventory and purchase receipt checks

- A product started with five units in East. Receiving a three-unit purchase
  while the writer's workspace was West raised East to eight and left West zero.
  Repeating Received, then reopening and receiving again, did not add stock twice.
- A versioned count correction raised East to ten. A stale stock version rejected
  both the count and a simultaneous catalogue-name change. A read-only user could
  not adjust stock. A stale creation-office header also rejected a new product.
- The East-only reader could not inspect West quantities. Another tenant could
  not read the product or purchase. Product identity remained tenant-shared while
  quantity/cost context followed the permitted office.

## Booking, conflicts and source-office stock

A one-hour service at 5,000 cents and two product units at 500 cents each produced
a 6,000-cent subtotal. A ten-percent coupon gave a 5,400-cent total in both preview
and save. Preview did not consume stock.

West could not confirm a product sale against East's stock. After a normal count
correction gave West two units, its booking consumed one there only; repeating
confirmation did not consume another. East's booking consumed two of its ten
units and retained its native office. Each source's stock stayed separate.

An East-only reader could not list/read the West appointment or order, and the
second tenant could not read the booking sources. Nevertheless, the hidden West
customer booking blocked an overlapping East attempt. The error disclosed no
hidden record ID. A visible staff conflict was also rejected. A standalone
appointment could be created and rescheduled to a free time; moving it into the
existing booking was denied. The reader lacked cancellation authority.

Editing East's product quantity from two to three while the workspace was West
deducted one additional unit from East only. An attempted 999-unit edit failed
without changing order lines or stock. With seven units available, two concurrent
six-unit booking requests returned one 201 and one 409; stock remained one. The
failed request left no order. Canceling the successful race order restored six
units, and repeating cancellation did not restore them twice.

Canceling the primary East order restored its updated three-unit quantity,
returning East to ten. West's cancellation restored West to two. Linked and
standalone appointments were canceled through their ordinary source actions.

## Financial reads and permission changes

Changing shared MRP to 900 cents did not reprice saved 500-cent booking lines.
The edited three-unit booking retained its coupon-adjusted 5,850-cent total.
After replacing the reader's profile with a financial-only profile:

- Product catalogue/stock Read was denied.
- The saved purchase still exposed its product label and frozen 100-cent cost,
  without office quantity fields in the label projection.
- The saved booking remained readable, and invoice export returned a valid PDF
  with the retained financial source. No invoice email was sent.

Office revocation hid the booking/purchase and denied stock context in the
existing session. Profile revocation then denied both booking and inventory
entrypoints. No module-local fallback or permission override was added.

### Staff lookup contract

Appointment Read already authorizes the limited generic Staff identity lookup;
this is explicitly covered by `tests/core-access.integration.test.cjs`. It does
not grant `/api/users` administration or access to staff business records. The
hosted check retained its limited identity fields rather than changing that
existing contract. This lookup is tenant-shared, not office-scoped.

Booking controls use the separate office/date-scoped picker. Its create request
uses the captured workspace office/version headers, not an arbitrary `officeId`
query parameter. The hosted picker returned only the eligible East staff member.
The initial runner incorrectly expected the generic lookup to return 403 and
then supplied the disallowed query field. Both expectations were corrected
against the existing tested contracts. No application access rule was changed.

## Browser checks and evidence

Desktop Inventory and the 390-pixel mobile saved-booking view were exercised in
separate Chrome contexts and visually inspected. They showed the source office,
quantity, saved item prices, coupon and total without page-body horizontal
overflow or JavaScript page errors. Browser checks covered rendering/search;
business writes used normal authenticated APIs. PDF checks covered successful
response and PDF header, not a new page-by-page print-layout review.

The initial and resumed assertion segments used one fixture; successful stock,
receipt and booking writes were not replayed. Failed-expectation evidence remains
separate from the completion receipt. Counts include repeated fresh sign-in
checks across those segments. `.playwright-auth` was not modified, and passwords
and session state were not printed or committed.

## Cleanup and independent audit

All three created booking orders and four appointments are canceled. The two
synthetic office quantities were corrected to zero through the normal stock API.
The referenced product, supplier, inventory category, service and service category
remain inactive. No active test coupon remains. Six new accounts are archived;
their explicit office grants and business profiles are cleared. The two future
workplaces are canceled, dated availability is removed, and the test offices,
company and access profiles are archived.

The received purchase remains as financial history: three units received once,
100-cent unit cost and 300-cent total, in its original East office. Booking prices,
coupon totals and historical invoice access remain intact after cancellation.
These native receipt/history rows were not deleted to make cleanup appear complete.
Hosted checks verified quantities, source receipts and saved values; detailed
movement/audit rollback assertions retain the earlier native integration evidence.

Private evidence: `tmp/industry-release/phase6d3/MVRJUR1R/fixture.json`,
`assertions.json`, `cleanup.json`, `cleanup-audit.json`, `receipt.json`, prior
attempt receipts, two PNG captures and the invoice PDF. Utilities/receipt hashes
are retained privately with the existing staging recovery checkpoint. No raw
client data, credentials, environment files or browser state are committed.

Next: phase 6D4 hosted Leaves and Shifts. Invitation acceptance/expiry, multiple
managers on one team, module activation and broader browser-write/sharing scenarios
remain explicit acceptance gates. Production requires its own fresh recovery and
authorized cutover decision.
