/**
 * Office Errors — person cards, click-through breakdown, 1:1 follow-up ticks.
 * 1:1 status is stored in localStorage on this browser (manager device).
 */
import { CONFIG } from "./config.js";
import { fmtDate } from "./utils.js";

const STORAGE_KEY = "officeErrorOneToOnes";

function loadOneToOnes() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") || {};
  } catch (_) {
    return {};
  }
}

function saveOneToOnes(map) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch (_) {}
}

function errorKey(e) {
  const d = e.date instanceof Date
    ? e.date.getFullYear() + "-" + String(e.date.getMonth() + 1).padStart(2, "0") + "-" + String(e.date.getDate()).padStart(2, "0")
    : String(e.date);
  return [e.initials || "", d, (e.issue || "").trim(), String(e.points || 0)].join("|");
}

function escapeHtml(s) {
  const el = document.createElement("div");
  el.textContent = String(s == null ? "" : s);
  return el.innerHTML;
}

function productionPeople() {
  return CONFIG.people.filter(function (p) {
    return p.initials !== CONFIG.excludeFromKpiDisplay;
  });
}

let selectedInitials = null;

function groupByPerson(errorEntries) {
  const people = productionPeople();
  const map = {};
  people.forEach(function (p) {
    map[p.initials] = { person: p, entries: [], totalPoints: 0 };
  });
  (errorEntries || []).forEach(function (e) {
    if (!e.initials || !map[e.initials]) return;
    map[e.initials].entries.push(e);
    map[e.initials].totalPoints += Number(e.points) || 0;
  });
  Object.keys(map).forEach(function (k) {
    map[k].entries.sort(function (a, b) {
      return (b.date && a.date) ? (b.date - a.date) : 0;
    });
  });
  return map;
}

function renderCards(grouped, oneToOnes) {
  const container = document.getElementById("officeErrorCards");
  if (!container) return;

  const cards = productionPeople().map(function (p) {
    const g = grouped[p.initials] || { entries: [], totalPoints: 0 };
    const count = g.entries.length;
    let openFollowUps = 0;
    g.entries.forEach(function (e) {
      const rec = oneToOnes[errorKey(e)];
      if (!rec || !rec.done) openFollowUps += 1;
    });

    const pts = g.totalPoints;
    const ptsClass = pts < 0 ? "negative" : (pts > 0 ? "positive" : "neutral");
    const selected = selectedInitials === p.initials ? " selected" : "";

    return (
      '<button type="button" class="office-error-card' + selected + '" data-initials="' + escapeHtml(p.initials) + '">' +
        '<div class="oe-card-top">' +
          '<span class="oe-dot" style="background:' + p.color + ';"></span>' +
          '<span class="oe-name">' + escapeHtml(p.name) + '</span>' +
        '</div>' +
        '<div class="oe-points ' + ptsClass + '">' + (pts > 0 ? "+" : "") + pts + '</div>' +
        '<div class="oe-sub">error points</div>' +
        '<div class="oe-meta">' +
          count + ' error' + (count === 1 ? "" : "s") +
          (count > 0
            ? (openFollowUps > 0
                ? ' · <span class="oe-open">' + openFollowUps + ' need 1:1</span>'
                : ' · <span class="oe-done">all 1:1s done</span>')
            : "") +
        '</div>' +
      '</button>'
    );
  }).join("");

  container.innerHTML = cards || '<div class="parts-note">No production staff configured.</div>';

  container.querySelectorAll(".office-error-card").forEach(function (btn) {
    btn.addEventListener("click", function () {
      selectedInitials = btn.getAttribute("data-initials");
      renderOfficeErrors();
      const detail = document.getElementById("officeErrorDetail");
      if (detail) detail.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function renderDetail(grouped, oneToOnes) {
  const detail = document.getElementById("officeErrorDetail");
  if (!detail) return;

  if (!selectedInitials || !grouped[selectedInitials]) {
    detail.style.display = "none";
    detail.innerHTML = "";
    return;
  }

  const g = grouped[selectedInitials];
  const p = g.person;
  const entries = g.entries;

  let rows = "";
  if (entries.length === 0) {
    rows = '<div class="parts-note">No errors logged for this person.</div>';
  } else {
    rows = entries.map(function (e) {
      const key = errorKey(e);
      const rec = oneToOnes[key] || {};
      const done = !!rec.done;
      const note = rec.note || "";
      const pts = Number(e.points) || 0;
      return (
        '<div class="oe-error-row' + (done ? " oe-row-done" : "") + '" data-key="' + escapeHtml(key) + '">' +
          '<div class="oe-error-main">' +
            '<div class="oe-error-date">' + escapeHtml(fmtDate(e.date)) +
              (e.plot ? " · Plot " + escapeHtml(e.plot) : "") +
              (e.loadLink ? " · Load " + escapeHtml(e.loadLink) : "") +
            '</div>' +
            '<div class="oe-error-issue">' + escapeHtml(e.issue || "Unspecified") +
              (e.section ? ' <span class="oe-section">(' + escapeHtml(e.section) + ")</span>" : "") +
            '</div>' +
            (e.impact ? '<div class="oe-error-impact">' + escapeHtml(e.impact) + "</div>" : "") +
          '</div>' +
          '<div class="oe-error-points">' + (pts > 0 ? "+" : "") + pts + '</div>' +
          '<label class="oe-oto">' +
            '<input type="checkbox" class="oe-oto-check" data-key="' + escapeHtml(key) + '"' + (done ? " checked" : "") + ' />' +
            '<span>1:1 done</span>' +
          '</label>' +
          '<input type="text" class="oe-oto-note" data-key="' + escapeHtml(key) + '" placeholder="Optional note…" value="' + escapeHtml(note) + '" />' +
        '</div>'
      );
    }).join("");
  }

  detail.style.display = "";
  detail.innerHTML =
    '<div class="oe-detail-header">' +
      '<button type="button" class="back-btn" id="oeCloseDetail">← All people</button>' +
      '<h3><span class="oe-dot" style="background:' + p.color + ';"></span> ' +
        escapeHtml(p.name) + " — breakdown</h3>" +
      '<div class="oe-detail-total">Total: <strong class="' +
        (g.totalPoints < 0 ? "negative" : "") + '">' +
        (g.totalPoints > 0 ? "+" : "") + g.totalPoints +
      '</strong> points · ' + entries.length + ' error' + (entries.length === 1 ? "" : "s") +
      '</div>' +
    '</div>' +
    '<div class="oe-error-list">' + rows + '</div>';

  const closeBtn = document.getElementById("oeCloseDetail");
  if (closeBtn) {
    closeBtn.addEventListener("click", function () {
      selectedInitials = null;
      renderOfficeErrors();
    });
  }

  detail.querySelectorAll(".oe-oto-check").forEach(function (cb) {
    cb.addEventListener("change", function () {
      const key = cb.getAttribute("data-key");
      const map = loadOneToOnes();
      if (!map[key]) map[key] = {};
      map[key].done = cb.checked;
      map[key].updatedAt = new Date().toISOString();
      saveOneToOnes(map);
      renderOfficeErrors();
    });
  });

  detail.querySelectorAll(".oe-oto-note").forEach(function (inp) {
    inp.addEventListener("change", function () {
      const key = inp.getAttribute("data-key");
      const map = loadOneToOnes();
      if (!map[key]) map[key] = {};
      map[key].note = inp.value;
      map[key].updatedAt = new Date().toISOString();
      saveOneToOnes(map);
    });
  });
}

export function renderOfficeErrors() {
  const entries = window._errorEntries || [];
  const oneToOnes = loadOneToOnes();
  const grouped = groupByPerson(entries);
  renderCards(grouped, oneToOnes);
  renderDetail(grouped, oneToOnes);
}

window.renderOfficeErrors = renderOfficeErrors;
