# CRM module

CRM owns contacts, business accounts, contact/account relationships, enquiries,
configurable pipelines, opportunities, follow-up tasks and activity. Contacts do
not need login accounts. Existing salon records and authentication are preserved.
See `docs/MODULAR_PLATFORM.md` for boundaries, migration and deferred work.
See `docs/CRM_SALES_PHASE_3.md` for the optional Real Estate projects extension,
owned by `modules/real-estate/`. Shared CRM invokes narrow extension hooks within its existing transactions.
See `docs/CRM_SALES_PHASE_4.md` for optional sales context, project filters,
conversion preservation and the editable property-sales pipeline draft.
Generic CRM continues to work without enabling Real Estate.
See `docs/CRM_SALES_PHASE_5.md` for sales reporting semantics, role-scoped
drill-downs and bounded CSV downloads. `sales-report-service.ts` shares the
scoped SQL sets across metrics, breakdowns and exports. Existing list exports
reuse their list-service predicates inside the same transaction.
See `docs/CRM_SALES_PHASE_2.md` for additive lead-intake fields, managed sources,
conversion attribution, migration and verification. `intake-service.ts` owns
source management and shared enquiry context validation/referrer redaction.

`service.ts` owns operations and authorization scopes. Routes authenticate the
caller and establish tenant database context; they do not implement business rules.
`sales-service.ts` owns opportunity/pipeline operations using the same transactional
authorization boundary. Stage definitions are tenant data; enquiry statuses remain
a separate intake lifecycle.
Lia must eventually call these operations through an authenticated adapter, never
write these tables directly or trust a tenant ID supplied by a conversation.
