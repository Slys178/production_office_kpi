/**
 * This-week finish day prediction module.
 * Uses actual pace (stairs per hour) when available; falls back to capacity targets.
 * Privacy: team members only see their own person card;
 * SA (manager) and ADMIN role see permanent staff. Temporary helpers (hideIndividualKpi)
 * count in team totals but have no personal card.
 */
import { mondayOf, dayBucket, sameDay, fmtDate, fmtDateShort } from "./utils.js";
import { getCodeForPerson, targetFor, isAbsenceCode, statusLabel, hoursLostForCode } from "./data.js";
import { CONFIG } from "./config.js";

const PEOPLE = CONFIG.people;

/** Typical office start time used to estimate hours elapsed today. */
const WORK_START_HOUR = 8;
const WORK_END_HOUR = 17;

function getLoggedInUser() {
  try {
    const raw = localStorage.getItem("po_user") || localStorage.getItem("kpiUser") || "";
    if (!raw) return { userName: "", role: "", initials: "", canSeeAll: false };
    const u = typeof raw === "string" && raw.startsWith("{") ? JSON.parse(raw) : { name: raw };
    const name = (u.name || u.userName || u.displayName || "").toString().trim();
    const role = (u.role || u.ROLE || "").toString().trim().toUpperCase();
    const initials = (u.initials || "").toString().trim().toUpperCase();
    const canSeeAll = role === "ADMIN" || role === "SA" || initials === "SA";
    // Match initials from people list by name if not provided
    let matched = initials;
    if (!matched && name) {
      const p = PEOPLE.find(
        (x) =>
          x.name.toLowerCase() === name.toLowerCase() ||
          x.holidayName.toLowerCase() === name.toLowerCase()
      );
      if (p) matched = p.initials;
    }
    return { userName: name, role, initials: matched, canSeeAll };
  } catch (e) {
    return { userName: "", role: "", initials: "", canSeeAll: false };
  }
}

function hoursElapsedToday(now) {
  const start = new Date(now);
  start.setHours(WORK_START_HOUR, 0, 0, 0);
  const end = new Date(now);
  end.setHours(WORK_END_HOUR, 0, 0, 0);
  if (now <= start) return 0;
  if (now >= end) return WORK_END_HOUR - WORK_START_HOUR;
  return (now - start) / 3600000;
}

function toDayDate(d) {
  if (!d) return null;
  if (d instanceof Date && !isNaN(d.getTime())) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  const s = String(d).trim();
  const gviz = /^Date\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(s);
  if (gviz) return new Date(+gviz[1], +gviz[2], +gviz[3]);
  const parts = s.split(/[\/\-\.]/);
  if (parts.length === 3) {
    let dd = parseInt(parts[0], 10);
    let mm = parseInt(parts[1], 10);
    let yy = parseInt(parts[2], 10);
    if (yy < 100) yy += 2000;
    if (dd && mm && yy) return new Date(yy, mm - 1, dd);
  }
  const t = new Date(d);
  if (!isNaN(t.getTime())) return new Date(t.getFullYear(), t.getMonth(), t.getDate());
  return null;
}

/** Open stairs (no green tick) with delivery in the week after this work week. */
function openLoadDemandForThisWorkWeek(forecastEntries, today) {
  const workMon = mondayOf(today);
  const demandMon = new Date(workMon);
  demandMon.setDate(demandMon.getDate() + 7);
  demandMon.setHours(0, 0, 0, 0);
  const demandEnd = new Date(demandMon);
  demandEnd.setDate(demandEnd.getDate() + 7);

  let total = 0;
  let count = 0;
  (forecastEntries || []).forEach(function (e) {
    if (e.isCompleted === true) return;
    const d = toDayDate(e.deliveryDate || e.date);
    if (!d) return;
    if (d >= demandMon && d < demandEnd) {
      const n = Number(e.stairs) || 0;
      if (n > 0) {
        total += n;
        count += 1;
      }
    }
  });
  return {
    stairs: Math.round(total),
    loadCount: count,
    demandMonday: demandMon,
    demandEnd: new Date(demandMon.getFullYear(), demandMon.getMonth(), demandMon.getDate() + 4),
  };
}

export function renderCurrentWeekFinish(stairEntries, holidayIndex, today) {
  const container = document.getElementById("currentWeekFinish");
  if (!container || !holidayIndex || !today) return;

  const viewer = getLoggedInUser();
  const monday = mondayOf(today);
  const days = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    days.push(d);
  }

  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const elapsedToday = hoursElapsedToday(today);

  const personStats = [];

  PEOPLE.forEach((person) => {
    if (person.initials === CONFIG.excludeFromKpiDisplay) return;

    let weekTarget = 0;
    let actualSoFar = 0;
    const dayInfo = [];

    days.forEach((day) => {
      const code = getCodeForPerson(holidayIndex, person.holidayName, day);
      const dayTarget = targetFor(person.initials, day, code);
      const dayActual = (stairEntries || [])
        .filter((e) => e.initials === person.initials && sameDay(e.date, day))
        .reduce((s, e) => s + (e.stairs || 0), 0);

      weekTarget += dayTarget;
      if (day <= todayStart) actualSoFar += dayActual;

      const isPast = day < todayStart;
      const isToday = sameDay(day, todayStart);
      const bucket = dayBucket(day);
      const fullHours =
        bucket && CONFIG.hours[person.initials]
          ? CONFIG.hours[person.initials][bucket] || 0
          : 0;
      const remainingHoursToday = isToday
        ? Math.max(0, fullHours - elapsedToday)
        : fullHours;

      dayInfo.push({
        day,
        target: dayTarget,
        actual: dayActual,
        code,
        remainingHours: isPast ? 0 : remainingHoursToday,
        fullHours,
        isPast,
        isToday,
        remainingCapacity: isPast ? 0 : dayTarget,
        available: dayTarget > 0,
      });
    });

    const remaining = Math.max(0, weekTarget - actualSoFar);

    // Pace: stairs per hour from this week so far
    let pace = CONFIG.baseRate;
    let paceSource = "target";
    const hoursWorkedSoFar = dayInfo
      .filter((di) => di.isPast || di.isToday)
      .reduce((s, di) => s + (di.isToday ? elapsedToday : di.fullHours), 0);
    if (hoursWorkedSoFar > 0.5 && actualSoFar > 0) {
      pace = actualSoFar / hoursWorkedSoFar;
      paceSource = "actual";
    } else if (hoursWorkedSoFar > 0.5) {
      pace = CONFIG.baseRate;
      paceSource = "target";
    }

    let left = remaining;
    let finishLabel = "";
    let finishDay = null;

    if (remaining === 0) {
      finishLabel = "Already done";
    } else {
      for (const di of dayInfo) {
        if (di.isPast || left <= 0) continue;
        const hrs = di.remainingHours;
        if (hrs <= 0) continue;
        const canDo = pace * hrs;
        if (canDo >= left) {
          const hrsNeeded = left / pace;
          finishDay = di.day;
          if (di.isToday) {
            const finishAt = new Date(today);
            finishAt.setHours(WORK_START_HOUR, 0, 0, 0);
            // advance by elapsed + needed, but account for already elapsed
            let waitHrs = 0;
            for (const earlier of dayInfo) {
              if (earlier.day < di.day) waitHrs += earlier.remainingHours;
            }
            finishAt.setTime(today.getTime() + hrsNeeded * 3600000);
            finishLabel =
              "Today ~" +
              finishAt.toLocaleTimeString("en-GB", {
                hour: "2-digit",
                minute: "2-digit",
              });
          } else {
            finishLabel = di.day.toLocaleDateString("en-GB", {
              weekday: "long",
              day: "numeric",
              month: "short",
            });
          }
          left = 0;
          break;
        }
        left -= canDo;
      }
      if (left > 0) {
        finishLabel = "Won't hit target";
        finishDay = null;
      }
    }

    const remainingCapacityTotal = dayInfo
      .filter((di) => !di.isPast)
      .reduce((s, di) => s + di.remainingCapacity, 0);

    const expectedRemainingOut = dayInfo
      .filter((di) => !di.isPast)
      .reduce((s, di) => s + pace * di.remainingHours, 0);

    personStats.push({
      person,
      weekTarget,
      actualSoFar,
      remaining,
      remainingCapacityTotal,
      expectedRemainingOut,
      finishLabel,
      finishDay,
      dayInfo,
      pace,
      paceSource,
      fullyOff: weekTarget === 0,
    });
  });

  let teamRemaining = personStats.reduce((s, p) => s + p.remaining, 0);
  let teamFinishDay = null;
  let teamFinishLabel = "Already done";

  if (teamRemaining > 0) {
    const remainingDays = days.filter((d) => d >= todayStart);
    let left = teamRemaining;
    for (const day of remainingDays) {
      let dayExpected = 0;
      let dayRemainingHrsTeam = 0;
      personStats.forEach((ps) => {
        const di = ps.dayInfo.find((x) => sameDay(x.day, day));
        if (!di || di.remainingHours <= 0) return;
        dayExpected += ps.pace * di.remainingHours;
        dayRemainingHrsTeam += di.remainingHours;
      });
      if (dayExpected >= left) {
        teamFinishDay = day;
        const isToday = sameDay(day, todayStart);
        if (isToday && dayRemainingHrsTeam > 0) {
          const teamRate = dayExpected / dayRemainingHrsTeam;
          const hrsNeeded = left / teamRate;
          const finishAt = new Date(today.getTime() + hrsNeeded * 3600000);
          teamFinishLabel =
            "Today ~" +
            finishAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
        } else {
          teamFinishLabel = day.toLocaleDateString("en-GB", {
            weekday: "long",
            day: "numeric",
            month: "short",
          });
        }
        left = 0;
        break;
      }
      left -= dayExpected;
    }
    if (left > 0) teamFinishLabel = "Won't hit target this week";
  }

  const teamWeekTarget = personStats.reduce((s, p) => s + p.weekTarget, 0);
  const teamActual = personStats.reduce((s, p) => s + p.actualSoFar, 0);
  const teamRemCap = personStats.reduce((s, p) => s + p.remainingCapacityTotal, 0);
  const teamExpectedOut = personStats.reduce((s, p) => s + p.expectedRemainingOut, 0);

  // Open loads for delivery W/C (next week) — real work left from Project Tracking
  const openDemand = openLoadDemandForThisWorkWeek(window._forecastEntries || [], today);
  const openStairs = openDemand.stairs;
  const hasOpenLoads = openStairs > 0;
  const shortVsLoads = hasOpenLoads && teamRemCap < openStairs;
  const headlineClass = hasOpenLoads
    ? shortVsLoads
      ? "danger"
      : "ok"
    : teamRemaining === 0
      ? "ok"
      : teamFinishDay
        ? "ok"
        : "danger";

  const anyoneUsingPace = personStats.some(
    (p) => p.paceSource === "actual" || p.paceSource === "blended"
  );

  const hideInd = Array.isArray(CONFIG.hideIndividualKpi)
    ? CONFIG.hideIndividualKpi
    : CONFIG.hideIndividualKpi
      ? [CONFIG.hideIndividualKpi]
      : [];
  const visibleStats = (
    viewer.canSeeAll
      ? personStats
      : personStats.filter((ps) => viewer.initials && ps.person.initials === viewer.initials)
  ).filter((ps) => hideInd.indexOf(ps.person.initials) === -1);

  const demandWcLabel = openDemand.demandMonday
    ? fmtDateShort(openDemand.demandMonday)
    : "";
  let headlineText;
  if (hasOpenLoads) {
    if (shortVsLoads) {
      headlineText =
        "⚠️ Short of capacity for open loads (delivery W/C " + demandWcLabel + ")";
    } else if (teamFinishDay) {
      headlineText =
        "📅 Predicted finish: " + teamFinishLabel + " · open loads covered";
    } else {
      headlineText =
        "✅ Capacity covers open loads (delivery W/C " + demandWcLabel + ")";
    }
  } else {
    headlineText =
      teamRemaining === 0
        ? "🎯 Week targets already met"
        : teamFinishDay
          ? "📅 Predicted finish: " + teamFinishLabel
          : "⚠️ Short of capacity this week";
  }

  let html = `
    <div class="finish-summary">
      <div class="finish-headline ${headlineClass}">
        ${headlineText}
      </div>
      <div class="finish-meta">
        ${
          hasOpenLoads
            ? `Open loads remaining <strong>${openStairs}</strong> (delivery W/C <strong>${demandWcLabel}</strong>, ${openDemand.loadCount} loads)`
            : `Open loads remaining <strong>—</strong> (none found for delivery W/C)`
        }
        · Capacity left <strong>${teamRemCap}</strong>
        · At current pace ~<strong>${Math.round(teamExpectedOut)}</strong> more possible
        ${
          anyoneUsingPace
            ? " · <em>using actual pace</em>"
            : " · <em>using target rate</em>"
        }
      </div>
      <div class="finish-meta" style="opacity:0.85;margin-top:4px;font-size:0.85em;">
        Week targets: done <strong>${teamActual}</strong> of <strong>${teamWeekTarget}</strong>
        · still needed vs targets <strong>${teamRemaining}</strong>
      </div>
    </div>
  `;

  if (visibleStats.length === 0) {
    html += `
      <div class="finish-privacy-note">
        Individual figures are only shown for your own login.
        ${
          viewer.userName
            ? "Logged in as <strong>" +
              viewer.userName +
              "</strong> — name not matched to a team member."
            : "Could not detect who is logged in."
        }
      </div>
    `;
  } else if (!viewer.canSeeAll) {
    html += `
      <div class="finish-privacy-note">
        Showing your figures only · Team predicted finish is above
      </div>
    `;
  }

  html += '<div class="finish-person-grid">';
  visibleStats.forEach((ps) => {
    const {
      person,
      weekTarget,
      actualSoFar,
      remaining,
      finishLabel,
      dayInfo,
      fullyOff,
      remainingCapacityTotal,
      pace,
      paceSource,
    } = ps;

    const badge =
      remaining === 0
        ? '<span class="badge ok">Done</span>'
        : finishLabel === "Won't hit target"
          ? '<span class="badge danger">Short</span>'
          : `<span class="badge ok">${finishLabel}</span>`;

    const dayChips = dayInfo
      .map((di) => {
        const name = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][di.day.getDay()];
        let cls = "day-chip";
        if (di.isPast) cls += " past";
        if (di.isToday) cls += " today";
        if (di.code && isAbsenceCode(di.code)) cls += " off";
        if (!di.available && !di.isPast) cls += " off";
        return `<span class="${cls}">${name}${di.isToday ? "*" : ""}</span>`;
      })
      .join("");

    html += `
      <div class="finish-person-card">
        <div class="finish-person-head">
          <span class="dot" style="background:${person.color}"></span>
          <strong>${person.initials} · ${person.name.split(" ")[0]}</strong>
          ${badge}
        </div>
        <div class="finish-person-stats">
          <div><span>Week target</span><span>${weekTarget}</span></div>
          <div><span>Done so far</span><span>${actualSoFar}</span></div>
          <div><span>Still needed</span><span>${remaining}</span></div>
          <div><span>Capacity left</span><span>${remainingCapacityTotal}</span></div>
          <div><span>Pace</span><span>${pace.toFixed(1)}/hr (${paceSource === "actual" ? "from this week" : "target rate"})</span></div>
        </div>
        <div class="day-chips">${dayChips}</div>
      </div>
    `;
  });
  html += "</div>";

  container.innerHTML = html;
}

window.renderCurrentWeekFinish = function () {
  if (window._stairEntries && window._holidayIndex && window._today) {
    renderCurrentWeekFinish(window._stairEntries, window._holidayIndex, window._today);
  }
};
