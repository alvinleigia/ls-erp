# Project detail view — 2026-09-29

Projects and subprojects now open in a read-only detail view. Overview shows
project details, property/pricing and configured additional information. Each
section has a focused edit panel. The header offers Edit project and a secondary
menu for Refresh and confirmed Archive/Restore.

Record-local tabs separate Overview, Subprojects, Sales, Activities and Team.
Subprojects do not offer another hierarchy level. Team remains manager-only;
subprojects explain inherited access. Related lists mount only when their tab is
opened, preserving existing server-side paging, filters and access checks.

Creation keeps project details visible, collapses optional property/pricing,
and defaults currency from the business display settings. Custom fields remain
available at creation, including fields required by configuration.

## Shared components

- `modules/crm/components/crm-record-detail.tsx`: keyboard-accessible tabs,
  read-only field grid, secondary action menu and edit panel with a fixed footer,
  saving/error state and an unsaved-change discard confirmation.
- `CrmSection`, `CrmPageHeader`, `CrmFormActions`, shared controls, selectors,
  tables and pagination continue to own their existing presentation.
- `useCustomFields.readOnlySection` renders configured values with saved choice
  labels; the existing field controls handle editing.
- `CrmPagination` now omits pagination when a completed request returns no rows.
  Populated lists retain count left, navigation centre and page size right.

Project and subproject instances use the same components. Other CRM and Sales Documents editors now share this pattern; see
`CRM_RECORD_VIEWS.md` for coverage and the shared edit-session components. Empty pagination is already a
shared change across CRM lists and timelines. Filters remain reachable on empty
lists so users can recover a filtered-out or archived record.

## Data and verification

No migration or API contract change. Saves retain optimistic version checks,
tenant access, auditing and custom-field validation. Cancelling an edit restores
the last loaded values and clears its custom-field patch. Archive/Restore is a
separate confirmed action and preserves records.

Run `npx playwright test --config playwright.project-ui.config.ts` for the
isolated component checks. The generated host lives in ignored test output,
imports the real UI components and intercepts every API call. No hosted login,
database or business writes are used. It covers focused saves, lazy list loading,
discard, conflicts, archive, custom fields, manager/staff controls, parent
context, currency defaults and desktop/mobile layouts. It is not hosted
end-to-end acceptance testing.

The existing local database browser scenarios have been updated to navigate
the new tabs and panels. Their full workflow rerun remains part of the separate
CRM acceptance pass. Push and production deployment via main are authorized;
hosted acceptance testing remains pending.

Verified locally: all 3 intercepted browser scenarios and 27 CRM unit/boundary
checks passed, as did targeted ESLint and whitespace checks. The production
build completed compilation, TypeScript, static generation and route output.
Desktop overview/creation and mobile overview/edit-panel screenshots were
visually inspected. The browser host includes a representative sidebar/flex
shell; it does not claim verification of the hosted application shell.
