# Production Office KPI – Modular Structure

## Files

| File | Purpose |
|------|---------|
| `index.html` | Page structure only (no big script) |
| `styles.css` | All styling |
| `config.js` | **Single place** for sheet IDs, people, targets, API keys |
| `app.js` | Entry point – theme toggle + starts the app |
| `main.js` | All the application logic (KPI, loads, forecasts, etc.) |
| `utils.js` | Date helpers, toast notifications, loading overlay |
| `data.js` | Sheet fetching helpers (ready for further split) |
| `drive.js` | Google Drive search (ready for further split) |

## What changed (Improvement #1 complete)

- CSS is no longer inside the HTML
- All settings live in `config.js`
- The giant single file has been split
- Theme handling and startup live in `app.js`
- Main logic lives in `main.js` and reads from `config.js`

## How to use on GitHub

1. Download the new zip
2. Upload **all** the files into your repo (replace the old ones)
3. Commit

## Making future changes

| You want to change… | Edit this file |
|---------------------|----------------|
| People’s names, colours, targets, sheet IDs | `config.js` |
| Look / colours / layout | `styles.css` |
| How the app starts or the theme | `app.js` |
| KPI dials, loads, forecasts, holidays… | `main.js` |

## Important

You must open the app through a local web server (not by double-clicking the HTML file), because browsers block ES modules on `file://`.

```bash
npx serve .
# or
python3 -m http.server 8000
```

Then open http://localhost:3000 (or 8000).
