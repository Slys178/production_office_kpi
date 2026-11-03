/**
 * Application entry point
 * - Theme toggle
 * - Starts the main app
 * - Presence heartbeat (loaded separately so it cannot block the app)
 */

import { initAndLoad, loadAndRender, REFRESH_MS } from "./main.js";
import { applyKpiTargetOverride, initAdminTargets } from "./admin-targets.js";

// Apply admin target override before any KPI maths run
applyKpiTargetOverride();
window.loadAndRender = loadAndRender;


/* =========================================================
   THEME TOGGLE
   ========================================================= */
const themeToggle = document.getElementById("themeToggle");
let currentTheme = localStorage.getItem("theme") || "dark";
document.documentElement.setAttribute("data-theme", currentTheme);

if (themeToggle) {
  themeToggle.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme");
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("theme", next);
  });
}

/* =========================================================
   START — never let optional features block the main app
   ========================================================= */
function showLoadError(err) {
  console.error("initAndLoad failed", err);
  const el = document.getElementById("loadingMsg");
  if (el) {
    el.classList.remove("loading");
    el.style.display = "block";
    el.style.color = "var(--red, #e74c3c)";
    el.textContent = "Could not load live figures. Check your connection and refresh. (" + (err && err.message ? err.message : String(err)) + ")";
  }
  const banner = document.getElementById("errorBanner");
  if (banner) {
    banner.textContent = "Load error: " + (err && err.message ? err.message : String(err));
    banner.style.display = "block";
  }
}

initAndLoad()
  .then(function () { try { initAdminTargets(); } catch (e) { console.warn(e); } })
  .catch(showLoadError);
setInterval(() => {
  loadAndRender().catch(e => console.warn("refresh failed", e));
}, REFRESH_MS);

// Presence is optional — load after a tick so it never blocks startup
setTimeout(() => {
  import("./presence.js").catch(e => console.warn("presence module failed", e));
}, 0);

console.log("%cProduction Office KPI – modular build", "color:#00A99D;font-weight:bold");
