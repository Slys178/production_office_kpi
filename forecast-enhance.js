/**
 * Forecast manpower check
 *
 * Target rhythm:
 *   Mon–Thu  → finishing / working NEXT week’s deliveries
 *   Fri AM   → should be starting WEEK AFTER NEXT
 *
 * So capacity for a delivery week D is the people available on:
 *   • Friday of the week two weeks before D  (start of that work)
 *   • Mon–Thu of the week before D           (main build)
 *
 * Loads:
 *   Completed / still to do from the tracking sheet.
 *   Done weeks (0 outstanding) → Done, no shortfall.
 *   No loads yet → defaultWeeklyStairs estimate.
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

/** Build days that serve delivery week starting forecastWeekStart (Monday). */
function getBuildDays(forecastWeekStart) {
  // Week before (D-1): Mon–Thu
  const d1Mon = new Date(forecastWeekStart);
  d1Mon.setDate(d1Mon.getDate() - 7);
  const days = [];
  for (let i = 0; i <= 3; i++) {
    const d = new Date(d1Mon);
    d.setDate(d1Mon.getDate() + i);
    days.push(d);
  }
  // Friday of week two before (D-2)
  const d2Mon = new Date(forecastWeekStart);
  d2Mon.setDate(d2Mon.getDate() - 14);
  const fri = new Date(d2Mon);
  fri.setDate(d2Mon.getDate() + 4);
  days.push(fri);
  days.sort(function (a, b) { return a - b; });
  return days;
}

function getBuildCapacity(person, forecastWeekStart, holidayIndex, today, onlyRemainingDays) {
  const buildDays = getBuildDays(forecastWeekStart);
  const todayStart = today ? startOfDay(today) : null;

  let capacity = 0;
  let fullCapacity = 0;
  const offDays = [];
  let daysCounted = 0;
  let daysSkippedPast = 0;
  let anyDayCurrentOrFuture = false;
  let anyDayInCurrentWeek = false;

  const thisMon = today ? mondayOf(today) : null;

  buildDays.forEach(function (dCopy) {
    if (!dayBucket(dCopy)) return;

    if (thisMon) {
      const dayMon = mondayOf(dCopy);
      if (dayMon.getTime() === thisMon.getTime()) anyDayInCurrentWeek = true;
    }

    const code = getCodeForPerson(holidayIndex, person.holidayName, dCopy);
    let dayCap = 0;
    if (isAbsenceCode(code)) {
      offDays.push({ date: new Date(dCopy), code: code });
    } else {
      dayCap = targetFor(person.initials, dCopy, code);
    }
    fullCapacity += dayCap;

    if (onlyRemainingDays && todayStart && startOfDay(dCopy) < todayStart) {
      daysSkippedPast += 1;
      return;
    }

    if (todayStart && startOfDay(dCopy) >= todayStart) anyDayCurrentOrFuture = true;

    capacity += dayCap;
    daysCounted += 1;
  });

  return {
    capacity: Math.round(capacity),
    fullCapacity: Math.round(fullCapacity),
    offDays: offDays,
    daysCounted: daysCounted,
    daysSkippedPast: daysSkippedPast,
    anyDayInCurrentWeek: anyDayInCurrentWeek,
    buildDays: buildDays,
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

function buildWindowLabel(forecastWeekStart) {
  const days = getBuildDays(forecastWeekStart);
  if (!days.length) return "";
  const first = days[0];
  const last = days[days.length - 1];
  return fmtDateShort(first) + " → " + fmtDateShort(last) + " (Fri start + Mon–Thu)";
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

  (stairEntries || []).forEach(function (e) {
    addToWeek(weeks, startMonday, lastWeekEnd, e, "done");
  });
  (forecastEntries || []).forEach(function (e) {
    addToWeek(weeks, startMonday, lastWeekEnd, e, "out");
  });

  let hasManpowerWarning = false;

  const html = weeks.map(function (w) {
    const completed = Math.round(w.completed);
    const outstanding = Math.round(w.outstanding);
    const hasLoads = completed + outstanding > 0;
    const isDone = hasLoads && outstanding === 0;

    const needed = isDone ? 0 : (hasLoads ? outstanding : defaultNeeded);
    const onlyRemaining = !isDone && outstanding > 0;

    let totalCapacity = 0;
    let totalFullCapacity = 0;
    const perPerson = [];
    const holidayImpacts = [];
    let anyBuildInCurrentWeek = false;
    let daysLeftNote = "";

    PEOPLE.forEach(function (person) {
      const cap = getBuildCapacity(
        person, w.start, holidayIndex, today, onlyRemaining
      );
      totalCapacity += cap.capacity;
      totalFullCapacity += cap.fullCapacity;
      perPerson.push({ initials: person.initials, capacity: cap.capacity });
      if (cap.anyDayInCurrentWeek) anyBuildInCurrentWeek = true;
      if (cap.offDays.length > 0) {
        holidayImpacts.push({ person: person, offDays: cap.offDays, capacity: cap.capacity });
      }
      if (onlyRemaining && cap.daysSkippedPast > 0 && !daysLeftNote) {
        daysLeftNote =
          cap.daysCounted + " build day(s) left" +
          " (" + cap.daysSkippedPast + " already passed)";
      }
    });

    const warning = getWarningLevel(needed, totalCapacity, isDone);
    if (warning.level === "danger") hasManpowerWarning = true;

    const headLabel = w.isCurrent ? "This week" : ("W/C " + fmtDateShort(w.start));
    const sumParts = perPerson.map(function (p) { return String(p.capacity); }).join(" + ");
    const whoLine = sumParts + " = " + totalCapacity;
    const windowLine = buildWindowLabel(w.start);

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
      holidayWarning = '<div class="holiday-impact" style="margin-top:8px;font-size:0.75rem;">⚠️ Off in the build window: ';
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
      !isDone && onlyRemaining && daysLeftNote
        ? '<div style="font-size:0.75rem;color:var(--muted);margin-top:6px;">' +
            "⏱ " + escapeHtml(daysLeftNote) +
            (totalFullCapacity > totalCapacity
              ? " · full window was " + totalFullCapacity
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
              '<span>Build window</span>' +
              '<span class="val" style="font-size:0.75rem;text-align:right;">' + escapeHtml(windowLine) + '</span>' +
            '</div>' +
            '<div class="fw-row" style="display:flex;justify-content:space-between;gap:12px;margin:4px 0;">' +
              '<span>Who can build</span>' +
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
      '<strong>Target rhythm:</strong> by first thing <strong>Friday</strong> you should be starting ' +
      '<strong>week after next</strong>. Capacity for a delivery week = ' +
      '<strong>that Friday two weeks before</strong> + <strong>Mon–Thu of the week before</strong>. ' +
      'Done weeks stay Done. Empty weeks use default <strong>' + defaultNeeded + '</strong>.' +
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
    capacity += getBuildCapacity(
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
