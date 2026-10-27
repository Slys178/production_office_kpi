/**
 * Load check — MS TOP (Google Doc) vs SNIP.xml (Compass)
 * Results are per-plot: Plot | House type | Handing | FFL | tick/cross
 */
import {
  gapiSignedIn,
  searchDriveFolder,
  listFolderFiles,
  downloadDriveFile,
  showDriveSignIn,
  ensureDriveReady,
} from "./drive.js";

let pdfjsLib = null;
let pdfjsReady = null;

async function ensurePdfJs() {
  if (pdfjsLib) return pdfjsLib;
  if (window.pdfjsLib) {
    pdfjsLib = window.pdfjsLib;
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    return pdfjsLib;
  }
  if (!pdfjsReady) {
    pdfjsReady = new Promise(function (resolve, reject) {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
      s.async = true;
      s.onload = function () {
        if (!window.pdfjsLib) {
          reject(new Error("pdf.js loaded but pdfjsLib missing"));
          return;
        }
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        resolve(window.pdfjsLib);
      };
      s.onerror = function () {
        reject(new Error("Failed to load pdf.js from CDN"));
      };
      document.head.appendChild(s);
    });
  }
  pdfjsLib = await pdfjsReady;
  return pdfjsLib;
}

function classifyFileName(name) {
  const n = String(name || "")
    .toUpperCase()
    .replace(/\.(PDF|PNG|JPG|JPEG|DOC|DOCX|XML|TXT|CSV|HTML|HTM)$/i, "");
  // MS TOP variants: "MS TOP", "MS TOP SHEET", "M/S TOP", "MSTOP"
  if (/M\s*[\/]?\s*S[\s_\-]*TOP/.test(n) || /\bMSTOP\b/.test(n)) return "ms_top";
  if (/\bMANUFACTURING\b/.test(n) && /\bTOP\b/.test(n)) return "ms_top";
  if (/SNIP[\s_\-]*0*2\b/.test(n) || /SNIP[\s_\-]*0*2$/.test(n)) return "snip_2";
  if (/SNIP[\s_\-]*0*1\b/.test(n) || /SNIP[\s_\-]*0*1$/.test(n)) return "snip_1";
  if (/\bSNIP\b/.test(n)) return "snip";
  return null;
}

function pickPreferredFile(files) {
  if (!files || !files.length) return null;
  const score = function (f) {
    const mt = (f.mimeType || "").toLowerCase();
    const n = (f.name || "").toLowerCase();
    if (mt === "application/vnd.google-apps.document") return 100;
    if (n.endsWith(".xml") || mt.indexOf("xml") !== -1) return 90;
    if (n.endsWith(".txt") || n.endsWith(".csv") || mt.indexOf("text/") === 0) return 80;
    if (n.endsWith(".pdf") || mt.indexOf("pdf") !== -1) return 40;
    if (mt.indexOf("image/") === 0 || /\.(png|jpe?g)$/.test(n)) return 10;
    return 20;
  };
  return files.slice().sort(function (a, b) {
    return score(b) - score(a);
  })[0];
}

function htmlTableToText(html) {
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const parts = [];
    doc.querySelectorAll("table").forEach(function (table) {
      table.querySelectorAll("tr").forEach(function (tr) {
        const cells = [];
        tr.querySelectorAll("th,td").forEach(function (td) {
          cells.push((td.textContent || "").replace(/\s+/g, " ").trim());
        });
        if (cells.some(Boolean)) parts.push(cells.join(" | "));
      });
      parts.push("");
    });
    if (doc.body) parts.push(doc.body.innerText);
    return parts.join("\n");
  } catch (_) {
    return String(html || "").replace(/<[^>]+>/g, " ");
  }
}

function xmlToSearchableText(xml) {
  const raw = String(xml || "");
  let s = raw
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/&/g, "&")
    .replace(/"/g, '"')
    .replace(/&#(\d+);/g, function (_, n) {
      return String.fromCharCode(Number(n));
    });
  const labelled = [];
  const tagRe = /<([A-Za-z][A-Za-z0-9_\-]*)\b([^>]*)>([^<]*)</g;
  let m;
  while ((m = tagRe.exec(s))) {
    const tag = m[1];
    const attrs = m[2] || "";
    const val = (m[3] || "").trim();
    if (val) labelled.push(tag + ": " + val);
    const attrRe = /([A-Za-z][A-Za-z0-9_\-]*)\s*=\s*["']([^"']+)["']/g;
    let a;
    while ((a = attrRe.exec(attrs))) labelled.push(a[1] + ": " + a[2]);
  }
  const selfRe = /<([A-Za-z][A-Za-z0-9_\-]*)\b([^>]*?)\/>/g;
  while ((m = selfRe.exec(s))) {
    const attrs = m[2] || "";
    const attrRe = /([A-Za-z][A-Za-z0-9_\-]*)\s*=\s*["']([^"']+)["']/g;
    let a;
    while ((a = attrRe.exec(attrs))) {
      labelled.push(m[1] + " " + a[1] + ": " + a[2]);
      labelled.push(a[1] + ": " + a[2]);
    }
  }
  return labelled.join("\n") + "\n" + s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

let tesseractReady = null;
function loadTesseractScript() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (tesseractReady) return tesseractReady;
  tesseractReady = new Promise(function (resolve, reject) {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
    s.async = true;
    s.onload = function () {
      if (window.Tesseract) resolve(window.Tesseract);
      else reject(new Error("Tesseract missing"));
    };
    s.onerror = function () {
      reject(new Error("Failed to load Tesseract"));
    };
    document.head.appendChild(s);
  });
  return tesseractReady;
}

async function extractTextFromImage(arrayBuffer, mimeType) {
  const Tesseract = await loadTesseractScript();
  const blob = new Blob([arrayBuffer], { type: mimeType || "image/png" });
  if (typeof Tesseract.createWorker === "function") {
    const worker = await Tesseract.createWorker("eng");
    try {
      const result = await worker.recognize(blob);
      return (result && result.data && result.data.text) || "";
    } finally {
      try {
        await worker.terminate();
      } catch (_) {}
    }
  }
  if (typeof Tesseract.recognize === "function") {
    const result = await Tesseract.recognize(blob, "eng");
    return (result && result.data && result.data.text) || "";
  }
  throw new Error("Tesseract API not available");
}

async function extractTextFromPdf(arrayBuffer) {
  const pdfjs = await ensurePdfJs();
  const doc = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  const parts = [];
  for (let i = 1; i <= Math.min(doc.numPages, 4); i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    parts.push(content.items.map(function (it) { return it.str || ""; }).join(" "));
  }
  let text = parts.join("\n").trim();
  if (text) return text;
  const ocrParts = [];
  for (let i = 1; i <= Math.min(doc.numPages, 2); i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext("2d"), viewport: viewport }).promise;
    const blob = await new Promise(function (resolve) { canvas.toBlob(resolve, "image/png"); });
    if (!blob) continue;
    const pageText = await extractTextFromImage(await blob.arrayBuffer(), "image/png");
    if (pageText) ocrParts.push(pageText);
  }
  return ocrParts.join("\n");
}

function isImageFile(name, mimeType) {
  const mt = (mimeType || "").toLowerCase();
  const n = (name || "").toLowerCase();
  if (mt.indexOf("image/") === 0) return true;
  return /\.(png|jpe?g|webp|gif|bmp)$/.test(n);
}

async function fileToText(file) {
  const downloaded = await downloadDriveFile(file.id, file.mimeType, file.name);
  if (!downloaded) return { text: "", error: "Could not download " + file.name };
  if (downloaded.type === "text") {
    let text = downloaded.text || "";
    const name = (file.name || "").toLowerCase();
    const via = downloaded.via || "";
    if (via === "gdoc-html" || /<html|<table|<body/i.test(text))
      return { text: htmlTableToText(text), error: null, via: "gdoc" };
    if (name.endsWith(".xml") || (downloaded.mimeType || "").indexOf("xml") !== -1 || /^\s*</.test(text))
      return { text: xmlToSearchableText(text), error: null, via: "xml" };
    return { text: text, error: null, via: "text" };
  }
  const mt = (downloaded.mimeType || file.mimeType || "").toLowerCase();
  const name = file.name || "";
  if (isImageFile(name, mt)) {
    try {
      const text = await extractTextFromImage(downloaded.buffer, mt || "image/png");
      if (!text || !text.trim()) return { text: "", error: name + " — no OCR text" };
      return { text: text, error: null, via: "ocr" };
    } catch (e) {
      return { text: "", error: "OCR failed: " + (e.message || e) };
    }
  }
  if (mt.indexOf("pdf") !== -1 || name.toLowerCase().endsWith(".pdf")) {
    try {
      const text = await extractTextFromPdf(downloaded.buffer);
      if (text && text.trim()) return { text: text, error: null, via: "pdf" };
      return { text: "", error: name + " — no text in PDF" };
    } catch (e) {
      return { text: "", error: "PDF failed: " + (e.message || e) };
    }
  }
  return { text: "", error: name + " — prefer Google Doc or SNIP.xml" };
}

function norm(s) {
  return String(s || "").toUpperCase().replace(/\s+/g, " ").trim();
}
function normalizeHanding(raw) {
  if (!raw) return null;
  const u = norm(raw);
  if (/\bRH\b/.test(u) || /RIGHT\s*HAND/.test(u) || /^RIGHT$/.test(u)) return "RH";
  if (/\bLH\b/.test(u) || /LEFT\s*HAND/.test(u) || /^LEFT$/.test(u)) return "LH";
  return u;
}
function normalizeFfl(raw) {
  if (!raw) return null;
  const m = String(raw).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return m ? m[0] : norm(raw);
}
function normalizeHouse(raw) {
  if (!raw) return null;
  return norm(raw).replace(/^TYPE\s+/, "");
}

const JUNK_HOUSE = /^(STRING|INT|INTEGER|BOOL|BOOLEAN|FLOAT|DOUBLE|NUMBER|NULL|TRUE|FALSE|VALUE|TEXT|DATA|TYPE|HANDING|FFL|PLOT|LOAD|STAIR|THE|AND|FOR|WS|LHWS|RHWS)$/i;

export function extractPlots(text) {
  const t = String(text || "");
  const upper = t.toUpperCase();
  const rows = [];
  t.split(/\n+/).forEach(function (line) {
    const u = line.toUpperCase();
    if (!/\d/.test(u)) return;
    if (/^[\s|]*PLOT[\s|]*HOUSE/.test(u) && !/\d{2,}/.test(u)) return;
    let plot = null, houseType = null, handing = null, ffl = null;
    let m = u.match(/\bPLOT\s*(?:NO\.?|NUMBER|#)?\s*[:\|\-]?\s*(\d{1,6})\b/);
    if (m) plot = m[1];
    m = u.match(/\b(?:HOUSE\s*)?TYPE\s*[:\|\-#]?\s*([A-Z0-9][A-Z0-9\-\/]{0,16})\b/);
    if (m && !JUNK_HOUSE.test(m[1])) houseType = m[1].replace(/[^A-Z0-9\-\/].*$/, "").trim();
    m = u.match(/\bHANDING\s*[:\|\-]?\s*(LH|RH)\b/) || u.match(/\b(LH|RH)\s*W(?:S|C)?\b/) ||
        u.match(/(?:^|[^A-Z0-9])(LH|RH)(?=[^A-Z0-9]|$)/);
    if (m) handing = m[1];
    m = u.match(/\bFFL\s*[:\|\-]?\s*([+-]?\d+(?:\.\d+)?)/);
    if (m) ffl = m[1];
    if (!plot && u.indexOf("|") !== -1) {
      u.split("|").map(function (c) { return c.trim(); }).filter(Boolean).forEach(function (c) {
        if (!plot && /^\d{1,6}$/.test(c)) plot = c;
        else if (!handing && /^(LH|RH)$/.test(c)) handing = c;
        else if (!ffl && /^[+-]?\d+(\.\d+)?$/.test(c) && Number(c) < 5000) {
          if (!houseType && /^\d{1,3}$/.test(c)) houseType = c;
          else ffl = c;
        } else if (!houseType && /^[A-Z0-9\-\/]{2,12}$/.test(c) && !JUNK_HOUSE.test(c) && !/^(WK|REG)$/.test(c))
          houseType = c;
      });
    }
    if (plot || handing || houseType || ffl) {
      if (plot && !houseType) {
        const near = upper.match(new RegExp("PLOT\\s*" + plot + "\\s+([A-Z]\\d{3,5})\\b"));
        if (near) houseType = near[1];
      }
      rows.push({
        plot: plot,
        houseType: normalizeHouse(houseType),
        handing: normalizeHanding(handing),
        ffl: normalizeFfl(ffl),
      });
    }
  });
  if (!rows.length) {
    const plotM = upper.match(/\bPLOT\s*(?:NO\.?|NUMBER|#)?\s*[:\|\-]?\s*(\d{1,6})\b/);
    let houseType = null, handing = null, ffl = null;
    let m = upper.match(/\bTYPE\s*[:\|\-#]\s*([A-Z0-9][A-Z0-9\-\/]{0,16})/);
    if (m && !JUNK_HOUSE.test(m[1])) houseType = m[1];
    if (!houseType && plotM) {
      const near = upper.match(new RegExp("PLOT\\s*" + plotM[1] + "\\s+([A-Z]\\d{3,5})\\b"));
      if (near) houseType = near[1];
    }
    m = upper.match(/\b(LH|RH)\s*W(?:S|C)?\b/) || upper.match(/HANDING\s*[:\|\-]?\s*(LH|RH)\b/) ||
        upper.match(/(?:^|[^A-Z0-9])(LH|RH)(?=[^A-Z0-9]|$)/);
    if (m) handing = m[1];
    m = upper.match(/\bFFL\s*[:\|\-]?\s*([+-]?\d+(?:\.\d+)?)/);
    if (m) ffl = m[1];
    if (plotM || handing || houseType || ffl) {
      rows.push({
        plot: plotM ? plotM[1] : null,
        houseType: normalizeHouse(houseType),
        handing: normalizeHanding(handing),
        ffl: normalizeFfl(ffl),
      });
    }
  }
  const byPlot = {};
  const noPlot = [];
  rows.forEach(function (r) {
    if (r.plot) {
      const k = String(r.plot);
      if (!byPlot[k]) byPlot[k] = r;
      else ["houseType", "handing", "ffl"].forEach(function (f) {
        if (!byPlot[k][f] && r[f]) byPlot[k][f] = r[f];
      });
    } else noPlot.push(r);
  });
  return Object.keys(byPlot)
    .sort(function (a, b) { return Number(a) - Number(b); })
    .map(function (k) { return byPlot[k]; })
    .concat(noPlot);
}

export function extractFields(text) {
  const plots = extractPlots(text);
  if (plots.length === 1) {
    const p = plots[0];
    return {
      handing: p.handing,
      ffl: p.ffl,
      houseType: p.houseType,
      plot: p.plot,
      hints: {},
      rawSample: String(text || "").slice(0, 600).replace(/\s+/g, " "),
      plots: plots,
    };
  }
  const upper = String(text || "").toUpperCase();
  let handing = null, ffl = null, houseType = null, plot = null;
  let m = upper.match(/HANDING\s*[:\|\-]?\s*(LH|RH|LEFT\s*HAND(?:ED)?|RIGHT\s*HAND(?:ED)?|LEFT|RIGHT)\b/);
  if (!m) m = upper.match(/\b(LH|RH)\s*W(?:S|C)?\b/);
  if (!m) m = upper.match(/(?:^|[^A-Z0-9])(LH|RH)(?=[^A-Z0-9]|$)/);
  if (m) handing = m[1];
  m = upper.match(/\bFFL\s*[:\|\-]?\s*([+-]?\d+(?:\.\d+)?)/);
  if (m) ffl = m[1];
  m = upper.match(/HOUSE\s*TYPE\s*[:\|\-#]?\s*([A-Z0-9][A-Z0-9\-\/]{0,16})/) ||
      upper.match(/\bTYPE\s*[:\|\-#]\s*([A-Z0-9][A-Z0-9\-\/]{0,16})/);
  if (m && !JUNK_HOUSE.test(m[1])) houseType = m[1].trim().replace(/[^A-Z0-9\-\/].*$/, "").trim();
  m = upper.match(/\bPLOT\s*(?:NO\.?|NUMBER|#)?\s*[:\|\-]?\s*(\d{1,6})\b/);
  if (m) plot = m[1];
  return {
    handing: normalizeHanding(handing),
    ffl: normalizeFfl(ffl),
    houseType: normalizeHouse(houseType),
    plot: plot ? String(plot) : null,
    hints: {},
    rawSample: String(text || "").slice(0, 600).replace(/\s+/g, " "),
    plots: plots,
  };
}

export function buildPlotComparison(msText, snipText) {
  const msPlots = extractPlots(msText);
  const snipPlots = extractPlots(snipText);
  const msBy = {}, snipBy = {}, allPlots = {};
  msPlots.forEach(function (p) { if (p.plot) { msBy[p.plot] = p; allPlots[p.plot] = true; } });
  snipPlots.forEach(function (p) { if (p.plot) { snipBy[p.plot] = p; allPlots[p.plot] = true; } });
  let keys = Object.keys(allPlots).sort(function (a, b) { return Number(a) - Number(b); });
  if (!keys.length) {
    const ms = extractFields(msText);
    const sn = extractFields(snipText);
    keys = ["—"];
    msBy["—"] = { plot: null, houseType: ms.houseType, handing: ms.handing, ffl: ms.ffl };
    snipBy["—"] = { plot: null, houseType: sn.houseType, handing: sn.handing, ffl: sn.ffl };
  }
  function cell(msVal, snipVal) {
    const a = msVal != null && msVal !== "" ? String(msVal) : null;
    const b = snipVal != null && snipVal !== "" ? String(snipVal) : null;
    if (a == null && b == null) return { ms: null, snip: null, status: "missing" };
    if (a == null || b == null) return { ms: a, snip: b, status: "partial" };
    if (a === b) return { ms: a, snip: b, status: "ok" };
    return { ms: a, snip: b, status: "diff" };
  }
  const plotRows = keys.map(function (k) {
    const ms = msBy[k] || {};
    const sn = snipBy[k] || {};
    const house = cell(ms.houseType, sn.houseType);
    const hand = cell(ms.handing, sn.handing);
    const ffl = cell(ms.ffl, sn.ffl);
    const fields = [house, hand, ffl];
    let rowStatus = "ok";
    if (fields.some(function (f) { return f.status === "diff"; })) rowStatus = "diff";
    else if (fields.every(function (f) { return f.status === "missing"; })) rowStatus = "missing";
    else if (fields.some(function (f) { return f.status === "partial" || f.status === "missing"; })) rowStatus = "partial";
    return {
      plot: k === "—" ? null : k,
      houseType: house,
      handing: hand,
      ffl: ffl,
      status: rowStatus,
    };
  });
  return { plotRows: plotRows, msPlots: msPlots, snipPlots: snipPlots };
}

export async function runLoadCheck(loadNumber) {
  const ready = await ensureDriveReady(true);
  if (!ready || !gapiSignedIn) {
    return { ok: false, needSignIn: true, message: "Sign in to Drive first.", details: null };
  }
  const folder = await searchDriveFolder(loadNumber);
  if (!folder || !folder.id) {
    return { ok: false, message: "Could not find folder for load #" + loadNumber + ".", details: null };
  }
  const files = await listFolderFiles(folder.id);
  if (!files.length) {
    return { ok: false, message: "Folder empty.", details: { folderName: folder.name } };
  }
  const classified = { ms_top: [], snip: [], snip_1: [], snip_2: [], other: [] };
  files.forEach(function (f) {
    const role = classifyFileName(f.name);
    if (role && classified[role]) classified[role].push(f);
    else classified.other.push(f);
  });
  let snipFiles = classified.snip_1.length || classified.snip_2.length
    ? classified.snip_1.concat(classified.snip_2)
    : classified.snip.slice();
  if (!classified.ms_top.length) {
    const names = files.map(function (f) { return f.name; });
    return {
      ok: false,
      message:
        "No MS TOP file found in this folder.\n" +
        "Rename your Google Doc so the name includes “MS TOP”\n" +
        "e.g. “#119573 MS TOP” or “MS TOP SHEET”.\n\n" +
        "Files in folder:\n• " +
        (names.length ? names.join("\n• ") : "(none)"),
      details: { folderName: folder.name, files: names },
    };
  }
  if (!snipFiles.length) {
    const names = files.map(function (f) { return f.name; });
    return {
      ok: false,
      message:
        "No SNIP file found.\n" +
        "Add Compass export named with “SNIP” e.g. “SNIP.xml”.\n\n" +
        "Files in folder:\n• " +
        (names.length ? names.join("\n• ") : "(none)"),
      details: { folderName: folder.name, files: names },
    };
  }
  const msFile = pickPreferredFile(classified.ms_top);
  const structuredSnips = snipFiles.filter(function (f) {
    const n = (f.name || "").toLowerCase();
    const mt = (f.mimeType || "").toLowerCase();
    return n.endsWith(".xml") || n.endsWith(".txt") || mt.indexOf("xml") !== -1 || mt.indexOf("text/") === 0;
  });
  if (structuredSnips.length) snipFiles = structuredSnips;
  else snipFiles = [pickPreferredFile(snipFiles)].filter(Boolean);

  const msResult = await fileToText(msFile);
  const snipTexts = [];
  const snipErrors = [];
  for (let i = 0; i < snipFiles.length; i++) {
    const r = await fileToText(snipFiles[i]);
    if (r.error) snipErrors.push(r.error);
    snipTexts.push({ name: snipFiles[i].name, text: r.text, via: r.via });
  }
  if (msResult.error && !msResult.text) {
    return { ok: false, message: msResult.error, details: { folderName: folder.name } };
  }
  const combinedSnipText = snipTexts.map(function (s) { return s.text; }).join("\n");
  if (!combinedSnipText.trim() && snipErrors.length) {
    return { ok: false, message: snipErrors.join("\n"), details: { folderName: folder.name } };
  }

  const msFields = extractFields(msResult.text);
  const snipFields = extractFields(combinedSnipText);
  const plotCompare = buildPlotComparison(msResult.text, combinedSnipText);

  const details = {
    folderName: folder.name,
    msFile: msFile.name,
    snipFiles: snipFiles.map(function (f) { return f.name; }),
    msFields: msFields,
    snipFields: snipFields,
    plotRows: plotCompare.plotRows,
    msVia: msResult.via,
    snipVia: snipTexts.map(function (s) { return s.via; }),
  };

  const hasDiff = plotCompare.plotRows.some(function (r) { return r.status === "diff"; });
  const allOk =
    plotCompare.plotRows.length > 0 &&
    plotCompare.plotRows.every(function (r) { return r.status === "ok"; });

  if (allOk) {
    return {
      ok: true,
      message: "All plots match.",
      details: details,
      plotRows: plotCompare.plotRows,
    };
  }

  return {
    ok: false,
    message: hasDiff
      ? "Differences on one or more plots."
      : "Some fields missing — check MS TOP table labels.",
    details: details,
    plotRows: plotCompare.plotRows,
    partial: !hasDiff,
  };
}

window.runLoadCheck = runLoadCheck;
