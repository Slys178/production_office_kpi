/**
 * Forecast manpower check (kept simple):
 *
 *   Completed   = loads with delivery date in that week, programs done
 *   Still to do = loads with delivery date in that week, not done yet
 *
 *   If still to do = 0 and some completed → week is DONE (no shortfall)
 *   If still to do > 0 → Result = capacity − still to do
 *   If no loads at all → use defaultWeeklyStairs as planning estimate
 *
 *   Capacity = who is available the WEEK BEFORE (when that work is built).
 *   If that build week is the current week AND there is still work to do,
 *   only remaining days count (Mon already gone on a Tuesday, etc.).
 */
import { CONFIG } from "./config.js";
import { mondayOf, dayBucket, fmtDateShort } from "./utils.js";
import { getCodeForPerson, isAbsenceCode, targetFor } from "./data.js";

const PEOPLE = CONFIG.people.filter(function (p) {
  return p.initials !== CONFIG.excludeFromKpiDisplay;
});

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function getPrevWeekCapacity(person, forecastWeekStart, holidayIndex, today, onlyRemainingDays) {
  const prevWeekStart = new Date(forecastWeekStart);
  prevWeekStart.setDate(prevWeekStart.getDate() - 7);
  const prevWeekEnd = new Date(prevWeekStart);
  prevWeekEnd.setDate(prevWeekStart.getDate() + 4);

  const todayStart = today ? startOfDay(today) : null;
  const buildWeekIsCurrent =
    todayStart &&
    todayStart >= startOfDay(prevWeekStart) &&
    todayStart <= startOfDay(prevWeekEnd);

  const trimDays = onlyRemainingDays && buildWeekIsCurrent;

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

    if (trimDays && startOfDay(dCopy) < todayStart) {
      daysSkippedPast += 1;
      continue;
    }

    capacity += dayCap;
    daysCounted += 1;
  }

  return {
    capacity: Math.round(capacity),
    fullWeekCapacity: Math.round(fullWeekCapacity),
    offDays: offDays,
    buildWeekIsCurrent: !!buildWeekIsCurrent,
    daysCounted: daysCounted,
    daysSkippedPast: daysSkippedPast,
  };
}

function getWarningLevel(needed, capacity, isDone) {
  if (isDone) return { level: "ok", label: "✅ Done", className: "ok" };
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

function addToWeek(weeks, startMonday, lastWeekEnd, e, bucket) {
  if (!e || !e.deliveryDate) return;
  if (e.deliveryDate < startMonday || e.deliveryDate > lastWeekEnd) return;
  if (e.initials === CONFIG.excludeFromKpiDisplay) return;
  const wk = weeks.find(function (w) {
    return e.deliveryDate >= w.start && e.deliveryDate <= w.end;
  });
  if (!wk) return;
  const stairs = Number(e.stairs) || 0;
  if (stairs <= 0) return;
  if (bucket === "done") wk.completed += stairs;
  else wk.outstanding += stairs;
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
    wEnd.setDate(wStart.getDate() + 6);
    weeks.push({
      start: wStart,
      end: wEnd,
      completed: 0,
      outstanding: 0,
      isCurrent: i === 0,
    });
  }
  const lastWeekEnd = weeks[weeks.length - 1].end;

  // Completed rows (programs done)
  (stairEntries || []).forEach(function (e) {
    addToWeek(weeks, startMonday, lastWeekEnd, e, "done");
  });
  // Outstanding rows (not done yet)
  (forecastEntries || []).forEach(function (e) {
    addToWeek(weeks, startMonday, lastWeekEnd, e, "out");
  });

  let hasManpowerWarning = false;

  const html = weeks.map(function (w) {
    const completed = Math.round(w.completed);
    const outstanding = Math.round(w.outstanding);
    const hasLoads = completed + outstanding > 0;
    const isDone = hasLoads && outstanding === 0;

    // What we still need capacity for (shortfall check)
    // Done weeks → 0. Weeks with loads → outstanding only. Empty weeks → default estimate.
    const needed = isDone ? 0 : (hasLoads ? outstanding : defaultNeeded);
    const onlyRemaining = !isDone && outstanding > 0;

    let totalCapacity = 0;
    let totalFullCapacity = 0;
    const perPerson = [];
    const holidayImpacts = [];
    let anyBuildWeekCurrent = false;
    let daysLeftNote = "";

    PEOPLE.forEach(function (person) {
      const cap = getPrevWeekCapacity(
        person, w.start, holidayIndex, today, onlyRemaining
      );
      totalCapacity += cap.capacity;
      totalFullCapacity += cap.fullWeekCapacity;
      perPerson.push({ initials: person.initials, capacity: cap.capacity });
      if (cap.buildWeekIsCurrent) anyBuildWeekCurrent = true;
      if (cap.offDays.length > 0) {
        holidayImpacts.push({ person: person, offDays: cap.offDays, capacity: cap.capacity });
      }
      if (cap.buildWeekIsCurrent && onlyRemaining && !daysLeftNote) {
        daysLeftNote =
          cap.daysCounted + " day(s) left to finish remaining work" +
          (cap.daysSkippedPast ? " (" + cap.daysSkippedPast + " day(s) already used)" : "");
      }
    });

    const warning = getWarningLevel(needed, totalCapacity, isDone);
    if (warning.level === "danger") hasManpowerWarning = true;

    const headLabel = w.isCurrent ? "This week" : ("W/C " + fmtDateShort(w.start));
    const sumParts = perPerson.map(function (p) { return String(p.capacity); }).join(" + ");
    const whoLine = sumParts + " = " + totalCapacity;

    let resultFormula;
    if (isDone) {
      resultFormula = "Result = Done — " + completed + " stairs complete, nothing left to build";
    } else {
      const gap = totalCapacity - needed;
      resultFormula =
        "Result = " + totalCapacity + " − " + needed + " = " +
        (gap >= 0 ? ("+" + gap + " above needed") : (Math.abs(gap) + " short"));
    }

    let holidayWarning = "";
    if (!isDone && holidayImpacts.length > 0) {
      holidayWarning = '<div class="holiday-impact" style="margin-top:8px;font-size:0.75rem;">⚠️ Off in the build week: ';
      holidayImpacts.forEach(function (p) {
        const days = p.offDays.map(function (o) { return fmtDateShort(o.date); }).join(", ");
        holidayWarning +=
          '<span class="chip">' + escapeHtml(p.person.initials) + " " + days +
          " (" + p.capacity + " left)</span> ";
      });
      holidayWarning += "</div>";
    }

    const loadsLine = hasLoads
      ? (completed + " done · " + outstanding + " still to do")
      : ("no loads yet — using default " + defaultNeeded);

    const midWeekNote =
      !isDone && anyBuildWeekCurrent && outstanding > 0
        ? '<div style="font-size:0.75rem;color:var(--muted);margin-top:6px;">' +
            "⏱ Still building this week — capacity is only days left" +
            (daysLeftNote ? ": " + escapeHtml(daysLeftNote) : "") +
            (totalFullCapacity > totalCapacity
              ? " (full week was " + totalFullCapacity + ")"
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
          '<span>Loads that week</span>' +
          '<span class="val">' + escapeHtml(loadsLine) + '</span>' +
        '</div>' +
        (isDone
          ? ""
          : '<div class="fw-row" style="display:flex;justify-content:space-between;gap:12px;margin:4px 0;">' +
              '<span>Still need capacity for</span>' +
              '<span class="val">' + needed + '</span>' +
            '</div>' +
            '<div class="fw-row" style="display:flex;justify-content:space-between;gap:12px;margin:4px 0;">' +
              '<span>Who can build (week before)</span>' +
              '<span class="val" style="font-size:0.8rem;text-align:right;">' + escapeHtml(whoLine) + '</span>' +
            '</div>') +
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
      '<strong>Done weeks</strong> (all loads ticked complete) show as Done — they cannot show short. ' +
      '<strong>Short / OK</strong> only looks at <strong>still to do</strong> vs who is available the week before. ' +
      'Weeks with no loads yet use the default of <strong>' + defaultNeeded + '</strong>.' +
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

  // Prefer the next week that still has work, else next calendar week
  let focus = weeks[1];
  for (let i = 1; i < weeks.length; i++) {
    if (weeks[i].outstanding > 0 || (weeks[i].completed + weeks[i].outstanding === 0)) {
      focus = weeks[i];
      break;
    }
  }

  const completed = Math.round(focus.completed);
  const outstanding = Math.round(focus.outstanding);
  const hasLoads = completed + outstanding > 0;
  const isDone = hasLoads && outstanding === 0;
  const needed = isDone ? 0 : (hasLoads ? outstanding : defaultNeeded);
  const onlyRemaining = !isDone && outstanding > 0;

  let capacity = 0;
  PEOPLE.forEach(function (person) {
    capacity += getPrevWeekCapacity(
      person, focus.start, holidayIndex, today, onlyRemaining
    ).capacity;
  });

  let msg;
  let short = false;
  if (isDone) {
    msg = "W/C " + fmtDateShort(focus.start) + ": Done — " + completed + " stairs complete";
  } else {
    const gap = capacity - needed;
    short = gap < 0;
    const src = hasLoads ? "still to do" : "default " + defaultNeeded;
    msg =
      "W/C " + fmtDateShort(focus.start) + ": " + capacity + " − " + needed +
      " (" + src + ") = " +
      (short ? (Math.abs(gap) + " short") : ("+" + gap + " above needed"));
  }

  const color = short ? "var(--red)" : "var(--green)";
  const bg = short ? "rgba(231,76,60,0.08)" : "rgba(46,204,113,0.08)";

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
