# Staircraft Near Miss & Incident Register (Google Apps Script)

This is a separate manager-facing Apps Script web app. It does not replace or edit the employee-facing Report an Incident page.

## Data source
The app reads the existing `Incidents` tab in spreadsheet:
`1GlPcGP7ByU8SDv3XetsZn0oM33fnoUIrLLoEciBhaFg`

The employee form should continue submitting reports to that sheet. The register adds manager-only fields to the right of the existing columns and creates two supporting tabs:
- `Incident Actions` — action owner, due date and completion status
- `Incident Lists` — manager and department dropdown lists

## Install
1. Create a new Google Apps Script project using the Staircraft Google account that owns or can edit the incident spreadsheet.
2. Add a script file named `Code.gs` and paste the contents of this folder's `Code.gs`.
3. Add an HTML file named `Index` and paste `Index.html`.
4. Save, select `setupIncidentRegister` and run it once. Approve the spreadsheet permissions.
5. Open the `Incident Lists` sheet and replace the placeholder text in column A with actual manager names. Add/remove departments in column B as needed.
6. Deploy > New deployment > Web app. Execute as: **Me**. Who has access: **Anyone within Staircraft's Google Workspace** (recommended; choose the narrowest available company option).
7. Copy the /exec URL and test with a manager account.

## Current features
- Teal register header and navigation styled to match the Quality Concern Register.
- Register, Action Log, Reviewed and Lists views.
- Search and filters.
- Manager severity, assigned manager(s), review date, completion date and status.
- Short manager review for minor events.
- Expanded investigation fields for local/standard investigations.
- Action assignment and due dates.
- CSV export.

## Important
This is an initial working build, not yet connected to the employee form's deployment URL. It assumes the reporting process continues to write a `Ref` column and the original fields to the existing `Incidents` tab. Before go-live, confirm the actual spreadsheet tab and column headings against the live report app. Do not delete or rename existing report columns.

The script is intentionally separate from the existing Production Office app. Do not change `report-incident/`, `report-incident-tab.js`, or the employee form's Apps Script deployment as part of this installation.
