/**
 * Forecast — back to basics
 *
 * For each upcoming week:
 *   - What can the team produce? (each person's daily target, Mon–Fri)
 *   - Who is off, and by how much does that cut capacity?
 *   - Optional guide: compare to defaultWeeklyStairs (usual weekly load)
 *
 * No delivery-date lag, no load totals, no mid-week trimming.
 */
import { CONFIG } from "./config.js";
import { mondayOf, dayBucket, fmtDateShort } from "./utils.js";
import { getCodeForPerson, isAbsenceCode, targetFor, statusLabel } from "./data.js";

const PEOPLE = CONFIG.people.filter(function (p) {
  return p.initials !== CONFIG.excludeFromKpiDisplay;
});

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = String(s);
  return d.innerHTML;
}

/** Full Mon–Fri capacity for one person in a week, with holiday days listed. */
function weekCapacityForPerson(person, weekStart, holidayIndex) {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 4);

  let capacity = 0;
  let fullCapacity = 0;
  const offDays = [];

  for (let d = new Date(weekStart); d <= weekEnd; d.setDate(d.getDate() + 1)) {
    const dCopy = new Date(d);
    if (!dayBucket(dCopy)) continue;

    // Target with no absence code = what they can do if in
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
      // half-days still keep partial target via targetFor
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

function getWarningLevel(capacity, guide) {
  if (!guide || guide <= 0) return { level: "ok", label: "✅ OK", className: "ok" };
  const gap = capacity - guide;
  if (gap <= -80) return { level: "danger", label: "🔴 Tight", className: "danger" };
  if (gap <= -30) return { level: "warning", label: "🟡 Watch", className: "warning" };
  return { level: "ok", label: "✅ OK", className: "ok" };
}

export function renderEnhancedForecast(forecastEntries, holidayIndex, today) {
  const container = document.getElementById("forecastWeeks");
  if (!container || !holidayIndex || !today) return;

  const guide = Math.round(Number(CONFIG.defaultWeeklyStairs) || 0);
  const startMonday = mondayOf(today);
  const numWeeks = CONFIG.forecastWeeks || 8;

  let hasWarning = false;

  const cards = [];
  for (let i = 0; i < numWeeks; i++) {
    const wStart = new Date(startMonday);
    wStart.setDate(wStart.getDate() + 7 * i);
    const wEnd = new Date(wStart);
    wEnd.setDate(wStart.getDate() + 4); // Fri

    let totalCapacity = 0;
    let totalFull = 0;
    const perPerson = [];
    const absences = [];

    PEOPLE.forEach(function (person) {
      const cap = weekCapacityForPerson(person, wStart, holidayIndex);
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
    const warning = getWarningLevel(totalCapacity, guide);
    if (warning.level === "danger" || warning.level === "warning") hasWarning = true;

    const headLabel = i === 0 ? "This week" : ("W/C " + fmtDateShort(wStart));
    const whoLine = perPerson.map(function (p) { return p.initials + " " + p.capacity; }).join(" · ");

    let absenceHtml = "";
    if (absences.length > 0) {
      absenceHtml = '<div class="holiday-impact" style="margin-top:10px;font-size:0.8rem;">';
      absenceHtml += "<strong>Who is off</strong><div style=\"margin-top:6px;display:flex;flex-wrap:wrap;gap:6px;\">";
      absences.forEach(function (a) {
        const days = a.offDays.map(function (o) {
          return fmtDateShort(o.date) + " (" + (o.label || o.code) + ")";
        }).join(", ");
        absenceHtml +=
          '<span class="chip" style="background:rgba(0,0,0,0.06);padding:4px 8px;border-radius:8px;">' +
          '<span class="dot" style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' +
          a.person.color + ';margin-right:6px;"></span>' +
          escapeHtml(a.person.initials) + ": " + escapeHtml(days) +
          " · left with " + a.capacity +
          "</span>";
      });
      absenceHtml += "</div></div>";
    } else {
      absenceHtml =
        '<div style="margin-top:10px;font-size:0.8rem;color:var(--muted);">Everyone in — full capacity</div>';
    }

    let guideLine = "";
    if (guide > 0) {
      const gap = totalCapacity - guide;
      guideLine =
        '<div class="fw-row" style="display:flex;justify-content:space-between;gap:12px;margin:6px 0;border-top:1px solid var(--card-border);padding-top:8px;">' +
          "<span>Vs usual week (" + guide + ")</span>" +
          "<span class=\"val\"><strong>" +
          (gap >= 0 ? ("+" + gap + " spare") : (Math.abs(gap) + " short")) +
          "</strong></span>" +
        "</div>";
    }

    cards.push(
      '<div class="forecast-week-card ' + warning.className + '">' +
        '<div class="fw-header" style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;">' +
          '<div class="fw-title" style="font-weight:700;">' + headLabel +
            ' <span style="font-weight:400;color:var(--muted);font-size:0.8rem;">(' +
            fmtDateShort(wStart) + " – " + fmtDateShort(wEnd) + ")</span></div>" +
          '<div class="fw-badge ' + warning.className + '">' + warning.label + '</div>' +
        '</div>' +
        '<div class="fw-row" style="display:flex;justify-content:space-between;gap:12px;margin:4px 0;">' +
          "<span><strong>Team capacity</strong></span>" +
          "<span class=\"val\"><strong>" + totalCapacity + "</strong> stairs" +
          (lost > 0
            ? " <span style=\"color:var(--muted);font-weight:400\">(−" + lost + " from absences)</span>"
            : "") +
          "</span>" +
        "</div>" +
        '<div style="font-size:0.78rem;color:var(--muted);margin:4px 0 2px;">' +
          escapeHtml(whoLine) +
        "</div>" +
        guideLine +
        absenceHtml +
      "</div>"
    );
  }

  const note =
    '<div class="forecast-note" style="margin-bottom:12px;line-height:1.5;">' +
      "<strong>Simple view:</strong> each week shows what the team can produce " +
      "(from daily rates) after holidays. " +
      (guide
        ? "Usual weekly load is set at <strong>" + guide + "</strong> stairs — change defaultWeeklyStairs in config if needed."
        : "") +
    "</div>";

  container.innerHTML = note + '<div class="forecast-week-grid-inner">' + cards.join("") + "</div>";

  const tileBadge = document.getElementById("tileForecastBadge");
  if (tileBadge) {
    if (hasWarning) {
      tileBadge.style.display = "";
      tileBadge.textContent = "!";
      tileBadge.className = "tile-badge danger";
    } else {
      tileBadge.style.display = "none";
    }
  }

  updateLookaheadBanner(startMonday, holidayIndex, guide);
}

function updateLookaheadBanner(startMonday, holidayIndex, guide) {
  const container = document.getElementById("lookaheadBanner");
  if (!container) return;

  // Next calendar week (not this week)
  const nextStart = new Date(startMonday);
  nextStart.setDate(nextStart.getDate() + 7);

  let capacity = 0;
  let full = 0;
  const offNames = [];
  PEOPLE.forEach(function (person) {
    const cap = weekCapacityForPerson(person, nextStart, holidayIndex);
    capacity += cap.capacity;
    full += cap.fullCapacity;
    if (cap.offDays.length > 0) {
      offNames.push(person.initials);
    }
  });

  const lost = full - capacity;
  let msg;
  let short = false;
  if (guide > 0) {
    const gap = capacity - guide;
    short = gap < 0;
    msg =
      "Next week capacity " + capacity +
      (lost > 0 ? " (−" + lost + " absences" + (offNames.length ? ": " + offNames.join(", ") : "") + ")" : "") +
      " · usual " + guide + " → " +
      (short ? Math.abs(gap) + " short" : "+" + gap + " spare");
  } else {
    msg =
      "Next week capacity " + capacity +
      (lost > 0 ? " (−" + lost + " from absences)" : " (full team)");
  }

  const color = short ? "var(--red)" : "var(--green)";
  const bg = short ? "rgba(231,76,60,0.08)" : "rgba(46,204,113,0.08)";

  container.innerHTML =
    '<div style="background:' + bg + ";border:1px solid " + color +
    ';border-radius:10px;padding:10px 16px;margin-bottom:16px;text-align:center;' +
    'font-size:0.85rem;font-weight:600;color:' + color + ';">' + escapeHtml(msg) + "</div>";
}

window.renderEnhancedForecast = function () {
  if (window._holidayIndex && window._today) {
    renderEnhancedForecast(window._forecastEntries || [], window._holidayIndex, window._today);
  }
};
