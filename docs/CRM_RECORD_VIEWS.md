# Shared CRM record views

Saved records open as read-only details. Related information belongs in local
tabs; editing opens the shared side panel. Section Edit actions open the
relevant section, with one fixed Save/Cancel footer. Discarding a changed draft
requires confirmation and reloads the authoritative record, including extension
and custom-field values. Failed saves retain the draft.

## Coverage

| View | Organization |
| --- | --- |
| Contacts | Overview, Business accounts, Activities, Interactions |
| Business accounts | Overview, Contacts |
| Enquiries | Overview, Activities, History; conversion stays in the header |
| Opportunities | Overview, optional Sales documents, Activities, History |
| Activities | Overview, Outcome and next step, Customer interactions, History and notes |
| Activity plans | Overview, Plan steps; Apply saved plan remains a separate action |
| Follow-up rules | Trigger and suggested activity summaries with section editing |
| Pipelines | Configuration and ordered stage summary |
| Sales teams | Overview and manager-only Members |
| Custom fields | Definition, access/validation rules and options |
| Property configuration | Read-only choice details and shared editing panel |
| Quotations and templates | Overview, Pricing and charges, optional Payment plan, Bank and terms |
| Projects and subprojects | Existing Overview, Subprojects, Sales, Activities, Team tabs and focused panels |
| Sources, lost reasons, activity types | Existing paginated lists, shared editing panel with discard protection |

Creation forms use the same section controls with the first relevant section
expanded. Native invalid fields reveal their section. Apply-plan and preset
preview flows remain explicit review/confirmation workflows. Lists, reports,
calendars and timelines retain their shared filters, tables and pagination.
Inactive record tabs are unmounted, so their lists load only when opened.

## Reuse and data boundaries

- `crm-record-view.tsx`: record edit session, view/form boundary, summary sections
  and section Edit actions. `withCrmRecordView` wraps the existing controller;
  record-specific validation, payloads, permissions and version checks remain
  in that controller.
- `crm-record-detail.tsx`: tabs, read-only fields and shared editing panel;
  `CrmDraftPanel` gives small configuration lists the same save/discard behavior.
- `crm-edit-sections.tsx` and `CrmSection`: shared collapsible form sections.
- CRM extension summaries and optional panels come through the extension
  provider. Application composition decides whether Sales documents is present;
  CRM does not import Sales Documents or Real Estate.
- `quotation-summary.tsx` displays saved snapshot calculations and formatting.
  Historical quotation versions remain read-only; edits create a new version.
  A saved payment schedule remains readable if Payment Plans is disabled.
- No API contract, database schema, migration or permission-policy change.

## Verification

`npx playwright test --config playwright.project-ui.config.ts` runs isolated
component checks. All API calls are intercepted; there is no database or hosted
business-data access. Coverage includes record summaries, successful versioned
saves, discard, conflicts, lazy tabs, optional module visibility, permissions,
quotation history, configuration panels, creation and mobile layouts. Existing
project scenarios run in the same suite.

This is local component/build verification. Hosted end-to-end acceptance is a
separate pass after deployment; legacy workflow scripts that assume immediately
editable saved records need the appropriate Edit action/tab before form steps.

Local verification on 2026-09-29: 22 isolated browser scenarios passed (21 in
one final suite run, plus the missing-record scenario after correcting its
locator to exclude Next.js route announcements). The 27 CRM boundary/unit
checks and 6 quotation calculation checks passed. Targeted ESLint, whitespace
checks and the production build passed. Desktop quotation and mobile enquiry
summary/edit-panel screenshots were inspected. No hosted data was changed.
