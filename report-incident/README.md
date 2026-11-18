# Report an incident (standalone)

The Apps Script "Report an incident" page, moved into the repo. Self-contained: nothing here imports
from the main KPI app, and `../incidents/` (the managers' log) is a separate folder.

| File | Purpose |
|------|---------|
| `index.html` | The original Apps Script page, unchanged (logo moved to `logo.jpg`, plus a `<title>` and two `<script>` tags) |
| `gas-shim.js` | Recreates `google.script.run` so the page runs outside Apps Script |
| `report-config.js` | Web-app URL (`endpoint`), sites and departments |
| `apps-script-doPost.gs` | Small function to ADD to the existing report app in Apps Script |
| `logo.jpg` | Header logo |

## How it links to the Incident Log

Reports are saved by the existing Apps Script into the **Incidents** tab of the log sheet
(`1GlPcGP7…`), which is exactly what `../incidents/` (the managers' Incident Log) reads and edits.
A report sent here appears in the log as soon as the manager presses Refresh.

## One-time setup (needed before reports can be sent)

1. In the report app's Apps Script project, add the function in `apps-script-doPost.gs` to `Code.gs`.
2. **Deploy > Manage deployments > edit > New version > Deploy** (Execute as: Me, Access: Anyone).
   Copy the Web app URL (ends `/exec`).
3. Paste it into `report-config.js` as `endpoint`, commit.

Until the endpoint is set, the form opens normally but says "Reporting is not connected yet" on send.

## Notes

- Saving, photo storage, reference numbers, spam protection and emails still run in Apps Script (so no
  Google sign-in is needed for reporters). When this moves to Azure, replace the `fetch` in
  `gas-shim.js` with a call to your own API; `index.html` does not change.
- `sites`/`departments` in `report-config.js` must match the lists in Apps Script `Code.gs`
  (the server validates against its own copy).
