/**
 * KPI privacy + Monday status fix + temporary helpers
 * - SA / ADMIN: individual dials (except hideIndividualKpi e.g. DK)
 * - Everyone else: whole-office team dial only
 * - Temporary helpers still count in team totals & capacity
 */
import { CONFIG } from "./config.js";

function isManagerViewer() {
  let userName = "";
  let userEmail = "";
  let userRole = "";
  try {
    userName = (localStorage.getItem("userName") || "").trim();
    userEmail = (localStorage.getItem("userEmail") || "").trim().toLowerCase();
    userRole = (localStorage.getItem("userRole") || "").trim().toUpperCase();
  } catch (_) {}

  const role = userRole;
  if (role === "ADMIN" || role === "ADMINISTRATOR" || role === "MANAGER" || role.includes("ADMIN")) {
    return true;
  }
  const n = userName.toUpperCase();
  const e = userEmail;
  if (n === "SA" || n.startsWith("SA ") || n.endsWith(" SA") || n === "S.A" || n === "S A") return true;
  if (/\bSA\b/.test(n)) return true;
  if (n.includes("SIMON ASK")) return true;
  if (n.includes("ASK") && n.includes("SIMON")) return true;
  if (e.includes("simon.ask") || e.includes("simon_ask")) return true;
  if (e.startsWith("sa@") || e.includes(".sa@")) return true;
  return false;
}

function hideList() {
  const list = CONFIG.hideIndividualKpi;
  if (!list) return [];
  return Array.isArray(list) ? list : [list];
}

function cardMatchesHidden(card, hidden) {
  if (!hidden.length) return false;
  const bits = [];
  card.querySelectorAll(".role, .name, h3, .card-title, .lb-name").forEach(function (el) {
    bits.push(el.textContent || "");
  });
  const text = bits.join(" ").toUpperCase();
  return hidden.some(function (init) {
    const u = String(init).toUpperCase();
    if (text.indexOf(u) !== -1) return true;
    // also match full name from config
    const person = CONFIG.people.find(function (p) { return p.initials === init; });
    if (person && text.indexOf(person.name.toUpperCase()) !== -1) return true;
    return false;
  });
}

/** Hide dials / leaderboard rows for temporary helpers (e.g. DK). */
function hideTemporaryIndividualCards() {
  const hidden = hideList();
  if (!hidden.length) return;

  document.querySelectorAll("#dialGrid .card").forEach(function (card) {
    if (cardMatchesHidden(card, hidden)) {
      card.style.display = "none";
      card.setAttribute("data-temp-helper-hidden", "1");
    }
  });

  document.querySelectorAll("#kpiPage .leaderboard-card li, #kpiPage .lb-row, #kpiPage .leaderboard li").forEach(function (row) {
    if (cardMatchesHidden(row, hidden)) {
      row.style.display = "none";
    }
  });
}

function fixFalseOffBadges() {
  const today = window._today ? new Date(window._today) : new Date();
  const dow = today.getDay();
  const earlyWeek = dow === 0 || dow === 1 || dow === 6;

  document.querySelectorAll("#dialGrid .card, #teamSummary .team-dial-card").forEach(function (card) {
    const badge = card.querySelector(".badge.off, .badge");
    if (!badge) return;

    const text = (badge.textContent || "").trim();
    if (text !== "Off today" && text !== "Off") return;

    const role = (card.querySelector(".role") || {}).textContent || "";
    const actuallyOff = role.indexOf(" · ") !== -1;
    if (actuallyOff) return;

    badge.textContent = earlyWeek ? "Week just started" : "No pace data yet";
    badge.className = "badge off";
    badge.title = "Pace includes Mon through today.";
  });

  document.querySelectorAll("#teamSummary .badge").forEach(function (badge) {
    const text = (badge.textContent || "").trim();
    if (text !== "Off today" && text !== "Off") return;
    badge.textContent = earlyWeek ? "Week just started" : "No pace data yet";
    badge.className = "badge off";
  });
}

export function applyKpiPrivacy() {
  const manager = isManagerViewer();
  const kpiPage = document.getElementById("kpiPage");
  if (!kpiPage) return;

  fixFalseOffBadges();
  hideTemporaryIndividualCards();

  const dialGrid = document.getElementById("dialGrid");
  if (dialGrid) {
    dialGrid.style.display = manager ? "" : "none";
    dialGrid.setAttribute("aria-hidden", manager ? "false" : "true");
  }

  kpiPage.querySelectorAll(".leaderboard-card").forEach(function (el) {
    el.style.display = manager ? "" : "none";
  });

  let note = document.getElementById("kpiTeamOnlyNote");
  if (!manager) {
    if (!note) {
      note = document.createElement("div");
      note.id = "kpiTeamOnlyNote";
      note.className = "kpi-team-only-note";
      note.textContent =
        "Team progress only — individual targets are a management guide and are not shown here.";
      const summary = document.getElementById("teamSummary");
      if (summary && summary.parentNode) {
        summary.parentNode.insertBefore(note, summary.nextSibling);
      } else {
        kpiPage.appendChild(note);
      }
    }
    note.style.display = "";
  } else if (note) {
    note.style.display = "none";
  }

  const tileSub = document.querySelector("#tileKpi .tile-sub");
  if (tileSub) {
    tileSub.textContent = manager
      ? "Team & individual stair targets (guide)"
      : "Whole-office weekly target";
  }
}

window.applyKpiPrivacy = applyKpiPrivacy;
