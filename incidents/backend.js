/**
 * Backend for the Incident Log — port of Apps Script Code.gs
 * (getData / getPhoto / saveCloseOut) onto Sheets + Drive REST APIs.
 * On Azure, replace these three functions with your own API.
 */
import { CONFIG } from "./config.js";
import { getToken, clearToken, getUserEmail } from "./google.js";

const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets/";
const DRIVE = "https://www.googleapis.com/drive/v3/files/";
const NO_ACCESS_HTML =
  '<div style="font:18px sans-serif;padding:48px 20px;text-align:center">You do not have access to the incident log.<br>Please speak to Simon Askew.</div>';

let accessPromise = null;
function need() {
  if (!accessPromise) {
    accessPromise = (async function () {
      await getToken();
      const me = await getUserEmail();
      const ok = !!me && CONFIG.managers.some((m) => m.toLowerCase() === me);
      if (!ok) {
        document.title = "Incident Log";
        document.body.innerHTML = NO_ACCESS_HTML;
        return new Promise(function () {});
      }
      return me;
    })().catch(function (e) {
      accessPromise = null;
      throw e;
    });
  }
  return accessPromise;
}

async function gfetch(url, init, retry) {
  const token = await getToken();
  const headers = Object.assign({}, init && init.headers, { Authorization: "Bearer " + token });
  const res = await fetch(url, Object.assign({}, init, { headers: headers }));
  if (res.status === 401 && retry !== false) {
    clearToken();
    return gfetch(url, init, false);
  }
  return res;
}
async function gjson(url, init) {
  const res = await gfetch(url, init);
  if (!res.ok) {
    const t = await res.text();
    const err = new Error("Google error " + res.status + ": " + t.slice(0, 200));
    err.status = res.status;
    err.body = t;
    throw err;
  }
  return res.json();
}
function tabRef(a1) {
  return "'" + CONFIG.sheetName.replace(/'/g, "''") + "'" + (a1 ? "!" + a1 : "");
}
async function readSheet() {
  try {
    const j = await gjson(
      SHEETS + CONFIG.logSheetId + "/values/" + encodeURIComponent(tabRef()) +
        "?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER"
    );
    return j.values || [];
  } catch (e) {
    if (e.status === 400 && /Unable to parse range/i.test(e.body || "")) throw new Error("Incidents tab not found");
    throw e;
  }
}
function colLetter(i) {
  let s = "";
  i++;
  while (i > 0) {
    const m = (i - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    i = Math.floor((i - 1) / 26);
  }
  return s;
}

const pad = (n) => ("0" + n).slice(-2);
function fmtSerial(s, withTime) {
  const ms = withTime
    ? Math.round(((s - 25569) * 864e5) / 6e4) * 6e4
    : Math.floor(s - 25569) * 864e5;
  const d = new Date(ms);
  const day = d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());
  return withTime ? day + " " + pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()) : day;
}
const DATE_COLS = { Date: false, "Closed Date": false, Reported: true, "RIDDOR Date": false };

function clean(v, max) {
  let s = String(v == null ? "" : v)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .trim()
    .slice(0, max);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}
function todaySerial() {
  const n = new Date();
  return Math.floor((Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) - Date.UTC(1899, 11, 30)) / 864e5);
}

export async function getData() {
  const me = await need();
  const v = await readSheet();
  if (v.length < 2) return { rows: [], me: me };
  const h = v[0];
  const rows = v
    .slice(1)
    .filter(function (r) { return r[0] !== undefined && r[0] !== ""; })
    .map(function (r) {
      const o = {};
      h.forEach(function (k, i) {
        let x = r[i];
        if (x === undefined) x = "";
        if (typeof x === "number" && Object.prototype.hasOwnProperty.call(DATE_COLS, k)) x = fmtSerial(x, DATE_COLS[k]);
        else if (typeof x === "number" && k === "Time" && x >= 0 && x < 1) {
          const mins = Math.round(x * 1440);
          x = pad(Math.floor(mins / 60) % 24) + ":" + pad(mins % 60);
        }
        o[k] = x;
      });
      return o;
    });
  return { rows: rows, me: me };
}

export async function getPhoto(id, full) {
  await need();
  const fields = full ? "thumbnailLink,webContentLink" : "thumbnailLink";
  const j = await gjson(DRIVE + encodeURIComponent(id) + "?fields=" + fields + "&supportsAllDrives=true");
  if (full && j.webContentLink) return j.webContentLink;
  if (j.thumbnailLink) return j.thumbnailLink.replace(/=s\d+$/, full ? "=s1200" : "=s400");
  throw new Error("Photo not available");
}

export async function saveCloseOut(ref, f) {
  const me = await need();
  const EDITABLE = CONFIG.editable;
  const v = await readSheet();
  if (!v.length) return { ok: false, error: "Incident not found." };
  const h = v[0];
  let rowIdx = -1;
  for (let i = 1; i < v.length; i++) {
    if (String(v[i][0]) === String(ref)) { rowIdx = i; break; }
  }
  if (rowIdx < 0) return { ok: false, error: "Incident not found." };

  const out = {};
  const present = EDITABLE.filter(function (k) { return h.indexOf(k) >= 0; });
  const longText = { "Actions Taken": 1, "Corrective Action": 1, Title: 1 };
  present.forEach(function (k) {
    out[k] = clean(f[k], longText[k] ? 2000 : 200);
  });
  if (out["Status"] != null && ["Open", "Closed"].indexOf(out["Status"]) < 0)
    return { ok: false, error: "Please choose a status." };
  const RIDDOR_OK = ["", "Yes", "No", "Not assessed", "Not reportable", "Potentially reportable", "Reported"];
  if (out["RIDDOR"] != null && RIDDOR_OK.indexOf(out["RIDDOR"]) < 0)
    return { ok: false, error: "Please check RIDDOR status." };
  if (out["LTI"] != null && ["", "Yes", "No"].indexOf(out["LTI"]) < 0)
    return { ok: false, error: "Please check LTI." };
  if (out["Lost Days"] != null && out["Lost Days"] !== "") {
    const n = Number(out["Lost Days"]);
    if (isNaN(n) || n < 0 || n > 3650) return { ok: false, error: "Lost days must be a number." };
    out["Lost Days"] = n;
  }
  ["Closed Date", "Updated By"].forEach(function (k) {
    if (h.indexOf(k) < 0) throw new Error("Column not found: " + k);
  });

  const wasClosed = String(v[rowIdx][h.indexOf("Status")] == null ? "" : v[rowIdx][h.indexOf("Status")]) === "Closed";
  const r = rowIdx + 1;
  const cell = (k) => tabRef(colLetter(h.indexOf(k)) + r);

  const data = present.map(function (k) { return { range: cell(k), values: [[out[k]]] }; });
  if (out["Status"] === "Open") data.push({ range: cell("Closed Date"), values: [[""]] });
  data.push({ range: cell("Updated By"), values: [[me]] });

  await gjson(SHEETS + CONFIG.logSheetId + "/values:batchUpdate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ valueInputOption: "USER_ENTERED", data: data }),
  });

  if (out["Status"] === "Closed" && !wasClosed) {
    await gjson(SHEETS + CONFIG.logSheetId + "/values:batchUpdate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        valueInputOption: "USER_ENTERED",
        data: [{ range: cell("Closed Date"), values: [[new Date().toISOString().slice(0, 10)]] }],
      }),
    });
  }
  return { ok: true };
}
