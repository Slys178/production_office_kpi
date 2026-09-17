# Who's online — one-time setup (about 5 minutes)

The app can show admins who has the Production Office open. It needs a small Google Sheet tab and a free Apps Script web app to receive quiet “I’m here” pings.

## 1. Create a Presence tab

1. Open the **same spreadsheet** used for the login user list  
   (the one login.html reads for emails / rights).
2. Add a new sheet tab named **`Presence`**.
3. In row 1 put these headers exactly:

   | A | B | C | D |
   |---|---|---|---|
   | Email | Name | Role | LastSeen |

4. Share the spreadsheet so the app can read it the same way as your other sheets  
   (**Anyone with the link → Viewer** is fine if that is how Project Tracking works).
5. Copy the **gid** from the browser URL while the Presence tab is selected  
   (`...gid=123456789`). You will paste this into `presence.js`.

## 2. Deploy the Apps Script

1. In that same spreadsheet: **Extensions → Apps Script**.
2. Delete any placeholder code and paste this:

```javascript
function doGet(e) {
  try {
    const email = (e.parameter.email || '').toString().trim().toLowerCase();
    const name  = (e.parameter.name  || '').toString().trim();
    const role  = (e.parameter.role  || '').toString().trim();
    if (!email) {
      return ContentService.createTextOutput('missing email');
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sh = ss.getSheetByName('Presence');
    if (!sh) {
      sh = ss.insertSheet('Presence');
      sh.appendRow(['Email', 'Name', 'Role', 'LastSeen']);
    }

    const data = sh.getDataRange().getValues();
    let rowIndex = -1; // 1-based later
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0] || '').trim().toLowerCase() === email) {
        rowIndex = i + 1;
        break;
      }
    }

    const now = new Date();
    if (rowIndex > 0) {
      sh.getRange(rowIndex, 2, rowIndex, 4).setValues([[name || data[rowIndex - 1][1], role || data[rowIndex - 1][2], now]]);
    } else {
      sh.appendRow([email, name, role, now]);
    }

    return ContentService.createTextOutput('ok');
  } catch (err) {
    return ContentService.createTextOutput('error: ' + err);
  }
}
```

3. **Save** the project (disk icon).
4. **Deploy → New deployment**
   - Type: **Web app**
   - Description: `Presence heartbeat`
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Deploy, then **copy the Web app URL**  
   (looks like `https://script.google.com/macros/s/……/exec`).

## 3. Paste URL + gid into the app

Open `presence.js` in the GitHub repo and set:

```js
const PRESENCE = {
  scriptUrl: "https://script.google.com/macros/s/YOUR_ID/exec",
  sheetId: "1uX_f3jc123mX2SsK7vIVIxN_zpQ3GkUqmA9U0QdJ2Dw", // user-list spreadsheet
  sheetGid: "YOUR_PRESENCE_TAB_GID",
  // …
};
```

Commit / push (or ask Grok to put the values in for you).

## 4. Test

1. Hard-refresh the Production Office app.
2. Leave it open for a minute.
3. Check the **Presence** tab — your row should update **LastSeen**.
4. Signed in as **ADMIN** or **Simon (SF)**, the landing page shows **Who's online**.

- **Green** = active in the last 10 minutes  
- **Amber** = seen in the last hour  
- Older entries listed under “Earlier”

Normal **USER** logins never see this panel; they only send the quiet heartbeat.
