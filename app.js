/**
 * Application entry point
 * - Theme toggle
 * - Starts the main app
 */

import { initAndLoad, loadAndRender, REFRESH_MS } from "./main.js";

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
   START
   ========================================================= */
initAndLoad();
setInterval(loadAndRender, REFRESH_MS);

console.log("%cProduction Office KPI – modular build", "color:#00A99D;font-weight:bold");
