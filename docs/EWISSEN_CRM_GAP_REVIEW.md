# Ewissen CRM screenshot capability review

Reviewed: 2026-09-28.

Planning note: the phase numbers below belong to the earlier architecture plan.
The CRM-and-sales-only [active delivery plan](CRM_EXTENSIBILITY_PLAN.md) supersedes
that sequence. Use [Phase 1 mapping and contracts](CRM_SALES_PHASE_1.md) for current
delivery phases and verification; this review remains the screenshot evidence.

Scope: the nine supplied PNG files in `docs/ewissen-current-crm`, current source
code, and `CRM_EXTENSIBILITY_PLAN.md`. This is a capability and scope review, not
a fresh runtime test or verification of the client's backend behavior. No feature
implementation or change to the six-phase plan is included in this review.

## Finding

The supplied application includes lead management, customer applications/property
bookings, and receivables/collections. Our current CRM provides the lead, contact,
opportunity and follow-up foundation. The six-phase plan covers projects and links,
and broadly anticipates property bookings. It does not yet define sufficient scope
to replace the customer application, payment schedule or collections workflows.

Phases 1–3 can deliver project-based presales. Full replacement requires explicit
booking/application and receivables deliverables plus a migration/reconciliation
workstream. Generic configurable fields are not a substitute for those workflows.

## Evidence reviewed

| Reference | Supplied screenshot | Visible scope |
|---|---|---|
| L1 | `Ewissen CRM Leads/g70.ourmandi.com_add-leads.png` | Contact/company details, separate WhatsApp, source, expected close, partner, assignment, address, status and description |
| L2 | `Ewissen CRM Leads/g70.ourmandi.com_leads-listing.png` | Name/mobile/company search, Export Leads, source/partner/assignment/close-date columns and Fill CIF action |
| L3 | `Ewissen CRM Leads/g70.ourmandi.com_view-leads_id=609.png` | Lead details, address, created/modified information, comments, follow-up date/time |
| L4 | `Ewissen CRM Leads/g70.ourmandi.com_view-leads_id=609 (1).png` | Close status and additional commercial-value inputs; some labels are clipped |
| B1 | `Ewissen CRM/g70.ourmandi.com_add_cif.png` | Customer application, documents, co-applicant, project/subproject/plot, booking details and sales participants |
| B2 | `Ewissen CRM/g70.ourmandi.com_view-booking_id=222.png` | Application identifiers, booking, totals, instalments, other charges, receipts and calling comments |
| P1 | `Ewissen CRM/g70.ourmandi.com_payment_installment_edit_id=222.png` | Instalment event, mode, amount, payment date, other-charge indicator and remarks |
| P2 | `Ewissen CRM/g70.ourmandi.com_payment_installment_edit_id=222 (1).png` | A second screenshot of the same visible instalment form |
| P3 | `Ewissen CRM/g70.ourmandi.com_add_payment_id=222.png` | Receipt date/amount, due dates, interest, discounts, mode, bank/reference details and supporting file |

Long images were inspected in full-resolution sections where needed. Personal
names, identifiers and payment values are deliberately omitted from this report.

The menus show Inventory, Channel Partners, Reports, Collection and HelpDesk, but
their dedicated screens were not supplied. Their workflows cannot be inferred
from the menu labels. A WhatsApp number or an IVR/Facebook source value does not
establish that an integration exists. Receipt-send/PDF/status actions are visible;
delivery channels and backend behavior are not established by screenshots.

## Detailed capability comparison

"Exists" means implemented in the current CRM source, not exact screen parity.
"Partial" means a related capability exists with the stated gap. Planned features
remain unimplemented. Phase references below refer to the current plan; suggested
scope additions are explicitly distinguished.

| Capability and evidence | Current CRM | Current six-phase coverage and recommendation |
|---|---|---|
| Basic buyer name, email and mobile (L1–L3) | Exists in Contacts; enquiries refer to a contact. Creation is not the same combined lead form. | Reuse; consider an inline existing/new-contact flow in phase 3 if needed for intake. |
| Company association (L1–L3) | Partial: business accounts, contact/account relationships and an opportunity account exist. Enquiries do not store their own account context. | Specify company selection/display for lead intake in phase 3; do not copy company names into unrelated text fields. |
| Separate WhatsApp and alternate telephone, same-as-mobile control (L1) | Missing; a CRM contact currently has one phone field. | Phase 5 supports future fields in principle, but does not specify these. Add explicit basic contact requirements to phase 3 if needed for the pilot. Messaging is separate scope. |
| Customer address, country/state/city/postcode (L1–L3, B1) | Missing on CRM Contacts/Enquiries. Address fields elsewhere in the application do not provide CRM capability. | Add reusable contact address support by phase 3 if needed for intake. A project address in phase 2 is not a buyer address. Dependent geographic dropdowns need their own data source/design. |
| Lead source (L1–L3) | Partial: free-text source exists; no managed source dropdown. | Bring basic managed source choices forward to phase 3; the full business configuration editor can remain phase 5. |
| Lead assignment and reassignment (L1–L3) | Exists: assigned salesperson, role restrictions and reassignment handling. | Reuse. A dedicated assignment date/remarks display would be an additional presentation requirement. |
| Lead status and closure comment (L3–L4) | Exists with differences: fixed NEW/CONTACTED/QUALIFIED/CLOSED enquiry statuses and required closure outcome. Opportunities have configurable stages and won/lost outcomes. | Map the client's statuses in phase 1. A scheduled follow-up remains an activity, not necessarily a new lead status. Editable lead statuses are not already implemented. |
| Expected close date on the lead (L1–L2) | Partial: available on Opportunities, not Enquiries. | Decide in phase 1 whether to add an optional enquiry target date and carry it forward; implement by phase 3 if required. |
| Comments, calls and scheduled follow-ups (L3, B2) | Exists for contacts/enquiries/opportunities, including timed work, summaries, reminders and history. | Reuse. Linking these to a booking/application still needs phase 6 integration. |
| Created/modified information (L2–L3, B2) | Partial: timestamps, audit entries and actor-attributed enquiry/work histories exist. Identical created-by/modified-by panels and listing columns are not present throughout CRM. | Add the useful metadata presentation in phase 3, reusing recorded history. Preserve legacy actor/date information in imports. |
| Lead listing and search (L2) | Partial: server-paginated enquiries, search and status filtering exist. Enquiry search currently matches title/contact name; mobile/company search and the client's full column set are absent. | Add required search/filter/column support by phase 3. Existing contact search is not equivalent to lead-list search. |
| Export Leads (L2) | Missing in CRM. | Not explicit in the plan. Add an access-scoped export in phase 4, or phase 3 if essential to daily work. |
| Lead commercial close fields (L4) | Partial: opportunity amount/currency and won/lost handling exist. Separate market/list value, sale consideration and brokerage values are not modelled. Some screenshot labels are clipped. | Confirm exact meanings in phase 1; sales pricing belongs with booking scope, and brokerage with explicit partner/commission scope. |
| Project and subproject (B1–B2) | Missing. | Project master is phase 2; CRM links phase 3; subproject/phases are broadly phase 6. Define the parent/child relationship now, and bring subprojects forward if sales operates at that level. |
| Plot/unit number, area and price (B1–B2) | Missing; salon inventory is not property inventory. | Broadly planned in phase 6. Make plots as well as flats/units explicit, including area units and unique identity within the project hierarchy. |
| Fill CIF/customer application, reference numbers and booking date/status/type (L2, B1–B2) | Missing. Lead-to-opportunity conversion exists, but does not create a customer application or property booking. | Phase 6 mentions bookings but not the complete CIF flow. Explicitly add application numbering, booking lifecycle and conversion/linking behavior. |
| Salutation, DOB, family/relationship details and identity references (B1–B2) | Missing on CRM Contacts/applications. | Generic phase 5 fields are only an enabler. Specify a booking/application profile with appropriate access in phase 6A. Requiredness must be decided rather than copied from screenshot asterisks. |
| Customer photo, identity/KYC/passport and booking-form uploads (B1–B2) | Missing in CRM; staff-document capability elsewhere is not a customer-document module. | Explicitly deferred in phase 2 and otherwise unspecified. Add reusable secured attachments before the CIF/booking pilot in phase 6A, with document categories and access rules. |
| Co-applicant details and documents (B1–B2) | Missing. | Not explicit in any phase. Add applicant relationships in phase 6A and define supported number/roles. Reuse contact identity where appropriate. |
| Team head, site/sales manager, BDM, BDE (B1–B2) | Missing as distinct sales-participant roles; current opportunities have one assigned owner. | Project staff membership is planned but does not implement this. Define participant roles and visibility separately; implement with phase 6A or earlier if needed for lead allocation. |
| Channel partner attribution (L1–L2, B1–B2) | Partial foundation only: accounts/contacts exist, but partner attribution/agreements/commission do not. | Not a committed deliverable. Capture referral partner by phase 3 if required; add partner operations/commission as an explicit later increment. |
| List value vs sale consideration; cheque/cash presentation (B2) | Missing as booking pricing and receivables. One opportunity amount is insufficient. | Outside the detailed current scope. Define one auditable booking price/charge model with payment modes and allocations; do not infer the meaning of separate cash/cheque totals. |
| Event-based instalments, due dates and partial collection (B2, P1–P3) | Missing. CRM activities with due dates do not track monetary obligations or allocations. | Payments require separate scope in the current phase 6. Add an explicit receivables increment, proposed phase 6B. |
| Additional charges and pending/TBD amounts (B2, P1–P2) | Missing: no booking charge schedule. | Add charge definitions, scheduling and treatment of unknown amounts in phase 6B; do not treat unknown amounts as zero or hardcode screenshot amounts. |
| Payment method, bank/reference, cheque date and proof file (P3) | Missing for CRM/property bookings. | Explicit phase 6B scope linked to the attachment foundation. |
| Interest, discounts, final amount and pending balances (B2, P3) | Missing for booking receivables. | Phase 6B requires defined calculation, rounding, adjustment and allocation rules. The screenshots do not establish interest formulas. |
| Payment confirmation/failure, PDF and Send Receipt (B2) | Missing for property payments. | Explicit phase 6B scope. Confirm lifecycle and delivery requirements; include correction/reversal behavior before production money tracking. |
| Collection follow-up and outstanding reports (B2) | Partial: general call tracking and work reports exist. There is no booking balance, instalment ageing or collection report. | Reuse CRM activities once booking/receivable links exist; collection reports belong to phase 6B, not the phase 4 sales pipeline reports. |
| Legacy data import and reconciliation (all) | No Ewissen importer exists. | Not explicit in the plan. Begin mapping in phase 1, pilot lead import before sales cutover, and reconcile bookings/receipts/documents before full replacement. |

## Recommended changes to delivery scope

1. **Phase 1:** add a client field/status mapping and migration assessment. Confirm
   source lists, close-field meanings, participant roles, project hierarchy and
   booking/payment rules. Inventory documents and legacy identifiers. Map manual
   acceptance cases from these screenshots onto the new workflows.
2. **Phase 2:** retain Projects, with the subproject relationship explicitly designed.
   Implement that hierarchy early if leads must be assigned to subprojects.
3. **Phase 3:** include the basic intake gaps needed for client adoption: WhatsApp/
   alternate contact details, address, source choices, referral attribution,
   expected-close behavior, phone/company lead search and useful metadata. Build
   these as shared features or small module additions, not copied client screens.
4. **Phase 4:** retain sales reporting and add controlled export, a lead-import
   rehearsal and acceptance against actual client presales scenarios.
5. **Phase 5:** keep broader configuration/templates. Do not postpone essential
   operational fields until a general configuration editor is complete.
6. **Expand phase 6 into separately deliverable scopes:** **6A** property hierarchy,
   units/plots, applications/CIF, applicant documents and bookings; **6B** payment
   schedules, charges, receipts, balances and collections; **6C**, when required,
   richer partner/commission operations. These are proposed scope additions, not
   features already promised by the existing phase 6 description.

Document access and receipt infrastructure should be reusable across modules;
property booking rules remain in Real Estate. Existing salon orders or inventory
should not be repurposed for these records.

## Migration finding that needs early resolution

The lead-list screenshot appears to use the same email address for multiple
different named people and shows some repeated-looking entries. This is evidence
to investigate, not proof that those people should be merged.

Current CRM Contacts enforce tenant-unique email and phone values. A direct import
could therefore fail or map people incorrectly. Phase 1 should define shared vs
personal contact details, duplicate review/merge rules, normalized phone handling,
legacy IDs, and repeatable import behavior. Do not relax constraints or auto-merge
people simply to make an import succeed. Before financial cutover, reconcile
instalment obligations, allocations, adjustments and balances with source records.

## What can wait

- For a **presales pilot**, richer bookings, documents and collections can remain
  in the existing application, with a clearly defined handoff and record references.
- For **full replacement**, CIF/applicants, property bookings, active payment
  schedules, receipts, balances, documents and migration cannot be deferred beyond
  cutover if the client relies on them.
- Advanced automation, a full object builder, partner commissions and additional
  industry modules can follow actual demand. Basic partner attribution may be
  needed much earlier.
- HelpDesk, unseen reports, channel-partner screens and integrations need additional
  requirements evidence before classifying their detailed functionality.

## Source-code anchors

- `modules/crm/validation.ts`: basic contacts, free-text source, fixed enquiry
  statuses, required closure outcome and list query contract.
- `modules/crm/service.ts`: enquiry search, assignment, history and audit behavior.
- `modules/crm/sales-validation.ts`: opportunity amount/currency/close date,
  account link, configurable pipeline stages and list filters.
- `modules/crm/components/record-list.tsx`: current enquiry columns and filters.
- `modules/crm/components/enquiry-editor.tsx` and `enquiry-timeline.tsx`: existing
  intake/edit/conversion and history/notes surfaces.
- `modules/crm/work-validation.ts`, work/plan/follow-up services: scheduled work,
  outcomes, reminders, plans and rule behavior.
- `prisma/schema.prisma`: unique contact identifiers, CRM relationships and the
  absence of real-estate/application/receivable models; legacy appointment orders
  are separate salon records.
- `CRM_EXTENSIBILITY_PLAN.md`: the six planned phases used for comparison.
