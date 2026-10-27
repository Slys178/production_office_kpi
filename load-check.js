/**
 * Load check — compare MS TOP vs SNIP(s) for handing, FFL, house type, plot.
 * File names (case-insensitive):
 *   #12345 MS TOP   (Google Doc table preferred)
 *   #12345 SNIP.xml (Compass export — one long line is fine)
 *   #12345 SNIP 1 / SNIP 2
 *
 * Preferred sources (most reliable first):
 *   MS TOP  — Google Doc (table) or .txt
 *   SNIP    — Compass .xml
 * Fallback: PDF text, then PNG/JPG OCR.
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

  if (/MS[\s_\-]*TOP/.test(n)) return "ms_top";
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
    const tables = doc.querySelectorAll("table");
    if (tables.length) {
      tables.forEach(function (table) {
        table.querySelectorAll("tr").forEach(function (tr) {
          const cells = [];
          tr.querySelectorAll("th,td").forEach(function (td) {
            cells.push((td.textContent || "").replace(/\s+/g, " ").trim());
          });
          if (cells.some(Boolean)) parts.push(cells.join(" | "));
        });
        parts.push("");
      });
    }
    const body = doc.body ? doc.body.innerText : "";
    if (body) parts.push(body);
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
    while ((a = attrRe.exec(attrs))) {
      labelled.push(a[1] + ": " + a[2]);
    }
  }
  const selfRe = /<([A-Za-z][A-Za-z0-9_\-]*)\b([^>]*?)\/>/g;
  while ((m = selfRe.exec(s))) {
    const tag = m[1];
    const attrs = m[2] || "";
    const attrRe = /([A-Za-z][A-Za-z0-9_\-]*)\s*=\s*["']([^"']+)["']/g;
    let a;
    while ((a = attrRe.exec(attrs))) {
      labelled.push(tag + " " + a[1] + ": " + a[2]);
      labelled.push(a[1] + ": " + a[2]);
    }
  }

  const stripped = s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return labelled.join("\n") + "\n" + stripped;
}

let tesseractReady = null;

function loadTesseractScript() {
  if (window.Tesseract) {
    return Promise.resolve(window.Tesseract);
  }
  if (tesseractReady) return tesseractReady;
  tesseractReady = new Promise(function (resolve, reject) {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
    s.async = true;
    s.onload = function () {
      if (window.Tesseract) resolve(window.Tesseract);
      else reject(new Error("Tesseract script loaded but global missing"));
    };
    s.onerror = function () {
      reject(new Error("Failed to load Tesseract.js"));
    };
    document.head.appendChild(s);
  });
  return tesseractReady;
}

async function extractTextFromImage(arrayBuffer, mimeType) {
  const Tesseract = await loadTesseractScript();
  const blob = new Blob([arrayBuffer], {
    type: mimeType || "image/png",
  });
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
  throw new Error("Tesseract API not available (no createWorker/recognize)");
}

async function extractTextFromPdf(arrayBuffer) {
  const pdfjs = await ensurePdfJs();
  const doc = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  const maxPages = Math.min(doc.numPages, 4);
  const parts = [];
  for (let i = 1; i <= maxPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const strings = content.items.map(function (it) {
      return it.str || "";
    });
    parts.push(strings.join(" "));
  }
  let text = parts.join("\n").trim();
  if (text) return text;

  const ocrParts = [];
  const pagesToOcr = Math.min(doc.numPages, 2);
  for (let i = 1; i <= pagesToOcr; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
    await page.render({ canvasContext: ctx, viewport: viewport }).promise;
    const blob = await new Promise(function (resolve) {
      canvas.toBlob(resolve, "image/png");
    });
    if (!blob) continue;
    const buf = await blob.arrayBuffer();
    const pageText = await extractTextFromImage(buf, "image/png");
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

    if (via === "gdoc-html" || /<html|<table|<body/i.test(text)) {
      text = htmlTableToText(text);
      return { text: text, error: null, via: "gdoc" };
    }
    if (
      name.endsWith(".xml") ||
      (downloaded.mimeType || "").indexOf("xml") !== -1 ||
      /^\s*</.test(text)
    ) {
      text = xmlToSearchableText(text);
      return { text: text, error: null, via: "xml" };
    }
    return { text: text, error: null, via: "text" };
  }

  const mt = (downloaded.mimeType || file.mimeType || "").toLowerCase();
  const name = file.name || "";

  if (isImageFile(name, mt)) {
    try {
      const text = await extractTextFromImage(downloaded.buffer, mt || "image/png");
      if (!text || !text.trim()) {
        return {
          text: "",
          error: name + " — OCR found no readable text. Try a clearer image or check manually.",
        };
      }
      return { text: text, error: null, via: "ocr" };
    } catch (e) {
      console.error(e);
      return { text: "", error: "OCR failed for " + name + ": " + (e.message || e) };
    }
  }

  if (mt.indexOf("pdf") !== -1 || name.toLowerCase().endsWith(".pdf")) {
    try {
      const text = await extractTextFromPdf(downloaded.buffer);
      if (text && text.trim()) {
        return { text: text, error: null, via: "pdf" };
      }
      return {
        text: "",
        error: name + " — could not read text from PDF (even with OCR). Try a clearer PNG instead.",
      };
    } catch (e) {
      console.error(e);
      return { text: "", error: "PDF read failed for " + name + ": " + (e.message || e) };
    }
  }

  return {
    text: "",
    error:
      name +
      " type not supported. Prefer Google Doc (MS TOP) or SNIP.xml from Compass.",
  };
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

function contextAround(upper, index, before, after) {
  if (index < 0) return "";
  const start = Math.max(0, index - before);
  const end = Math.min(upper.length, index + after);
  return upper.slice(start, end).replace(/\s+/g, " ").trim();
}

export function extractFields(text) {
  const t = String(text || "");
  const upper = t.toUpperCase();

  let handing = null;
  let ffl = null;
  let houseType = null;
  let plot = null;
  const hints = {};

  let m = upper.match(
    /HANDING\s*[:\|\-]?\s*(LH|RH|LEFT\s*HAND(?:ED)?|RIGHT\s*HAND(?:ED)?|LEFT|RIGHT)\b/
  );
  if (m) {
    handing = m[1];
    hints.handing = contextAround(upper, m.index, 20, 40);
  } else {
    m = upper.match(/\b(LH|RH|LEFT\s*HAND(?:ED)?|RIGHT\s*HAND(?:ED)?)\b/);
    if (m) {
      handing = m[1];
      hints.handing = contextAround(upper, m.index, 20, 40);
    }
  }

  m =
    upper.match(/FFL\s*[:\|\-]?\s*([+-]?\d+(?:\.\d+)?)/) ||
    upper.match(/FINISHED\s*FLOOR\s*LEVEL\s*[:\-]?\s*([+-]?\d+(?:\.\d+)?)/);
  if (m) {
    ffl = m[1];
    hints.ffl = contextAround(upper, m.index, 15, 30);
  }

  m =
    upper.match(/HOUSE\s*TYPE\s*[:\|\-#]?\s*([A-Z0-9][A-Z0-9\-\/]{0,16})/) ||
    upper.match(/\bH\s*[\/\-]?\s*TYPE\s*[:\|\-#]?\s*([A-Z0-9][A-Z0-9\-\/]{0,16})/) ||
    upper.match(/\bHTYPE\s*[:\|\-#]?\s*([A-Z0-9][A-Z0-9\-\/]{0,16})/);
  if (m) {
    houseType = m[1].trim().replace(/[^A-Z0-9\-\/].*$/, "").trim();
    hints.houseType = contextAround(upper, m.index, 15, 40);
  }

  m =
    upper.match(/\bPLOT\s*(?:NO\.?|NUMBER|#)?\s*[:\|\-]?\s*([A-Z0-9\-]{1,12})\b/) ||
    upper.match(/\bPLT\s*[:\|\-#]?\s*([A-Z0-9\-]{1,12})\b/);
  if (m) {
    plot = m[1].trim();
    hints.plot = contextAround(upper, m.index, 15, 30);
  }

  return {
    handing: normalizeHanding(handing),
    ffl: normalizeFfl(ffl),
    houseType: normalizeHouse(houseType),
    plot: plot ? String(plot).toUpperCase() : null,
    hints: hints,
    rawSample: t.slice(0, 400).replace(/\s+/g, " "),
  };
}

function fieldsEqual(a, b) {
  if (a == null || b == null) return false;
  return String(a) === String(b);
}

export async function runLoadCheck(loadNumber) {
  const ready = await ensureDriveReady(true);
  if (!ready || !gapiSignedIn) {
    return {
      ok: false,
      needSignIn: true,
      message: "Sign in to Drive first, then try Check load again.",
      details: null,
    };
  }

  const folder = await searchDriveFolder(loadNumber);
  if (!folder || !folder.id) {
    return {
      ok: false,
      message: "Could not find a Drive folder whose name contains load #" + loadNumber + ".",
      details: null,
    };
  }

  const files = await listFolderFiles(folder.id);
  if (!files.length) {
    return {
      ok: false,
      message: "Folder found but it has no files.",
      details: { folderName: folder.name },
    };
  }

  const classified = { ms_top: [], snip: [], snip_1: [], snip_2: [], other: [] };
  files.forEach(function (f) {
    const role = classifyFileName(f.name);
    if (role && classified[role]) classified[role].push(f);
    else classified.other.push(f);
  });

  let snipFiles = [];
  if (classified.snip_1.length || classified.snip_2.length) {
    snipFiles = classified.snip_1.concat(classified.snip_2);
  } else {
    snipFiles = classified.snip.slice();
  }

  if (!classified.ms_top.length) {
    return {
      ok: false,
      message:
        "No file matching “MS TOP” found.\nUse a Google Doc named e.g. #" +
        loadNumber +
        " MS TOP",
      details: {
        folderName: folder.name,
        files: files.map(function (f) {
          return f.name;
        }),
      },
    };
  }
  if (!snipFiles.length) {
    return {
      ok: false,
      message:
        "No file matching “SNIP” found.\nUse #" +
        loadNumber +
        " SNIP.xml from Compass.",
      details: {
        folderName: folder.name,
        files: files.map(function (f) {
          return f.name;
        }),
      },
    };
  }

  const msFile = pickPreferredFile(classified.ms_top);
  const structuredSnips = snipFiles.filter(function (f) {
    const n = (f.name || "").toLowerCase();
    const mt = (f.mimeType || "").toLowerCase();
    return (
      n.endsWith(".xml") ||
      n.endsWith(".txt") ||
      mt.indexOf("xml") !== -1 ||
      mt.indexOf("text/") === 0
    );
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
    return {
      ok: false,
      message: msResult.error,
      details: { folderName: folder.name },
    };
  }

  const combinedSnipText = snipTexts
    .map(function (s) {
      return s.text;
    })
    .join("\n");

  if (!combinedSnipText.trim() && snipErrors.length) {
    return {
      ok: false,
      message: snipErrors.join("\n"),
      details: { folderName: folder.name },
    };
  }

  const msFields = extractFields(msResult.text);
  const snipFields = extractFields(combinedSnipText);

  const comparisons = [
    { key: "handing", label: "Handing", ms: msFields.handing, snip: snipFields.handing },
    { key: "ffl", label: "FFL", ms: msFields.ffl, snip: snipFields.ffl },
    { key: "houseType", label: "House type", ms: msFields.houseType, snip: snipFields.houseType },
    { key: "plot", label: "Plot", ms: msFields.plot, snip: snipFields.plot },
  ];

  const missing = [];
  const mismatches = [];
  comparisons.forEach(function (c) {
    if (c.key === "plot") {
      if (c.ms != null && c.snip != null && !fieldsEqual(c.ms, c.snip)) {
        mismatches.push({ label: c.label, ms: c.ms, snip: c.snip, key: c.key });
      }
      return;
    }
    if (c.ms == null && c.snip == null) {
      missing.push(c.label + " (not found on either file)");
    } else if (c.ms == null) {
      missing.push(c.label + " (not found on MS TOP)");
    } else if (c.snip == null) {
      missing.push(c.label + " (not found on SNIP)");
    } else if (!fieldsEqual(c.ms, c.snip)) {
      mismatches.push({ label: c.label, ms: c.ms, snip: c.snip, key: c.key });
    }
  });

  const details = {
    folderName: folder.name,
    msFile: msFile.name,
    snipFiles: snipFiles.map(function (f) {
      return f.name;
    }),
    msFields: msFields,
    snipFields: snipFields,
    comparisons: comparisons,
    warnings: [].concat(msResult.error ? [msResult.error] : [], snipErrors),
    msVia: msResult.via,
    snipVia: snipTexts.map(function (s) {
      return s.via;
    }),
  };

  comparisons.forEach(function (c) {
    c.msHint = (msFields.hints && msFields.hints[c.key]) || "";
    c.snipHint = (snipFields.hints && snipFields.hints[c.key]) || "";
  });
  mismatches.forEach(function (m) {
    const full = comparisons.find(function (c) {
      return c.label === m.label;
    });
    if (full) {
      m.msHint = full.msHint;
      m.snipHint = full.snipHint;
    }
  });

  if (mismatches.length) {
    const lines = mismatches.map(function (m) {
      return m.label + ": MS TOP = " + m.ms + " · SNIP = " + m.snip;
    });
    return {
      ok: false,
      message: "Differences found:\n\n" + lines.join("\n"),
      details: details,
      mismatches: mismatches,
      missing: missing,
      comparisons: comparisons,
    };
  }

  const coreMissing = missing.filter(function (x) {
    return x.indexOf("Plot") !== 0;
  });
  if (coreMissing.length >= 3) {
    return {
      ok: false,
      message:
        "Could not read handing / FFL / house type.\n" +
        "MS TOP Google Doc table and SNIP.xml should include those labels.",
      details: details,
      missing: missing,
      comparisons: comparisons,
    };
  }

  if (coreMissing.length) {
    return {
      ok: false,
      message:
        "Some fields could not be read:\n\n• " +
        coreMissing.join("\n• ") +
        "\n\nMatched fields look the same; please verify the missing ones manually.",
      details: details,
      missing: missing,
      comparisons: comparisons,
      partial: true,
    };
  }

  return {
    ok: true,
    message:
      "Match — fields agree.\n\n" +
      "Handing: " +
      msFields.handing +
      "\nFFL: " +
      msFields.ffl +
      "\nHouse type: " +
      msFields.houseType +
      (msFields.plot ? "\nPlot: " + msFields.plot : ""),
    details: details,
    comparisons: comparisons,
  };
}

window.runLoadCheck = runLoadCheck;
