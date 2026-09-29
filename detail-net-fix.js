/**
 * Fix net points on the person detail page.
 *
 * 1) Holiday days: stairsOver = actual - target (target already reduced; no double credit).
 * 2) Current week: compare to completed-days target only (days before today),
 *    so mid-week does not look massively negative against a full-week target.
 * 3) Top "Net Points" total: completed weeks only (last 3 finished weeks),
 *    so an in-progress week cannot drag the rolling score down unfairly.
 */
import { mondayOf, dayBucket, sameDay, fmtDateShort } from "./utils.js";
import { computeDayStats } from "./data.js";
import { CONFIG } from "./config.js";

let patching = false;

function findPersonByDetailName() {
  const nameEl = document.getElementById("detailPersonName");
  if (!nameEl) return null;
  const name = (nameEl.textContent || "").trim();
  if (!name) return null;
  return CONFIG.people.find(p => p.name === name || p.name.startsWith(name) || name.startsWith(p.name)) || null;
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function recalcAndPatchDetail() {
  if (patching) return;
  const person = findPersonByDetailName();
  const stairEntries = window._stairEntries;
  const forecastEntries = window._forecastEntries || [];
  const holidayIndex = window._holidayIndex;
  const today = window._today;
  const errorEntries = window._errorEntries || [];

  if (!person || !stairEntries || !holidayIndex || !today) return;

  const monday = mondayOf(today);
  const todayStart = startOfDay(today);

  // Oldest → newest (i=3 is three weeks ago, i=0 is this week)
  const weeks = [];
  for (let i = 3; i >= 0; i--) {
    const wStart = new Date(monday);
    wStart.setDate(wStart.getDate() - 7 * i);
    const wEnd = new Date(wStart);
    wEnd.setDate(wStart.getDate() + 4);
    weeks.push({ start: wStart, end: wEnd });
  }

  let totalActual = 0;
  let totalFullTarget = 0;
  let totalHolidayCredit = 0;
  let totalErrorPoints = 0;
  let completedWeeksNet = 0;
  let completedWeeksCount = 0;
  const weekData = [];

  weeks.forEach(function (week) {
    const isCurrent = week.start.getTime() === monday.getTime();

    let actual = 0;
    let fullTarget = 0;
    let completedTarget = 0;
    let holidayCredit = 0;

    for (let d = new Date(week.start); d <= week.end; d.setDate(d.getDate() + 1)) {
      const dCopy = new Date(d);
      if (!dayBucket(dCopy)) continue;
      const stats = computeDayStats(person, dCopy, stairEntries, holidayIndex);
      fullTarget += stats.target;
      actual += stats.actual;
      holidayCredit += stats.credit;

      // Completed days = strictly before today (same rule as KPI dials)
      if (startOfDay(dCopy) < todayStart) {
        completedTarget += stats.target;
      }
    }

    let weekErrorPoints = 0;
    const weekErrors = errorEntries.filter(function (e) {
      return e.initials === person.initials && e.date >= week.start && e.date <= week.end;
    });
    weekErrors.forEach(function (e) { weekErrorPoints += e.points; });

    // Finished weeks: actual vs full week target
    // Current week: actual vs expected so far (completed days only)
    const compareTarget = isCurrent ? completedTarget : fullTarget;
    const stairsOver = actual - compareTarget;
    const netPoints = stairsOver + weekErrorPoints;

    const forecastForWeek = forecastEntries
      .filter(function (e) {
        return e.initials === person.initials &&
          e.deliveryDate &&
          e.deliveryDate >= week.start &&
          e.deliveryDate <= week.end;
      })
      .reduce(function (s, e) { return s + e.stairs; }, 0);

    totalActual += actual;
    totalFullTarget += fullTarget;
    totalHolidayCredit += holidayCredit;
    totalErrorPoints += weekErrorPoints;

    if (!isCurrent) {
      completedWeeksNet += netPoints;
      completedWeeksCount += 1;
    }

    let label;
    if (isCurrent) {
      label = "This Week (in progress)";
    } else {
      label = fmtDateShort(week.start) + " - " + fmtDateShort(week.end);
    }

    weekData.push({
      label: label,
      isCurrent: isCurrent,
      actual: actual,
      fullTarget: fullTarget,
      compareTarget: compareTarget,
      holidayCredit: holidayCredit,
      stairsOver: stairsOver,
      errorPoints: weekErrorPoints,
      netPoints: netPoints,
      forecast: forecastForWeek,
      errorCount: weekErrors.length
    });
  });

  // Headline totals: stairs/target still show all 4 weeks for context,
  // but Net Points only sum finished weeks so mid-week cannot tank the score.
  const totalNetPoints = completedWeeksNet;
  const diffClass = totalNetPoints > 0 ? "positive" : (totalNetPoints < 0 ? "negative" : "neutral");
  const diffDisplay = totalNetPoints > 0 ? "+" + totalNetPoints : String(totalNetPoints);

  const currentWeek = weekData.find(function (w) { return w.isCurrent; });
  const currentNote = currentWeek
    ? ("This week in progress: " + currentWeek.actual + " done · expected so far " +
       currentWeek.compareTarget + " · net " +
       (currentWeek.netPoints > 0 ? "+" : "") + currentWeek.netPoints +
       " (not in total above)")
    : "";

  patching = true;
  try {
    const statsEl = document.getElementById("detailStats");
    if (statsEl) {
      statsEl.innerHTML =
        '<div class="detail-stat-card"><div class="label">Total Stairs</div><div class="value">' + totalActual + '</div></div>' +
        '<div class="detail-stat-card"><div class="label">Target (4 wks)</div><div class="value">' + totalFullTarget + '</div></div>' +
        '<div class="detail-stat-card"><div class="label">Holiday Credit</div><div class="value">+' + totalHolidayCredit + '</div></div>' +
        '<div class="detail-stat-card"><div class="label">Total Error Points</div><div class="value negative">' + totalErrorPoints + '</div></div>' +
        '<div class="detail-stat-card" title="Sum of net points from finished weeks only — current week is shown separately so mid-week progress cannot drag this down">' +
          '<div class="label">Net Points (' + completedWeeksCount + ' wks)</div>' +
          '<div class="value ' + diffClass + '">' + diffDisplay + '</div></div>' +
        (currentNote
          ? '<div style="grid-column:1/-1;font-size:0.75rem;color:var(--muted);margin-top:4px;line-height:1.4;">' +
              currentNote +
            '</div>'
          : '');
    }

    const weeksEl = document.getElementById("detailWeeks");
    if (weeksEl) {
      weeksEl.innerHTML = weekData.map(function (w) {
        const overClass = w.stairsOver > 0 ? "positive" : (w.stairsOver < 0 ? "negative" : "neutral");
        const netClass = w.netPoints > 0 ? "gold" : (w.netPoints < 0 ? "negative" : "neutral");
        const creditNote = w.holidayCredit > 0
          ? ' <span style="color:var(--muted);font-weight:400">(target reduced for holiday)</span>'
          : "";
        const stairsLine = w.isCurrent
          ? (w.actual + " done · expected so far " + w.compareTarget +
             " <span style=\"color:var(--muted);font-weight:400\">(full week target " + w.fullTarget + ")</span>")
          : (w.actual + " / " + w.fullTarget + creditNote);
        const overLabel = w.isCurrent ? "Vs expected so far" : "Over target";
        return (
          '<div class="detail-week-card">' +
            '<div class="week-label">' + w.label + '</div>' +
            '<div class="week-row"><span>Stairs</span><span class="val">' + stairsLine + '</span></div>' +
            '<div class="week-row"><span>' + overLabel + '</span><span class="val ' + overClass + '">' +
              (w.stairsOver > 0 ? "+" : "") + w.stairsOver + '</span></div>' +
            '<div class="week-row error-points-row"><span>Error points</span><span class="val negative">' + w.errorPoints + '</span></div>' +
            '<div class="week-row" style="border-top:1px solid var(--card-border);padding-top:4px;margin-top:4px;">' +
              '<span><strong>Net points</strong></span>' +
              '<span class="val ' + netClass + '"><strong>' + (w.netPoints > 0 ? "+" : "") + w.netPoints + '</strong></span>' +
            '</div>' +
            '<div class="week-row forecast-row"><span>Forecast (uncompleted)</span><span class="val" style="color:var(--blue);">' + w.forecast + '</span></div>' +
            (w.errorCount > 0 ? '<div style="font-size:0.6rem;color:var(--muted);margin-top:4px;">' + w.errorCount + ' error(s) this week</div>' : '') +
          '</div>'
        );
      }).join("");
    }
  } finally {
    patching = false;
  }
}

function watchDetailPage() {
  const detailPage = document.getElementById("detailPage");
  if (!detailPage) return;

  const run = function () {
    if (detailPage.classList.contains("active")) {
      setTimeout(recalcAndPatchDetail, 50);
      setTimeout(recalcAndPatchDetail, 250);
    }
  };

  const obs = new MutationObserver(run);
  obs.observe(detailPage, { attributes: true, attributeFilter: ["class"] });

  const statsEl = document.getElementById("detailStats");
  if (statsEl) {
    const obs2 = new MutationObserver(function () {
      if (patching) return;
      if (detailPage.classList.contains("active")) {
        setTimeout(recalcAndPatchDetail, 30);
      }
    });
    obs2.observe(statsEl, { childList: true });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", watchDetailPage);
} else {
  watchDetailPage();
}
