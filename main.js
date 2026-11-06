/**
 * Local main.js – loads the known-good modular build from CDN,
 * then wires in finish prediction, KPI privacy, detail net-points, forecast, incidents.
 */
import {
  initAndLoad as _initAndLoad,
  loadAndRender as _loadAndRender,
  REFRESH_MS
} from "https://cdn.jsdelivr.net/gh/Slys178/production_office_kpi@aab94dcec7ba58bd953c9514f58748408e2d26bd/main.js";

export { REFRESH_MS };

function callFinishIfReady() {
  try {
    if (typeof window.renderCurrentWeekFinish === "function"
        && window._stairEntries
        && window._holidayIndex
        && window._today) {
      window.renderCurrentWeekFinish(window._stairEntries, window._holidayIndex, window._today);
    }
  } catch (e) {
    console.warn("finish prediction error", e);
  }
}

function callKpiPrivacy() {
  try {
    if (typeof window.applyKpiPrivacy === "function") {
      window.applyKpiPrivacy();
    }
  } catch (e) {
    console.warn("kpi privacy error", e);
  }
}

function callLoadsByPerson() {
  try {
    if (typeof window.renderLoadsByPerson === "function") {
      window.renderLoadsByPerson();
    }
  } catch (e) {
    console.warn("loads-by-person error", e);
  }
}

function callIncidents() {
  try {
    if (typeof window.renderIncidents === "function") {
      window.renderIncidents();
    }
  } catch (e) {
    console.warn("incidents render error", e);
  }
}

function callOfficeErrors() {
  try {
    if (typeof window.renderOfficeErrors === "function") {
      window.renderOfficeErrors();
    }
  } catch (e) {
    console.warn("office errors error", e);
  }
}

function callForecastEnhance() {
  try {
    if (typeof window.renderEnhancedForecast === "function") {
      window.renderEnhancedForecast();
    }
  } catch (e) {
    console.warn("forecast enhance error", e);
  }
}

import("./finish-week.js")
  .then(function () { callFinishIfReady(); })
  .catch(function (e) { console.warn("finish-week module failed", e); });

import("./kpi-privacy.js")
  .then(function () { callKpiPrivacy(); })
  .catch(function (e) { console.warn("kpi-privacy module failed", e); });

import("./detail-net-points.js")
  .catch(function (e) { console.warn("detail-net-points module failed", e); });

import("./forecast-enhance.js")
  .then(function () { callForecastEnhance(); })
  .catch(function (e) { console.warn("forecast-enhance module failed", e); });

import("./office-errors.js")
  .then(function () { callOfficeErrors(); })
  .catch(function (e) { console.warn("office-errors module failed", e); });

import("./loads-by-person.js")
  .then(function () { callLoadsByPerson(); })
  .catch(function (e) { console.warn("loads-by-person module failed", e); });

import("./admin-targets.js")
  .catch(function (e) { console.warn("admin-targets module failed", e); });

import("./incident-report.js")
  .then(function () { callIncidents(); })
  .catch(function (e) { console.warn("incident-report module failed", e); });

export async function initAndLoad() {
  const result = await _initAndLoad();
  callFinishIfReady();
  callKpiPrivacy();
  callForecastEnhance();
  callOfficeErrors();
  callLoadsByPerson();
  try {
    if (typeof window.__goAreaLanding === "function") window.__goAreaLanding();
  } catch (e) { console.warn("area route", e); }
  return result;
}

export async function loadAndRender() {
  const result = await _loadAndRender();
  callFinishIfReady();
  callKpiPrivacy();
  callForecastEnhance();
  callOfficeErrors();
  callLoadsByPerson();
  return result;
}

document.addEventListener("DOMContentLoaded", function () {
  const tileForecast = document.getElementById("tileForecast");
  if (tileForecast) {
    tileForecast.addEventListener("click", function () {
      setTimeout(callForecastEnhance, 200);
      setTimeout(callForecastEnhance, 800);
    });
  }
  const tileKpi = document.getElementById("tileKpi");
  if (tileKpi) {
    tileKpi.addEventListener("click", function () {
      setTimeout(callKpiPrivacy, 150);
      setTimeout(function () {
        if (typeof window.renderAdminTargetPanel === "function") window.renderAdminTargetPanel();
      }, 200);
    });
  }
  const tileErrors = document.getElementById("tileErrors");
  if (tileErrors) {
    tileErrors.addEventListener("click", function () {
      setTimeout(callOfficeErrors, 150);
    });
  }
  const tileLoads = document.getElementById("tileLoads");
  if (tileLoads) {
    tileLoads.addEventListener("click", function () {
      setTimeout(callLoadsByPerson, 150);
      setTimeout(callLoadsByPerson, 800);
    });
  }
  const refreshLoads = document.getElementById("refreshLoadsBtn");
  if (refreshLoads) {
    refreshLoads.addEventListener("click", function () {
      setTimeout(callLoadsByPerson, 100);
      setTimeout(callLoadsByPerson, 500);
    });
  }
});

(function ensureIncidentsDom() {
  function run() {
    const areaGrid = document.querySelector("#areaLandingPage .tile-grid");
    if (areaGrid && !document.getElementById("tileAreaIncidents")) {
      const tile = document.createElement("div");
      tile.className = "nav-tile";
      tile.id = "tileAreaIncidents";
      tile.style.minHeight = "140px";
      tile.innerHTML =
        '<div class="tile-icon">🩹</div>' +
        '<div class="tile-label">INCIDENTS</div>' +
        '<div class="tile-sub">Report · photos · near miss & injury</div>';
      areaGrid.appendChild(tile);
    }
    const oldTile = document.getElementById("tileIncidents");
    if (oldTile) oldTile.remove();

    if (!document.getElementById("incidentsPage")) {
      const page = document.createElement("div");
      page.id = "incidentsPage";
      page.className = "page-view";
      page.innerHTML =
        '<div class="page-header">' +
        '<button class="back-btn" id="backToLandingFromIncidents">← Areas</button>' +
        "<h2>🩹 Incidents</h2></div>" +
        '<div id="incidentsPageBody" class="page-body" style="padding:12px 16px 32px;"></div>';
      const anchor = document.getElementById("areaLandingPage") || document.getElementById("landingPage") || document.body;
      anchor.parentNode.insertBefore(page, anchor.nextSibling);
    } else {
      const back = document.getElementById("backToLandingFromIncidents");
      if (back) back.textContent = "← Areas";
    }
    if (!document.querySelector('link[href="incident-report.css"]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "incident-report.css";
      document.head.appendChild(link);
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
  setTimeout(run, 300);
})();

(function wireIncidentsNav() {
  function openIncidents() {
    if (typeof window.showPage === "function") window.showPage("incidentsPage");
    else if (typeof window.__showPage === "function") window.__showPage("incidentsPage");
    else {
      document.querySelectorAll(".page-view").forEach(function (p) {
        p.classList.remove("active");
        p.style.display = "none";
      });
      const page = document.getElementById("incidentsPage");
      if (page) {
        page.classList.add("active");
        page.style.display = "";
      }
    }
    if (typeof window.renderIncidents === "function") window.renderIncidents();
    try { window.scrollTo(0, 0); } catch (e) {}
  }
  function bind() {
    const tile = document.getElementById("tileAreaIncidents") || document.getElementById("tileIncidents");
    const back = document.getElementById("backToLandingFromIncidents");
    if (tile && !tile._incBound) {
      tile._incBound = true;
      tile.addEventListener("click", openIncidents);
    }
    if (back && !back._incBound) {
      back._incBound = true;
      back.addEventListener("click", function () {
        if (typeof window.__goAreaLanding === "function") window.__goAreaLanding();
        else if (typeof window.showPage === "function") window.showPage("areaLandingPage");
        else if (typeof window.__showPage === "function") window.__showPage("areaLandingPage");
      });
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
  setTimeout(bind, 500);
  setTimeout(bind, 1200);
})();
