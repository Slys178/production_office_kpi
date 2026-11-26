/**
 * Incidents tab — shows the Incident Log (the Apps Script managers app, converted).
 *
 * The app itself lives in ../log/ and is fully self-contained so it can be
 * moved to Azure later. Here it is simply hosted inside the tab, so edits made in
 * ../log/ show up straight away when you open Areas > Incidents.
 *
 * (The previous in-app reporting form is still in this file's git history.)
 */
const FRAME_ID = "incidentsFrame";
const SRC = "incident-system/log/index.html";

export function renderIncidents() {
  const root = document.getElementById("incidentsPageBody");
  const page = document.getElementById("incidentsPage");
  if (!root || !page) return;
  // Only load once the tab is actually open (this is also called at app start-up)
  if (!page.classList.contains("active")) return;
  // Already loaded: keep it (re-creating would make the manager sign in again)
  if (root.querySelector("#" + FRAME_ID)) return;

  root.style.padding = "0";
  root.innerHTML =
    '<iframe id="' + FRAME_ID + '" title="Incident Log" src="' + SRC + '"' +
    ' style="display:block;width:100%;height:calc(100vh - 64px);min-height:480px;border:0;background:#EEF1F2"></iframe>';
}

window.renderIncidents = renderIncidents;
