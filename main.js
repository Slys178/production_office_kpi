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

export async function initAndLoad() {
  const result = await _initAndLoad();
  callFinishIfReady();
  callKpiPrivacy();
  callForecastEnhance();
  return result;
}

export async function loadAndRender() {
  const result = await _loadAndRender();
  callFinishIfReady();
  callKpiPrivacy();
  callForecastEnhance();
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
});
