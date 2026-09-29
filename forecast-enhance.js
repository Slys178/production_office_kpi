/**
 * Simple forecast manpower check:
 *
 *   Needed that week  = ALL stairs with a delivery date in that week
 *                       (completed rows + still outstanding rows)
 *   Who can build     = capacity in the WEEK BEFORE (when that work is built)
 *                       If that build week is the current week, only count
 *                       days still left (e.g. Tue–Fri once Monday has gone).
 *   Result            = capacity − needed
 */
import { CONFIG } from "./config.js";
import { mondayOf, dayBucket, fmtDateShort, sameDay } from "./utils.js";
import { getCodeForPerson, isAbsenceCode, targetFor } from "./data.js";

const PEOPLE = CONFIG.people.filter(function (p) {
  return p.initials !== CONFIG.excludeFromKpiDisplay;
});

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/**
 * Capacity in the week before a delivery week.
 * If that build week is in progress, only days from today onwards count.
 */
function getPrevWeekCapacity(person, forecastWeekStart, holidayIndex, today) {
  const prevWeekStart = new Date(forecastWeekStart);
  prevWeekStart.setDate(prevWeekStart.getDate() - 7);
  const prevWeekEnd = new Date(prevWeekStart);
  prevWeekEnd.setDate(prevWeekStart.getDate() + 4); // Mon–Fri

  const todayStart = today ? startOfDay(today) : null;
  const buildWeekIsCurrent =
    todayStart &&
    todayStart >= startOfDay(prevWeekStart) &&
    todayStart <= startOfDay(prevWeekEnd);

  let capacity = 0;
  let fullWeekCapacity = 0;
  const offDays = [];
  let daysCounted = 0;
  let daysSkippedPast = 0;

  for (let d = new Date(prevWeekStart); d <= prevWeekEnd; d.setDate(d.getDate() + 1)) {
    const dCopy = new Date(d);
    if (!dayBucket(dCopy)) continue;

    const code = getCodeForPerson(holidayIndex, person.holidayName, dCopy);
    let dayCap = 0;
    if (isAbsenceCode(code)) {
      offDays.push({ date: new Date(dCopy), code: code });
    } else {
      dayCap = targetFor(person.initials, dCopy, code);
    }
    fullWeekCapacity += dayCap;

    // Mid-week: ignore days already finished
    if (buildWeekIsCurrent && startOfDay(dCopy) < todayStart) {
      daysSkippedPast += 1;
      continue;
    }

    capacity += dayCap;
    daysCounted += 1;
  }

  return {
    prevWeekStart: prevWeekStart,
    prevWeekEnd: prevWeekEnd,
    capacity: Math.round(capacity),
    fullWeekCapacity: Math.round(fullWeekCapacity),
    offDays: offDays,
    buildWeekIsCurrent: buildWeekIsCurrent,
    daysCounted: daysCounted,
    daysSkippedPast: daysSkippedPast,
  };
}

function getWarningLevel(needed, capacity) {
  const shortfall = needed - capacity;
  if (shortfall >= 80) return { level: "danger", label: "🔴 Short", className: "danger" };
  if (shortfall >= 30) return { level: "warning", label: "🟡 Tight", className: "warning" };
  return { level: "ok", label: "✅ OK", className: "ok" };
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = String(s);
  return d.innerHTML;
}

function addEntryToWeek(weeks, startMonday, lastWeekEnd, e) {
  if (!e || !e.deliveryDate) return;
  if (e.deliveryDate < startMonday || e.deliveryDate > lastWeekEnd) return;
  const wk = weeks.find(function (w) {
    return e.deliveryDate >= w.start && e.deliveryDate <= w.end;
  });
  if (!wk) return;
  const stairs = Number(e.stairs) || 0;
  if (stairs <= 0) return;
  wk.loadTotal += stairs;
  const key = e.initials || "UNASSIGNED";
  wk.byPerson[key] = (wk.byPerson[key] || 0) + stairs;
}

export function renderEnhancedForecast(forecastEntries, holidayIndex, today) {
  const container = document.getElementById("forecastWeeks");
  if (!container || !holidayIndex || !today) return;

  const defaultNeeded = Math.round(Number(CONFIG.defaultWeeklyStairs) || 0);
  const startMonday = mondayOf(today);
  const numWeeks = CONFIG.forecastWeeks || 8;
  const stairEntries = window._stairEntries || [];

  const weeks = [];
  for (let i = 0; i < numWeeks; i++) {
    const wStart = new Date(startMonday);
    wStart.setDate(wStart.getDate() + 7 * i);
    const wEnd = new Date(wStart);
    wEnd.setDate(wStart.getDate() + 6); // Mon–Sun delivery week
    weeks.push({
      start: wStart,
      end: wEnd,
      loadTotal: 0,
      byPerson: {},
      isCurrent: i === 0,
    });
  }
  const lastWeekEnd = weeks[weeks.length - 1].end;

  // Needed = completed (stairEntries) + outstanding (forecastEntries)
  const allForDemand = [].concat(stairEntries || [], forecastEntries || []);
  allForDemand.forEach(function (e) {
    if (e.initials === CONFIG.excludeFromKpiDisplay) return;
    addEntryToWeek(weeks, startMonday, lastWeekEnd, e);
  });

  let hasManpowerWarning = false;

  const html = weeks.map(function (w) {
    const fromLoads = w.loadTotal > 0;
    const needed = fromLoads ? Math.round(w.loadTotal) : defaultNeeded;

    let totalCapacity = 0;
    let totalFullCapacity = 0;
    const perPerson = [];
    const holidayImpacts = [];
    let anyBuildWeekCurrent = false;
    let daysLeftNote = "";

    PEOPLE.forEach(function (person) {
      const cap = getPrevWeekCapacity(person, w.start, holidayIndex, today);
      totalCapacity += cap.capacity;
      totalFullCapacity += cap.fullWeekCapacity;
      perPerson.push({ initials: person.initials, capacity: cap.capacity });
      if (cap.buildWeekIsCurrent) anyBuildWeekCurrent = true;
      if (cap.offDays.length > 0) {
        holidayImpacts.push({ person: person, offDays: cap.offDays, capacity: cap.capacity });
      }
      if (cap.buildWeekIsCurrent && !daysLeftNote) {
        daysLeftNote =
          cap.daysCounted + " day(s) left this build week" +
          (cap.daysSkippedPast ? " (" + cap.daysSkippedPast + " already gone)" : "");
      }
    });

    const warning = getWarningLevel(needed, totalCapacity);
    if (warning.level === "danger") hasManpowerWarning = true;

    const headLabel = w.isCurrent ? "This week" : ("W/C " + fmtDateShort(w.start));

    const sumParts = perPerson.map(function (p) { return String(p.capacity); }).join(" + ");
    const whoLine = sumParts + " = " + totalCapacity;

    const gap = totalCapacity - needed;
    const resultFormula =
      "Result = " + totalCapacity + " − " + needed + " = " +
      (gap >= 0 ? ("+" + gap + " above needed") : (Math.abs(gap) + " short"));

    let holidayWarning = "";
    if (holidayImpacts.length > 0) {
      holidayWarning = '<div class="holiday-impact" style="margin-top:8px;font-size:0.75rem;">⚠️ Off in the build week: ';
      holidayImpacts.forEach(function (p) {
        const days = p.offDays.map(function (o) { return fmtDateShort(o.date); }).join(", ");
        holidayWarning +=
          '<span class="chip">' + escapeHtml(p.person.initials) + " " + days +
          " (" + p.capacity + " left)</span> ";
      });
      holidayWarning += "</div>";
    }

    const neededNote = fromLoads
      ? " <span style=\"color:var(--muted);font-weight:400\">(all loads in this week)</span>"
      : " <span style=\"color:var(--muted);font-weight:400\">(default " + defaultNeeded + ")</span>";

    const midWeekNote = anyBuildWeekCurrent
      ? '<div style="font-size:0.75rem;color:var(--muted);margin-top:6px;">' +
          "⏱ Build week is this week — capacity is only remaining days" +
          (daysLeftNote ? ": " + escapeHtml(daysLeftNote) : "") +
          (totalFullCapacity > totalCapacity
            ? " (full week would be " + totalFullCapacity + ")"
            : "") +
        "</div>"
      : "";

    return (
      '<div class="forecast-week-card ' + warning.className + '">' +
        '<div class="fw-header" style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;">' +
          '<div class="fw-title" style="font-weight:700;">' + headLabel + '</div>' +
          '<div class="fw-badge ' + warning.className + '">' + warning.label + '</div>' +
        '</div>' +
        '<div class="fw-row" style="display:flex;justify-content:space-between;gap:12px;margin:4px 0;">' +
          '<span>Needed that week</span>' +
          '<span class="val">' + needed + neededNote + '</span>' +
        '</div>' +
        '<div class="fw-row" style="display:flex;justify-content:space-between;gap:12px;margin:4px 0;">' +
          '<span>Who can build (week before)</span>' +
          '<span class="val" style="font-size:0.8rem;text-align:right;">' + escapeHtml(whoLine) + '</span>' +
        '</div>' +
        '<div style="border-top:1px solid var(--card-border);padding-top:8px;margin-top:8px;' +
          'font-weight:700;font-size:0.95rem;">' +
          escapeHtml(resultFormula) +
        '</div>' +
        midWeekNote +
        holidayWarning +
      '</div>'
    );
  }).join("");

  const note =
    '<div class="forecast-note" style="margin-bottom:12px;line-height:1.45;">' +
      '<strong>Needed</strong> = every load with a delivery date in that week (done + still to do). ' +
      '<strong>Capacity</strong> = who is in the week before. ' +
      'If that build week is the current week, only <strong>days left</strong> count (e.g. on Tuesday, Monday is already gone).' +
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

  updateLookaheadBanner(weeks, holidayIndex, defaultNeeded, today);
}

function updateLookaheadBanner(weeks, holidayIndex, defaultNeeded, today) {
  const container = document.getElementById("lookaheadBanner");
  if (!container || !weeks || weeks.length < 2) return;

  const next = weeks[1];
  const fromLoads = next.loadTotal > 0;
  const needed = fromLoads ? Math.round(next.loadTotal) : defaultNeeded;

  let capacity = 0;
  PEOPLE.forEach(function (person) {
    capacity += getPrevWeekCapacity(person, next.start, holidayIndex, today).capacity;
  });

  const gap = capacity - needed;
  const short = gap < 0;
  const color = short ? "var(--red)" : "var(--green)";
  const bg = short ? "rgba(231,76,60,0.08)" : "rgba(46,204,113,0.08)";
  const src = fromLoads ? "all loads" : "default " + defaultNeeded;
  const msg =
    "Next week: Result = " + capacity + " − " + needed +
    " (" + src + ") = " +
    (short ? (Math.abs(gap) + " short") : ("+" + gap + " above needed"));

  container.innerHTML =
    '<div style="background:' + bg + ';border:1px solid ' + color +
    ';border-radius:10px;padding:10px 16px;margin-bottom:16px;text-align:center;' +
    'font-size:0.85rem;font-weight:600;color:' + color + ';">' + msg + '</div>';
}

window.renderEnhancedForecast = function () {
  if (window._holidayIndex && window._today) {
    renderEnhancedForecast(window._forecastEntries || [], window._holidayIndex, window._today);
  }
};
