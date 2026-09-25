/**
 * Fix net points on the person detail page.
 *
 * Bug: stairsOver was (actual + holidayCredit) - target, but target is already
 * reduced to 0 on full holiday days while credit still equals a full day of stairs.
 * That made a week off look like +~264 net points instead of 0.
 *
 * Correct: stairsOver = actual - target (target already reflects absences).
 * Holiday credit remains informational only.
 */
import { mondayOf, dayBucket, sameDay, fmtDateShort } from "./utils.js";
import { computeDayStats } from "./data.js";
import { CONFIG } from "./config.js";

function findPersonByDetailName() {
  const nameEl = document.getElementById("detailPersonName");
  if (!nameEl) return null;
  const name = (nameEl.textContent || "").trim();
  if (!name) return null;
  return CONFIG.people.find(p => p.name === name || p.name.startsWith(name) || name.startsWith(p.name)) || null;
}

function recalcAndPatchDetail() {
  const person = findPersonByDetailName();
  const stairEntries = window._stairEntries;
  const forecastEntries = window._forecastEntries || [];
  const holidayIndex = window._holidayIndex;
  const today = window._today;
  const errorEntries = window._errorEntries || [];

  if (!person || !stairEntries || !holidayIndex || !today) return;

  const monday = mondayOf(today);
  const weeks = [];
  for (let i = 3; i >= 0; i--) {
    const wStart = new Date(monday);
    wStart.setDate(wStart.getDate() - 7 * i);
    const wEnd = new Date(wStart);
    wEnd.setDate(wStart.getDate() + 4);
    weeks.push({ start: wStart, end: wEnd });
  }

  let totalActual = 0;
  let totalTarget = 0;
  let totalHolidayCredit = 0;
  let totalErrorPoints = 0;
  const weekData = [];

  weeks.forEach((week, idx) => {
    let actual = 0;
    let target = 0;
    let holidayCredit = 0;

    for (let d = new Date(week.start); d <= week.end; d.setDate(d.getDate() + 1)) {
      const dCopy = new Date(d);
      if (!dayBucket(dCopy)) continue;
      const stats = computeDayStats(person, dCopy, stairEntries, holidayIndex);
      target += stats.target;
      actual += stats.actual;
      holidayCredit += stats.credit;
    }

    let weekErrorPoints = 0;
    const weekErrors = errorEntries.filter(e =>
      e.initials === person.initials &&
      e.date >= week.start && e.date <= week.end
    );
    weekErrors.forEach(e => { weekErrorPoints += e.points; });

    // FIXED: target already reduced for holidays — do not add credit again
    const stairsOver = actual - target;
    const netPoints = stairsOver + weekErrorPoints;

    const forecastForWeek = forecastEntries
      .filter(e =>
        e.initials === person.initials &&
        e.deliveryDate &&
        e.deliveryDate >= week.start &&
        e.deliveryDate <= week.end
      )
      .reduce((s, e) => s + e.stairs, 0);

    totalActual += actual;
    totalTarget += target;
    totalHolidayCredit += holidayCredit;
    totalErrorPoints += weekErrorPoints;

    weekData.push({
      label: idx === 0 ? "This Week" : (fmtDateShort(week.start) + " - " + fmtDateShort(week.end)),
      actual: actual,
      target: target,
      holidayCredit: holidayCredit,
      stairsOver: stairsOver,
      errorPoints: weekErrorPoints,
      netPoints: netPoints,
      forecast: forecastForWeek,
      errorCount: weekErrors.length
    });
  });

  const totalStairsOver = totalActual - totalTarget;
  const totalNetPoints = totalStairsOver + totalErrorPoints;
  const diffClass = totalNetPoints > 0 ? "positive" : (totalNetPoints < 0 ? "negative" : "neutral");
  const diffDisplay = totalNetPoints > 0 ? "+" + totalNetPoints : String(totalNetPoints);

  const statsEl = document.getElementById("detailStats");
  if (statsEl) {
    statsEl.innerHTML =
      '<div class="detail-stat-card"><div class="label">Total Stairs</div><div class="value">' + totalActual + '</div></div>' +
      '<div class="detail-stat-card"><div class="label">Target</div><div class="value">' + totalTarget + '</div></div>' +
      '<div class="detail-stat-card"><div class="label">Holiday Credit</div><div class="value">+' + totalHolidayCredit + '</div></div>' +
      '<div class="detail-stat-card"><div class="label">Total Error Points</div><div class="value negative">' + totalErrorPoints + '</div></div>' +
      '<div class="detail-stat-card"><div class="label">Net Points</div><div class="value ' + diffClass + '">' + diffDisplay + '</div></div>';
  }

  const weeksEl = document.getElementById("detailWeeks");
  if (weeksEl) {
    weeksEl.innerHTML = weekData.map(function (w) {
      const overClass = w.stairsOver > 0 ? "positive" : (w.stairsOver < 0 ? "negative" : "neutral");
      const netClass = w.netPoints > 0 ? "gold" : (w.netPoints < 0 ? "negative" : "neutral");
      const creditNote = w.holidayCredit > 0
        ? ' <span style="color:var(--muted);font-weight:400">(target reduced for holiday)</span>'
        : "";
      return (
        '<div class="detail-week-card">' +
          '<div class="week-label">' + w.label + '</div>' +
          '<div class="week-row"><span>Stairs</span><span class="val">' + w.actual + ' / ' + w.target + creditNote + '</span></div>' +
          '<div class="week-row"><span>Over target</span><span class="val ' + overClass + '">' + (w.stairsOver > 0 ? "+" : "") + w.stairsOver + '</span></div>' +
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
}

function watchDetailPage() {
  const detailPage = document.getElementById("detailPage");
  if (!detailPage) return;

  const run = function () {
    if (detailPage.classList.contains("active")) {
      // Original render is sync on click; patch shortly after
      setTimeout(recalcAndPatchDetail, 50);
      setTimeout(recalcAndPatchDetail, 200);
    }
  };

  const obs = new MutationObserver(run);
  obs.observe(detailPage, { attributes: true, attributeFilter: ["class"] });

  // Also when stats content is written
  const statsEl = document.getElementById("detailStats");
  if (statsEl) {
    const obs2 = new MutationObserver(function () {
      if (detailPage.classList.contains("active")) recalcAndPatchDetail();
    });
    obs2.observe(statsEl, { childList: true, subtree: true });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", watchDetailPage);
} else {
  watchDetailPage();
}
