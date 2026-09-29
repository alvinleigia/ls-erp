# CRM checkpoint release - 2026-09-29

- Commit `df1b560`: four completed Odoo-alignment phases, pushed to `main`.
- Hosted migrations successfully applied: `20260929090000_real_estate_choices`,
  `20260929120000_crm_custom_fields`, `20260929160000_crm_sales_teams`.
- Prisma reported the deployed checkpoint database up to date after migration.
- Vercel deployment `dpl_6M4kAEhXqADzLihCFYvtN5TUJjZu` reached Ready and was
  aliased to `salon.leigia.com` and `*.salon.leigia.com`, including CRM Test.
- Deployment URL: https://ls-salon-duqwmgtnw-alvin-araujos-projects.vercel.app
- Full hosted workflow verification was deferred by explicit user instruction
  until after payment-plan implementation. Prior local checks remain documented
  in the four phase delivery notes and are not hosted acceptance results.
- Automatic approval review rejected a full local hosted-database export because
  it would copy sensitive application data. No such backup was taken or exported.
  The separately authorized additive migrations succeeded. No reset/seed ran.

The subsequent quotation/payment-plan feature is local work, outside this
checkpoint. See [its delivery notes](CRM_QUOTATIONS_PAYMENT_PLANS.md).
