# P13A3 customer tax identities

Customer tax facts now belong to the canonical person or business account, through
one shared `platform/tax/party` contract, service and editor. CRM installs only
the source access probe and routes. No Real Estate dependency, second contact
directory, custom tenant override or inferred tax treatment is introduced.

## Usage

Open a contact or business account and choose **Tax details**. Choose **Add tax
identity**, explicitly select Registered or Unregistered, enter the reviewed
legal details and effective dates, confirm the review, then save.

- Registered identities require a structurally valid GSTIN, its matching state
  code and an explicit registration category. Checks are offline and do not
  verify GSTN status, legal name, address or statutory eligibility.
- Unregistered is an explicit dated assertion, not the absence of a GSTIN. No
  active identity means **Not assessed**. Creating an identity never copies a
  linked person's/business's assessment or interprets a free-text address.
- A party can have several registered GSTINs. The same registration can be
  recorded independently on separate parties. A duplicate on the same party
  must be edited or restored, including when its prior entry is archived.
- Active unregistered and registered assertions cannot coexist for one party and
  scheme. Archive the previous assertion before recording a different status.
  Effective dates are reviewed evidence; the directory summary is not a decision
  that a registration applies to a particular supply or invoice date.
- Addresses may be incomplete at directory entry. A later statutory workflow
  must validate its required recipient details before approval or issuance.

Use **View tax details** to review history or edit. Registration number, status,
scheme and party ownership remain fixed. Archive and replace a wrong identity;
ordinary reviewed versions can correct legal names, categories, addresses and
effective dates. Every version, including archive/restore, retains an immutable
copy and reviewer ID. History and identity lists are paginated.

A stale save returns a conflict and retains the draft. **Reload saved details
(discard draft)** explicitly replaces it. Browsing history never upgrades the
draft's optimistic version or silently overwrites it with another review.

## Access and storage

Read and Edit use the owning contact/account's existing profile actions, Read
bounds, scope adapter, module activation and Restricted sharing. Archive/restore
also requires that owner's Archive action and record scope. No staff/manager
label grants authority. Archived owners cannot receive new/restored active tax
details; existing identities can still be archived by an authorized editor.

Writes refresh authorization after the shared tenant security lock, lock the
canonical owner, check the expected identity version and write strict parent
audit events in the same transaction. Child saves do not increment the parent's
ordinary version or overwrite an open contact/account draft.

Migration `20261030000700_party_tax_identities` adds two empty tables. Native
tenant/owner foreign keys, exactly-one-owner checks, forced RLS, Restricted owner
privacy, fixed identity/version checks and immutable review proofs retain the
canonical source boundary. Every intermediate version within a transaction must
have its own matching history. Revisions cannot be forged ahead of a current
head, updated or deleted. Conflicting active statuses serialize on their owner.
These native boundaries complement, rather than replace, the service's full
action/scope authorization.

## Financial boundary and verification

This is recipient master data only. Accepted participant snapshots, quotations,
orders, commercial invoices, payments, amounts, numbering and archived PDF bytes
are unchanged. No prior customer is marked unregistered. Approved source
selection and frozen recipient tax evidence remain P13B work; statutory GST
document issuance remains P13C work.

Run `npm.cmd run test:party-tax` for the disposable localhost migration and
native/API checks, or append `-- --browser-only` after building for its browser
flow. The suite never reads hosted credentials or seeds/resets hosted databases.
The migration rehearsal verifies forced rollback and exact preservation of all
prior rows, policies and stored functions, and admission checks cover both new
models under their canonical contact/account resources.
