/**
 * 1st Fix — stair flow between departments from Project Tracking.
 * Uses PROGRAMS COMPLETED (col D) and stage ticks (O–W), stairs in col G.
 * Same idea as Looker: how many stairs sit between one stage and the next.
 */
import { CONFIG } from './config.js';

const SHEET_ID = (CONFIG.sheets && CONFIG.sheets.projectTracking && CONFIG.sheets.projectTracking.id)
  || '15aEtpNIDILzw_2n_KYWkBCefakqSt36jzGWredct3J4';
const GID = (CONFIG.sheets && CONFIG.sheets.projectTracking && CONFIG.sheets.projectTracking.gid)
  || '1766737074';

/** Pipeline stages in shop order (after office programs completed). */
const STAGES = [
  { key: 'office', label: 'Office', sub: 'Programs completed', col: 'PROGRAMS COMPLETED' },
  { key: 'cncPaper', label: 'CNC paperwork', sub: 'Paperwork sorted', col: 'CNC PAPERWORK' },
  { key: 'cnc', label: 'CNC machining', sub: 'Posts + winders + strings', cols: ['POSTS COMPLETED', 'WINDERS COMPLETED', 'STRINGS COMPLETED'] },
  { key: 'shopFloor', label: 'Shop floor', sub: 'Treads & risers', col: 'SHOP FLOOR TREADS' },
  { key: 'bullnose', label: 'Bullnose', sub: 'Bullnose done', col: 'BULLNOSE' },
  { key: 'assembly', label: 'Assembly', sub: 'In assembly', col: 'IN ASSEMBLY' },
  { key: 'stacked', label: 'Stacked', sub: 'Stacked', col: 'STACKED' },
  { key: 'dispatch', label: 'Dispatch', sub: 'Dispatched', col: 'DISPATCH' },
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

function findCol(labels, includesAll) {
  const up = labels.map(normHeader);
  for (var i = 0; i < up.length; i++) {
    var ok = true;
    for (var j = 0; j < includesAll.length; j++) {
      if (up[i].indexOf(includesAll[j]) < 0) { ok = false; break; }
    }
    if (ok) return i;
  }
  return -1;
}

function stageDone(row, labels, stage) {
  if (stage.cols) {
    for (var i = 0; i < stage.cols.length; i++) {
      var parts = stage.cols[i].split(' ');
      var idx = findCol(labels, parts);
      if (idx < 0 || !truthy(row[idx])) return false;
    }
    return true;
  }
  var bits = stage.col.split(' ');
  var col = findCol(labels, bits);
  if (col < 0) return false;
  return truthy(row[col]);
}

function parseFlow(labels, rows) {
  var stairsCol = findCol(labels, ['NUMBER OF STAIRS']);
  if (stairsCol < 0) stairsCol = findCol(labels, ['STAIRS']);
  if (stairsCol < 0) throw new Error('Could not find stairs column on Project Tracking');

  var completed = {};
  var gapFromPrev = {};
  STAGES.forEach(function (s) {
    completed[s.key] = 0;
    gapFromPrev[s.key] = 0;
  });

  var loadCount = 0;
  rows.forEach(function (row) {
    var g = row[stairsCol];
    var stairs = typeof g === 'number' ? g : parseFloat(String(g || '').replace(/,/g, ''));
    if (!stairs || stairs <= 0 || isNaN(stairs)) return;
    loadCount++;

    var doneFlags = STAGES.map(function (s) { return stageDone(row, labels, s); });
    for (var i = 0; i < STAGES.length; i++) {
      if (doneFlags[i]) completed[STAGES[i].key] += stairs;
      if (i > 0 && doneFlags[i - 1] && !doneFlags[i]) {
        gapFromPrev[STAGES[i].key] += stairs;
      }
    }
  });

  return { completed: completed, gapFromPrev: gapFromPrev, loadCount: loadCount };
}

function esc(t) {
  return String(t == null ? '' : t)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function fmt(n) {
  return Math.round(n).toLocaleString('en-GB');
}

function render(data) {
  var root = document.getElementById('firstFixBody');
  if (!root) return;

  var cards = STAGES.map(function (s, i) {
    var done = data.completed[s.key];
    var gap = data.gapFromPrev[s.key];
    var gapHtml = '';
    if (i > 0) {
      var prev = STAGES[i - 1].label;
      var gapClass = gap > 0 ? 'ff-gap-warn' : 'ff-gap-ok';
      gapHtml =
        '<div class="ff-gap ' + gapClass + '">' +
          '<span class="ff-gap-label">Behind ' + esc(prev) + '</span>' +
          '<span class="ff-gap-val">' + fmt(gap) + ' stairs</span>' +
        '</div>';
    }
    return (
      '<div class="ff-card">' +
        '<div class="ff-card-top">' +
          '<div class="ff-step">' + (i + 1) + '</div>' +
          '<div>' +
            '<div class="ff-title">' + esc(s.label) + '</div>' +
            '<div class="ff-sub">' + esc(s.sub) + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="ff-done"><b>' + fmt(done) + '</b> stairs through</div>' +
        gapHtml +
      '</div>'
    );
  }).join('');

  var office = data.completed.office;
  var cnc = data.completed.cnc;
  var assembly = data.completed.assembly;
  var pairs =
    '<div class="ff-pairs">' +
      '<div class="ff-pair">' +
        '<div class="ff-pair-title">Office → CNC</div>' +
        '<div class="ff-pair-nums">' +
          '<span>Office ' + fmt(office) + '</span>' +
          '<span class="ff-arrow">→</span>' +
          '<span>CNC ' + fmt(cnc) + '</span>' +
        '</div>' +
        '<div class="ff-pair-diff">Difference: <b>' + fmt(office - cnc) + '</b> stairs (office ahead)</div>' +
      '</div>' +
      '<div class="ff-pair">' +
        '<div class="ff-pair-title">CNC → Assembly</div>' +
        '<div class="ff-pair-nums">' +
          '<span>CNC ' + fmt(cnc) + '</span>' +
          '<span class="ff-arrow">→</span>' +
          '<span>Assembly ' + fmt(assembly) + '</span>' +
        '</div>' +
        '<div class="ff-pair-diff">Difference: <b>' + fmt(cnc - assembly) + '</b> stairs (CNC ahead)</div>' +
      '</div>' +
      '<div class="ff-pair">' +
        '<div class="ff-pair-title">Assembly → Dispatch</div>' +
        '<div class="ff-pair-nums">' +
          '<span>Assembly ' + fmt(assembly) + '</span>' +
          '<span class="ff-arrow">→</span>' +
          '<span>Dispatch ' + fmt(data.completed.dispatch) + '</span>' +
        '</div>' +
        '<div class="ff-pair-diff">Difference: <b>' + fmt(assembly - data.completed.dispatch) + '</b> stairs</div>' +
      '</div>' +
    '</div>';

  root.innerHTML =
    '<p class="ff-intro">From Project Tracking — stairs on loads where each stage is ticked. ' +
    '"Behind" = previous stage done, this stage not yet (same idea as Looker department gaps).</p>' +
    pairs +
    '<h3 class="ff-h3">Full flow</h3>' +
    '<div class="ff-grid">' + cards + '</div>' +
    '<p class="ff-note">Based on ' + fmt(data.loadCount) + ' loads with stair counts. CNC = posts + winders + strings all ticked.</p>';
}

var loading = false;

export async function loadFirstFix(force) {
  var root = document.getElementById('firstFixBody');
  if (!root) return;
  if (loading) return;
  loading = true;
  root.innerHTML = '<p class="ff-intro">Loading Project Tracking…</p>';
  try {
    var table = await fetchGviz(SHEET_ID, GID);
    var data = parseFlow(table.labels, table.rows);
    render(data);
  } catch (e) {
    console.error(e);
    root.innerHTML =
      '<p class="ff-intro" style="color:#c0392b;">Could not load Project Tracking. ' +
      esc(e && e.message ? e.message : e) + '</p>';
  } finally {
    loading = false;
  }
}

window.loadFirstFix = loadFirstFix;
