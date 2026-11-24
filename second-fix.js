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
  return sheet + '!' + a1;
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

function parseNum(s) {
  if (s == null || s === '') return 0;
  const n = parseFloat(String(s).replace(/[,%m\s]/gi, ''));
  return isNaN(n) ? 0 : n;
}

function normName(s) {
  return String(s || '').toUpperCase().replace(/\s+/g, ' ').trim();
}

function esc(t) {
  return String(t == null ? '' : t)
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"');
}

function shiftDateISO() {
  var now = new Date();
  var d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (now.getHours() < 6 || (now.getHours() === 6 && now.getMinutes() < 30)) {
    d.setDate(d.getDate() - 1);
  }
  var y = d.getFullYear();
  var m = String(d.getMonth() + 1).padStart(2, '0');
  var day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function isManager() {
  var role = (localStorage.getItem('userRole') || '').toUpperCase();
  var roleText = (localStorage.getItem('userRoleText') || '').toUpperCase();
  var blob = role + ' ' + roleText;
  if (/ADMIN|MANAGER|SUPER|WRITE|EDIT|BOTH/.test(blob)) return true;
  if (/VIEW|TV|READ\s*ONLY|READONLY/.test(blob)) return false;
  return false;
}
