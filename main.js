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

import("./detail-net-fix.js")
  .catch(function (e) { console.warn("detail-net-fix module failed", e); });

import("./forecast-enhance.js")
  .then(function () { callForecastEnhance(); })
  .catch(function (e) { console.warn("forecast-enhance module failed", e); });

import("./office-errors.js")
  .then(function () { callOfficeErrors(); })
  .catch(function (e) { console.warn("office-errors module failed", e); });

import("./loads-by-person.js")
  .then(function () { callLoadsByPerson(); })
  .catch(function (e) { console.warn("loads-by-person module failed", e); });

// Local Drive module must be initialized separately from the CDN copy
import("./drive.js")
  .then(function (mod) {
    if (mod && typeof mod.ensureDriveReady === "function") {
      mod.ensureDriveReady(false).catch(function () {});
    } else if (mod && typeof mod.initGapiClient === "function") {
      mod.initGapiClient().catch(function () {});
    }
  })
  .catch(function (e) { console.warn("drive init failed", e); });

export async function initAndLoad() {
  const result = await _initAndLoad();
  callFinishIfReady();
  callKpiPrivacy();
  callForecastEnhance();
  callOfficeErrors();
  callLoadsByPerson();
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
      setTimeout(callFinishIfReady, 150);
      setTimeout(callForecastEnhance, 200);
    });
  }
  const tileKpi = document.getElementById("tileKpi");
  if (tileKpi) {
    tileKpi.addEventListener("click", function () {
      setTimeout(callKpiPrivacy, 150);
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
      import("./drive.js").then(function (mod) {
        if (mod && mod.ensureDriveReady) mod.ensureDriveReady(false);
      }).catch(function () {});
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
