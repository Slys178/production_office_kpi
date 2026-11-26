# Report an incident (standalone)

The "Report an incident" page. Self-contained: nothing here imports
from the main KPI app, and `../log/` (the managers' log) is a separate folder.

| File | Purpose |
|------|---------|
| `index.html` | The reporting form |
| `gas-shim.js` | Sends the form's data to `endpoint` |
| `report-config.js` | `endpoint`, sites and departments |
| `logo.jpg` | Header logo |

## Connecting it

Reports are received by the Azure code in `../azure/` (see its README). Until `endpoint` is set,
the form opens but says "Reporting is not connected yet" on send, and nothing is saved.

The Azure code checks sites and departments against its own copy (`../azure/api/src/report.js`),
so change both together.

The log in `../log/` still reads the Google sheet, so Azure reports will not show there until
the log has moved to Azure too.
