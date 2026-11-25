/**
 * 1st Fix WIP dials — matches Looker F1 report logic.
 *
 * Office→CNC WIP: programs completed (D) but posts+winders+strings not all done.
 * Strings/Winders/Posts/Treads WIP: that stage done, assembly not done.
 * Assembled bullnose WIP: bullnose done, dispatch not done.
 * Under each dial: last ticked load delivery date, load no, "X of Y" that date.
 */
import { CONFIG } from './config.js';

const SHEET_ID = (CONFIG.sheets && CONFIG.sheets.projectTracking && CONFIG.sheets.projectTracking.id)
  || '15aEtpNIDILzw_2n_KYWkBCefakqSt36jzGWredct3J4';
const GID = (CONFIG.sheets && CONFIG.sheets.projectTracking && CONFIG.sheets.projectTracking.gid)
  || '1766737074';

const DIALS = [
  { key: 'officeCnc', title: 'OFFICE TO CNC', band: '350-500', greenMin: 350, greenMax: 500, scaleMax: 800, kind: 'wip' },
  { key: 'strings', title: 'STRINGS', band: '400-500', greenMin: 400, greenMax: 500, scaleMax: 700, kind: 'wip' },
  { key: 'winders', title: 'WINDERS', band: '1100-1300', greenMin: 1100, greenMax: 1300, scaleMax: 1700, kind: 'wip' },
  { key: 'posts', title: 'POSTS', band: '1000-1200', greenMin: 1000, greenMax: 1200, scaleMax: 1600, kind: 'wip' },
  { key: 'treads', title: 'TREADS/RISERS', band: '100-150', greenMin: 100, greenMax: 150, scaleMax: 250, kind: 'wip' },
  { key: 'bullnose', title: 'ASSEMBLED BULLNOSE', band: '100-150', greenMin: 100, greenMax: 150, scaleMax: 250, kind: 'wip' },
  { key: 'stacked', title: 'STACKED', kind: 'status' },
  { key: 'dispatch', title: 'DISPATCH', kind: 'status' },
];

function gvizUrl(sheetId, gid) {
  return 'https://docs.google.com/spreadsheets/d/' + sheetId + '/gviz/tq?tqx=out:json&gid=' + gid;
}

async function fetchGviz(sheetId, gid) {
  const res = await fetch(gvizUrl(sheetId, gid));
  const text = await res.text();
  const json = JSON.parse(text.substring(47, text.length - 2));
  if (json.status === 'error') {
    throw new Error((json.errors && json.errors[0] && json.errors[0].detailed_message) || 'Sheet error');
  }
  const table = json.table;
  const labels = (table.cols || []).map(function (c) { return String(c.label || '').trim(); });
  const rows = (table.rows || []).map(function (r) {
    return (table.cols || []).map(function (_, i) {
      const cell = r.c ? r.c[i] : null;
      if (!cell) return null;
      if (cell.v !== undefined && cell.v !== null) return cell.v;
      if (cell.f != null) return cell.f;
      return null;
    });
  });
  return { labels: labels, rows: rows };
}

function normHeader(s) {
  return String(s || '').toUpperCase().replace(/\s+/g, ' ').trim();
}

function truthy(v) {
  return v === true || v === 'true' || v === 'TRUE' || v === 1 || v === '1';
}

function findCol(labels, parts) {
  const up = labels.map(normHeader);
  for (var i = 0; i < up.length; i++) {
    var ok = true;
    for (var j = 0; j < parts.length; j++) {
      if (up[i].indexOf(parts[j]) < 0) { ok = false; break; }
    }
    if (ok) return i;
  }
  return -1;
}

function colMap(labels) {
  return {
    stairs: findCol(labels, ['NUMBER OF STAIRS']) >= 0
      ? findCol(labels, ['NUMBER OF STAIRS'])
      : findCol(labels, ['STAIRS']),
    load: findCol(labels, ['LOAD']) >= 0 ? findCol(labels, ['LOAD']) : findCol(labels, ['JOB']),
    delivery: findCol(labels, ['DELIVERY', 'DATE']),
    office: findCol(labels, ['PROGRAMS', 'COMPLETED']),
    posts: findCol(labels, ['POSTS', 'COMPLETED']),
    winders: findCol(labels, ['WINDERS', 'COMPLETED']),
    strings: findCol(labels, ['STRINGS', 'COMPLETED']),
    treads: findCol(labels, ['TREADS']) >= 0 ? findCol(labels, ['TREADS']) : findCol(labels, ['RISERS']),
    bullnose: findCol(labels, ['BULLNOSE']),
    assembly: findCol(labels, ['IN', 'ASSEMBLY']) >= 0
      ? findCol(labels, ['IN', 'ASSEMBLY'])
      : findCol(labels, ['ASSEMBLY']),
    stacked: findCol(labels, ['STACKED']),
    dispatch: findCol(labels, ['DISPATCH']),
  };
}

function stairsOf(row, cols) {
  var g = row[cols.stairs];
  var n = typeof g === 'number' ? g : parseFloat(String(g || '').replace(/,/g, ''));
  return (!n || isNaN(n) || n <= 0) ? 0 : n;
}

function formatDelivery(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'string' && v.indexOf('Date(') === 0) {
    var m = /Date\((\d+),(\d+),(\d+)/.exec(v);
    if (m) return new Date(+m[1], +m[2], +m[3]);
  }
  if (v instanceof Date) return v;
  if (typeof v === 'object' && v && typeof v.getFullYear === 'function') return v;
  if (typeof v === 'string') {
    var d2 = new Date(v);
    if (!isNaN(d2.getTime())) return d2;
  }
  return null;
}

function formatDateLong(d) {
  if (!d || isNaN(d.getTime())) return '—';
  try {
    return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
  } catch (e) {
    return d.toISOString().slice(0, 10);
  }
}

function sameDayKey(d) {
  if (!d || isNaN(d.getTime())) return '';
  return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}

function lastTickInfo(rows, cols, checkCol) {
  if (checkCol < 0) return { dateStr: '—', load: '—', tickCount: '—' };
  var lastIndex = -1;
  for (var i = rows.length - 1; i >= 0; i--) {
    if (truthy(rows[i][checkCol])) { lastIndex = i; break; }
  }
  if (lastIndex < 0) return { dateStr: '—', load: '—', tickCount: '—' };

  var delRaw = rows[lastIndex][cols.delivery];
  var delDate = formatDelivery(delRaw);
  var dateStr = formatDateLong(delDate);
  if ((!delDate || isNaN(delDate.getTime())) && delRaw != null) dateStr = String(delRaw);
  var load = rows[lastIndex][cols.load];
  load = load == null || load === '' ? '—' : String(load).trim();

  var key = sameDayKey(delDate);
  var totalSame = 0, tickedSame = 0;
  if (key) {
    for (var j = 0; j < rows.length; j++) {
      var dj = formatDelivery(rows[j][cols.delivery]);
      if (sameDayKey(dj) !== key) continue;
      totalSame++;
      if (truthy(rows[j][checkCol])) tickedSame++;
    }
  }
  return { dateStr: dateStr, load: load, tickCount: totalSame > 0 ? (tickedSame + ' of ' + totalSame) : '—' };
}

function computeWip(rows, cols) {
  var wip = { officeCnc: 0, strings: 0, winders: 0, posts: 0, treads: 0, bullnose: 0 };
  rows.forEach(function (row) {
    var s = stairsOf(row, cols);
    if (!s) return;
    var office = truthy(row[cols.office]);
    var posts = truthy(row[cols.posts]);
    var winders = truthy(row[cols.winders]);
    var strings = truthy(row[cols.strings]);
    var treads = truthy(row[cols.treads]);
    var bull = truthy(row[cols.bullnose]);
    var assembly = truthy(row[cols.assembly]);
    var dispatch = truthy(row[cols.dispatch]);
    var cncDone = posts && winders && strings;
    if (office && !cncDone) wip.officeCnc += s;
    if (strings && !assembly) wip.strings += s;
    if (winders && !assembly) wip.winders += s;
    if (posts && !assembly) wip.posts += s;
    if (treads && !assembly) wip.treads += s;
    if (bull && !dispatch) wip.bullnose += s;
  });
  return wip;
}

function esc(t) {
  return String(t == null ? '' : t).replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>');
}

function fmt(n) {
  return Math.round(n).toLocaleString('en-GB');
}

function gaugeSvg(value, greenMin, greenMax, scaleMax) {
  var size = 180, cx = 90, cy = 100, r = 70, stroke = 14;
  scaleMax = Math.max(scaleMax || greenMax * 1.6, greenMax * 1.1, value * 1.05, 1);
  function ang(v) {
    var t = Math.min(Math.max(v / scaleMax, 0), 1);
    return -210 + t * 240;
  }
  function polar(aDeg, rad) {
    var a = (aDeg * Math.PI) / 180;
    return { x: cx + rad * Math.cos(a), y: cy + rad * Math.sin(a) };
  }
  function arcPath(a0, a1, rad) {
    var p0 = polar(a0, rad), p1 = polar(a1, rad);
    var large = a1 - a0 > 180 ? 1 : 0;
    return 'M ' + p0.x.toFixed(2) + ' ' + p0.y.toFixed(2) +
      ' A ' + rad + ' ' + rad + ' 0 ' + large + ' 1 ' + p1.x.toFixed(2) + ' ' + p1.y.toFixed(2);
  }
  var aMin = ang(0), aG0 = ang(greenMin), aG1 = ang(greenMax), aMax = ang(scaleMax);
  var aA0 = ang(greenMin * 0.55);
  var aA1 = ang(Math.min(greenMax + (scaleMax - greenMax) * 0.35, scaleMax));
  var needle = polar(ang(value), r - 8);
  return (
    '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '">' +
      '<path d="' + arcPath(aMin, aA0, r) + '" fill="none" stroke="#c0392b" stroke-width="' + stroke + '"/>' +
      '<path d="' + arcPath(aA0, aG0, r) + '" fill="none" stroke="#e67e22" stroke-width="' + stroke + '"/>' +
      '<path d="' + arcPath(aG0, aG1, r) + '" fill="none" stroke="#27ae60" stroke-width="' + stroke + '"/>' +
      '<path d="' + arcPath(aG1, aA1, r) + '" fill="none" stroke="#e67e22" stroke-width="' + stroke + '"/>' +
      '<path d="' + arcPath(aA1, aMax, r) + '" fill="none" stroke="#c0392b" stroke-width="' + stroke + '"/>' +
      '<line x1="' + cx + '" y1="' + cy + '" x2="' + needle.x.toFixed(2) + '" y2="' + needle.y.toFixed(2) +
        '" stroke="#2c3e50" stroke-width="3" stroke-linecap="round"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="8" fill="#3498db"/>' +
      '<text x="' + cx + '" y="' + (cy + 36) + '" text-anchor="middle" font-size="22" font-weight="700" fill="var(--text,#1a1a1a)">' +
        fmt(value) + '</text>' +
    '</svg>'
  );
}

function statusCard(title, info) {
  return (
    '<div class="ff-dial-card">' +
      '<div class="ff-dial-title">' + esc(title) + '</div>' +
      '<div class="ff-status-body">' +
        '<div class="ff-status-date">' + esc(info.dateStr) + '</div>' +
        '<div class="ff-status-load">' + esc(info.load) + '</div>' +
        '<div class="ff-status-xy">' + esc(info.tickCount) + '</div>' +
      '</div>' +
    '</div>'
  );
}

function dialCard(def, value, info) {
  var band = def.band ? (' ' + def.band) : '';
  return (
    '<div class="ff-dial-card">' +
      '<div class="ff-dial-title">' + esc(def.title) + esc(band) + '</div>' +
      '<div class="ff-dial-svg">' + gaugeSvg(value, def.greenMin, def.greenMax, def.scaleMax) + '</div>' +
      '<div class="ff-under">' +
        '<div>' + esc(info.dateStr) + '</div>' +
        '<div>' + esc(info.load) + ' · ' + esc(info.tickCount) + '</div>' +
      '</div>' +
    '</div>'
  );
}

function render(payload) {
  var root = document.getElementById('firstFixBody');
  if (!root) return;
  var wip = payload.wip, last = payload.last;
  var html = DIALS.map(function (d) {
    if (d.kind === 'status') return statusCard(d.title, last[d.key] || { dateStr: '—', load: '—', tickCount: '—' });
    return dialCard(d, wip[d.key] || 0, last[d.key] || { dateStr: '—', load: '—', tickCount: '—' });
  }).join('');
  root.innerHTML =
    '<p class="ff-intro">WIP buffers between departments (stairs). Green band = healthy work ahead so the next area does not run out. ' +
    'Office→CNC only clears when posts, winders and strings are all ticked. Under each dial: last load completed for that stage.</p>' +
    '<div class="ff-dial-grid">' + html + '</div>';
}

var loading = false;

export async function loadFirstFix() {
  var root = document.getElementById('firstFixBody');
  if (!root) return;
  if (loading) return;
  loading = true;
  root.innerHTML = '<p class="ff-intro">Loading Project Tracking…</p>';
  try {
    var table = await fetchGviz(SHEET_ID, GID);
    var cols = colMap(table.labels);
    if (cols.stairs < 0) throw new Error('Stairs column not found');
    if (cols.office < 0) throw new Error('PROGRAMS COMPLETED column not found');
    var wip = computeWip(table.rows, cols);
    var last = {
      officeCnc: lastTickInfo(table.rows, cols, cols.office),
      strings: lastTickInfo(table.rows, cols, cols.strings),
      winders: lastTickInfo(table.rows, cols, cols.winders),
      posts: lastTickInfo(table.rows, cols, cols.posts),
      treads: lastTickInfo(table.rows, cols, cols.treads),
      bullnose: lastTickInfo(table.rows, cols, cols.bullnose),
      stacked: lastTickInfo(table.rows, cols, cols.stacked),
      dispatch: lastTickInfo(table.rows, cols, cols.dispatch),
    };
    render({ wip: wip, last: last });
  } catch (e) {
    console.error(e);
    root.innerHTML = '<p class="ff-intro" style="color:#c0392b;">Could not load Project Tracking. ' +
      esc(e && e.message ? e.message : e) + '</p>';
  } finally {
    loading = false;
  }
}

window.loadFirstFix = loadFirstFix;
