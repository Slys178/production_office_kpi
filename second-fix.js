/**
 * 2nd Fix dials — pulls Expected / Actual from the capability sheet.
 * Sheet must be shared "Anyone with the link can view" for GViz.
 */
import { CONFIG } from './config.js';

const SHEET_ID = (CONFIG.sheets && CONFIG.sheets.secondFix && CONFIG.sheets.secondFix.id)
  || '1Bm_7Zeo2d2ZG3oDM-9F6fZ5X3QWvWmgkU4DumHfusb4';

const GID_DAILY = (CONFIG.sheets && CONFIG.sheets.secondFix && CONFIG.sheets.secondFix.gidDaily) || '0';

const ROSTER_TAB = (CONFIG.sheets && CONFIG.sheets.secondFix && CONFIG.sheets.secondFix.rosterTab) || 'Roster';

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

function parseDailyRows(rows) {
  // Summary rows: Expected Capability / Actual so far today
  // Header row: first cell === "Name"
  // People: Name | Daily Target | Status | Expected | Actual
  // GViz often blanks middle header labels — use fixed column indexes.

  var sectionExpected = null;
  var sectionActual = null;
  var peopleIn = null;

  for (var i = 0; i < Math.min(rows.length, 15); i++) {
    var label = String(rows[i][0] || '').trim().toUpperCase();
    var val = parseNum(rows[i][1]);
    if (label.indexOf('EXPECTED CAPABILITY') >= 0) sectionExpected = val;
    else if (label.indexOf('ACTUAL SO FAR') >= 0) sectionActual = val;
    else if (label.indexOf('PEOPLE CURRENTLY IN') >= 0) peopleIn = val;
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
      status: String(row[2] || '').trim(),
      expected: parseNum(row[3]),
      actual: parseNum(row[4])
    });
  }

  var sumExp = people.reduce(function (s, p) { return s + p.expected; }, 0);
  var sumAct = people.reduce(function (s, p) { return s + p.actual; }, 0);
  if (sectionExpected == null) sectionExpected = sumExp;
  if (sectionActual == null) sectionActual = sumAct;

  return {
    people: people,
    sectionExpected: sectionExpected,
    sectionActual: sectionActual,
    peopleIn: peopleIn
  };
}

function normName(s) {
  return String(s || '').toUpperCase().replace(/\s+/g, ' ').trim();
}

/**
 * Roster tab (in the capability sheet): A = Name, B = Temp Help.
 * Blank Temp Help = regular team member (always shown).
 * "Yes" = temp helper, shown.  "No" = temp helper, hidden and not counted.
 */
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
  // Safety: if nothing matches, the roster tab is wrong - don't blank the dials
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

/** Full-circle dial matching Production Office style */
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
    : (actual > 0 ? (tv ? 'm today' : 'm today (attendance not in)') : 'of 0 m');

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
  el.innerHTML = dialSvg(sectionActual, sectionExpected, 200);
}

function renderPeopleDials(people) {
  const grid = document.getElementById('secondFixDialGrid');
  if (!grid) return;
  const sorted = people.slice().sort(function (a, b) {
    if ((b.expected > 0) !== (a.expected > 0)) return b.expected > 0 ? 1 : -1;
    return a.name.localeCompare(b.name);
  });

  grid.innerHTML = sorted.map(function (p) {
    var scale = p.expected > 0 ? p.expected : p.dailyTarget;
    var statusBadge = p.status
      ? '<span style="font-size:0.7rem;opacity:0.8;">' + p.status + '</span>'
      : '';
    var detail = '<div style="font-size:0.7rem;color:var(--muted,#8993ab);margin-top:2px;">' +
      p.actual.toFixed(1) + ' / ' + (p.expected > 0 ? p.expected.toFixed(1) : scale.toFixed(1)) + ' m</div>';
    return '<div class="dial-card" style="text-align:center;padding:12px;background:var(--card-bg,#161d2e);border-radius:12px;border:1px solid var(--card-border,#232c42);">' +
      '<div style="font-weight:700;font-size:0.85rem;margin-bottom:2px;">' + p.name + '</div>' +
      statusBadge +
      dialSvg(p.actual, scale, 130) +
      detail +
      '</div>';
  }).join('');
}

var loading = false;
var lastData = null;
var tvActive = false;
var tvTimer = null;

export async function loadSecondFix(force) {
  if (loading && !force) return;
  loading = true;
  const summary = document.getElementById('secondFixSummary');
  if (summary) summary.innerHTML = '<div class="forecast-note">Loading live figures…</div>';

  try {
    const rows = await fetchGviz(SHEET_ID, GID_DAILY);
    const parsed = parseDailyRows(rows);
    var people = parsed.people;
    var sectionExpected = parsed.sectionExpected;
    var sectionActual = parsed.sectionActual;

    if (!people.length) {
      if (summary) {
        summary.innerHTML = '<div class="forecast-note" style="color:var(--red,#e74c3c);">' +
          'No people data found. Share the capability sheet as “Anyone with the link can view”, ' +
          'and complete Allow access on the Live Data tab of that sheet.</div>';
      }
      return;
    }

    // Apply Roster tab: drops leavers and hides temp helpers set to "No"
    var roster = null;
    try {
      roster = parseRoster(await fetchGviz(SHEET_ID, null, ROSTER_TAB));
    } catch (e) {
      console.warn('2nd Fix: Roster tab not available, showing everyone from the Daily tab', e);
    }
    var applied = applyRoster(people, roster);
    if (applied.filtered) {
      people = applied.people;
      // Totals must only include the people still shown
      sectionExpected = people.reduce(function (s, p) { return s + p.expected; }, 0);
      sectionActual = people.reduce(function (s, p) { return s + p.actual; }, 0);
      if (applied.removed.length) console.info('2nd Fix: hidden from dials -', applied.removed.join(', '));
    }

    var fullDaily = people.reduce(function (s, p) { return s + (p.dailyTarget || 0); }, 0);
    var dialExpected = sectionExpected > 0 ? sectionExpected : fullDaily;
    renderSummary(sectionExpected, sectionActual, fullDaily);
    renderSectionDial(dialExpected, sectionActual);
    renderPeopleDials(people);

    lastData = {
      people: people,
      sectionExpected: sectionExpected,
      sectionActual: sectionActual,
      dialExpected: dialExpected,
      updated: new Date()
    };
    if (tvActive) renderTv();

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


/* ───────────── TV mode ─────────────
 * Full-screen view sized from the screen so every dial fits with no scrolling.
 * Opened from the "TV" button under Refresh. Esc / Exit button closes it.
 */
function esc(t) {
  return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
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

  var people = d.people.slice().sort(function (a, b) {
    if ((b.expected > 0) !== (a.expected > 0)) return b.expected > 0 ? 1 : -1;
    return a.name.localeCompare(b.name);
  });
  var n = Math.max(people.length, 1);

  // Choose the column count that gives the biggest dials
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
  var statW = (W - topH - pad * 3) / 4;
  var valFs = Math.min(topH * 0.3, statW / (7 * 0.62));
  var lblFs = Math.max(12, Math.min(topH * 0.1, 26));

  function stat(label, value, colour) {
    return '<div style="flex:1;display:flex;flex-direction:column;justify-content:center;align-items:center;' +
      'background:var(--card-bg,#161d2e);border:1px solid var(--card-border,#232c42);border-radius:16px;min-width:0;">' +
      '<div style="font-size:' + lblFs + 'px;color:var(--muted,#8993ab);text-transform:uppercase;letter-spacing:0.06em;">' + label + '</div>' +
      '<div style="font-size:' + valFs + 'px;font-weight:800;line-height:1.1;' + (colour ? 'color:' + colour + ';' : '') + '">' + value + '</div>' +
      '</div>';
  }

  var cards = people.map(function (p) {
    var scale = p.expected > 0 ? p.expected : p.dailyTarget;
    var away = p.status && p.status.toUpperCase() !== 'IN'
      ? ' <span style="font-size:' + (detailFs * 0.8) + 'px;color:var(--muted,#8993ab);font-weight:600;">' + esc(p.status) + '</span>' : '';
    return '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-width:0;min-height:0;' +
      'background:var(--card-bg,#161d2e);border:1px solid var(--card-border,#232c42);border-radius:14px;padding:4px;overflow:hidden;">' +
      '<div style="font-size:' + nameFs + 'px;font-weight:700;white-space:nowrap;">' + esc(p.name) + away + '</div>' +
      '<div style="flex:1;min-height:0;width:100%;display:flex;align-items:center;justify-content:center;">' +
        dialSvg(p.actual, scale, 200, { tv: true }) +
      '</div>' +
      '<div style="font-size:' + detailFs + 'px;color:var(--muted,#8993ab);">' +
        p.actual.toFixed(1) + ' / ' + (scale > 0 ? scale.toFixed(1) : '0') + ' m</div>' +
      '</div>';
  }).join('');

  var hh = d.updated.getHours(), mm = d.updated.getMinutes();
  var stamp = 'Updated ' + (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
  var note = d.sectionExpected <= 0 ? 'Attendance not in yet – dials scaled to full target' : '';

  o.innerHTML =
    '<div style="height:100%;box-sizing:border-box;padding:' + pad + 'px;display:flex;flex-direction:column;gap:' + pad + 'px;">' +
      '<div style="height:' + barH + 'px;display:flex;align-items:center;justify-content:space-between;">' +
        '<div style="font-size:' + (barH * 0.55) + 'px;font-weight:800;">🔩 2nd Fix — Today</div>' +
        '<div style="font-size:' + (barH * 0.3) + 'px;color:var(--muted,#8993ab);">' + note + '</div>' +
        '<div style="display:flex;align-items:center;gap:14px;">' +
          '<span style="font-size:' + (barH * 0.32) + 'px;color:var(--muted,#8993ab);">' + stamp + '</span>' +
          '<button id="sfTvExit" type="button" style="font-family:inherit;font-size:' + (barH * 0.3) + 'px;padding:6px 16px;border-radius:10px;' +
          'border:1px solid var(--card-border,#232c42);background:transparent;color:var(--muted,#8993ab);cursor:pointer;">✕ Exit</button>' +
        '</div>' +
      '</div>' +
      '<div style="height:' + topH + 'px;display:flex;gap:' + pad + 'px;">' +
        '<div style="width:' + topH + 'px;height:' + topH + 'px;flex:none;">' + dialSvg(d.sectionActual, d.dialExpected, 200, { tv: true }) + '</div>' +
        stat('Expected today', d.sectionExpected.toFixed(0) + ' m') +
        stat('Actual so far', d.sectionActual.toFixed(0) + ' m', 'var(--green,#2ecc71)') +
        stat('Remaining', remaining.toFixed(0) + ' m') +
        stat('% of expected', pct.toFixed(0) + '%') +
      '</div>' +
      '<div style="height:' + gridH + 'px;display:grid;gap:' + pad + 'px;' +
        'grid-template-columns:repeat(' + best.cols + ',minmax(0,1fr));grid-template-rows:repeat(' + best.rows + ',minmax(0,1fr));">' +
        cards +
      '</div>' +
    '</div>';

  var exit = document.getElementById('sfTvExit');
  if (exit) exit.addEventListener('click', closeTv);
}

function onTvResize() { if (tvActive) renderTv(); }

function onTvFullscreenChange() {
  // Esc in fullscreen exits fullscreen -> close the TV view too
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
    o.style.cssText = 'position:fixed;inset:0;z-index:99999;background:var(--bg,#0b1020);color:var(--text,#eef2fb);' +
      'font-family:inherit;overflow:hidden;';
    document.body.appendChild(o);
  }
  o.style.display = 'block';
  tvActive = true;
  document.documentElement.style.overflow = 'hidden';
  if (lastData) renderTv();
  else o.innerHTML = '<div style="padding:40px;font-size:28px;">Loading live figures…</div>';

  try {
    if (o.requestFullscreen) o.requestFullscreen().catch(function () {});
  } catch (e) { /* overlay still covers the whole window */ }

  window.addEventListener('resize', onTvResize);
  document.addEventListener('fullscreenchange', onTvFullscreenChange);
  document.addEventListener('keydown', onTvKey);

  loadSecondFix(true);
  tvTimer = setInterval(function () { loadSecondFix(true); }, 60 * 1000);
}

function closeTv() {
  tvActive = false;
  if (tvTimer) { clearInterval(tvTimer); tvTimer = null; }
  window.removeEventListener('resize', onTvResize);
  document.removeEventListener('fullscreenchange', onTvFullscreenChange);
  document.removeEventListener('keydown', onTvKey);
  var o = document.getElementById('sfTvOverlay');
  if (o) o.style.display = 'none';
  document.documentElement.style.overflow = '';
  try {
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen();
  } catch (e) { /* ignore */ }
}

/** Adds a "TV" button directly under the Refresh button */
function initTvButton() {
  var refresh = document.getElementById('refresh2ndFixBtn');
  if (!refresh || document.getElementById('sf2TvBtn')) return;
  var wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:6px;align-items:stretch;';
  refresh.parentNode.insertBefore(wrap, refresh);
  wrap.appendChild(refresh);
  var btn = document.createElement('button');
  btn.id = 'sf2TvBtn';
  btn.type = 'button';
  btn.className = refresh.className;
  btn.textContent = '📺 TV';
  btn.style.cssText = 'background:var(--card-bg,#161d2e);color:var(--text,#eef2fb);border:1px solid var(--card-border,#232c42);';
  btn.addEventListener('click', openTv);
  wrap.appendChild(btn);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initTvButton);
else initTvButton();

window.loadSecondFix = loadSecondFix;
