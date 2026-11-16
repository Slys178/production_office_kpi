/**
 * Replacement Parts — loads sheet itself (does not rely on CDN _rpEntries),
 * groups by SECTION (column K), click section to list rows.
 */
import { CONFIG } from "./config.js";
import { fetchGvizRows, parseReplacementPartsRows } from "./data.js";
import { fmtDate } from "./utils.js";

let selectedSection = null;
let loading = false;
let lastError = null;

function escapeHtml(s) {
  const el = document.createElement("div");
  el.textContent = String(s == null ? "" : s);
  return el.innerHTML;
}

function groupBySection(entries) {
  const map = {};
  (entries || []).forEach(function (e) {
    const key = (e.section || "UNSPECIFIED").toUpperCase();
    if (!map[key]) {
      map[key] = {
        key: key,
        label: e.sectionLabel || key,
        entries: [],
        cost: 0,
        count: 0,
      };
    }
    map[key].entries.push(e);
    map[key].cost += Number(e.cost) || 0;
    map[key].count += 1;
  });
  return Object.keys(map)
    .sort()
    .map(function (k) {
      map[k].entries.sort(function (a, b) {
        return b.date && a.date ? b.date - a.date : 0;
      });
      return map[k];
    });
}

function ensureDom() {
  const page = document.getElementById("replacementPartsPage");
  if (!page) return null;

  let sectionHost = document.getElementById("rpSectionCards");
  if (!sectionHost) {
    sectionHost = document.createElement("div");
    sectionHost.id = "rpSectionCards";
    sectionHost.className = "office-error-grid";
    sectionHost.style.margin = "16px 0";
    const summary = document.getElementById("rpSummaryStats");
    if (summary && summary.parentNode) {
      summary.parentNode.insertBefore(sectionHost, summary.nextSibling);
    } else {
      page.appendChild(sectionHost);
    }
  }

  let detail = document.getElementById("rpSectionDetail");
  if (!detail) {
    detail = document.createElement("div");
    detail.id = "rpSectionDetail";
    detail.className = "office-error-detail";
    detail.style.display = "none";
    sectionHost.parentNode.insertBefore(detail, sectionHost.nextSibling);
  }

  return { page: page, sectionHost: sectionHost, detail: detail };
}

function hideLegacyLists() {
  ["rpTopParts", "rpTopReasons", "rpRecentList", "rpCostTrend", "rpCountTrend"].forEach(
    function (id) {
      const el = document.getElementById(id);
      if (el) el.style.display = "none";
    }
  );
}

function setSummaryMessage(html) {
  const summary = document.getElementById("rpSummaryStats");
  if (summary) summary.innerHTML = html;
}

function renderFromEntries(entries) {
  const dom = ensureDom();
  if (!dom) return;
  hideLegacyLists();

  const today = new Date();
  const totalCost = entries.reduce(function (s, e) {
    return s + (Number(e.cost) || 0);
  }, 0);
  const thisMonth = entries.filter(function (e) {
    return (
      e.date &&
      e.date.getFullYear() === today.getFullYear() &&
      e.date.getMonth() === today.getMonth()
    );
  });
  const thisMonthCost = thisMonth.reduce(function (s, e) {
    return s + (Number(e.cost) || 0);
  }, 0);

  setSummaryMessage(
    '<div class="detail-stat-card"><div class="label">All sections</div><div class="value">' +
      entries.length +
      "</div></div>" +
      '<div class="detail-stat-card"><div class="label">Total cost</div><div class="value negative">£' +
      totalCost.toFixed(2) +
      "</div></div>" +
      '<div class="detail-stat-card"><div class="label">This month</div><div class="value">' +
      thisMonth.length +
      "</div></div>" +
      '<div class="detail-stat-card"><div class="label">This month cost</div><div class="value negative">£' +
      thisMonthCost.toFixed(2) +
      "</div></div>"
  );

  const groups = groupBySection(entries);

  if (!groups.length) {
    dom.sectionHost.innerHTML =
      '<div class="parts-note" style="grid-column:1/-1;padding:16px;">' +
      "No replacement parts found. Check the sheet is shared “Anyone with the link can view”, " +
      "and that rows have a Date + SECTION (column K).</div>";
    dom.detail.style.display = "none";
    dom.detail.innerHTML = "";
    return;
  }

  dom.sectionHost.innerHTML = groups
    .map(function (g) {
      const selected = selectedSection === g.key ? " selected" : "";
      return (
        '<button type="button" class="office-error-card' +
        selected +
        '" data-section="' +
        escapeHtml(g.key) +
        '">' +
        '<div class="oe-name" style="margin-bottom:8px;">' +
        escapeHtml(g.label) +
        "</div>" +
        '<div class="oe-points negative">£' +
        g.cost.toFixed(0) +
        "</div>" +
        '<div class="oe-sub">section cost</div>' +
        '<div class="oe-meta">' +
        g.count +
        " replacement" +
        (g.count === 1 ? "" : "s") +
        "</div></button>"
      );
    })
    .join("");

  dom.sectionHost.querySelectorAll(".office-error-card").forEach(function (btn) {
    btn.addEventListener("click", function () {
      selectedSection = btn.getAttribute("data-section");
      renderFromEntries(entries);
      if (dom.detail) dom.detail.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  if (
    !selectedSection ||
    !groups.some(function (g) {
      return g.key === selectedSection;
    })
  ) {
    dom.detail.style.display = "none";
    dom.detail.innerHTML = "";
    return;
  }

  const g = groups.find(function (x) {
    return x.key === selectedSection;
  });
  const rows = g.entries
    .map(function (e) {
      return (
        '<div class="oe-error-row" style="grid-template-areas:\'main points\';">' +
        '<div class="oe-error-main">' +
        '<div class="oe-error-date">' +
        escapeHtml(fmtDate(e.date)) +
        (e.plot ? " · Plot " + escapeHtml(e.plot) : "") +
        (e.loadNo ? " · Load " + escapeHtml(e.loadNo) : "") +
        "</div>" +
        '<div class="oe-error-issue">' +
        escapeHtml(e.part) +
        (e.quantity > 1 ? " (x" + e.quantity + ")" : "") +
        "</div>" +
        '<div class="oe-error-impact">' +
        escapeHtml(e.reason || "") +
        (e.material ? " · " + escapeHtml(e.material) : "") +
        (e.operator ? " · " + escapeHtml(e.operator) : "") +
        "</div></div>" +
        '<div class="oe-error-points">£' +
        (Number(e.cost) || 0).toFixed(2) +
        "</div></div>"
      );
    })
    .join("");

  dom.detail.style.display = "";
  dom.detail.innerHTML =
    '<div class="oe-detail-header">' +
    '<button type="button" class="back-btn" id="rpCloseSection">← All sections</button>' +
    "<h3>" +
    escapeHtml(g.label) +
    "</h3>" +
    '<div class="oe-detail-total">' +
    g.count +
    " replacement" +
    (g.count === 1 ? "" : "s") +
    ' · <strong class="negative">£' +
    g.cost.toFixed(2) +
    "</strong></div></div>" +
    '<div class="oe-error-list">' +
    rows +
    "</div>";

  const back = document.getElementById("rpCloseSection");
  if (back) {
    back.addEventListener("click", function () {
      selectedSection = null;
      renderFromEntries(entries);
    });
  }
}

export async function loadAndRenderReplacementParts(force) {
  const dom = ensureDom();
  if (!dom) return;
  if (loading && !force) return;
  loading = true;
  lastError = null;

  hideLegacyLists();
  setSummaryMessage(
    '<div class="parts-note" style="padding:12px;">Loading replacement parts…</div>'
  );
  if (dom.sectionHost) {
    dom.sectionHost.innerHTML =
      '<div class="parts-note" style="grid-column:1/-1;padding:12px;">Loading from Google Sheet…</div>';
  }

  try {
    const sheetId = CONFIG.sheets.replacementParts.id;
    const gid = CONFIG.sheets.replacementParts.gid;
    const rows = await fetchGvizRows(sheetId, gid);
    const entries = parseReplacementPartsRows(rows);
    window._rpEntries = entries;
    window._today = window._today || new Date();
    renderFromEntries(entries);
  } catch (err) {
    console.error("Replacement parts load failed", err);
    lastError = err;
    setSummaryMessage(
      '<div class="parts-note" style="color:var(--red,#e74c3c);padding:12px;">' +
        "Could not load replacement parts: " +
        escapeHtml(err && err.message ? err.message : String(err)) +
        ". Share the sheet as “Anyone with the link can view”.</div>"
    );
    if (dom.sectionHost) {
      dom.sectionHost.innerHTML =
        '<div class="parts-note" style="grid-column:1/-1;color:var(--red,#e74c3c);padding:12px;">' +
        "Load failed. Check sheet sharing, then reopen this tab.</div>";
    }
  } finally {
    loading = false;
  }
}

/** Called from nav / main.js */
export function enhanceReplacementPartsView() {
  loadAndRenderReplacementParts(false);
}

window.loadAndRenderReplacementParts = loadAndRenderReplacementParts;
window.enhanceReplacementPartsView = enhanceReplacementPartsView;
window.renderReplacementPartsBySection = function () {
  loadAndRenderReplacementParts(false);
};
