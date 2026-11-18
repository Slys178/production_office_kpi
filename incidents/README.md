# Incidents (standalone)

Self-contained copy of the Incidents tab, ready to move to Azure. It does **not** import
anything from the main KPI app (`../config.js`, `../drive.js`, `../main.js`, etc.).

| File | Purpose |
|------|---------|
| `index.html` | Page shell; mounts the module into `#incidentsPageBody` |
| `incidents.js` | All incident logic: list, form, detail, photos, local backup, Sheet/Drive sync |
| `incidents.css` | Styles **plus** the theme tokens it used to inherit from the main app |
| `config.js` | Sheet ID, range, Drive folder, sites/types/body parts, Google OAuth client, storage key |
| `google.js` | Google Identity Services token flow (Sheets append + Drive upload) |
| `user.js` | The only place the current user is read from (swap for MSAL/Entra on Azure) |

## Run locally

    cd incidents && python3 -m http.server 8000

## Things to do when moving to Azure

1. **Google OAuth origin** – add the Azure site URL to *Authorised JavaScript origins* on the OAuth client in `config.js`, otherwise Google sign-in is blocked.
2. **User identity** – edit `user.js` to return `{ name, email }` from your Azure sign-in (MSAL).
3. **Storage** – reports are stored in the Google Sheet (+ Drive photos) and backed up in `localStorage` (per browser/origin, so existing local-only reports on the old site will not appear on the new origin).
4. **Longer term** – if you want to drop Google entirely, replace `appendIncidentRow` and `uploadPhotoToDrive` in `incidents.js` with calls to Azure (e.g. Functions + Blob Storage + Cosmos/SQL).

## Original code

The original `incident-report.js` / `incident-report.css` and their wiring in `index.html` /
`main.js` in the repo root are **unchanged**, so the live app keeps working until you cut over.
Changes made in the root copy after this split are not mirrored here.
