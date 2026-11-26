/**
 * "Report an incident" tile + page for the landing screen.
 *
 * The form itself lives in ../report/ (self-contained, so I.T. can lift it out
 * later). This file only adds the tile, a page to hold it, and the open/back wiring.
 * It sits beside the existing "Incident Log" tile (managers' log, ../log/).
 */
const TILE_ID = "tileAreaReport";
const PAGE_ID = "reportIncidentPage";
const BACK_ID = "backToLandingFromReport";
const FRAME_ID = "reportIncidentFrame";
const SRC = "incident-system/report/index.html";

function addTile() {
  const grid = document.querySelector("#areaLandingPage .tile-grid");
  if (!grid || document.getElementById(TILE_ID)) return;
  const tile = document.createElement("div");
  tile.className = "nav-tile";
  tile.id = TILE_ID;
  tile.style.minHeight = "140px";
  tile.innerHTML =
    '<div class="tile-icon">⚠️</div>' +
    '<div class="tile-label">REPORT AN INCIDENT</div>' +
    '<div class="tile-sub">Near miss · hazard · injury · photos</div>';
  // Sit just before the Incident Log tile if it is there, otherwise at the end
  const log = document.getElementById("tileAreaIncidents");
  if (log && log.parentNode === grid) grid.insertBefore(tile, log);
  else grid.appendChild(tile);
  tile.addEventListener("click", openReport);
}

function addPage() {
  if (document.getElementById(PAGE_ID)) return;
  const page = document.createElement("div");
  page.id = PAGE_ID;
  page.className = "page-view";
  page.innerHTML =
    '<div class="page-header">' +
    '<button class="back-btn" id="' + BACK_ID + '">← Areas</button>' +
    "<h2>⚠️ Report an incident</h2></div>" +
    '<div id="reportIncidentBody" class="page-body" style="padding:0;"></div>';
  const anchor =
    document.getElementById("incidentsPage") ||
    document.getElementById("areaLandingPage") ||
    document.body;
  anchor.parentNode.insertBefore(page, anchor.nextSibling);
  document.getElementById(BACK_ID).addEventListener("click", function () {
    if (typeof window.__goAreaLanding === "function") window.__goAreaLanding();
  });
}

function openReport() {
  if (typeof window.showPage === "function") window.showPage(PAGE_ID);
  else if (typeof window.__showPage === "function") window.__showPage(PAGE_ID);
  const body = document.getElementById("reportIncidentBody");
  // Load once, when first opened (reloading would throw away a half-filled report)
  if (body && !body.querySelector("#" + FRAME_ID)) {
    body.innerHTML =
      '<iframe id="' + FRAME_ID + '" title="Report an incident" src="' + SRC + '"' +
      ' style="display:block;width:100%;height:calc(100vh - 64px);min-height:480px;border:0;background:#EEF1F2"></iframe>';
  }
  try { window.scrollTo(0, 0); } catch (e) {}
}

function init() {
  addPage();
  addTile();
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();
