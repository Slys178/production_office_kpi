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

/* ---------- saving ---------- */

const SIGNATURE_COLS = ["Signature Person", "Signature Supervisor", "Signature Ops Manager", "Signature HS Manager", "Signature Ops Director"];
const DATA_COL = "Investigation Data";
const CELL_LIMIT = 49000; // Google Sheets allows 50,000 characters in a cell

async function post(url, body) {
  return gjson(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

/** Add any missing column headers to the end of row 1, so nothing is silently dropped. */
async function ensureColumns(header, names) {
  const missing = names.filter((n) => header.indexOf(n) < 0);
  if (!missing.length) return header;
  const meta = await gjson(SHEETS + CONFIG.logSheetId + "?fields=sheets.properties");
  const tab = meta.sheets.map((s) => s.properties).find((p) => p.title === CONFIG.sheetName);
  if (!tab) throw new Error("Incidents tab not found");
  const short = header.length + missing.length - tab.gridProperties.columnCount;
  if (short > 0) {
    await post(SHEETS + CONFIG.logSheetId + ":batchUpdate", {
      requests: [{ appendDimension: { sheetId: tab.sheetId, dimension: "COLUMNS", length: short } }],
    });
  }
  await post(SHEETS + CONFIG.logSheetId + "/values:batchUpdate", {
    valueInputOption: "RAW",
    data: [{ range: tabRef(colLetter(header.length) + "1"), values: [missing] }],
  });
  return header.concat(missing);
}

async function findRow(ref, columns) {
  const v = await readSheet();
  const i = v.findIndex((row, n) => n > 0 && String(row[0]) === String(ref));
  if (i < 0) return null;
  const header = await ensureColumns(v[0], columns);
  return {
    row: v[i],
    get: (k) => String(v[i][header.indexOf(k)] == null ? "" : v[i][header.indexOf(k)]),
    cell: (k) => tabRef(colLetter(header.indexOf(k)) + (i + 1)),
  };
}

function revOf(json) {
  try { return JSON.parse(json).rev || 0; } catch (_) { return 0; }
}

export async function saveCase(ref, flat, answers, loadedRev) {
  const me = await need();
  const found = await findRow(ref, CONFIG.editable.concat([DATA_COL, "Closed Date", "Updated By"]));
  if (!found) return { ok: false, error: "Incident not found." };
  if (revOf(found.get(DATA_COL)) !== loadedRev) {
    return { ok: false, error: "Someone else has saved this case since you opened it. Note your changes, press Refresh and open it again." };
  }
  if (["Open", "Closed"].indexOf(flat["Status"]) < 0) return { ok: false, error: "Please choose a case status." };
  const lost = flat["Lost Days"];
  if (lost !== "" && lost != null && !(Number(lost) >= 0 && Number(lost) <= 3650)) {
    return { ok: false, error: "Lost days must be a number." };
  }
  const json = JSON.stringify({ rev: loadedRev + 1, savedBy: me, savedAt: new Date().toISOString(), answers: answers });
  if (json.length > CELL_LIMIT) return { ok: false, error: "This case has too much text to save. Please shorten the longest answers." };

  const long = ["Actions Taken", "Corrective Action", "Title"];
  const data = CONFIG.editable
    .filter((k) => flat[k] !== undefined)
    .map((k) => ({ range: found.cell(k), values: [[clean(flat[k], long.indexOf(k) >= 0 ? 2000 : 200)]] }));
  if (flat["Status"] === "Open") data.push({ range: found.cell("Closed Date"), values: [[""]] });
  else if (found.get("Status") !== "Closed") data.push({ range: found.cell("Closed Date"), values: [[new Date().toISOString().slice(0, 10)]] });
  data.push({ range: found.cell("Updated By"), values: [[me]] });

  await post(SHEETS + CONFIG.logSheetId + "/values:batchUpdate", { valueInputOption: "USER_ENTERED", data: data });
  // RAW: stored exactly as typed, never treated as a formula
  await post(SHEETS + CONFIG.logSheetId + "/values:batchUpdate", {
    valueInputOption: "RAW",
    data: [{ range: found.cell(DATA_COL), values: [[json]] }],
  });
  return { ok: true, data: json };
}

export async function saveSignature(ref, column, sig) {
  const me = await need();
  if (SIGNATURE_COLS.indexOf(column) < 0) return { ok: false, error: "Unknown signature." };
  const found = await findRow(ref, SIGNATURE_COLS.concat([DATA_COL]));
  if (!found) return { ok: false, error: "Incident not found." };
  if (revOf(found.get(DATA_COL)) !== sig.rev) {
    return { ok: false, error: "The case has changed since you opened it. Press Refresh and check it before signing." };
  }
  const value = JSON.stringify(Object.assign({}, sig, { recordedBy: me, recordedAt: new Date().toISOString() }));
  if (value.length > CELL_LIMIT) return { ok: false, error: "Signature is too detailed. Please clear and sign again." };
  await post(SHEETS + CONFIG.logSheetId + "/values:batchUpdate", {
    valueInputOption: "RAW",
    data: [{ range: found.cell(column), values: [[value]] }],
  });
  return { ok: true, value: value };
}

/* ---------- document uploads ---------- */

export async function uploadFile(ref, file) {
  await need();
  if (!CONFIG.uploadFolderId) throw new Error("the private upload folder has not been set up yet.");
  if (file.size > 25 * 1024 * 1024) throw new Error("files must be under 25 MB.");
  const type = file.type || "application/octet-stream";
  const start = await gfetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name,webViewLink", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": type },
    body: JSON.stringify({ name: "Incident " + ref + " - " + file.name, parents: [CONFIG.uploadFolderId] }),
  });
  const where = start.ok && start.headers.get("Location");
  if (!where) throw new Error("Google Drive refused the upload (" + start.status + "). Check you can edit the folder.");
  const done = await gfetch(where, { method: "PUT", headers: { "Content-Type": type }, body: file });
  if (!done.ok) throw new Error("Google Drive error " + done.status);
  const j = await done.json();
  return { id: j.id, name: file.name, link: j.webViewLink };
}
