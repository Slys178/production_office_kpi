/**
 * Replacement Parts — section breakdown (column K),
 * click a section to list its replacements.
 * Overrides the CDN OFFICE-only summary when data is available.
 */

import { fmtDate } from "./utils.js";

let selectedSection = null;

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
        return (b.date && a.date) ? b.date - a.date : 0;
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
    sectionHost.style.marginBottom = "16px";
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

  return { sectionHost: sectionHost, detail: detail };
}

function hideLegacyLists() {
  ["rpTopParts", "rpTopReasons", "rpRecentList"].forEach(function (id) {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  });
}

export function renderReplacementPartsBySection() {
  const entries = window._rpEntries || [];
  const today = window._today || new Date();
  const dom = ensureDom();
  if (!dom) return;

  hideLegacyLists();

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

  const summary = document.getElementById("rpSummaryStats");
  if (summary) {
    summary.innerHTML =
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
      "</div></div>";
  }

  const groups = groupBySection(entries);

  if (!groups.length) {
    dom.sectionHost.innerHTML =
      '<div class="parts-note">No replacement parts logged (check sheet share + SECTION column).</div>';
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
        "</div>" +
        "</button>"
      );
    })
    .join("");

  dom.sectionHost.querySelectorAll(".office-error-card").forEach(function (btn) {
    btn.addEventListener("click", function () {
      selectedSection = btn.getAttribute("data-section");
      renderReplacementPartsBySection();
      if (dom.detail) {
        dom.detail.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });

  if (!selectedSection || !groups.some(function (g) {
    return g.key === selectedSection;
  })) {
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
    " · <strong class="negative">£" +
    g.cost.toFixed(2) +
    "</strong></div></div>" +
    '<div class="oe-error-list">' +
    rows +
    "</div>";

  const back = document.getElementById("rpCloseSection");
  if (back) {
    back.addEventListener("click", function () {
      selectedSection = null;
      renderReplacementPartsBySection();
    });
  }
}

window.renderReplacementPartsBySection = renderReplacementPartsBySection;

/** Hook after CDN render when tile is opened or data refreshes */
export function enhanceReplacementPartsView() {
  try {
    renderReplacementPartsBySection();
  } catch (e) {
    console.warn("replacement parts sections", e);
  }
}

window.enhanceReplacementPartsView = enhanceReplacementPartsView;
