# Incident system

Everything for incident reporting and the incident log, kept apart so it can become its own app.
Nothing in here imports from the KPI app.

| Folder | What it is |
|---|---|
| `report/` | "Report an incident" form |
| `log/` | Incident log and investigation form |
| `azure/` | Azure code (part 1: receiving reports) |
| `kpi-app-link/` | Shows the two screens inside the KPI app. Not needed once this is its own app |

## Moving it out

1. Copy this folder, without `kpi-app-link/`, to the new repository or hosting.
2. Update the Google sign-in's allowed web address while the log still uses Google (`log/config.js`).
3. In the KPI app, delete this folder and remove:
   - `index.html`: the `tileAreaIncidents` tile, `incidentsPage`, the `report-tab.js` script tag,
     and the `openIncidents` / `tileInc` / `backInc` code
   - `main.js`: the `log-tab.js` import, `callIncidents`, `ensureIncidentsDom`, `wireIncidentsNav`,
     and the `tileInc` lines in `overrideAreaLanding`
   - `config.js`: the old `incidents` settings (from an earlier version; this folder does not use them)
