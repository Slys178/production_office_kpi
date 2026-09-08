# Production Office KPI – Modular Refactor

## What was done

The original 3 850-line single-file `index.html` has been split into a maintainable structure:

| File            | Purpose                                      | Status          |
|-----------------|----------------------------------------------|-----------------|
| `index.html`    | Clean markup + script bootstrap              | ✅ Done         |
| `styles.css`    | All CSS extracted                            | ✅ Done         |
| `config.js`     | Sheet IDs, API keys, PEOPLE, rates, timings  | ✅ Done         |
| `utils.js`      | Date helpers, toast notifications, loading   | ✅ Done         |
| `data.js`       | Sheet fetching + holiday / target helpers    | ✅ Partial      |
| `drive.js`      | Google Drive search & auth                   | ✅ Done         |
| Original logic  | Still runs inside `<script>` in index.html   | ⏳ To migrate   |

### New capabilities already working

- **Toast notifications** – call `window.__PO_showToast("message", "success|error|warning|info")`
- **Loading overlay** – `window.__PO_setLoading(true, "Loading…")` / `false`
- **Central config** – `window.__PO_CONFIG` (or `import { CONFIG } from './config.js'`)
- CSS is no longer embedded in the HTML

## How to finish the migration (recommended order)

1. **Copy the full parsers into `data.js`**
   - Take `parseStairRows`, `parseErrorRows`, `parseReplacementPartsRows` from the original script and move them into `data.js`, exporting them.
   - Update the stubs that currently just `console.warn`.

2. **Move rendering functions**
   - Create `kpi.js` (or `render.js`) and move:
     - `drawProjectedDial`, `renderTeamSummary`, `renderForecast`, `renderHolidayCalendar`, `showDetailPage`, etc.
   - Import the helpers they need from `config.js`, `utils.js` and `data.js`.

3. **Move loads logic**
   - Create `loads.js` containing `renderLoads`, `handleDriveClick`, pagination, badge updates.
   - Import from `drive.js` and `config.js`.

4. **Create the real `app.js`**
   - Theme toggle
   - Navigation (`setActiveView`)
   - Main `loadAndRender` / `initAndLoad` loop
   - Wire up event listeners
   - Use `setLoading` + `showToast` for better UX

5. **Delete the big inline `<script>`** once everything is imported via ES modules.

6. **Optional – Type safety**
   - Add JSDoc `@typedef` / `@param` (already started in `config.js`)
   - Or introduce TypeScript + a simple build step later.

## Running the modular version

Because the app uses ES modules and talks to Google APIs you need a local server (file:// will block modules and CORS):

```bash
# From this folder
npx serve .
# or
python3 -m http.server 8000
```

Then open http://localhost:8000

## Notes

- All original functionality is still present – the big script block has not been removed yet.
- The modular files are already loaded and can be used immediately (toast, config, drive helpers).
- Once the remaining functions are moved you will have a clean, maintainable codebase that is far easier to extend.
