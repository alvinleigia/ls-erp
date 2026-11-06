# Customer and business addresses

Open a contact or business account, then select **Addresses**.

1. Click **Add address** and give it a useful name, such as Home, Head office or
   Project site.
2. Choose its purposes: Correspondence, Billing, Delivery / site. One address can
   serve more than one purpose. Enter address line 1 and country; add the remaining
   address and communication fields as needed.
3. Optionally choose a default for each purpose. Saving a new default replaces the
   previous default for that owner and purpose only.
4. Click **Save address**. Use **View address** to edit or archive it. Archiving
   removes its defaults and makes it unavailable for new selections, preserving
   saved transactions. Archived addresses can be restored if the owner is active.

The contact's profile address remains its base correspondence address. An active
named correspondence default takes precedence when creating a new transaction.
Business accounts use their own address book; a linked person's address is never
assumed to be the buying company's address.

## Use an address for a transaction

Open an opportunity > **Customer details** > **Edit customer details**. Each
participant has Correspondence, Billing and Delivery / site tabs.

- New transactions copy the current authorized defaults once.
- **Choose saved address** selects another active address for that purpose.
- Edit the copied fields to use a different address for this transaction.
- **Clear separate address** removes an optional billing or delivery copy.
- Save customer details to accept the independent transaction copies.

A second opportunity for the same customer can use different addresses. Editing
one CIF never updates another opportunity or the address book. Existing sources
without a saved CIF offer defaults in the edit draft; opening or cancelling does
not save them. Existing saved CIFs are not automatically supplemented or refreshed.

## Quotations, orders and documents

Creating a quotation captures the correspondence, billing and delivery copies.
Orders retain the selected quotation revision. Existing saved revisions and
issued PDFs never synchronize with current customer addresses.

The standard quotation PDF prints separately saved billing/delivery addresses.
Custom quotation, company letter, receipt and commercial invoice/credit templates
can insert **Saved billing addresses** and **Saved delivery / site addresses** as
dynamic sections. These sections use the accepted snapshot only; no missing
address is inferred. Their order and presence are controlled by the template.

Tax registration identities and reviewed statutory billing details keep their
existing approval rules. This address book does not replace or approve them.

## Access and conflicts

Read, Edit and Archive follow the contact or business account's current permissions
and record scope. Opportunity access alone does not grant access to its directory
address book. Accepted transaction copies remain visible under source access.

If a selected address changes before saving, choose it again and review the new
version; the draft is retained. Editing copied fields makes that purpose a manual
transaction address. If the source or customer-detail requirements change, reload
the source draft before saving. Audit records capture address changes and default
transfers. Addresses are archived rather than permanently deleted.

## Regression checks

The guarded disposable participant suites include address migration preservation,
owner access, snapshot and browser checks:

```powershell
npm.cmd run test:participant-information
npm.cmd run test:participant-information:browser
```

Use the normal controlled migration/release workflow for hosted environments.
