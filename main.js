/**
 * Local main.js – loads the known-good modular build from CDN,
 * then wires in the "This Week Predicted Finish Day" feature.
 * Finish prediction is loaded dynamically so a failure there cannot
 * leave the whole app stuck on "Loading…".
 */
import {
  initAndLoad as _initAndLoad,
  loadAndRender as _loadAndRender,
  REFRESH_MS
} from "https://cdn.jsdelivr.net/gh/Slys178/production_office_kpi@aab94dcec7ba58bd953c9514f58748408e2d26bd/main.js";

export { REFRESH_MS };

let finishReady = false;

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

// Load finish module in the background (does not block initAndLoad)
import("./finish-week.js")
  .then(() => {
    finishReady = true;
    callFinishIfReady();
  })
  .catch(e => console.warn("finish-week module failed", e));

export async function initAndLoad() {
  const result = await _initAndLoad();
  callFinishIfReady();
  return result;
}

export async function loadAndRender() {
  const result = await _loadAndRender();
  callFinishIfReady();
  return result;
}

document.addEventListener("DOMContentLoaded", () => {
  const tile = document.getElementById("tileForecast");
  if (tile) {
    tile.addEventListener("click", () => {
      setTimeout(callFinishIfReady, 150);
    });
  }
});
