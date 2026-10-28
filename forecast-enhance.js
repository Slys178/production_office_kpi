/**
 * Forecast — capacity week vs demand week (+1)
 *
 * You produce next week’s stairs during the current week:
 *   Work week W (who is in / off)  →  capacity
 *   Demand week W+1 (stairs due)   →  demand
 *
 * Demand = sum of load stairs with delivery in demand week,
 * or CONFIG.defaultWeeklyStairs when none entered yet.
 */
import { CONFIG } from "./config.js";
import { mondayOf, dayBucket, fmtDateShort } from "./utils.js";
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

function getWarningLevel(capacity, demand) {
  if (!demand || demand <= 0) return { level: "ok", label: "OK", className: "ok" };
  const gap = capacity - demand;
  if (gap < 0) return { level: "danger", label: Math.abs(gap) + " short", className: "danger" };
  if (gap < demand * 0.1) return { level: "warning", label: "Tight", className: "warning" };
  return { level: "ok", label: "+" + gap + " spare", className: "ok" };
}

function stairsForDemandWeek(entries, demandMonday) {
  const start = new Date(demandMonday);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);

  let total = 0;
  let count = 0;
  (entries || []).forEach(function (e) {
    const d = e.deliveryDate || e.date;
    if (!d) return;
    const t = d instanceof Date ? d : new Date(d);
    if (isNaN(t.getTime())) return;
    if (t >= start && t < end) {
      const n = Number(e.stairs) || 0;
      if (n > 0) {
        total += n;
        count += 1;
      }
    }
  });
  return { total: Math.round(total), count: count };
}

function demandForWorkWeek(forecastEntries, stairEntries, workMonday) {
  const demandMonday = new Date(workMonday);
  demandMonday.setDate(demandMonday.getDate() + 7);

  const all = [].concat(forecastEntries || [], stairEntries || []);
  const fromLoads = stairsForDemandWeek(all, demandMonday);
  const fallback = Math.round(Number(CONFIG.defaultWeeklyStairs) || 0);

  if (fromLoads.total > 0) {
    return {
      stairs: fromLoads.total,
      source: "loads",
      loadCount: fromLoads.count,
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
      i === 0 ? "This work week" : "Work W/C " + fmtDateShort(workStart);

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
        ? "Stairs due W/C " + fmtDateShort(demandStart) + " (" + demand.loadCount + " loads)"
        : demand.source === "default"
          ? "Stairs due W/C " + fmtDateShort(demandStart) + " (default " + demandStairs + ")"
          : "Stairs due W/C " + fmtDateShort(demandStart);

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
        "Producing for <strong>W/C " +
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

  const note =
    '<div class="forecast-note" style="margin-bottom:12px;line-height:1.5;">' +
    "<strong>How this works:</strong> capacity is who is in during the <em>work week</em>. " +
    "Demand is stairs for the <em>following week</em> (what you produce in the work week). " +
    "If no loads are entered for that demand week, the default (" +
    (CONFIG.defaultWeeklyStairs || 0) +
    ") is used.</div>";

  container.innerHTML = note + cards.join("");

  renderLookaheadBanner(startMonday, holidayIndex, forecastEntries, stairEntries);

  const flag = document.getElementById("forecastWarningFlag");
  if (flag) flag.style.display = hasWarning ? "" : "none";
}

function renderLookaheadBanner(startMonday, holidayIndex, forecastEntries, stairEntries) {
  const container = document.getElementById("lookaheadBanner");
  if (!container) return;

  const workStart = new Date(startMonday);
  const PEOPLE = peopleForWeek(workStart);

  let capacity = 0;
  let full = 0;
  const offNames = [];
  PEOPLE.forEach(function (person) {
    const cap = weekCapacityForPerson(person, workStart, holidayIndex);
    capacity += cap.capacity;
    full += cap.fullCapacity;
    if (cap.offDays.length > 0) offNames.push(person.initials);
  });

  const demand = demandForWorkWeek(forecastEntries, stairEntries, workStart);
  const lost = full - capacity;
  const gap = capacity - demand.stairs;
  const short = demand.stairs > 0 && gap < 0;

  const msg =
    "This work week capacity " +
    capacity +
    (lost > 0
      ? " (−" + lost + " absences" + (offNames.length ? ": " + offNames.join(", ") : "") + ")"
      : "") +
    " · demand W/C " +
    fmtDateShort(demand.demandMonday) +
    " = " +
    demand.stairs +
    (demand.source === "default" ? " (default)" : "") +
    " → " +
    (demand.stairs <= 0
      ? "no demand set"
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
