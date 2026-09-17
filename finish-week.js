/**
 * This-week finish day prediction module.
 * Uses actual pace (stairs per hour) when available; falls back to capacity targets.
 * Privacy: team members only see their own person card;
 * SA (manager) and ADMIN role see all four. SF is a normal user.
 * Team-level predicted finish day is always visible.
 */
import { mondayOf, dayBucket, sameDay } from "./utils.js";
import { getCodeForPerson, targetFor, isAbsenceCode, statusLabel, hoursLostForCode } from "./data.js";
import { CONFIG } from "./config.js";

const PEOPLE = CONFIG.people;

/** Typical office start time used to estimate hours elapsed today. */
const WORK_START_HOUR = 8;
const WORK_START_MIN = 0;

function availableHours(initials, date, code) {
  const bucket = dayBucket(date);
  if (!bucket) return 0;
  const full = CONFIG.hours[initials]?.[bucket] ?? 0;
  const lost = hoursLostForCode(code, full);
  return Math.max(0, full - lost);
}

function hoursElapsedToday(initials, today, code) {
  const avail = availableHours(initials, today, code);
  if (avail <= 0) return 0;
  const now = new Date();
  if (!sameDay(now, today)) return avail;
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate(), WORK_START_HOUR, WORK_START_MIN);
  const elapsedMs = now - start;
  if (elapsedMs <= 0) return 0;
  return Math.min(avail, elapsedMs / 3600000);
}

function formatPace(pace) {
  if (pace == null || !isFinite(pace) || pace <= 0) return null;
  return pace.toFixed(1);
}

function formatTimeEstimate(hoursFromNow) {
  if (hoursFromNow == null || !isFinite(hoursFromNow) || hoursFromNow < 0) return null;
  const now = new Date();
  const finish = new Date(now.getTime() + hoursFromNow * 3600000);
  return finish.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

/** Manager SA (not in production PEOPLE list) + ADMIN role get full view. */
function isManagerViewer(userName, userEmail, userRole) {
  if ((userRole || "").toUpperCase() === "ADMIN") return true;
  const n = (userName || "").trim().toUpperCase();
  const e = (userEmail || "").trim().toLowerCase();
  if (n === "SA" || n.startsWith("SA ") || /\bSA\b/.test(n)) return true;
  if (n.includes("SIMON ASK")) return true;
  if (e.includes("simon.ask")) return true;
  return false;
}

function resolveViewer() {
  let userName = "";
  let userEmail = "";
  let userRole = "";
  try {
    userName = (localStorage.getItem("userName") || "").trim();
    userEmail = (localStorage.getItem("userEmail") || "").trim().toLowerCase();
    userRole = (localStorage.getItem("userRole") || "").trim().toUpperCase();
  } catch (_) { /* private mode etc. */ }

  const nameUpper = userName.toUpperCase();

  const matched = PEOPLE.find(p => {
    const full = (p.name || "").toUpperCase();
    const first = full.split(" ")[0];
    return full === nameUpper
      || nameUpper === first
      || full.startsWith(nameUpper)
      || nameUpper.startsWith(full)
      || (p.initials && nameUpper === p.initials.toUpperCase());
  }) || null;

  const canSeeAll = isManagerViewer(userName, userEmail, userRole);

  return {
    userName,
    userEmail,
    userRole,
    person: matched,
    initials: matched ? matched.initials : null,
    canSeeAll
  };
}

export function renderCurrentWeekFinish(stairEntries, holidayIndex, today) {
  const container = document.getElementById("currentWeekFinish");
  if (!container) return;

  const viewer = resolveViewer();

  const monday = mondayOf(today);
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  const todayStart = new Date(today);
  todayStart.setHours(0, 0, 0, 0);

  const days = [];
  for (let d = new Date(monday); d <= friday; d.setDate(d.getDate() + 1)) {
    const dCopy = new Date(d);
    if (!dayBucket(dCopy)) continue;
    days.push(dCopy);
  }

  const people = PEOPLE.filter(p => p.initials !== CONFIG.excludeFromKpiDisplay);
  const baseRate = CONFIG.baseRate;

  const personStats = people.map(person => {
    let weekTarget = 0;
    let actualSoFar = 0;
    let hoursWorkedSoFar = 0;
    const dayInfo = [];

    days.forEach(day => {
      const code = getCodeForPerson(holidayIndex, person.holidayName, day);
      const dayTarget = targetFor(person.initials, day, code);
      const dayHours = availableHours(person.initials, day, code);
      const dayActual = stairEntries
        .filter(e => e.initials === person.initials && sameDay(e.date, day))
        .reduce((s, e) => s + e.stairs, 0);

      weekTarget += dayTarget;

      const isPast = day < todayStart;
      const isToday = sameDay(day, todayStart);

      if (isPast) {
        actualSoFar += dayActual;
        hoursWorkedSoFar += dayHours;
      } else if (isToday) {
        actualSoFar += dayActual;
        hoursWorkedSoFar += hoursElapsedToday(person.initials, todayStart, code);
      }

      const remainingHoursToday = isToday
        ? Math.max(0, dayHours - hoursElapsedToday(person.initials, todayStart, code))
        : (isPast ? 0 : dayHours);

      dayInfo.push({
        date: new Date(day),
        target: dayTarget,
        actual: dayActual,
        hours: dayHours,
        remainingHours: isPast ? 0 : remainingHoursToday,
        code,
        isPast,
        isToday,
        remainingCapacity: isPast ? 0 : dayTarget,
        available: dayTarget > 0
      });
    });

    const remaining = Math.max(0, weekTarget - actualSoFar);

    let pace = null;
    let paceSource = "target";
    if (hoursWorkedSoFar >= 1 && actualSoFar > 0) {
      pace = actualSoFar / hoursWorkedSoFar;
      paceSource = "actual";
    } else if (hoursWorkedSoFar >= 0.5 && actualSoFar > 0) {
      const raw = actualSoFar / hoursWorkedSoFar;
      pace = 0.6 * raw + 0.4 * baseRate;
      paceSource = "blended";
    } else {
      pace = baseRate;
      paceSource = "target";
    }

    let left = remaining;
    let finishDay = null;
    let finishLabel = null;
    let finishTimeLabel = null;
    let hoursUntilFinish = null;

    if (remaining === 0) {
      finishLabel = "Already done";
    } else {
      for (const di of dayInfo) {
        if (di.isPast) continue;
        if (left <= 0) break;
        const hrs = di.remainingHours;
        if (hrs <= 0) continue;

        const expectedOut = pace * hrs;
        if (expectedOut <= 0) continue;

        if (left <= expectedOut) {
          const hrsNeeded = left / pace;
          if (!di.isToday) {
            let waitHrs = 0;
            for (const earlier of dayInfo) {
              if (earlier.isPast) continue;
              if (sameDay(earlier.date, di.date)) break;
              waitHrs += earlier.remainingHours;
            }
            hoursUntilFinish = waitHrs + hrsNeeded;
          } else {
            hoursUntilFinish = hrsNeeded;
          }

          finishDay = di.date;
          if (di.isToday) {
            const t = formatTimeEstimate(hrsNeeded);
            finishLabel = t ? `Today ~${t}` : "Today";
            finishTimeLabel = t;
          } else {
            finishLabel = di.date.toLocaleDateString("en-GB", {
              weekday: "long",
              day: "numeric",
              month: "short"
            });
          }
          left = 0;
          break;
        }

        left -= expectedOut;
      }

      if (left > 0) {
        finishLabel = "Won't hit target";
        finishDay = null;
      }
    }

    const remainingCapacityTotal = dayInfo
      .filter(di => !di.isPast)
      .reduce((s, di) => s + di.remainingCapacity, 0);

    const expectedRemainingOut = dayInfo
      .filter(di => !di.isPast)
      .reduce((s, di) => s + pace * di.remainingHours, 0);

    return {
      person,
      weekTarget,
      actualSoFar,
      remaining,
      remainingCapacityTotal,
      expectedRemainingOut,
      finishDay,
      finishLabel,
      finishTimeLabel,
      hoursUntilFinish,
      dayInfo,
      fullyOff: weekTarget === 0,
      pace,
      paceSource,
      hoursWorkedSoFar
    };
  });

  let teamRemaining = personStats.reduce((s, p) => s + p.remaining, 0);
  let teamFinishDay = null;
  let teamFinishLabel = "Already done";

  if (teamRemaining > 0) {
    const remainingDays = days.filter(d => d >= todayStart);
    let left = teamRemaining;
    for (const day of remainingDays) {
      let dayExpected = 0;
      let dayRemainingHrsTeam = 0;
      personStats.forEach(ps => {
        const di = ps.dayInfo.find(x => sameDay(x.date, day));
        if (!di || di.remainingHours <= 0) return;
        dayExpected += ps.pace * di.remainingHours;
        dayRemainingHrsTeam += di.remainingHours;
      });

      if (dayExpected <= 0) continue;

      if (left <= dayExpected) {
        teamFinishDay = day;
        const isToday = sameDay(day, todayStart);
        if (isToday && dayRemainingHrsTeam > 0) {
          const teamRate = dayExpected / dayRemainingHrsTeam;
          const hrsNeeded = teamRate > 0 ? left / teamRate : 0;
          const t = formatTimeEstimate(hrsNeeded);
          teamFinishLabel = t ? `Today ~${t}` : "Today";
        } else {
          teamFinishLabel = isToday
            ? "Today"
            : day.toLocaleDateString("en-GB", {
                weekday: "long",
                day: "numeric",
                month: "short"
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
  const headlineClass = teamRemaining === 0 ? "ok" : (teamFinishDay ? "ok" : "danger");

  const anyoneUsingPace = personStats.some(p => p.paceSource === "actual" || p.paceSource === "blended");

  const visibleStats = viewer.canSeeAll
    ? personStats
    : personStats.filter(ps => viewer.initials && ps.person.initials === viewer.initials);

  let html = `
    <div class="finish-summary">
      <div class="finish-headline ${headlineClass}">
        ${teamRemaining === 0
          ? "🎯 Week targets already met"
          : (teamFinishDay
              ? `📅 Predicted finish: ${teamFinishLabel}`
              : "⚠️ Short of capacity this week")}
      </div>
      <div class="finish-meta">
        Team done <strong>${teamActual}</strong> of <strong>${teamWeekTarget}</strong>
        · Remaining <strong>${teamRemaining}</strong>
        · Capacity left <strong>${teamRemCap}</strong>
        · At current pace ~<strong>${Math.round(teamExpectedOut)}</strong> more possible
        ${anyoneUsingPace ? " · <em>using actual pace</em>" : " · <em>using target rate (limited data yet)</em>"}
      </div>
    </div>
  `;

  if (visibleStats.length === 0) {
    html += `
      <div class="finish-privacy-note">
        Individual figures are only shown for your own login.
        ${viewer.userName ? "Logged in as <strong>" + viewer.userName + "</strong> — name not matched to a team member." : "Could not detect who is logged in."}
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
  visibleStats.forEach(ps => {
    const {
      person, weekTarget, actualSoFar, remaining, finishLabel, dayInfo,
      fullyOff, remainingCapacityTotal, pace, paceSource
    } = ps;

    let badgeClass = "friday";
    let badgeText = finishLabel;
    if (fullyOff) { badgeClass = "off"; badgeText = "Off this week"; }
    else if (remaining === 0) { badgeClass = "done"; badgeText = "✅ Done"; }
    else if (finishLabel && finishLabel.startsWith("Today")) { badgeClass = "today"; badgeText = finishLabel; }
    else if (finishLabel === "Won't hit target") { badgeClass = "short"; badgeText = "Short"; }

    const dayChips = dayInfo.map(di => {
      const dayName = di.date.toLocaleDateString("en-GB", { weekday: "short" });
      let cls = "available";
      let tip = `${di.target} target`;
      if (di.code && isAbsenceCode(di.code)) {
        cls = "off";
        tip = statusLabel(di.code) || di.code;
      } else if (di.target > 0 && di.target < targetFor(person.initials, di.date, "")) {
        cls = "partial";
        tip = `${di.code || "partial"}: ${di.target}`;
      } else if (di.target === 0) {
        cls = "off";
        tip = "No capacity";
      }
      return `<span class="fp-day-chip ${cls}" title="${tip}">${dayName}${di.isToday ? "*" : ""}</span>`;
    }).join("");

    const paceStr = formatPace(pace);
    const paceNote =
      paceSource === "actual" ? "from this week"
        : paceSource === "blended" ? "blended (early data)"
        : "target rate";

    html += `
      <div class="finish-person-card">
        <div class="fp-header">
          <span class="fp-name"><span class="dot" style="background:${person.color};"></span>${person.initials} · ${person.name.split(" ")[0]}</span>
          <span class="fp-badge ${badgeClass}">${badgeText}</span>
        </div>
        <div class="fp-row"><span>Week target</span><span class="val">${weekTarget}</span></div>
        <div class="fp-row"><span>Done so far</span><span class="val">${actualSoFar}</span></div>
        <div class="fp-row"><span>Still needed</span><span class="val">${remaining}</span></div>
        <div class="fp-row"><span>Capacity left</span><span class="val">${remainingCapacityTotal}</span></div>
        <div class="fp-row fp-pace"><span>Pace</span><span class="val">${paceStr ? paceStr + "/hr" : "—"} <span class="pace-note">(${paceNote})</span></span></div>
        <div class="fp-days">${dayChips}</div>
      </div>
    `;
  });
  html += "</div>";

  const remainingDays = days.filter(d => d >= todayStart);
  if (viewer.canSeeAll && remainingDays.length > 0 && teamRemaining > 0) {
    let running = teamRemaining;
    html += `
      <div class="finish-day-timeline">
        <table>
          <thead>
            <tr>
              <th>Day</th>
              <th>Expected (pace)</th>
              <th>Capacity</th>
              <th>Remaining after</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
    `;
    remainingDays.forEach(day => {
      let dayCap = 0;
      let dayExpected = 0;
      personStats.forEach(ps => {
        const di = ps.dayInfo.find(x => sameDay(x.date, day));
        if (!di) return;
        dayCap += di.remainingCapacity;
        dayExpected += ps.pace * di.remainingHours;
      });
      dayExpected = Math.round(dayExpected);
      const before = running;
      running = Math.max(0, running - dayExpected);
      const isFinish = before > 0 && running === 0;
      const dayName = day.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" });
      const todayMark = sameDay(day, todayStart) ? " (today)" : "";
      html += `
        <tr class="${isFinish ? "finish-row" : ""}">
          <td class="day-label">${dayName}${todayMark}</td>
          <td class="cap-cell">${dayExpected}</td>
          <td class="cap-cell">${dayCap}</td>
          <td class="rem-cell">${running}</td>
          <td>${isFinish ? "🏁 Finish" : (running === 0 ? "—" : "")}</td>
        </tr>
      `;
    });
    html += "</tbody></table></div>";
  }

  container.innerHTML = html;
}

window.renderCurrentWeekFinish = renderCurrentWeekFinish;
