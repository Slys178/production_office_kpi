/**
 * Loads — person-first layout + side-by-side MS/SNIP check results
 */
import { CONFIG } from "./config.js";
import {
  gapiSignedIn,
  driveSearchCache,
  searchDriveForLoad,
  getSavedDriveLinks,
  saveDriveLink,
  showDriveSignIn,
  ensureDriveReady,
} from "./drive.js";
import { runLoadCheck } from "./load-check.js";

const CHECKED_KEY = "loadCheckedStatus";

function loadCheckedMap() {
  try {
    return JSON.parse(localStorage.getItem(CHECKED_KEY) || "{}") || {};
  } catch (_) {
    return {};
  }
}

function saveCheckedMap(map) {
  try {
    localStorage.setItem(CHECKED_KEY, JSON.stringify(map));
  } catch (_) {}
}

function escapeHtml(s) {
  const el = document.createElement("div");
  el.textContent = String(s == null ? "" : s);
  return el.innerHTML;
}

function ensureCheckModal() {
  let overlay = document.getElementById("lbpCheckModal");
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.id = "lbpCheckModal";
  overlay.className = "lbp-modal-overlay";
  overlay.style.display = "none";
  overlay.innerHTML =
    '<div class="lbp-modal" role="dialog" aria-modal="true">' +
    '<div class="lbp-modal-title" id="lbpModalTitle"></div>' +
    '<div class="lbp-modal-body" id="lbpModalBody"></div>' +
    '<div class="lbp-modal-actions" id="lbpModalActions"></div>' +
    "</div>";
  document.body.appendChild(overlay);
  overlay.addEventListener("click", function (e) {
    e.stopPropagation();
  });
  return overlay;
}

function showCheckModal(opts) {
  const overlay = ensureCheckModal();
  document.getElementById("lbpModalTitle").textContent = opts.title || "Load check";
  const bodyEl = document.getElementById("lbpModalBody");
  if (opts.html) bodyEl.innerHTML = opts.html;
  else bodyEl.textContent = opts.message || "";
  const actionsEl = document.getElementById("lbpModalActions");
  actionsEl.innerHTML = "";
  const buttons = opts.buttons || [{ id: "ok", label: "OK", primary: true }];
  return new Promise(function (resolve) {
    buttons.forEach(function (b) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "lbp-modal-btn" + (b.primary ? " primary" : "");
      btn.textContent = b.label;
      btn.addEventListener("click", function () {
        overlay.style.display = "none";
        resolve(b.id);
      });
      actionsEl.appendChild(btn);
    });
    overlay.style.display = "flex";
  });
}

function formatSide(val, status) {
  if (val == null || val === "") {
    return '<span class="lbp-cell-miss">—</span>';
  }
  let cls = "lbp-cell-ok";
  if (status === "diff") cls = "lbp-cell-diff";
  else if (status === "partial") cls = "lbp-cell-partial";
  else if (status === "missing") cls = "lbp-cell-miss";
  return '<span class="' + cls + '">' + escapeHtml(val) + "</span>";
}

function formatCheckResultHtml(loadNum, result) {
  let html = '<div class="lbp-result-summary">';
  const plotRows =
    result.plotRows || (result.details && result.details.plotRows) || [];

  if (result.ok) {
    html += '<p class="lbp-result-ok">✅ Match</p>';
  } else if (
    plotRows.some(function (r) {
      return r.status === "diff";
    })
  ) {
    html += '<p class="lbp-result-bad">⚠️ Differences found (red)</p>';
  } else {
    html +=
      '<p class="lbp-result-warn">⚠️ Incomplete — some fields only on one side</p>';
  }
  html += "<p><strong>Load #" + escapeHtml(loadNum) + "</strong>";
  if (result.details && result.details.folderName) {
    html += " · folder: " + escapeHtml(result.details.folderName);
  }
  html += "</p>";

  if (plotRows.length) {
    html +=
      '<div class="lbp-table-scroll"><table class="lbp-result-table lbp-plot-table">' +
      "<thead><tr>" +
      "<th>Plot (MS)</th><th>Plot (SNIP)</th>" +
      "<th>House (MS)</th><th>House (SNIP)</th>" +
      "<th>Handing (MS)</th><th>Handing (SNIP)</th>" +
      "<th>FFL (MS)</th><th>FFL (SNIP)</th>" +
      "<th></th></tr></thead><tbody>";

    plotRows.forEach(function (row) {
      let mark = "✅";
      let rowClass = "ok";
      if (row.status === "diff") {
        mark = "❌";
        rowClass = "bad";
      } else if (row.status === "partial") {
        mark = "⚠️";
        rowClass = "warn";
      } else if (row.status === "missing") {
        mark = "—";
        rowClass = "muted";
      }

      const p = row.plot || {};
      const h = row.houseType || {};
      const d = row.handing || {};
      const f = row.ffl || {};

      html +=
        '<tr class="' +
        rowClass +
        '">' +
        "<td>" +
        formatSide(p.ms, p.status) +
        "</td><td>" +
        formatSide(p.snip, p.status) +
        "</td><td>" +
        formatSide(h.ms, h.status) +
        "</td><td>" +
        formatSide(h.snip, h.status) +
        "</td><td>" +
        formatSide(d.ms, d.status) +
        "</td><td>" +
        formatSide(d.snip, d.status) +
        "</td><td>" +
        formatSide(f.ms, f.status) +
        "</td><td>" +
        formatSide(f.snip, f.status) +
        "</td><td>" +
        mark +
        "</td></tr>";
    });
    html += "</tbody></table></div>";
    html +=
      '<p class="lbp-result-note">Green = match · Red = differ · Amber = only on one side. FFL (MS) = 4 digits before “mm”. House (MS) = value before “Site dwelling”. Handing = LHWS / RHWS / BW / LHLL / RHLL / T SHAPE.</p>';
  } else if (result.message) {
    html += '<pre class="lbp-result-pre">' + escapeHtml(result.message) + "</pre>";
  }

  if (result.details) {
    if (result.details.msFile) {
      html +=
        "<p><small>MS TOP: " + escapeHtml(result.details.msFile) + "</small></p>";
    }
    if (result.details.snipFiles && result.details.snipFiles.length) {
      html +=
        "<p><small>SNIP: " +
        escapeHtml(result.details.snipFiles.join(", ")) +
        "</small></p>";
    }
  }
  html += "</div>";
  return html;
}

function productionPeople() {
  return CONFIG.people.filter(function (p) {
    return p.initials !== CONFIG.excludeFromKpiDisplay;
  });
}

function parseLoads(stairEntries, forecastEntries) {
  const all = [].concat(stairEntries || [], forecastEntries || []);
  const loadMap = {};
  const people = CONFIG.people;
  all.forEach(function (entry) {
    const dueDate = entry.deliveryDate
      ? entry.deliveryDate.toISOString().split("T")[0]
      : null;
    const loadNumber =
      entry.loadNo && String(entry.loadNo).trim()
        ? String(entry.loadNo).trim()
        : "#" + entry.stairs + "_" + (dueDate || "");
    const key = loadNumber + "_" + (dueDate || "");
    let status = "pending";
    if (entry.initials) {
      const isCompleted =
        entry.isCompleted !== undefined ? entry.isCompleted : true;
      status = isCompleted ? "completed" : "in-progress";
    }
    if (!loadMap[key]) {
      const person = people.find(function (p) {
        return p.initials === entry.initials;
      });
      loadMap[key] = {
        loadNumber: loadNumber,
        stairs: entry.stairs,
        person: entry.initials || "",
        personName: person ? person.name : entry.initials || "Unassigned",
        status: status,
        dueDate: dueDate,
        date: entry.date ? entry.date.toISOString().split("T")[0] : null,
        sortDate: entry.date || entry.deliveryDate || null,
      };
    }
  });
  return Object.values(loadMap);
}

let selectedPerson = null;
let cachedLoads = [];

async function handleDriveClick(loadNum, button) {
  const ready = await ensureDriveReady(true);
  if (!ready) {
    button.textContent = "🔑 Sign in…";
    showDriveSignIn(function () {
      handleDriveClick(loadNum, button);
    });
    return;
  }
  const saved = getSavedDriveLinks()[loadNum];
  if (saved) {
    window.open(saved, "_blank");
    return;
  }
  if (driveSearchCache[loadNum]) {
    window.open(driveSearchCache[loadNum], "_blank");
    return;
  }
  button.textContent = "🔍 Searching…";
  button.classList.add("searching");
  button.disabled = true;
  try {
    const link = await searchDriveForLoad(loadNum);
    button.classList.remove("searching");
    button.disabled = false;
    if (link) {
      driveSearchCache[loadNum] = link;
      saveDriveLink(loadNum, link);
      button.textContent = "📁 Open folder";
      window.open(link, "_blank");
    } else {
      button.textContent = "🔍 Find in Drive";
      window.open(
        "https://drive.google.com/drive/search?q=" + encodeURIComponent(loadNum),
        "_blank"
      );
    }
  } catch (err) {
    console.error(err);
    button.textContent = "❌ Error";
    button.classList.remove("searching");
    button.disabled = false;
    setTimeout(function () {
      button.textContent = "🔍 Find in Drive";
    }, 2500);
  }
}

function renderPersonCards(loads) {
  const root = document.getElementById("loadsPersonView");
  if (!root) return;
  const people = productionPeople();
  const checked = loadCheckedMap();
  const cards = people
    .map(function (p) {
      const mine = loads.filter(function (l) {
        return l.person === p.initials;
      });
      const open = mine.filter(function (l) {
        return l.status !== "completed";
      }).length;
      const checkedCount = mine.filter(function (l) {
        return checked[l.loadNumber];
      }).length;
      return (
        '<button type="button" class="lbp-person-card" data-initials="' +
        escapeHtml(p.initials) +
        '">' +
        '<div class="lbp-top">' +
        '<span class="lbp-dot" style="background:' +
        p.color +
        ';"></span><strong>' +
        escapeHtml(p.initials) +
        '</strong><span class="lbp-name">' +
        escapeHtml(p.name.split(" ")[0]) +
        "</span></div>" +
        '<div class="lbp-count">' +
        mine.length +
        '</div><div class="lbp-sub">loads</div><div class="lbp-meta">' +
        (open ? open + " open" : "all complete") +
        (mine.length ? " · " + checkedCount + "/" + mine.length + " checked" : "") +
        "</div></button>"
      );
    })
    .join("");
  root.innerHTML =
    '<div class="parts-note" style="margin-bottom:12px;">Choose a person to see their loads.</div>' +
    '<div class="lbp-grid">' +
    cards +
    "</div>";
  root.querySelectorAll(".lbp-person-card").forEach(function (btn) {
    btn.addEventListener("click", function () {
      selectedPerson = btn.getAttribute("data-initials");
      showPersonDetail();
    });
  });
}

function showPersonDetail() {
  const view = document.getElementById("loadsPersonView");
  const detail = document.getElementById("loadsPersonDetail");
  if (!detail) return;
  if (view) view.style.display = "none";
  detail.style.display = "";
  const people = productionPeople();
  const person =
    selectedPerson === ""
      ? { initials: "", name: "Unassigned", color: "#8993ab" }
      : people.find(function (p) {
          return p.initials === selectedPerson;
        }) || { initials: selectedPerson, name: selectedPerson, color: "#8993ab" };

  let mine = cachedLoads.filter(function (l) {
    return selectedPerson === "" ? !l.person : l.person === selectedPerson;
  });
  mine = mine.slice().sort(function (a, b) {
    const da = a.sortDate ? new Date(a.sortDate).getTime() : 0;
    const db = b.sortDate ? new Date(b.sortDate).getTime() : 0;
    return db - da;
  });
  const checked = loadCheckedMap();
  const statusLabels = {
    completed: "✅ Done",
    "in-progress": "🔄 In progress",
    pending: "⏳ Pending",
  };
  const rows = mine
    .map(function (load) {
      const loadNum = load.loadNumber;
      const isChecked = !!checked[loadNum];
      const hasLink = driveSearchCache[loadNum] || getSavedDriveLinks()[loadNum];
      const due = load.dueDate ? new Date(load.dueDate).toLocaleDateString("en-GB") : "—";
      const work = load.date ? new Date(load.date).toLocaleDateString("en-GB") : "—";
      return (
        '<div class="lbp-load-card' +
        (isChecked ? " lbp-checked" : "") +
        '" data-load="' +
        escapeHtml(loadNum) +
        '"><div class="lbp-load-header"><span class="lbp-load-num">#' +
        escapeHtml(loadNum) +
        '</span><span class="load-status status-' +
        escapeHtml(load.status) +
        '">' +
        (statusLabels[load.status] || load.status) +
        '</span></div><div class="lbp-load-meta">📅 Worked: ' +
        work +
        (load.dueDate ? " · Due: " + due : "") +
        (load.stairs ? " · 📊 " + load.stairs + " stairs" : "") +
        '</div><div class="lbp-load-actions">' +
        '<button type="button" class="drive-btn lbp-drive-btn" data-load="' +
        escapeHtml(loadNum) +
        '">' +
        (hasLink ? "📁 Open folder" : "🔍 Find in Drive") +
        '</button><button type="button" class="lbp-check-btn' +
        (isChecked ? " is-checked" : "") +
        '" data-load="' +
        escapeHtml(loadNum) +
        '">' +
        (isChecked ? "✅ Load checked" : "☑️ Check load") +
        "</button></div></div>"
      );
    })
    .join("");

  detail.innerHTML =
    '<div class="lbp-detail-head">' +
    '<button type="button" class="back-btn" id="lbpBackToPeople">← All people</button>' +
    '<h3><span class="lbp-dot" style="background:' +
    person.color +
    ';"></span> ' +
    escapeHtml(person.initials || "?") +
    " · " +
    escapeHtml(person.name) +
    '</h3><div class="lbp-detail-sub">' +
    mine.length +
    " load" +
    (mine.length === 1 ? "" : "s") +
    " · newest first</div></div>" +
    (mine.length
      ? '<div class="lbp-load-list">' + rows + "</div>"
      : '<div class="parts-note">No loads for this person.</div>');

  document.getElementById("lbpBackToPeople").addEventListener("click", function () {
    selectedPerson = null;
    detail.style.display = "none";
    detail.innerHTML = "";
    if (view) view.style.display = "";
    renderPersonCards(cachedLoads);
  });
  detail.querySelectorAll(".lbp-drive-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      handleDriveClick(btn.getAttribute("data-load"), btn);
    });
  });
  detail.querySelectorAll(".lbp-check-btn").forEach(function (btn) {
    btn.addEventListener("click", async function () {
      const loadNum = btn.getAttribute("data-load");
      const map = loadCheckedMap();
      if (map[loadNum]) {
        const clear = await showCheckModal({
          title: "Clear check?",
          message: "Clear checked status for load #" + loadNum + "?",
          buttons: [
            { id: "no", label: "Keep checked", primary: true },
            { id: "yes", label: "Clear", primary: false },
          ],
        });
        if (clear !== "yes") return;
        delete map[loadNum];
        saveCheckedMap(map);
        showPersonDetail();
        return;
      }
      const originalLabel = btn.textContent;
      btn.disabled = true;
      btn.textContent = "⏳ Checking…";
      try {
        await ensureDriveReady(true);
        const result = await runLoadCheck(loadNum);
        if (result.needSignIn) {
          await showCheckModal({
            title: "Drive sign-in needed",
            message: result.message,
            buttons: [{ id: "ok", label: "OK", primary: true }],
          });
          btn.textContent = originalLabel;
          btn.disabled = false;
          return;
        }
        if (result.ok) {
          map[loadNum] = {
            checkedAt: new Date().toISOString(),
            by: localStorage.getItem("userName") || "SA",
            auto: true,
            fields: result.details && result.details.msFields,
          };
          saveCheckedMap(map);
          await showCheckModal({
            title: "Load #" + loadNum + " — checked",
            html: formatCheckResultHtml(loadNum, result),
            buttons: [{ id: "ok", label: "OK", primary: true }],
          });
          showPersonDetail();
          return;
        }
        const choice = await showCheckModal({
          title: "Load #" + loadNum + " — review needed",
          html: formatCheckResultHtml(loadNum, result),
          buttons: [
            { id: "manual", label: "Mark checked anyway", primary: false },
            { id: "cancel", label: "Leave unchecked", primary: true },
          ],
        });
        if (choice === "manual") {
          map[loadNum] = {
            checkedAt: new Date().toISOString(),
            by: localStorage.getItem("userName") || "SA",
            auto: false,
            note: "manual after failed auto-check",
            fields: result.details && result.details.msFields,
          };
          saveCheckedMap(map);
        }
        showPersonDetail();
      } catch (e) {
        console.error(e);
        await showCheckModal({
          title: "Check failed",
          message: e && e.message ? e.message : String(e),
          buttons: [{ id: "ok", label: "OK", primary: true }],
        });
        btn.textContent = originalLabel;
        btn.disabled = false;
      }
    });
  });
}

export function renderLoadsByPerson() {
  const stair = window._stairEntries || [];
  const forecast = window._forecastEntries || [];
  cachedLoads = parseLoads(stair, forecast);
  const totalEl = document.getElementById("loadsTotal");
  if (totalEl) totalEl.textContent = String(cachedLoads.length);
  const detail = document.getElementById("loadsPersonDetail");
  const view = document.getElementById("loadsPersonView");
  if (selectedPerson != null && detail && detail.style.display !== "none") {
    showPersonDetail();
  } else {
    if (detail) {
      detail.style.display = "none";
      detail.innerHTML = "";
    }
    if (view) view.style.display = "";
    selectedPerson = null;
    renderPersonCards(cachedLoads);
  }
}

window.renderLoadsByPerson = renderLoadsByPerson;
