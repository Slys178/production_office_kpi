/**
 * 2nd Fix dials — pulls Expected / Actual from the capability sheet.
 * Sheet must be shared "Anyone with the link can view" for GViz.
 */
import { CONFIG } from './config.js';

const SHEET_ID = (CONFIG.sheets && CONFIG.sheets.secondFix && CONFIG.sheets.secondFix.id)
  || '1Bm_7Zeo2d2ZG3oDM-9F6fZ5X3QWvWmgkU4DumHfusb4';

const GID_DAILY = (CONFIG.sheets && CONFIG.sheets.secondFix && CONFIG.sheets.secondFix.gidDaily) || '0';

function gvizUrl(sheetId, gid) {
  const gidPart = gid != null && gid !== '' ? '&gid=' + gid : '';
  return 'https://docs.google.com/spreadsheets/d/' + sheetId + '/gviz/tq?tqx=out:json' + gidPart;
}

async function fetchGviz(sheetId, gid) {
  const res = await fetch(gvizUrl(sheetId, gid));
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

function parseDailyRows(rows) {
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 25); i++) {
    const upper = rows[i].map(function (c) { return (c || '').toUpperCase(); });
    if (upper.some(function (c) { return c.includes('NAME'); }) &&
        upper.some(function (c) { return c.includes('EXPECTED') || c.includes('ACTUAL'); })) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) headerIdx = 11;

  const header = rows[headerIdx].map(function (c) { return (c || '').toUpperCase(); });
  const nameCol = header.findIndex(function (c) { return c.includes('NAME'); });
  const targetCol = header.findIndex(function (c) { return c.includes('DAILY TARGET'); });
  const statusCol = header.findIndex(function (c) { return c.includes('STATUS'); });
  const expectedCol = header.findIndex(function (c) { return c.includes('EXPECTED'); });
  const actualCol = header.findIndex(function (c) { return c.includes('ACTUAL'); });

  const people = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const name = (r[nameCol >= 0 ? nameCol : 0] || '').trim();
    if (!name || name.toUpperCase().includes('SECTION TOTAL') || name.toUpperCase().includes('TOTAL')) continue;
    if (name.length < 2) continue;

    people.push({
      name: name,
      dailyTarget: parseNum(r[targetCol >= 0 ? targetCol : 1]),
      status: (r[statusCol >= 0 ? statusCol : 2] || '').trim(),
      expected: parseNum(r[expectedCol >= 0 ? expectedCol : 3]),
      actual: parseNum(r[actualCol >= 0 ? actualCol : 4])
    });
  }

  const sectionExpected = people.reduce(function (s, p) { return s + p.expected; }, 0);
  const sectionActual = people.reduce(function (s, p) { return s + p.actual; }, 0);
  return { people: people, sectionExpected: sectionExpected, sectionActual: sectionActual };
}

function dialSvg(actual, target, size) {
  size = size || 160;
  var scale = target > 0 ? target : Math.max(actual, 1);
  var pct = Math.min(Math.max(actual / scale, 0), 1);
  var r = size * 0.38;
  var cx = size / 2;
  var cy = size * 0.55;
  var endRad = Math.PI - pct * Math.PI;
  var x2 = cx + r * Math.cos(endRad);
  var y2 = cy - r * Math.sin(endRad);

  var colour = '#e74c3c';
  if (target <= 0 && actual > 0) colour = '#3498db';
  else if (pct >= 0.95) colour = '#2ecc71';
  else if (pct >= 0.75) colour = '#f5a623';

  var bg = 'M ' + (cx - r) + ' ' + cy + ' A ' + r + ' ' + r + ' 0 0 1 ' + (cx + r) + ' ' + cy;
  var large = pct > 0.5 ? 1 : 0;
  var arc = pct < 0.005 ? '' : ('M ' + (cx - r) + ' ' + cy + ' A ' + r + ' ' + r + ' 0 ' + large + ' 1 ' + x2 + ' ' + y2);

  var sub = target > 0 ? ('of ' + target.toFixed(0) + ' m') : (actual > 0 ? 'm today (attendance not in)' : 'of 0 m');

  return '<svg width="' + size + '" height="' + (size * 0.72) + '" viewBox="0 0 ' + size + ' ' + (size * 0.7) + '">' +
    '<path d="' + bg + '" fill="none" stroke="#2a3348" stroke-width="14" stroke-linecap="round"/>' +
    (arc ? '<path d="' + arc + '" fill="none" stroke="' + colour + '" stroke-width="14" stroke-linecap="round"/>' : '') +
    '<circle cx="' + x2 + '" cy="' + y2 + '" r="6" fill="' + colour + '"/>' +
    '<text x="' + cx + '" y="' + (cy - 12) + '" text-anchor="middle" fill="var(--text, #eef2fb)" font-size="22" font-weight="700">' + actual.toFixed(0) + '</text>' +
    '<text x="' + cx + '" y="' + (cy + 14) + '" text-anchor="middle" fill="var(--muted, #8993ab)" font-size="11">' + sub + '</text>' +
    '</svg>';
}

function renderSummary(sectionExpected, sectionActual, fullDaily) {
  const el = document.getElementById('secondFixSummary');
  if (!el) return;
  fullDaily = fullDaily || 0;
  const pct = sectionExpected > 0 ? (100 * sectionActual / sectionExpected) : 0;
  const remaining = sectionExpected - sectionActual;
  var note = sectionExpected <= 0
    ? '<div class="forecast-note" style="grid-column:1/-1;">Attendance not marked in yet for today — expected is 0. Dial scale uses full section target (' + fullDaily.toFixed(0) + ' m).</div>'
    : '';
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
  el.innerHTML = dialSvg(sectionActual, sectionExpected, 220);
}

function renderPeopleDials(people) {
  const grid = document.getElementById('secondFixDialGrid');
  if (!grid) return;
  const sorted = people.slice().sort(function (a, b) {
    if ((b.expected > 0) !== (a.expected > 0)) return b.expected > 0 ? 1 : -1;
    return a.name.localeCompare(b.name);
  });

  grid.innerHTML = sorted.map(function (p) {
    const statusBadge = p.status
      ? '<span style="font-size:0.7rem;opacity:0.8;">' + p.status + '</span>'
      : '';
    return '<div class="dial-card" style="text-align:center;padding:12px;background:var(--card-bg,#161d2e);border-radius:12px;border:1px solid var(--card-border,#232c42);">' +
      '<div style="font-weight:700;font-size:0.85rem;margin-bottom:4px;">' + p.name + '</div>' +
      statusBadge +
      dialSvg(p.actual, p.expected || p.dailyTarget, 140) +
      '</div>';
  }).join('');
}

var loading = false;

export async function loadSecondFix(force) {
  if (loading && !force) return;
  loading = true;
  const summary = document.getElementById('secondFixSummary');
  if (summary) summary.innerHTML = '<div class="forecast-note">Loading live figures…</div>';

  try {
    const rows = await fetchGviz(SHEET_ID, GID_DAILY);
    const parsed = parseDailyRows(rows);
    const people = parsed.people;
    const sectionExpected = parsed.sectionExpected;
    const sectionActual = parsed.sectionActual;

    if (!people.length) {
      if (summary) {
        summary.innerHTML = '<div class="forecast-note" style="color:var(--red,#e74c3c);">' +
          'No people data found. Share the capability sheet as “Anyone with the link can view”, ' +
          'and complete Allow access on the Live Data tab of that sheet.</div>';
      }
      return;
    }

    var fullDaily = people.reduce(function (s, p) { return s + (p.dailyTarget || 0); }, 0);
    var dialExpected = sectionExpected > 0 ? sectionExpected : fullDaily;
    renderSummary(sectionExpected, sectionActual, fullDaily);
    renderSectionDial(dialExpected, sectionActual);
    renderPeopleDials(people);

    const weekEl = document.getElementById('secondFixWeekStrip');
    if (weekEl) {
      weekEl.textContent = 'Weekly forward view is on the Weekly tab of the capability sheet.';
    }
  } catch (err) {
    console.error('2nd Fix load failed', err);
    if (summary) {
      summary.innerHTML = '<div class="forecast-note" style="color:var(--red,#e74c3c);">' +
        'Could not load 2nd Fix data: ' + (err.message || err) +
        '. Share the sheet “Anyone with the link can view” if needed.</div>';
    }
  } finally {
    loading = false;
  }
}

window.loadSecondFix = loadSecondFix;
