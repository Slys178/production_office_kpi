# Incident Log (standalone managers app)

The Apps Script "Incident Log" (Code.gs + Index.html), moved out so it can live on Azure.
It does **not** import anything from the main KPI app.

| File | Purpose |
|------|---------|
| `index.html` | The original Apps Script page, unchanged (logo moved to `logo.jpg`, plus a `<title>` and the shim `<script>`) |
| `gas-shim.js` | Recreates `google.script.run` so the page runs outside Apps Script |
| `backend.js` | Port of Code.gs: `getData`, `getPhoto`, `saveCase`, `saveSignature`, `uploadFile` using the Sheets/Drive REST APIs |
| `google.js` | Google sign-in screen + token handling |
| `investigation.js` | Investigation form, signatures and summary document |
| `config.js` | Sheet ID, tab name, `managers` list, editable columns, OAuth client + scopes |
| `logo.jpg` | Header logo |

## In the main app

The Areas > Incidents tab hosts `incidents/index.html` in an iframe (see `incident-report.js` in the repo root),
so changes made in this folder show up in the app. Delete that one file's contents and move this folder to
Azure when you are ready to separate it.

## Run locally

    cd incidents && python3 -m http.server 8000

(ES modules do not load from `file://`.) Add `http://localhost:8000` to the OAuth client's
*Authorised JavaScript origins* to test.

## Differences from Apps Script

- **Sign-in:** Apps Script used "Execute as: Me" / the domain session. Here the manager signs in with
  Google on first load, and calls are made with *their* token, so they need access to the sheet and the
  private photo folder.
- **Manager check:** same `managers` list and same "no access" page, but it runs in the browser, so it is
  a courtesy, not security. The real protection is Google's sharing on the sheet and photo folder.
  Move the check server-side when this goes to Azure.
- **No script lock:** a save only writes the cells it changes, and is refused if someone else saved the case first.

## Moving to Azure

1. Add the Azure URL to the Google OAuth client's authorised origins (or replace Google with Azure auth).
2. Re-implement the functions in `backend.js` against your own API; `index.html` and `gas-shim.js` stay as they are.

## Uploads set-up

1. Create a Google Drive folder, shared only with the people who investigate (never "anyone with the link").
2. Put its ID (after `/folders/` in the address) in `config.js` -> `uploadFolderId`.
3. The Google Cloud project needs the Drive API enabled; Google will ask each manager to approve Drive access.
