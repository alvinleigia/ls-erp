# CRM module

CRM owns contacts, business accounts, contact/account relationships, enquiries,
follow-up tasks and enquiry activity. Contacts do
not need login accounts. Existing salon records and authentication are preserved.
See `docs/MODULAR_PLATFORM.md` for boundaries, migration and deferred work.

`service.ts` owns operations and authorization scopes. Routes authenticate the
caller and establish tenant database context; they do not implement business rules.
Lia must eventually call these operations through an authenticated adapter, never
write these tables directly or trust a tenant ID supplied by a conversation.
