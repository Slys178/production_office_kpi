# Incident system — Phase 1 (from Corin’s investigation brief)

## Split of work

| Shop-floor **reporting app** (`report/`) | Managers’ **incident log** (`log/`) |
|---|---|
| Near Miss / Incident, site, description, photos | Title, specific location, sub type, severity |
| Body part, first aid, hospital (if hurt) | RIDDOR status, investigation level, person type |
| Unique ID when backend is connected | Investigation status, actions, close-out |

Do **not** put the full investigation form on the phone app.

## Phase 1 delivered in the log UI

When a manager opens a case they can edit:

- **Title** — short name for finding this case
- **Specific location**
- **Sub type** — Injury, Occupational health, Unsafe condition, Unsafe Act, Property Damage, Environmental, Vehicle or FLT
- **Potential severity** — Low / Medium / High / Critical
- **Person type** — Employee, Contractor, Agency worker, Visitor, Member of the public
- **Investigation level** — None required / Local review / Standard Investigation
- **RIDDOR status** — Not assessed / Not reportable / Potentially reportable / Reported (+ legacy Yes/No)
- **RIDDOR Date** — date reported to HSE
- **Investigation status**, **Assigned to**, **Actions**, **Corrective action**, **Case status** (Open/Closed)
- LTI / lost days when relevant

Later phases (not built yet): document uploads (RA, SSOW, witness statements), full cause analysis, Just Culture, actions system, summary PDF, e-signatures.

## Google Sheet columns to add (one-time)

On the **Incidents** tab of the log spreadsheet, add these **header** names if missing (exact spelling):

`Title` · `Specific Location` · `Sub Type` · `Potential Severity` · `Investigation Level` · `Person Type` · `RIDDOR Date`

Existing columns used: `Status`, `Investigation`, `Assigned To`, `RIDDOR`, `LTI`, `Lost Days`, `Actions Taken`, `Corrective Action`, `Closed Date`, `Updated By`.

The log **only writes columns that exist** on the sheet, so you can add headers gradually. Fields without a column will not persist until the header is added.

## Azure

Replace `log/backend.js` and the report `endpoint` with your API. Keep the same field names where possible so the UI does not need a rewrite. See folder READMEs.
