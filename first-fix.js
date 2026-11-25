/**
 * 1st Fix WIP dials — matches Looker F1 report logic.
 * Reads the 'Looker Source Data' tab (same cells as the Looker report); falls back to recalculating.
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

const LOOKER_TAB = (CONFIG.sheets && CONFIG.sheets.projectTracking && CONFIG.sheets.projectTracking.lookerTab)
  || 'Looker Source Data';

function gvizUrl(sheetId, gid, tabName) {
  if (tabName) {
    return 'https://docs.google.com/spreadsheets/d/' + sheetId + '/gviz/tq?tqx=out:json&headers=1&sheet=' +
      encodeURIComponent(tabName);
  }
  return 'https://docs.google.com/spreadsheets/d/' + sheetId + '/gviz/tq?tqx=out:json&gid=' + gid;
}

async function fetchGviz(sheetId, gid, tabName) {
  const res = await fetch(gvizUrl(sheetId, gid, tabName));
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

function exactCol(labels, name) {
  var up = labels.map(normHeader);
  return up.indexOf(name);
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
    // Tick column is headed exactly "BULLNOSE" (not "No OF ASSEMBLED BULLNOSE")
    bullnose: exactCol(labels, 'BULLNOSE') >= 0 ? exactCol(labels, 'BULLNOSE') : findCol(labels, ['BULLNOSE']),
    postCount: findCol(labels, ['NO OF POSTS']),
    winderCount: findCol(labels, ['NO OF WINDERS']),
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

function numAt(row, idx) {
  if (idx < 0) return 0;
  var g = row[idx];
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

/** Sum of `stairs` between the last assembly tick and the last tick of this stage. */
function gapToAssembly(rows, cols, stageCol) {
  if (stageCol < 0 || cols.assembly < 0) return 0;
  var lastStage = -1, lastAsm = -1;
  for (var i = rows.length - 1; i >= 0 && (lastStage < 0 || lastAsm < 0); i--) {
    if (lastStage < 0 && truthy(rows[i][stageCol])) lastStage = i;
    if (lastAsm < 0 && truthy(rows[i][cols.assembly])) lastAsm = i;
  }
  if (lastStage <= lastAsm) return 0;
  var total = 0;
  for (var j = lastAsm + 1; j <= lastStage; j++) total += stairsOf(rows[j], cols);
  return total;
}

/**
 * Fallback calculation (used only if the Looker Source Data tab can't be read):
 *  Office→CNC : stairs with PROGRAMS ticked  − stairs with posts+winders+strings all ticked
 *  Strings    : stairs with STRINGS ticked   − stairs with IN ASSEMBLY ticked
 *  Posts      : No OF POSTS with POSTS ticked − No OF POSTS with IN ASSEMBLY ticked
 *  Winders    : No OF WINDERS with WINDERS ticked − No OF WINDERS with IN ASSEMBLY ticked
 *  Treads / Bullnose: stairs between the last tick of that stage and the last IN ASSEMBLY tick
 */
function computeWip(rows, cols) {
  var office = 0, cncDone = 0;
  var strT = 0, strA = 0, postT = 0, postA = 0, winT = 0, winA = 0;
  rows.forEach(function (row) {
    var s = stairsOf(row, cols);
    var posts = truthy(row[cols.posts]);
    var winders = truthy(row[cols.winders]);
    var strings = truthy(row[cols.strings]);
    var assembly = truthy(row[cols.assembly]);
    if (truthy(row[cols.office])) office += s;
    if (posts && winders && strings) cncDone += s;
    if (strings) strT += s;
    if (assembly) strA += s;
    var np = numAt(row, cols.postCount), nw = numAt(row, cols.winderCount);
    if (posts) postT += np;
    if (assembly) postA += np;
    if (winders) winT += nw;
    if (assembly) winA += nw;
  });
  return {
    officeCnc: Math.max(office - cncDone, 0),
    strings: Math.max(strT - strA, 0),
    posts: Math.max(postT - postA, 0),
    winders: Math.max(winT - winA, 0),
    treads: gapToAssembly(rows, cols, cols.treads),
    bullnose: gapToAssembly(rows, cols, cols.bullnose),
  };
}

/** Preferred source: the same "Looker Source Data" tab the Looker report reads. */
function fromLookerTab(table) {
  if (!table || !table.rows || !table.rows.length) return null;
  var up = table.labels.map(normHeader);
  var row = table.rows[0];
  function get(label) {
    var i = up.indexOf(label);
    return i < 0 ? null : row[i];
  }
  function num(label) {
    var v = get(label);
    var n = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v).replace(/,/g, ''));
    return isNaN(n) ? null : n;
  }
  function txt(label) {
    var v = get(label);
    if (v == null || v === '') return '—';
    if (typeof v === 'string' && v.indexOf('Date(') === 0) {
      var d = formatDelivery(v);
      return d ? formatDateLong(d) : v;
    }
    return String(v).trim();
  }
  var wip = {
    officeCnc: num('OFFICE TO CNC'),
    strings: num('STRINGS'),
    winders: num('WINDERS'),
    posts: num('POSTS'),
    treads: num('TREADS & RISERS'),
    bullnose: num('ASSEMBLED BULLNOSE'),
  };
  for (var k in wip) { if (wip[k] === null) return null; }
  function info(prefix) {
    return { dateStr: txt(prefix + ' DATE'), load: txt(prefix + ' I.D'), tickCount: txt(prefix + ' NO') };
  }
  return {
    wip: wip,
    last: {
      officeCnc: info('OFFICE'),
      strings: info('STRINGS'),
      winders: info('WINDERS'),
      posts: info('POSTS'),
      treads: info('TREADS & RISERS'),
      bullnose: info('BULLNOSE'),
      stacked: info('STACKED'),
      dispatch: info('DISPATCH'),
    },
  };
}

function esc(t) {
  return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmt(n) {
  return Math.round(n).toLocaleString('en-GB');
}

/**
 * Gauge with the GREEN band always centred at 12 o'clock (same layout as the Looker dials):
 * scale = green midpoint ± 2.5 × green width; amber = one green-width either side; red beyond.
 * The scale never moves with the value - the needle just stops at the end of the dial.
 */
function gaugeSvg(value, greenMin, greenMax) {
  var cx = 90, cy = 100, r = 70, stroke = 14;
  var mid = (greenMin + greenMax) / 2;
  var w = greenMax - greenMin;
  var sMin = mid - 2.5 * w;
  var sMax = mid + 2.5 * w;
  var b1 = mid - 1.5 * w, b4 = mid + 1.5 * w;

  function ang(v) {
    var t = Math.min(Math.max((v - sMin) / (sMax - sMin), 0), 1);
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
  function band(v0, v1, colour) {
    return '<path d="' + arcPath(ang(v0), ang(v1), r) + '" fill="none" stroke="' + colour +
      '" stroke-width="' + stroke + '"/>';
  }
  function tick(v) {
    var p = polar(ang(v), r - 17);
    return '<text x="' + p.x.toFixed(1) + '" y="' + (p.y + 3).toFixed(1) +
      '" text-anchor="middle" font-size="8.5" fill="var(--muted,#8a94a6)">' + Math.round(v) + '</text>';
  }
  var needle = polar(ang(value), r - 6);

  return (
    '<svg viewBox="0 16 180 134" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">' +
      band(sMin, b1, '#c0392b') +
      band(b1, greenMin, '#e67e22') +
      band(greenMin, greenMax, '#27ae60') +
      band(greenMax, b4, '#e67e22') +
      band(b4, sMax, '#c0392b') +
      tick(sMin) + tick(b1) + tick(greenMin) + tick(greenMax) + tick(b4) + tick(sMax) +
      '<line x1="' + cx + '" y1="' + cy + '" x2="' + needle.x.toFixed(2) + '" y2="' + needle.y.toFixed(2) +
        '" stroke="var(--text,#2c3e50)" stroke-width="3.5" stroke-linecap="round"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="8" fill="#3498db"/>' +
      '<text x="' + cx + '" y="' + (cy + 38) + '" text-anchor="middle" font-size="24" font-weight="700" fill="var(--text,#1a1a1a)">' +
        fmt(value) + '</text>' +
    '</svg>'
  );
}

/** Responsive layout: phone = 2 columns, tablet = 3, PC/TV = 4 and (on big screens) fills the screen with no scrolling. */
function injectStyles() {
  if (document.getElementById('ffResponsiveStyles')) return;
  var css =
    '#firstFixBody{max-width:none!important;padding:12px clamp(8px,1.5vw,48px) 28px!important}' +
    '.ff-dial-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:clamp(8px,1vw,26px)!important}' +
    '.ff-dial-card{display:flex;flex-direction:column;min-width:0;padding:clamp(8px,.8vw,22px) clamp(6px,.6vw,18px)!important}' +
    '.ff-dial-title{font-size:clamp(.68rem,2.6vw,1.1rem)!important;margin-bottom:clamp(2px,.4vw,10px)!important}' +
    '.ff-dial-svg{flex:1;min-height:0;display:flex;align-items:center;justify-content:center}' +
    '.ff-dial-svg svg{display:block;width:100%;height:auto;max-width:340px}' +
    '.ff-under{font-size:clamp(.7rem,2.4vw,.95rem)!important;margin-top:clamp(2px,.4vw,10px)!important}' +
    '.ff-status-body{flex:1;justify-content:center;min-height:120px!important}' +
    '.ff-status-date{font-size:clamp(.8rem,2.6vw,1.1rem)!important}' +
    '.ff-status-load,.ff-status-xy{font-size:clamp(.78rem,2.4vw,1rem)!important}' +
    '@media (min-width:640px){.ff-dial-grid{grid-template-columns:repeat(3,minmax(0,1fr))!important}}' +
    '@media (min-width:1000px){' +
      '.ff-dial-grid{grid-template-columns:repeat(4,minmax(0,1fr))!important}' +
      '.ff-dial-title{font-size:clamp(.8rem,1.15vw,2.6rem)!important}' +
      '.ff-under,.ff-status-load,.ff-status-xy{font-size:clamp(.78rem,1vw,2.2rem)!important}' +
      '.ff-status-date{font-size:clamp(.9rem,1.15vw,2.4rem)!important}' +
    '}' +
    /* PC / TV: fit everything on one screen, no scrolling */
    '@media (min-width:1400px) and (min-height:680px){' +
      '#firstFixBody{padding-bottom:12px!important}' +
      '.ff-intro,.ff-source{display:none!important}' +
      '.ff-dial-grid{height:calc(100vh - 96px);grid-template-rows:repeat(2,minmax(0,1fr))}' +
      '.ff-dial-svg{position:relative}' +
      '.ff-dial-svg svg{position:absolute;inset:0;width:100%;height:100%;max-width:none}' +
    '}';
  var el = document.createElement('style');
  el.id = 'ffResponsiveStyles';
  el.textContent = css;
  document.head.appendChild(el);
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
      '<div class="ff-dial-svg">' + gaugeSvg(value, def.greenMin, def.greenMax) + '</div>' +
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
  injectStyles();
  var wip = payload.wip, last = payload.last;
  var html = DIALS.map(function (d) {
    if (d.kind === 'status') return statusCard(d.title, last[d.key] || { dateStr: '—', load: '—', tickCount: '—' });
    return dialCard(d, wip[d.key] || 0, last[d.key] || { dateStr: '—', load: '—', tickCount: '—' });
  }).join('');
  root.innerHTML =
    '<p class="ff-intro">WIP buffers between departments (stairs). Green band = healthy work ahead so the next area does not run out. ' +
    'Office→CNC only clears when posts, winders and strings are all ticked. Under each dial: last load completed for that stage.</p>' +
    '<div class="ff-dial-grid">' + html + '</div>' +
    (payload.source ? '<p class="ff-intro ff-source" style="opacity:.55;font-size:12px;">Source: ' + esc(payload.source) + '</p>' : '');
}

var loading = false;

export async function loadFirstFix() {
  var root = document.getElementById('firstFixBody');
  if (!root) return;
  if (loading) return;
  loading = true;
  root.innerHTML = '<p class="ff-intro">Loading Project Tracking…</p>';
  try {
    var payload = null;
    try {
      payload = fromLookerTab(await fetchGviz(SHEET_ID, null, LOOKER_TAB));
      if (payload) payload.source = 'Looker Source Data tab';
    } catch (e) {
      console.warn('1st Fix: Looker Source Data tab not available, recalculating', e);
    }
    if (!payload) {
      var table = await fetchGviz(SHEET_ID, GID);
      var cols = colMap(table.labels);
      if (cols.stairs < 0) throw new Error('Stairs column not found');
      if (cols.office < 0) throw new Error('PROGRAMS COMPLETED column not found');
      payload = {
        wip: computeWip(table.rows, cols),
        last: {
          officeCnc: lastTickInfo(table.rows, cols, cols.office),
          strings: lastTickInfo(table.rows, cols, cols.strings),
          winders: lastTickInfo(table.rows, cols, cols.winders),
          posts: lastTickInfo(table.rows, cols, cols.posts),
          treads: lastTickInfo(table.rows, cols, cols.treads),
          bullnose: lastTickInfo(table.rows, cols, cols.bullnose),
          stacked: lastTickInfo(table.rows, cols, cols.stacked),
          dispatch: lastTickInfo(table.rows, cols, cols.dispatch),
        },
        source: 'recalculated from 2026 tab',
      };
    }
    render(payload);
  } catch (e) {
    console.error(e);
    root.innerHTML = '<p class="ff-intro" style="color:#c0392b;">Could not load Project Tracking. ' +
      esc(e && e.message ? e.message : e) + '</p>';
  } finally {
    loading = false;
  }
}

window.loadFirstFix = loadFirstFix;
