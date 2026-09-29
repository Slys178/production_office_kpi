/**
 * Longer-range forecast with a default weekly stair demand.
 *
 * - Weeks with load/delivery stairs entered → use those totals (real data).
 * - Weeks with no loads yet → use CONFIG.defaultWeeklyStairs as an estimate.
 * - Capacity still comes from who is available the week before (holidays applied).
 * - Shows all forecastWeeks so you can spot holiday pinch-points early.
 */
import { CONFIG } from "./config.js";
import { mondayOf, dayBucket, fmtDateShort } from "./utils.js";
import { getCodeForPerson, isAbsenceCode, targetFor } from "./data.js";

const PEOPLE = CONFIG.people.filter(function (p) {
  return p.initials !== CONFIG.excludeFromKpiDisplay;
});

function getPrevWeekCapacity(person, forecastWeekStart, holidayIndex) {
  const prevWeekStart = new Date(forecastWeekStart);
  prevWeekStart.setDate(prevWeekStart.getDate() - 7);
  const prevWeekEnd = new Date(prevWeekStart);
  prevWeekEnd.setDate(prevWeekStart.getDate() + 4);

  let capacity = 0;
  const offDays = [];
  for (let d = new Date(prevWeekStart); d <= prevWeekEnd; d.setDate(d.getDate() + 1)) {
    const dCopy = new Date(d);
    if (!dayBucket(dCopy)) continue;
    const code = getCodeForPerson(holidayIndex, person.holidayName, dCopy);
    if (isAbsenceCode(code)) {
      offDays.push({ date: new Date(dCopy), code: code });
      continue;
    }
    capacity += targetFor(person.initials, dCopy, code);
  }
  return { prevWeekStart: prevWeekStart, prevWeekEnd: prevWeekEnd, capacity: capacity, offDays: offDays };
}

function getWarningLevel(demand, capacity) {
  const shortfall = demand - capacity;
  if (shortfall >= 80) return { level: "danger", label: "🔴 Critical!", className: "danger" };
  if (shortfall >= 30) return { level: "warning", label: "🟡 Tight", className: "warning" };
  return { level: "ok", label: "✅ OK", className: "ok" };
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = String(s);
  return d.innerHTML;
}

export function renderEnhancedForecast(forecastEntries, holidayIndex, today) {
  const container = document.getElementById("forecastWeeks");
  if (!container || !holidayIndex || !today) return;

  const defaultDemand = Number(CONFIG.defaultWeeklyStairs) || 0;
  const startMonday = mondayOf(today);
  const numWeeks = CONFIG.forecastWeeks || 8;

  const weeks = [];
  for (let i = 0; i < numWeeks; i++) {
    const wStart = new Date(startMonday);
    wStart.setDate(wStart.getDate() + 7 * i);
    const wEnd = new Date(wStart);
    wEnd.setDate(wStart.getDate() + 6);
    weeks.push({
      start: wStart,
      end: wEnd,
      loadTotal: 0,
      byPerson: {},
      isCurrent: i === 0,
    });
  }
  const lastWeekEnd = weeks[weeks.length - 1].end;

  const displayForecast = (forecastEntries || []).filter(function (e) {
    return e.initials !== CONFIG.excludeFromKpiDisplay;
  });

  displayForecast.forEach(function (e) {
    if (!e.deliveryDate) return;
    if (e.deliveryDate < startMonday || e.deliveryDate > lastWeekEnd) return;
    const wk = weeks.find(function (w) {
      return e.deliveryDate >= w.start && e.deliveryDate <= w.end;
    });
    if (!wk) return;
    wk.loadTotal += e.stairs;
    const key = e.initials || "UNASSIGNED";
    wk.byPerson[key] = (wk.byPerson[key] || 0) + e.stairs;
  });

  let hasManpowerWarning = false;

  const html = weeks.map(function (w) {
    const fromLoads = w.loadTotal > 0;
    const demand = fromLoads ? w.loadTotal : defaultDemand;
    const sourceLabel = fromLoads ? "From loads" : "Default estimate";

    let totalCapacity = 0;
    const holidayImpacts = [];
    PEOPLE.forEach(function (person) {
      const cap = getPrevWeekCapacity(person, w.start, holidayIndex);
      totalCapacity += cap.capacity;
      if (cap.offDays.length > 0) {
        holidayImpacts.push({ person: person, offDays: cap.offDays });
      }
    });

    const warning = getWarningLevel(demand, totalCapacity);
    if (warning.level === "danger") hasManpowerWarning = true;

    const chips = [];
    if (fromLoads) {
      Object.keys(w.byPerson).forEach(function (initials) {
        const person = PEOPLE.find(function (p) { return p.initials === initials; });
        const color = person ? person.color : "#8993ab";
        const name = person ? initials : "Unassigned";
        chips.push(
          '<span class="fw-person-chip"><span class="dot" style="background:' + color + ';"></span>' +
          name + ": " + w.byPerson[initials] + "</span>"
        );
      });
    }

    let holidayWarning = "";
    if (holidayImpacts.length > 0) {
      holidayWarning = '<div class="holiday-impact">⚠️ Build-week absences: ';
      holidayImpacts.forEach(function (p) {
        const days = p.offDays.map(function (o) {
          return fmtDateShort(o.date);
        }).join(", ");
        holidayWarning += '<span class="chip">' + escapeHtml(p.person.initials) + ": " + days + "</span> ";
      });
      holidayWarning += "</div>";
    }

    const headLabel = w.isCurrent
      ? "This week"
      : ("W/C " + fmtDateShort(w.start));

    const sourceBadge = fromLoads
      ? '<span class="fw-source loads">📋 From loads</span>'
      : '<span class="fw-source default">📐 Default (' + defaultDemand + ')</span>';

    const gap = totalCapacity - demand;
    const gapText = gap >= 0
      ? ("+" + gap + " spare")
      : (Math.abs(gap) + " short");

    return (
      '<div class="forecast-week-card ' + warning.className + (fromLoads ? "" : " estimate") + '">' +
        '<div class="fw-header">' +
          '<div class="fw-title">' + headLabel + ' ' + sourceBadge + '</div>' +
          '<div class="fw-badge ' + warning.className + '">' + warning.label + '</div>' +
        '</div>' +
        '<div class="fw-row"><span>Demand</span><span class="val">' + demand +
          (fromLoads ? "" : " <span style=\"color:var(--muted);font-weight:400\">(estimate)</span>") +
        '</span></div>' +
        '<div class="fw-row"><span>Capacity (prev week)</span><span class="val">' + totalCapacity + '</span></div>' +
        '<div class="fw-row"><span>Balance</span><span class="val">' + gapText + '</span></div>' +
        (chips.length ? '<div class="fw-chips">' + chips.join("") + '</div>' : '') +
        holidayWarning +
      '</div>'
    );
  }).join("");

  const note =
    '<div class="forecast-note" style="margin-bottom:12px;">' +
      'Weeks with no loads yet use a <strong>default of ' + defaultDemand + ' stairs</strong> ' +
      '(set in config as defaultWeeklyStairs). When you enter loads and delivery dates for a week, ' +
      'that total <strong>replaces</strong> the default for that week only.' +
    '</div>';

  container.innerHTML = note + '<div class="forecast-week-grid-inner">' + html + '</div>';

  const tileBadge = document.getElementById("tileForecastBadge");
  if (tileBadge) {
    if (hasManpowerWarning) {
      tileBadge.style.display = "";
      tileBadge.textContent = "!";
      tileBadge.className = "tile-badge danger";
    } else {
      tileBadge.style.display = "none";
    }
  }

  // Landing lookahead: next week demand = loads if any, else default
  updateLookaheadBanner(weeks, holidayIndex, defaultDemand);
}

function updateLookaheadBanner(weeks, holidayIndex, defaultDemand) {
  const container = document.getElementById("lookaheadBanner");
  if (!container || !weeks || weeks.length < 2) return;

  const next = weeks[1];
  const fromLoads = next.loadTotal > 0;
  const demand = fromLoads ? next.loadTotal : defaultDemand;

  let capacity = 0;
  PEOPLE.forEach(function (person) {
    capacity += getPrevWeekCapacity(person, next.start, holidayIndex).capacity;
  });

  const diff = capacity - demand;
  const short = diff < 0;
  const color = short ? "var(--red)" : "var(--green)";
  const bg = short ? "rgba(231,76,60,0.08)" : "rgba(46,204,113,0.08)";
  const source = fromLoads ? "from loads" : "default estimate";
  const msg = short
    ? ("Next week needs " + demand + " stairs (" + source + "), capacity is " + capacity +
       " — " + Math.abs(diff) + " short")
    : ("Next week needs " + demand + " stairs (" + source + "), capacity is " + capacity +
       " — comfortable");

  container.innerHTML =
    '<div style="background:' + bg + ';border:1px solid ' + color +
    ';border-radius:10px;padding:10px 16px;margin-bottom:16px;text-align:center;' +
    'font-size:0.85rem;font-weight:600;color:' + color + ';">' + msg + '</div>';
}

window.renderEnhancedForecast = function () {
  if (window._forecastEntries && window._holidayIndex && window._today) {
    renderEnhancedForecast(window._forecastEntries, window._holidayIndex, window._today);
  }
};
