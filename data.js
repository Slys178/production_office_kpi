/**
 * Data fetching & parsing layer (Google Sheets via GViz)
 */

import { CONFIG } from "./config.js";
import { parseUKDate, sameDay, dayBucket, showToast } from "./utils.js";

let jsonpCounter = 0;

/**
 * Fetch rows from a Google Sheet using the GViz JSONP endpoint
 * @param {string} sheetId
 * @param {string} gid
 * @returns {Promise<string[][]>}
 */
export function fetchGvizRows(sheetId, gid) {
  return new Promise((resolve, reject) => {
    jsonpCounter++;
    const callbackName = `__gvizCallback_${jsonpCounter}_${Date.now()}`;
    const script = document.createElement("script");
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("Timed out loading sheet data"));
    }, 15000);

    function cleanup() {
      clearTimeout(timeout);
      delete window[callbackName];
      script.remove();
    }

    window[callbackName] = function (response) {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        if (response.status === "error") {
          reject(new Error("Sheet returned an error"));
          return;
        }
        const table = response.table;
        const dataRows = table.rows.map((r) =>
          table.cols.map((c, i) => {
            const cell = r.c ? r.c[i] : null;
            if (!cell) return "";
            if (cell.f !== undefined && cell.f !== null) return String(cell.f);
            if (cell.v !== undefined && cell.v !== null) return String(cell.v);
            return "";
          })
        );
        const labelRow = table.cols.map((c) => c.label || "");
        const hasLabels = labelRow.some((v) => v.trim() !== "");
        const rows = hasLabels ? [labelRow, ...dataRows] : dataRows;
        resolve(rows);
      } catch (e) {
        reject(e);
      }
    };

    script.onerror = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("Failed to load sheet"));
    };

    const gidPart = gid ? `&gid=${gid}` : "";
    script.src = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json;responseHandler:${callbackName}${gidPart}`;
    document.head.appendChild(script);
  });
}

/**
 * Load all required sheets in parallel with basic error handling
 */
export async function loadAllData() {
  const { sheets } = CONFIG;
  const results = {
    stairRows: null,
    holidayRows: null,
    errorRows: null,
    rpRows: null,
    errors: [],
  };

  const jobs = [
    { key: "stairRows", id: sheets.projectTracking.id, gid: sheets.projectTracking.gid, label: "Project Tracking" },
    { key: "holidayRows", id: sheets.holidays.id, gid: sheets.holidays.gid, label: "Holidays" },
    { key: "errorRows", id: sheets.errors.id, gid: sheets.errors.gid, label: "Errors" },
    { key: "rpRows", id: sheets.replacementParts.id, gid: sheets.replacementParts.gid, label: "Replacement Parts" },
  ];

  await Promise.all(
    jobs.map(async (job) => {
      try {
        results[job.key] = await fetchGvizRows(job.id, job.gid);
      } catch (err) {
        console.error(`Failed to load ${job.label}:`, err);
        results.errors.push(`${job.label}: ${err.message}`);
        showToast(`Could not load ${job.label}`, "error");
      }
    })
  );

  return results;
}

/* ---------- Holiday helpers ---------- */

export function buildHolidayIndex(rows) {
  if (!rows || rows.length < 2) return { colsToUse: [], nameIndex: {} };
  const header = rows[0];
  const colsToUse = [];
  for (let i = 1; i < header.length; i++) {
    const d = parseUKDate(header[i]);
    if (d) colsToUse.push({ idx: i, date: d });
  }
  const nameIndex = {};
  for (let i = 1; i < rows.length; i++) {
    const nameCell = (rows[i][0] || "").trim();
    if (nameCell) nameIndex[nameCell] = rows[i];
  }
  return { colsToUse, nameIndex };
}

export function getCodeForPerson(holidayIndex, personName, date) {
  const row = holidayIndex.nameIndex[personName];
  if (!row) return "";
  const match = holidayIndex.colsToUse.find((dc) => sameDay(dc.date, date));
  if (!match) return "";
  return (row[match.idx] || "").trim();
}

export function hoursLostForCode(code, fullDayHours) {
  if (!code) return 0;
  const c = code.toLowerCase();
  if (c === "h" || c === "b" || c === "o" || c.startsWith("2nd")) return fullDayHours;
  if (c === "h/am" || c === "h/pm") return fullDayHours / 2;
  if (c === "c") return 2;
  return 0;
}

export function creditableHoursLost(code, fullDayHours) {
  if (!code) return 0;
  const c = code.toLowerCase();
  if (c === "c") return 0;
  return hoursLostForCode(code, fullDayHours);
}

export function targetFor(initials, date, code) {
  const bucket = dayBucket(date);
  if (!bucket) return 0;
  const fullDayHours = CONFIG.hours[initials][bucket];
  const lost = hoursLostForCode(code, fullDayHours);
  const available = Math.max(0, fullDayHours - lost);
  return Math.round(CONFIG.baseRate * available);
}

export function isAbsenceCode(code) {
  if (!code) return false;
  const c = code.toLowerCase();
  return c === "h" || c === "h/am" || c === "h/pm" || c === "b" || c === "o";
}

export function statusLabel(code) {
  if (!code) return null;
  const c = code.toLowerCase();
  if (c === "h") return "Full day off";
  if (c === "h/am") return "Half day (AM) off";
  if (c === "h/pm") return "Half day (PM) off";
  if (c === "b") return "Bank holiday";
  if (c === "o") return "Other / away";
  if (c === "c") return "Carrier run";
  if (c.startsWith("2nd")) return "2nd fix help";
  return code;
}

export function computeDayStats(person, date, stairEntries, holidayIndex) {
  const bucket = dayBucket(date);
  const code = getCodeForPerson(holidayIndex, person.holidayName, date);
  if (!bucket) return { actual: 0, target: 0, credit: 0, code };
  const target = targetFor(person.initials, date, code);
  const actual = stairEntries
    .filter((e) => e.initials === person.initials && sameDay(e.date, date))
    .reduce((s, e) => s + e.stairs, 0);
  const fullDayHours = CONFIG.hours[person.initials][bucket];
  const lostHours = creditableHoursLost(code, fullDayHours);
  const credit = lostHours > 0 ? Math.round(CONFIG.baseRate * lostHours) : 0;
  return { actual, target, credit, code };
}

/* ---------- Parsers (simplified stubs – full logic kept in original for reference) ---------- */

/**
 * Parse project tracking / stair rows
 * NOTE: The full original parseStairRows is complex; keep the original implementation
 * or expand this function with the complete logic from the source.
 */
export function parseStairRows(rows) {
  // Placeholder – copy the full original parseStairRows body here for production use
  console.warn("parseStairRows: using stub – replace with full original logic");
  return { stairEntries: [], forecastEntries: [] };
}

export function parseErrorRows(rows) {
  console.warn("parseErrorRows: using stub – replace with full original logic");
  return [];
}

export function parseReplacementPartsRows(rows) {
  console.warn("parseReplacementPartsRows: using stub – replace with full original logic");
  return [];
}
