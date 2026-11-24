/**
 * 2nd Fix dials — actuals/targets from capability sheet.
 * Who is In/Half/Out is set in-app by managers and stored on tab AppInToday
 * so a TV login (view-only) stays in sync on any device.
 */
import { CONFIG } from './config.js';
import {
  driveAccessToken,
  gapiSignedIn,
  requestDriveToken,
  initGapiClient,
} from './drive.js';

const SHEET_ID = (CONFIG.sheets && CONFIG.sheets.secondFix && CONFIG.sheets.secondFix.id)
  || '1Bm_7Zeo2d2ZG3oDM-9F6fZ5X3QWvWmgkU4DumHfusb4';
const GID_DAILY = (CONFIG.sheets && CONFIG.sheets.secondFix && CONFIG.sheets.secondFix.gidDaily) || '0';
const ROSTER_TAB = (CONFIG.sheets && CONFIG.sheets.secondFix && CONFIG.sheets.secondFix.rosterTab) || 'Roster';
const ATTEND_TAB = (CONFIG.sheets && CONFIG.sheets.secondFix && CONFIG.sheets.secondFix.attendanceTab) || 'AppInToday';

/** A1 range with sheet name; quote if name has spaces/special chars (Sheets API). */
function sheetRange(tabName, a1) {
  var needQuote = /[^A-Za-z0-9_]/.test(tabName);
  var sheet = needQuote ? "'" + String(tabName).replace(/'/g, "''") + "'" : tabName;
  return sheet + "!" + a1;
}

function gvizUrl(sheetId, gid, tabName) {
  var part = '';
  if (tabName) part = '&sheet=' + encodeURIComponent(tabName);
  else if (gid != null && gid !== '') part = '&gid=' + gid;
  return 'https://docs.google.com/spreadsheets/d/' + sheetId + '/gviz/tq?tqx=out:json' + part;
}

async function fetchGviz(sheetId, gid, tabName) {
  const res = await fetch(gvizUrl(sheetId, gid, tabName));
  const text = await res.text();
  const json = JSON.parse(text.substring(47, text.length - 2));
  if (json.status === 'error') throw new Error((json.errors && json.errors[0] && json.errors[0].detailed_message) || 'Sheet error');
  const table = json.table;
  return table.rows.map(function (r) {
    return table.cols.map(function (_, i) {
      const cell = r.c ? r.c[i] : null;
      if (!cell) return '';
      if (cell.f != null) return String(cell.f);
      if (cell.v != null) return String(cell.v);
      return '';
    });
  });
}
