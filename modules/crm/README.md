# CRM module

CRM owns contacts, business accounts, contact/account relationships, enquiries,
configurable pipelines, opportunities, follow-up tasks and activity. Contacts do
not need login accounts. Existing salon records and authentication are preserved.
See `docs/MODULAR_PLATFORM.md` for boundaries, migration and deferred work.

`service.ts` owns operations and authorization scopes. Routes authenticate the
caller and establish tenant database context; they do not implement business rules.
`sales-service.ts` owns opportunity/pipeline operations using the same transactional
authorization boundary. Stage definitions are tenant data; enquiry statuses remain
a separate intake lifecycle.
Lia must eventually call these operations through an authenticated adapter, never
write these tables directly or trust a tenant ID supplied by a conversation.
