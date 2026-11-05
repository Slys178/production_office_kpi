/**
 * Forecast — capacity week vs demand week (+1)
 *
 * You produce next week’s stairs during the current week:
 *   Work week W (who is in / off)  →  capacity
 *   Demand week W+1 (stairs due)   →  demand
 *
 * Demand = sum of OPEN load stairs (no green tick) with delivery in demand week,
 * or CONFIG.defaultWeeklyStairs when none entered yet.
 */
import { CONFIG } from "./config.js";
import { mondayOf, dayBucket, fmtDateShort, sameDay } from "./utils.js";
import { getCodeForPerson, isAbsenceCode, targetFor, statusLabel } from "./data.js";

function parseYMD(str) {
  if (!str) return null;
  const m = String(str).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
}

function peopleForWeek(weekStart) {
  const lastMap = CONFIG.temporaryHelperLastWeek || {};
  const weekMs = weekStart.getTime();

  return CONFIG.people.filter(function (p) {
    if (p.initials === CONFIG.excludeFromKpiDisplay) return false;
    const lastStr = lastMap[p.initials];
    if (!lastStr) return true;
    const last = parseYMD(lastStr);
    if (!last) return true;
    return weekMs <= last.getTime();
  });
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = String(s);
  return d.innerHTML;
}

function weekCapacityForPerson(person, weekStart, holidayIndex) {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 4);

  let capacity = 0;
  let fullCapacity = 0;
  const offDays = [];

  for (let d = new Date(weekStart); d <= weekEnd; d.setDate(d.getDate() + 1)) {
    const dCopy = new Date(d);
    if (!dayBucket(dCopy)) continue;

    const fullDay = targetFor(person.initials, dCopy, "");
    fullCapacity += fullDay;

    const code = getCodeForPerson(holidayIndex, person.holidayName, dCopy);
    if (isAbsenceCode(code)) {
      offDays.push({
        date: new Date(dCopy),
        code: code,
        label: statusLabel(code) || code,
        lost: fullDay,
      });
      capacity += targetFor(person.initials, dCopy, code);
    } else {
      capacity += targetFor(person.initials, dCopy, code);
    }
  }

  return {
    capacity: Math.round(capacity),
    fullCapacity: Math.round(fullCapacity),
    offDays: offDays,
  };
}

/** Capacity still available from today through Fri of this work week (not full Mon–Fri). */
function remainingCapacityThisWeek(person, weekStart, holidayIndex, today) {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 4);
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  let capacity = 0;
  let fullCapacity = 0;
  const offDays = [];

  for (let d = new Date(weekStart); d <= weekEnd; d.setDate(d.getDate() + 1)) {
    const dCopy = new Date(d);
    if (!dayBucket(dCopy)) continue;
    if (dCopy < todayStart) continue;

    const fullDay = targetFor(person.initials, dCopy, "");
    fullCapacity += fullDay;

    const code = getCodeForPerson(holidayIndex, person.holidayName, dCopy);
    if (isAbsenceCode(code)) {
      offDays.push({
        date: new Date(dCopy),
        code: code,
        label: statusLabel(code) || code,
        lost: fullDay,
      });
    }
    capacity += targetFor(person.initials, dCopy, code);
  }

  return {
    capacity: Math.round(capacity),
    fullCapacity: Math.round(fullCapacity),
    offDays: offDays,
  };
}

function getWarningLevel(capacity, demand) {
  if (!demand || demand <= 0) return { level: "ok", label: "OK", className: "ok" };
  const gap = capacity - demand;
  if (gap < 0) return { level: "danger", label: Math.abs(gap) + " short", className: "danger" };
  if (gap < demand * 0.1) return { level: "warning", label: "Tight", className: "warning" };
  return { level: "ok", label: "+" + gap + " spare", className: "ok" };
}

function toDayDate(d) {
  if (!d) return null;
  if (d instanceof Date && !isNaN(d.getTime())) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  const s = String(d).trim();
  const gviz = /^Date\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(s);
  if (gviz) {
    return new Date(+gviz[1], +gviz[2], +gviz[3]);
  }
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

function stairsForDemandWeek(entries, demandMonday) {
  const start = toDayDate(demandMonday);
  if (!start) return { total: 0, count: 0 };
  const end = new Date(start);
  end.setDate(end.getDate() + 7);

  let total = 0;
  let count = 0;
  (entries || []).forEach(function (e) {
    if (e.isCompleted === true) return;
    const d = toDayDate(e.deliveryDate || e.date);
    if (!d) return;
    if (d >= start && d < end) {
      const n = Number(e.stairs) || 0;
      if (n > 0) {
        total += n;
        count += 1;
      }
    }
  });
  return { total: Math.round(total), count: count };
}

/** Loads for a delivery week that are already ticked complete (these drop out of the open list). */
function tickedLoadsForWeek(forecastEntries, stairEntries, demandMonday) {
  const start = toDayDate(demandMonday);
  if (!start) return 0;
  const end = new Date(start);
  end.setDate(end.getDate() + 7);

  let count = 0;
  const check = function (e) {
    const d = toDayDate(e.deliveryDate);
    if (!d || d < start || d >= end) return;
    if ((Number(e.stairs) || 0) > 0) count += 1;
  };
  (forecastEntries || []).forEach(function (e) {
    if (e.isCompleted === true) check(e);
  });
  (stairEntries || []).forEach(check);
  return count;
}

function demandForWorkWeek(forecastEntries, stairEntries, workMonday) {
  const demandMonday = new Date(workMonday);
  demandMonday.setDate(demandMonday.getDate() + 7);
  demandMonday.setHours(0, 0, 0, 0);

  const open = [].concat(forecastEntries || []);
  const fromLoads = stairsForDemandWeek(open, demandMonday);
  const fallback = Math.round(Number(CONFIG.defaultWeeklyStairs) || 0);

  if (fromLoads.total > 0) {
    return {
      stairs: fromLoads.total,
      source: "loads",
      loadCount: fromLoads.count,
      demandMonday: demandMonday,
    };
  }

  // Loads exist for that week but every one is ticked -> week is finished, not "no loads entered"
  const ticked = tickedLoadsForWeek(forecastEntries, stairEntries, demandMonday);
  if (ticked > 0) {
    return {
      stairs: 0,
      source: "done",
      loadCount: ticked,
      demandMonday: demandMonday,
    };
  }
  return {
    stairs: fallback,
    source: fallback > 0 ? "default" : "none",
    loadCount: 0,
    demandMonday: demandMonday,
  };
}

export function renderEnhancedForecast(forecastEntries, holidayIndex, today) {
  const container = document.getElementById("forecastWeeks");
  if (!container || !holidayIndex || !today) return;

  const startMonday = mondayOf(today);
  const numWeeks = CONFIG.forecastWeeks || 8;
  const stairEntries = window._stairEntries || [];

  let hasWarning = false;
  const cards = [];

  for (let i = 0; i < numWeeks; i++) {
    const workStart = new Date(startMonday);
    workStart.setDate(workStart.getDate() + 7 * i);
    const workEnd = new Date(workStart);
    workEnd.setDate(workStart.getDate() + 4);

    const demand = demandForWorkWeek(forecastEntries, stairEntries, workStart);
    const demandStart = demand.demandMonday;
    const demandEnd = new Date(demandStart);
    demandEnd.setDate(demandStart.getDate() + 4);

    const PEOPLE = peopleForWeek(workStart);

    let totalCapacity = 0;
    let totalFull = 0;
    const perPerson = [];
    const absences = [];

    PEOPLE.forEach(function (person) {
      const cap = weekCapacityForPerson(person, workStart, holidayIndex);
      totalCapacity += cap.capacity;
      totalFull += cap.fullCapacity;
      perPerson.push({
        initials: person.initials,
        capacity: cap.capacity,
        full: cap.fullCapacity,
        color: person.color,
      });
      if (cap.offDays.length > 0) {
        absences.push({ person: person, offDays: cap.offDays, capacity: cap.capacity });
      }
    });

    const lost = totalFull - totalCapacity;
    const demandStairs = demand.stairs;
    const warning = getWarningLevel(totalCapacity, demandStairs);
    if (warning.level === "danger" || warning.level === "warning") hasWarning = true;

    const headLabel =
      i === 0
        ? "This work week · W/C " + fmtDateShort(workStart)
        : "Work week · W/C " + fmtDateShort(workStart);

    const whoLine = perPerson
      .map(function (p) {
        return p.initials + " " + p.capacity;
      })
      .join(" · ");

    let absenceHtml = "";
    if (absences.length > 0) {
      absenceHtml =
        '<div class="holiday-impact" style="margin-top:10px;font-size:0.8rem;">' +
        "<strong>Who is off (work week)</strong>" +
        '<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:6px;">';
      absences.forEach(function (a) {
        const days = a.offDays
          .map(function (o) {
            return fmtDateShort(o.date) + " (" + (o.label || o.code) + ")";
          })
          .join(", ");
        absenceHtml +=
          '<span class="chip" style="background:rgba(0,0,0,0.06);padding:4px 8px;border-radius:8px;">' +
          '<span class="dot" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' +
          a.person.color +
          ';margin-right:6px;"></span>' +
          escapeHtml(a.person.initials) +
          ": " +
          escapeHtml(days) +
          " · left with " +
          a.capacity +
          "</span>";
      });
      absenceHtml += "</div></div>";
    }

    let tempNote = "";
    Object.keys(CONFIG.temporaryHelperLastWeek || {}).forEach(function (init) {
      const last = parseYMD(CONFIG.temporaryHelperLastWeek[init]);
      if (!last) return;
      const after = new Date(last);
      after.setDate(after.getDate() + 7);
      if (workStart.getTime() === after.getTime()) {
        tempNote =
          '<div style="margin-top:8px;font-size:0.75rem;color:var(--muted);">' +
          escapeHtml(init) +
          " finished — no longer in capacity</div>";
      }
    });

    const gap = totalCapacity - demandStairs;
    let demandLabel =
      demand.source === "loads"
        ? "Open loads · delivery W/C " + fmtDateShort(demandStart) + " (" + demand.loadCount + " loads)"
        : demand.source === "default"
          ? "No open loads found for delivery W/C " + fmtDateShort(demandStart) + " — using default"
          : demand.source === "done"
            ? "All " + demand.loadCount + " loads for delivery W/C " + fmtDateShort(demandStart) + " ticked complete ✓"
            : "Delivery W/C " + fmtDateShort(demandStart);

    let demandLine =
      '<div class="fw-row" style="display:flex;justify-content:space-between;gap:12px;margin:6px 0;border-top:1px solid var(--card-border);padding-top:8px;">' +
      "<span><strong>Demand</strong> <span style=\"color:var(--muted);font-weight:400;font-size:0.78rem\">" +
      escapeHtml(demandLabel) +
      "</span></span>" +
      '<span class="val"><strong>' +
      demandStairs +
      "</strong> stairs</span></div>";

    let resultLine =
      '<div class="fw-row" style="display:flex;justify-content:space-between;gap:12px;margin:4px 0;">' +
      "<span>Result</span>" +
      '<span class="val"><strong>' +
      totalCapacity +
      " − " +
      demandStairs +
      " = " +
      (gap >= 0 ? "+" + gap + " spare" : Math.abs(gap) + " short") +
      "</strong></span></div>";

    cards.push(
      '<div class="forecast-week-card ' +
        warning.className +
        '">' +
        '<div class="fw-header" style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;">' +
        '<div class="fw-title" style="font-weight:700;">' +
        headLabel +
        ' <span style="font-weight:400;color:var(--muted);font-size:0.8rem;">(' +
        fmtDateShort(workStart) +
        " – " +
        fmtDateShort(workEnd) +
        ")</span></div>" +
        '<div class="fw-badge ' +
        warning.className +
        '">' +
        warning.label +
        "</div></div>" +
        '<div style="font-size:0.78rem;color:var(--muted);margin-bottom:6px;">' +
        "Producing for <strong>delivery W/C " +
        fmtDateShort(demandStart) +
        "</strong> (" +
        fmtDateShort(demandStart) +
        " – " +
        fmtDateShort(demandEnd) +
        ")</div>" +
        '<div class="fw-row" style="display:flex;justify-content:space-between;gap:12px;margin:4px 0;">' +
        "<span><strong>Team capacity</strong> <span style=\"color:var(--muted);font-weight:400;font-size:0.78rem\">(work week)</span></span>" +
        '<span class="val"><strong>' +
        totalCapacity +
        "</strong> stairs" +
        (lost > 0
          ? ' <span style="color:var(--muted);font-weight:400">(−' + lost + " from absences)</span>"
          : "") +
        "</span></div>" +
        '<div style="font-size:0.78rem;color:var(--muted);margin:4px 0 2px;">' +
        escapeHtml(whoLine) +
        "</div>" +
        demandLine +
        resultLine +
        absenceHtml +
        tempNote +
        "</div>"
    );
  }

  const demandExample = new Date(startMonday.getFullYear(), startMonday.getMonth(), startMonday.getDate() + 7);
  const note =
    '<div class="forecast-note" style="margin-bottom:12px;line-height:1.5;">' +
    "<strong>How this works:</strong> each card is a <em>work week</em> (W/C shown). " +
    "You produce stairs for the <em>next</em> week — demand is open loads (no green tick) with delivery in that W/C. " +
    "Example: this work week produces for <strong>delivery W/C " +
    fmtDateShort(demandExample) +
    "</strong>. " +
    "If no loads are entered for a demand week, default (" +
    (CONFIG.defaultWeeklyStairs || 0) +
    ") is used. If every load for that week is ticked, it counts as complete (0 demand).</div>";

  container.innerHTML = note + cards.join("");

  renderLookaheadBanner(startMonday, holidayIndex, forecastEntries, stairEntries);

  const flag = document.getElementById("forecastWarningFlag");
  if (flag) flag.style.display = hasWarning ? "" : "none";
}

function renderLookaheadBanner(startMonday, holidayIndex, forecastEntries, stairEntries) {
  const container = document.getElementById("lookaheadBanner");
  if (!container) return;

  const workStart = new Date(startMonday);
  const today = window._today || new Date();
  const PEOPLE = peopleForWeek(workStart);

  // Capacity LEFT (today→Fri), not the whole week Mon–Fri
  let capacity = 0;
  let full = 0;
  const offNames = [];
  PEOPLE.forEach(function (person) {
    const cap = remainingCapacityThisWeek(person, workStart, holidayIndex, today);
    capacity += cap.capacity;
    full += cap.fullCapacity;
    if (cap.offDays.length > 0) offNames.push(person.initials);
  });

  // Skip delivery weeks where every load is already ticked; roll on to the next unfinished week.
  // Capacity then includes the work weeks in between (they can work ahead).
  const maxSkip = CONFIG.forecastWeeks || 8;
  let demand = demandForWorkWeek(forecastEntries, stairEntries, workStart);
  const doneWeeks = [];
  let extraCapacity = 0;
  const extraWeeks = [];
  for (let k = 1; k <= maxSkip && demand.source === "done"; k++) {
    doneWeeks.push(demand.demandMonday);
    const nextWork = new Date(workStart);
    nextWork.setDate(nextWork.getDate() + 7 * k);
    nextWork.setHours(0, 0, 0, 0);
    peopleForWeek(nextWork).forEach(function (person) {
      const cap = weekCapacityForPerson(person, nextWork, holidayIndex);
      extraCapacity += cap.capacity;
      full += cap.fullCapacity;
      if (cap.offDays.length > 0 && offNames.indexOf(person.initials) < 0) offNames.push(person.initials);
    });
    extraWeeks.push(nextWork);
    demand = demandForWorkWeek(forecastEntries, stairEntries, nextWork);
  }
  const thisWeekCapacity = capacity;
  capacity += extraCapacity;

  const lost = full - capacity;
  const gap = capacity - demand.stairs;
  const short = demand.stairs > 0 && gap < 0;

  const doneNote = doneWeeks.length
    ? "Delivery W/C " + doneWeeks.map(fmtDateShort).join(", ") + " complete ✓ · "
    : "";

  const capLabel = extraWeeks.length
    ? "Capacity left (this week from today + W/C " + extraWeeks.map(fmtDateShort).join(", ") + ") " +
      thisWeekCapacity + " + " + extraCapacity + " = " + capacity
    : "Capacity left this week (W/C " + fmtDateShort(workStart) + ", from today) " + capacity;

  const msg =
    doneNote +
    capLabel +
    (offNames.length
      ? " (− absences: " + offNames.join(", ") + ")"
      : "") +
    " · open demand delivery W/C " +
    fmtDateShort(demand.demandMonday) +
    " = " +
    demand.stairs +
    (demand.source === "default" ? " (default)" : demand.source === "loads" ? " (" + demand.loadCount + " open loads)" : "") +
    " → " +
    (demand.stairs <= 0
      ? (demand.source === "done" ? "all loads complete" : "no demand set")
      : short
        ? Math.abs(gap) + " short"
        : "+" + gap + " spare");

  const color = short ? "var(--red)" : "var(--green)";
  const bg = short ? "rgba(231,76,60,0.08)" : "rgba(46,204,113,0.08)";

  container.innerHTML =
    '<div style="background:' +
    bg +
    ";border:1px solid " +
    color +
    ';border-radius:10px;padding:10px 16px;margin-bottom:16px;text-align:center;' +
    "font-size:0.85rem;font-weight:600;color:" +
    color +
    ';">' +
    escapeHtml(msg) +
    "</div>";
}

window.renderEnhancedForecast = function () {
  if (window._holidayIndex && window._today) {
    renderEnhancedForecast(
      window._forecastEntries || [],
      window._holidayIndex,
      window._today
    );
  }
};
