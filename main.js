/**
 * Local main.js – loads the known-good modular build from CDN,
 * then wires in finish prediction, KPI privacy, detail net-points, and forecast defaults.
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

// Drive auto-search disabled (was unreliable; speeds up load)

export async function initAndLoad() {
  const result = await _initAndLoad();
  callFinishIfReady();
  callKpiPrivacy();
  callForecastEnhance();
  callOfficeErrors();
  callLoadsByPerson();
  // Re-apply area routing (CDN forces office landing on first load)
  try {
    if (typeof window.__goAreaLanding === 'function') window.__goAreaLanding();
  } catch (e) { console.warn('area route', e); }
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
  // Force exclusive page visibility after CDN navigation
  (function () {
    var navIds = [
      "tileKpi", "tileLoads", "tileHolidays", "tileForecast", "tileErrors", "tileReplacementParts",
      "backToLandingFromKpi", "backToLandingFromLoads", "backToLandingFromHolidays",
      "backToLandingFromForecast", "backToLandingFromErrors", "backToLandingFromReplacementParts",
      "backToKpi", "backToDetail"
    ];
    navIds.forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("click", function () {
        setTimeout(function () {
          var active = document.querySelector(".page-view.active");
          document.querySelectorAll(".page-view").forEach(function (p) {
            p.style.removeProperty("display");
            if (active && p !== active) p.classList.remove("active");
          });
          if (active) active.classList.add("active");
          try { window.scrollTo(0, 0); } catch (e) {}
        }, 10);
      });
    });
  })();

  const tileForecast = document.getElementById("tileForecast");
  if (tileForecast) {
    tileForecast.addEventListener("click", function () {
      setTimeout(callFinishIfReady, 150);
      setTimeout(callForecastEnhance, 200);
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
