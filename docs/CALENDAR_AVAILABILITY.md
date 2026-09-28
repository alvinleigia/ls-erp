# Temporary calendar pause - 2026-09-28

The application title is now Leiweissen ERP. The updated logo remains at
`public/assets/images/logo.png`.

Syncfusion calendar views are disabled by default. The dashboard and shared app
provider no longer import the vendor runtime. Its scripts, styles and license
registration live behind the optional calendar component; no license message is
hidden or altered.

- Appointments retains its list, filters and New appointment action.
- Staff roster retains its grid; the Calendar switch is disabled.
- CRM Calendar explains the temporary pause and links to My Work. Activities,
  scheduling forms and reminders continue to work without the calendar view.
- No existing bookings, shifts or CRM activities are removed or changed.

To restore calendar views, configure a valid `NEXT_PUBLIC_SYNCFUSION_LICENSE_KEY`,
set `NEXT_PUBLIC_ENABLE_CALENDAR_VIEWS=true`, then rebuild and deploy. The public
flag is evaluated at build time. Recheck appointment calendar, roster resources,
CRM drag/reschedule, styling and staff display preferences when re-enabling.

This change does not apply the separate pending CRM database migrations. Follow
the release sequence in CRM_SALES_PHASE_6.md when deploying those features.
