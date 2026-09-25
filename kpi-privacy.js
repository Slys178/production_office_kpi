/**
 * KPI privacy
 * - SA / ADMIN: full view (individual dials + pace leaderboard)
 * - Everyone else: whole-office team dial only — no personal targets or rankings
 *
 * Daily/person targets stay available for managers as a guide only.
 */

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

/**
 * After the KPI page is rendered, strip individual figures for non-managers.
 */
export function applyKpiPrivacy() {
  const manager = isManagerViewer();
  const kpiPage = document.getElementById("kpiPage");
  if (!kpiPage) return;

  // Individual person dials
  const dialGrid = document.getElementById("dialGrid");
  if (dialGrid) {
    dialGrid.style.display = manager ? "" : "none";
    dialGrid.setAttribute("aria-hidden", manager ? "false" : "true");
  }

  // Pace leaderboard (names + personal %)
  kpiPage.querySelectorAll(".leaderboard-card").forEach(function (el) {
    el.style.display = manager ? "" : "none";
  });

  // Optional note under the team dial for staff
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

  // Soften tile subtitle for everyone (targets are team-focused for staff)
  const tileSub = document.querySelector("#tileKpi .tile-sub");
  if (tileSub) {
    tileSub.textContent = manager
      ? "Team & individual stair targets (guide)"
      : "Whole-office weekly target";
  }
}

window.applyKpiPrivacy = applyKpiPrivacy;
