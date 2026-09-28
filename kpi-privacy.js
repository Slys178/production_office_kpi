/**
 * KPI privacy + Monday status fix
 * - SA / ADMIN: full view (individual dials + pace leaderboard)
 * - Everyone else: whole-office team dial only — no personal targets or rankings
 * - When there are no completed days yet (e.g. Monday), do not show "Off today"
 *   unless the person is actually marked absent on the holiday sheet.
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
 * Pace is measured vs completed days only. On Monday that total is 0, so the
 * core app labels everyone "Off today". Rewrite those badges unless the role
 * line shows a real absence code for today.
 */
function fixFalseOffBadges() {
  const today = window._today ? new Date(window._today) : new Date();
  const dow = today.getDay(); // 0 Sun … 1 Mon … 6 Sat
  const earlyWeek = dow === 0 || dow === 1 || dow === 6;

  document.querySelectorAll("#dialGrid .card, #teamSummary .team-dial-card").forEach(function (card) {
    const badge = card.querySelector(".badge.off, .badge");
    if (!badge) return;

    const text = (badge.textContent || "").trim();
    if (text !== "Off today" && text !== "Off") return;

    // Person dials put absence on the role line: "SF · Full day off"
    const role = (card.querySelector(".role") || {}).textContent || "";
    const actuallyOff = role.indexOf(" · ") !== -1;

    if (actuallyOff) return;

    badge.textContent = earlyWeek ? "Week just started" : "No pace data yet";
    badge.className = "badge off";
    badge.title = "Pace is measured against finished days only — nothing to compare until tomorrow.";
  });

  // Team summary badge (no .role line)
  document.querySelectorAll("#teamSummary .badge").forEach(function (badge) {
    const text = (badge.textContent || "").trim();
    if (text !== "Off today" && text !== "Off") return;
    badge.textContent = earlyWeek ? "Week just started" : "No pace data yet";
    badge.className = "badge off";
    badge.title = "Pace is measured against finished days only — nothing to compare until tomorrow.";
  });
}

/**
 * After the KPI page is rendered, strip individual figures for non-managers
 * and correct Monday "Off today" false positives.
 */
export function applyKpiPrivacy() {
  const manager = isManagerViewer();
  const kpiPage = document.getElementById("kpiPage");
  if (!kpiPage) return;

  fixFalseOffBadges();

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
