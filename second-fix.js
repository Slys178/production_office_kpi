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

function parseDailyRows(rows) {
  var sectionExpected = null;
  var sectionActual = null;
  for (var i = 0; i < Math.min(rows.length, 15); i++) {
    var label = String(rows[i][0] || '').trim().toUpperCase();
    var val = parseNum(rows[i][1]);
    if (label.indexOf('EXPECTED CAPABILITY') >= 0) sectionExpected = val;
    else if (label.indexOf('ACTUAL SO FAR') >= 0) sectionActual = val;
  }
  var headerIdx = -1;
  for (var j = 0; j < rows.length; j++) {
    if (String(rows[j][0] || '').trim().toUpperCase() === 'NAME') {
      headerIdx = j;
      break;
    }
  }
  if (headerIdx < 0) headerIdx = 6;
  var people = [];
  for (var r = headerIdx + 1; r < rows.length; r++) {
    var row = rows[r];
    var name = String(row[0] || '').trim();
    if (!name) continue;
    var up = name.toUpperCase();
    if (up.indexOf('SECTION TOTAL') >= 0 || up === 'TOTAL') continue;
    if (up.indexOf('AFTER ALLOW') >= 0 || up.indexOf('ALLOW ACCESS') >= 0) continue;
    if (up.indexOf('EXPECTED') >= 0 || up.indexOf('ACTUAL SO FAR') >= 0 || up.indexOf('REMAINING') >= 0) continue;
    if (name.length < 2) continue;
    people.push({
      name: name,
      dailyTarget: parseNum(row[1]),
      sheetStatus: String(row[2] || '').trim(),
      expected: parseNum(row[3]),
      actual: parseNum(row[4]),
      appStatus: 'OUT',
      expanded: false
    });
  }
  return { people: people, sectionExpected: sectionExpected, sectionActual: sectionActual };
}

function parseRoster(rows) {
  var map = {};
  var count = 0;
  rows.forEach(function (row) {
    var name = normName(row[0]);
    if (!name || name === 'NAME') return;
    map[name] = String(row[1] || '').trim().toUpperCase();
    count++;
  });
  return count ? map : null;
}

function applyRoster(people, roster) {
  if (!roster) return { people: people, filtered: false, removed: [] };
  var known = people.filter(function (p) { return roster.hasOwnProperty(normName(p.name)); });
  if (!known.length) return { people: people, filtered: false, removed: [] };
  var removed = [];
  var visible = people.filter(function (p) {
    var key = normName(p.name);
    if (!roster.hasOwnProperty(key)) { removed.push(p.name + ' (not on Targets)'); return false; }
    if (roster[key] === 'NO') { removed.push(p.name + ' (Temp Help = No)'); return false; }
    return true;
  });
  return { people: visible, filtered: true, removed: removed };
}

function parseAttendance(rows, dayISO) {
  var map = {};
  rows.forEach(function (row) {
    var d = String(row[0] || '').trim();
    var iso = normalizeSheetDate(d);
    if (iso && iso !== dayISO) return;
    if (!iso && d && d.indexOf(dayISO) < 0 && d !== dayISO) {
      if (d.replace(/\//g, '-').indexOf(dayISO) < 0) return;
    }
    var name = normName(row[1]);
    if (!name || name === 'NAME') return;
    var st = String(row[2] || 'OUT').trim().toUpperCase();
    if (st === 'H' || st === 'HALF DAY' || st === 'HALF') st = 'HALF';
    if (st !== 'IN' && st !== 'HALF') st = 'OUT';
    map[name] = st;
  });
  return map;
}

function normalizeSheetDate(s) {
  s = String(s || '').trim();
  if (!s) return '';
  var m = s.match(/^Date\((\d+),(\d+),(\d+)/);
  if (m) {
    var y = +m[1], mo = +m[2] + 1, d = +m[3];
    return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) return m[3] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[1]).padStart(2, '0');
  return '';
}

function applyAttendance(people, attendMap) {
  people.forEach(function (p) {
    var st = attendMap[normName(p.name)] || 'OUT';
    p.appStatus = st;
    if (st === 'IN') {
      p.expected = p.dailyTarget;
      p.expanded = true;
    } else if (st === 'HALF') {
      p.expected = Math.round(p.dailyTarget * 0.5 * 10) / 10;
      p.expanded = true;
    } else {
      p.expected = 0;
      p.expanded = false;
    }
    p.status = st;
  });
  var sectionExpected = people.reduce(function (s, p) { return s + (p.expected || 0); }, 0);
  var sectionActual = people.reduce(function (s, p) {
    return s + (p.appStatus === 'OUT' ? 0 : (p.actual || 0));
  }, 0);
  return { sectionExpected: sectionExpected, sectionActual: sectionActual };
}

async function ensureWriteToken() {
  if (driveAccessToken && gapiSignedIn) return driveAccessToken;
  try { await initGapiClient(); } catch (_) {}
  var ok = await requestDriveToken(true);
  if (!ok || !driveAccessToken) throw new Error('Google sign-in required to save who is in (TV needs a shared save).');
  return driveAccessToken;
}

async function saveAttendanceStatus(name, status) {
  var token = await ensureWriteToken();
  var day = shiftDateISO();
  var who = localStorage.getItem('userName') || localStorage.getItem('userEmail') || '';
  var when = new Date().toISOString();

  var getUrl = 'https://sheets.googleapis.com/v4/spreadsheets/' + SHEET_ID +
    '/values/' + encodeURIComponent(ATTEND_TAB + '!A:E');
  var getRes = await fetch(getUrl, { headers: { Authorization: 'Bearer ' + token } });
  if (!getRes.ok) {
    var t = await getRes.text();
    throw new Error('Cannot read ' + ATTEND_TAB + ' tab — create it with headers Date, Name, Status, UpdatedBy, UpdatedAt. ' + getRes.status + ' ' + t.slice(0, 120));
  }
  var data = await getRes.json();
  var values = data.values || [];
  if (!values.length) {
    values = [['Date', 'Name', 'Status', 'UpdatedBy', 'UpdatedAt']];
  }

  var found = -1;
  for (var i = 1; i < values.length; i++) {
    var row = values[i] || [];
    var iso = normalizeSheetDate(row[0]) || String(row[0] || '').trim();
    if (iso === day && normName(row[1]) === normName(name)) {
      found = i;
      break;
    }
  }
  var newRow = [day, name, status, who, when];
  if (found >= 0) values[found] = newRow;
  else values.push(newRow);

  var putRes = await fetch(
    'https://sheets.googleapis.com/v4/spreadsheets/' + SHEET_ID +
      '/values/' + encodeURIComponent(ATTEND_TAB + '!A1') +
      '?valueInputOption=USER_ENTERED',
    {
      method: 'PUT',
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ values: values })
    }
  );
  if (!putRes.ok) {
    var t2 = await putRes.text();
    throw new Error('Save failed: ' + putRes.status + ' ' + t2.slice(0, 160));
  }
}

function dialSvg(actual, target, size, opts) {
  size = size || 160;
  var tv = !!(opts && opts.tv);
  var scale = target > 0 ? target : Math.max(actual, 1);
  var pct = Math.min(Math.max(actual / scale, 0), 1);
  var stroke = Math.max(10, Math.round(size * (tv ? 0.1 : 0.08)));
  var r = (size - stroke) / 2 * (tv ? 0.95 : 0.85);
  var cx = size / 2;
  var cy = size / 2;
  var circumference = 2 * Math.PI * r;
  var dash = circumference * pct;
  var gap = circumference;
  var colour = '#e74c3c';
  if (target <= 0 && actual > 0) colour = '#3498db';
  else if (pct >= 0.95) colour = '#2ecc71';
  else if (pct >= 0.75) colour = '#f5a623';
  var sub = target > 0
    ? ('of ' + target.toFixed(0) + ' m')
    : (actual > 0 ? 'm today' : 'of 0 m');
  var fontMain = Math.round(size * (tv ? 0.24 : 0.16));
  var fontSub = Math.round(size * (tv ? 0.09 : 0.07));
  var wAttr = tv ? '100%' : size;
  return '<svg width="' + wAttr + '" height="' + wAttr + '" viewBox="0 0 ' + size + ' ' + size + '">' +
    '<circle cx="' + cx + '" cy="' + cy + '" r="' + r.toFixed(2) +
      '" fill="none" stroke="#2a3348" stroke-width="' + stroke + '"/>' +
    '<circle cx="' + cx + '" cy="' + cy + '" r="' + r.toFixed(2) +
      '" fill="none" stroke="' + colour + '" stroke-width="' + stroke +
      '" stroke-linecap="round"' +
      ' stroke-dasharray="' + dash.toFixed(2) + ' ' + gap.toFixed(2) + '"' +
      ' transform="rotate(-90 ' + cx + ' ' + cy + ')"/>' +
    '<text x="' + cx + '" y="' + (cy - 2) +
      '" text-anchor="middle" dominant-baseline="middle" fill="var(--text, #eef2fb)" font-size="' + fontMain +
      '" font-weight="700">' + actual.toFixed(0) + '</text>' +
    '<text x="' + cx + '" y="' + (cy + fontMain * 0.75) +
      '" text-anchor="middle" fill="var(--muted, #8993ab)" font-size="' + fontSub +
      '">' + sub + '</text>' +
    '</svg>';
}

function renderSummary(sectionExpected, sectionActual, fullDaily, mgr) {
  const el = document.getElementById('secondFixSummary');
  if (!el) return;
  fullDaily = fullDaily || 0;
  const pct = sectionExpected > 0 ? (100 * sectionActual / sectionExpected) : 0;
  const remaining = sectionExpected - sectionActual;
  var note = sectionExpected <= 0
    ? '<div class="forecast-note" style="grid-column:1/-1;">' +
      (mgr
        ? 'Nobody marked <strong>In</strong> yet — tap a name to set In / Half / Out.'
        : 'Nobody marked in yet today (manager sets this on their login).') +
      '</div>'
    : '';
  if (mgr) {
    note += '<div class="forecast-note" style="grid-column:1/-1;">Manager mode: tap a name to cycle Out → In → Half. TV users only see the result.</div>';
  }
  el.innerHTML =
    '<div class="stat-card"><div class="stat-label">Expected today</div><div class="stat-value">' + sectionExpected.toFixed(0) + ' m</div></div>' +
    '<div class="stat-card"><div class="stat-label">Actual so far</div><div class="stat-value" style="color:var(--green,#2ecc71)">' + sectionActual.toFixed(0) + ' m</div></div>' +
    '<div class="stat-card"><div class="stat-label">Remaining</div><div class="stat-value">' + remaining.toFixed(0) + ' m</div></div>' +
    '<div class="stat-card"><div class="stat-label">% of expected</div><div class="stat-value">' + pct.toFixed(0) + '%</div></div>' +
    note;
}

function renderSectionDial(sectionExpected, sectionActual) {
  const el = document.getElementById('secondFixSectionDial');
  if (!el) return;
  el.innerHTML = dialSvg(sectionActual, sectionExpected > 0 ? sectionExpected : 1, 200);
}

function statusColour(st) {
  if (st === 'IN') return '#2ecc71';
  if (st === 'HALF') return '#f5a623';
  return '#8993ab';
}

function renderPeopleDials(people) {
  const grid = document.getElementById('secondFixDialGrid');
  if (!grid) return;
  var mgr = isManager();

  // Keep closed name-rows short: do not stretch every cell to the tallest dial
  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(210px, 1fr))';
  grid.style.alignItems = 'start';
  grid.style.gridAutoRows = 'min-content';
  grid.style.gap = '10px';

  const sorted = people.slice().sort(function (a, b) {
    var ao = a.appStatus === 'OUT' ? 1 : 0;
    var bo = b.appStatus === 'OUT' ? 1 : 0;
    if (ao !== bo) return ao - bo;
    return a.name.localeCompare(b.name);
  });

  grid.innerHTML = sorted.map(function (p) {
    var st = p.appStatus || 'OUT';
    var open = st === 'IN' || st === 'HALF';
    var scale = p.expected > 0 ? p.expected : p.dailyTarget;
    var chevron = open ? '▼' : '▶';
    var clickHint = mgr ? ' title="Tap to change: Out → In → Half"' : ' title="View only"';

    // OUT: single compact bar only (no empty body stretching the row)
    var head =
      '<button type="button" class="sf-person-head" data-name="' + esc(p.name) + '"' + clickHint + ' style="' +
      'width:100%;display:flex;align-items:center;justify-content:space-between;gap:8px;' +
      'padding:10px 12px;background:transparent;border:none;color:inherit;font:inherit;cursor:' +
      (mgr ? 'pointer' : 'default') + ';">' +
      '<span style="font-weight:700;font-size:0.9rem;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
      chevron + ' ' + esc(p.name) + '</span>' +
      '<span style="font-size:0.72rem;font-weight:700;flex-shrink:0;color:' + statusColour(st) + ';">' +
      st + (mgr ? ' · edit' : '') + '</span></button>';

    var body = '';
    if (open) {
      body =
        '<div class="sf-person-body" style="text-align:center;padding:0 10px 12px;">' +
        dialSvg(p.actual, scale > 0 ? scale : p.dailyTarget || 1, 120) +
        '<div style="font-size:0.72rem;color:var(--muted,#8993ab);margin-top:2px;">' +
        p.actual.toFixed(1) + ' / ' + (p.expected > 0 ? p.expected.toFixed(1) : '0') + ' m' +
        (st === 'HALF' ? ' (half)' : '') +
        '</div></div>';
    }

    return '<div class="dial-card sf-person-card" data-name="' + esc(p.name) + '" style="' +
      'align-self:start;height:auto;max-width:100%;text-align:left;' +
      'background:var(--card-bg,#161d2e);border-radius:12px;' +
      'border:1px solid var(--card-border,#232c42);overflow:hidden;">' +
      head + body + '</div>';
  }).join('');

  if (mgr) {
    grid.querySelectorAll('.sf-person-head').forEach(function (btn) {
      btn.addEventListener('click', function () {
        cyclePersonStatus(btn.getAttribute('data-name'));
      });
    });
  }
}

async function cyclePersonStatus(name) {
  if (!isManager() || !lastData) return;
  var p = lastData.people.find(function (x) { return x.name === name; });
  if (!p) return;
  var order = ['OUT', 'IN', 'HALF'];
  var idx = order.indexOf(p.appStatus || 'OUT');
  var next = order[(idx + 1) % order.length];

  try {
    await saveAttendanceStatus(name, next);
    p.appStatus = next;
    p.status = next;
    if (next === 'IN') {
      p.expected = p.dailyTarget;
      p.expanded = true;
    } else if (next === 'HALF') {
      p.expected = Math.round(p.dailyTarget * 0.5 * 10) / 10;
      p.expanded = true;
    } else {
      p.expected = 0;
      p.expanded = false;
    }
    var sectionExpected = lastData.people.reduce(function (s, x) { return s + (x.expected || 0); }, 0);
    var sectionActual = lastData.people.reduce(function (s, x) {
      return s + (x.appStatus === 'OUT' ? 0 : (x.actual || 0));
    }, 0);
    lastData.sectionExpected = sectionExpected;
    lastData.sectionActual = sectionActual;
    lastData.dialExpected = sectionExpected > 0 ? sectionExpected : lastData.fullDaily || 1;
    lastData.updated = new Date();
    renderSummary(sectionExpected, sectionActual, lastData.fullDaily || 0, true);
    renderSectionDial(lastData.dialExpected, sectionActual);
    renderPeopleDials(lastData.people);
    if (tvActive) renderTv();
  } catch (err) {
    console.error(err);
    alert(err.message || String(err));
  }
}

var loading = false;
var lastData = null;
var tvActive = false;

export async function loadSecondFix(force) {
  if (loading && !force) return;
  loading = true;
  const summary = document.getElementById('secondFixSummary');
  if (summary) summary.innerHTML = '<div class="forecast-note">Loading live figures…</div>';
  var mgr = isManager();

  try {
    const rows = await fetchGviz(SHEET_ID, GID_DAILY);
    const parsed = parseDailyRows(rows);
    var people = parsed.people;

    if (!people.length) {
      if (summary) {
        summary.innerHTML = '<div class="forecast-note" style="color:var(--red,#e74c3c);">' +
          'No people data found. Share the capability sheet as “Anyone with the link can view”.</div>';
      }
      return;
    }

    var roster = null;
    try {
      roster = parseRoster(await fetchGviz(SHEET_ID, null, ROSTER_TAB));
    } catch (e) {
      console.warn('2nd Fix: Roster tab not available', e);
    }
    var applied = applyRoster(people, roster);
    if (applied.filtered) people = applied.people;

    var day = shiftDateISO();
    var attendMap = {};
    try {
      attendMap = parseAttendance(await fetchGviz(SHEET_ID, null, ATTEND_TAB), day);
    } catch (e) {
      console.warn('2nd Fix: AppInToday tab missing or not shared — defaulting everyone Out', e);
    }
    var totals = applyAttendance(people, attendMap);
    var sectionExpected = totals.sectionExpected;
    var sectionActual = totals.sectionActual;
    var fullDaily = people.reduce(function (s, p) { return s + (p.dailyTarget || 0); }, 0);
    var dialExpected = sectionExpected > 0 ? sectionExpected : Math.max(fullDaily, 1);

    renderSummary(sectionExpected, sectionActual, fullDaily, mgr);
    renderSectionDial(sectionExpected > 0 ? sectionExpected : dialExpected, sectionActual);
    renderPeopleDials(people);

    lastData = {
      people: people,
      sectionExpected: sectionExpected,
      sectionActual: sectionActual,
      dialExpected: dialExpected,
      fullDaily: fullDaily,
      updated: new Date()
    };
    if (tvActive) renderTv();

    const weekEl = document.getElementById('secondFixWeekStrip');
    if (weekEl) {
      weekEl.textContent = mgr
        ? 'Tap a name to mark In / Half / Out (saved for the TV). Day resets 06:30.'
        : 'View only — managers mark who is in from their login.';
    }
  } catch (err) {
    console.error('2nd Fix load failed', err);
    if (summary) {
      summary.innerHTML = '<div class="forecast-note" style="color:var(--red,#e74c3c);">' +
        'Could not load 2nd Fix data: ' + (err.message || err) + '</div>';
    }
  } finally {
    loading = false;
  }
}

function renderTv() {
  var o = document.getElementById('sfTvOverlay');
  if (!o || !lastData) return;
  var d = lastData;
  var W = window.innerWidth;
  var H = window.innerHeight;
  var pad = Math.round(H * 0.018);
  var barH = Math.round(H * 0.07);
  var topH = Math.round(H * 0.27);
  var gridH = H - barH - topH - pad * 4;
  var gridW = W - pad * 2;

  var people = d.people.filter(function (p) {
    return p.appStatus === 'IN' || p.appStatus === 'HALF';
  }).slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
  if (!people.length) people = d.people.slice();
  var n = Math.max(people.length, 1);
  var best = { dial: 0, cols: 1, rows: n };
  for (var c = 1; c <= n; c++) {
    var rows = Math.ceil(n / c);
    var cellW = gridW / c;
    var cellH = gridH / rows;
    var dial = Math.min(cellW * 0.92, cellH * 0.7);
    if (dial > best.dial) best = { dial: dial, cols: c, rows: rows };
  }
  var cellW2 = gridW / best.cols;
  var cellH2 = gridH / best.rows;
  var maxLen = people.reduce(function (m, p) { return Math.max(m, p.name.length); }, 8);
  var nameFs = Math.max(12, Math.min(cellH2 * 0.1, (cellW2 * 0.88) / (maxLen * 0.72), 48));
  var detailFs = Math.max(12, Math.min(cellH2 * 0.075, (cellW2 * 0.9) / (13 * 0.62), 36, nameFs * 1.05));
  var pct = d.sectionExpected > 0 ? (100 * d.sectionActual / d.sectionExpected) : 0;
  var remaining = d.sectionExpected - d.sectionActual;
  var valFs = Math.min(topH * 0.3, ((W - topH - pad * 3) / 4) / (7 * 0.62));
  var lblFs = Math.max(12, Math.min(topH * 0.1, 26));

  function stat(label, value, colour) {
    return '<div style="flex:1;display:flex;flex-direction:column;justify-content:center;align-items:center;' +
      'background:var(--card-bg,#161d2e);border:1px solid var(--card-border,#232c42);border-radius:16px;min-width:0;">' +
      '<div style="font-size:' + lblFs + 'px;color:var(--muted,#8993ab);text-transform:uppercase;letter-spacing:0.06em;">' + label + '</div>' +
      '<div style="font-size:' + valFs + 'px;font-weight:800;line-height:1.1;' + (colour ? 'color:' + colour + ';' : '') + '">' + value + '</div></div>';
  }

  var cards = people.map(function (p) {
    var scale = p.expected > 0 ? p.expected : p.dailyTarget;
    var away = p.appStatus && p.appStatus !== 'IN'
      ? ' <span style="font-size:' + (detailFs * 0.8) + 'px;color:var(--muted,#8993ab);">' + esc(p.appStatus) + '</span>' : '';
    return '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-width:0;min-height:0;' +
      'background:var(--card-bg,#161d2e);border:1px solid var(--card-border,#232c42);border-radius:14px;padding:4px;overflow:hidden;">' +
      '<div style="font-size:' + nameFs + 'px;font-weight:700;white-space:nowrap;">' + esc(p.name) + away + '</div>' +
      '<div style="flex:1;min-height:0;width:100%;display:flex;align-items:center;justify-content:center;">' +
      dialSvg(p.actual, scale > 0 ? scale : 1, 200, { tv: true }) +
      '</div>' +
      '<div style="font-size:' + detailFs + 'px;color:var(--muted,#8993ab);">' +
      p.actual.toFixed(1) + ' / ' + (scale > 0 ? scale.toFixed(1) : '0') + ' m</div></div>';
  }).join('');

  var hh = d.updated.getHours(), mm = d.updated.getMinutes();
  var stamp = 'Updated ' + (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
  var note = d.sectionExpected <= 0 ? 'Waiting for manager to mark who is in' : '';

  o.innerHTML =
    '<div style="height:100%;box-sizing:border-box;padding:' + pad + 'px;display:flex;flex-direction:column;gap:' + pad + 'px;">' +
      '<div style="height:' + barH + 'px;display:flex;align-items:center;justify-content:space-between;">' +
        '<div style="font-size:' + (barH * 0.55) + 'px;font-weight:800;">2nd Fix — Today</div>' +
        '<div style="font-size:' + (barH * 0.3) + 'px;color:var(--muted,#8993ab);">' + note + '</div>' +
        '<div style="display:flex;align-items:center;gap:14px;">' +
          '<span style="font-size:' + (barH * 0.32) + 'px;color:var(--muted,#8993ab);">' + stamp + '</span>' +
          '<button id="sfTvExit" type="button" style="font-family:inherit;font-size:' + (barH * 0.3) + 'px;padding:6px 16px;border-radius:10px;' +
          'border:1px solid var(--card-border,#232c42);background:transparent;color:var(--muted,#8993ab);cursor:pointer;">Exit</button>' +
        '</div></div>' +
      '<div style="height:' + topH + 'px;display:flex;gap:' + pad + 'px;">' +
        '<div style="width:' + topH + 'px;height:' + topH + 'px;flex:none;">' +
        dialSvg(d.sectionActual, d.dialExpected > 0 ? d.dialExpected : 1, 200, { tv: true }) + '</div>' +
        stat('Expected today', d.sectionExpected.toFixed(0) + ' m') +
        stat('Actual so far', d.sectionActual.toFixed(0) + ' m', 'var(--green,#2ecc71)') +
        stat('Remaining', remaining.toFixed(0) + ' m') +
        stat('% of expected', pct.toFixed(0) + '%') +
      '</div>' +
      '<div style="height:' + gridH + 'px;display:grid;gap:' + pad + 'px;' +
        'grid-template-columns:repeat(' + best.cols + ',minmax(0,1fr));grid-template-rows:repeat(' + best.rows + ',minmax(0,1fr));">' +
        cards + '</div></div>';

  var exit = document.getElementById('sfTvExit');
  if (exit) exit.addEventListener('click', closeTv);
}

function onTvResize() { if (tvActive) renderTv(); }
function onTvFullscreenChange() {
  if (tvActive && !document.fullscreenElement) closeTv();
}
function onTvKey(e) {
  if (e.key === 'Escape' && tvActive) closeTv();
}

function openTv() {
  var o = document.getElementById('sfTvOverlay');
  if (!o) {
    o = document.createElement('div');
    o.id = 'sfTvOverlay';
    o.style.cssText = 'position:fixed;inset:0;z-index:99999;background:var(--bg,#0b1020);color:var(--text,#eef2fb);font-family:inherit;overflow:hidden;';
    document.body.appendChild(o);
  }
  o.style.display = 'block';
  tvActive = true;
  document.documentElement.style.overflow = 'hidden';
  if (lastData) renderTv();
  else o.innerHTML = '<div style="padding:40px;font-size:28px;">Loading live figures…</div>';
  try {
    if (o.requestFullscreen) o.requestFullscreen().catch(function () {});
  } catch (e) {}
  window.addEventListener('resize', onTvResize);
  document.addEventListener('fullscreenchange', onTvFullscreenChange);
  document.addEventListener('keydown', onTvKey);
}

function closeTv() {
  tvActive = false;
  var o = document.getElementById('sfTvOverlay');
  if (o) {
    o.style.display = 'none';
    o.innerHTML = '';
  }
  document.documentElement.style.overflow = '';
  try {
    if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
  } catch (e) {}
  window.removeEventListener('resize', onTvResize);
  document.removeEventListener('fullscreenchange', onTvFullscreenChange);
  document.removeEventListener('keydown', onTvKey);
}

export function openSecondFixTv() {
  openTv();
}

window.loadSecondFix = loadSecondFix;
window.openSecondFixTv = openSecondFixTv;
