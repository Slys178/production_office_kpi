/**
 * Load check — compare MS TOP vs SNIP(s) for handing, FFL, house type, plot.
 * File names (case-insensitive):
 *   #12345 MS TOP
 *   #12345 SNIP
 *   #12345 SNIP 1 / #12345 SNIP 2
 *
 * Supports PDF (text) and PNG/JPG (OCR via Tesseract.js).
 * Scanned PDFs: render pages then OCR.
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
    .replace(/\.(PDF|PNG|JPG|JPEG|DOC|DOCX)$/i, "");

  if (/MS[\s_\-]*TOP/.test(n)) return "ms_top";
  if (/SNIP[\s_\-]*0*2\b/.test(n) || /SNIP[\s_\-]*0*2$/.test(n)) return "snip_2";
  if (/SNIP[\s_\-]*0*1\b/.test(n) || /SNIP[\s_\-]*0*1$/.test(n)) return "snip_1";
  if (/\bSNIP\b/.test(n)) return "snip";
  return null;
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
  const downloaded = await downloadDriveFile(file.id, file.mimeType);
  if (!downloaded) return { text: "", error: "Could not download " + file.name };

  if (downloaded.type === "text") {
    return { text: downloaded.text || "", error: null };
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
    error: name + " type not supported. Use PNG, JPG, or PDF named with MS TOP / SNIP.",
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
    /HANDING\s*[:\-]?\s*(LH|RH|LEFT\s*HAND(?:ED)?|RIGHT\s*HAND(?:ED)?|LEFT|RIGHT)\b/
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
    upper.match(/FFL\s*[:\-]?\s*([+-]?\d+(?:\.\d+)?)/) ||
    upper.match(/FINISHED\s*FLOOR\s*LEVEL\s*[:\-]?\s*([+-]?\d+(?:\.\d+)?)/);
  if (m) {
    ffl = m[1];
    hints.ffl = contextAround(upper, m.index, 15, 30);
  }

  // House type — ONLY labelled forms (loose TYPE was picking random OCR digits)
  m =
    upper.match(/HOUSE\s*TYPE\s*[:\-#]?\s*([A-Z0-9][A-Z0-9\-\/]{0,16})/) ||
    upper.match(/\bH\s*[\/\-]?\s*TYPE\s*[:\-#]?\s*([A-Z0-9][A-Z0-9\-\/]{0,16})/) ||
    upper.match(/\bHTYPE\s*[:\-#]?\s*([A-Z0-9][A-Z0-9\-\/]{0,16})/);
  if (m) {
    houseType = m[1].trim().replace(/[^A-Z0-9\-\/].*$/, "").trim();
    hints.houseType = contextAround(upper, m.index, 15, 40);
  }

  m =
    upper.match(/\bPLOT\s*(?:NO\.?|NUMBER|#)?\s*[:\-]?\s*([A-Z0-9\-]{1,12})\b/) ||
    upper.match(/\bPLT\s*[:\-#]?\s*([A-Z0-9\-]{1,12})\b/);
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
      message: "No file matching “MS TOP” found in the folder.\nName it e.g. #" + loadNumber + " MS TOP.png",
      details: {
        folderName: folder.name,
        files: files.map(function (f) { return f.name; }),
      },
    };
  }
  if (!snipFiles.length) {
    return {
      ok: false,
      message: "No file matching “SNIP” found.\nUse #" + loadNumber + " SNIP.png or SNIP 1 / SNIP 2.",
      details: {
        folderName: folder.name,
        files: files.map(function (f) { return f.name; }),
      },
    };
  }

  const msFile = classified.ms_top[0];
  const msResult = await fileToText(msFile);
  const snipTexts = [];
  const snipErrors = [];
  for (let i = 0; i < snipFiles.length; i++) {
    const r = await fileToText(snipFiles[i]);
    if (r.error) snipErrors.push(r.error);
    snipTexts.push({ name: snipFiles[i].name, text: r.text });
  }

  if (msResult.error && !msResult.text) {
    return {
      ok: false,
      message: msResult.error,
      details: { folderName: folder.name },
    };
  }

  const combinedSnipText = snipTexts.map(function (s) { return s.text; }).join("\n");

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
    snipFiles: snipFiles.map(function (f) { return f.name; }),
    msFields: msFields,
    snipFields: snipFields,
    comparisons: comparisons,
    warnings: [].concat(msResult.error ? [msResult.error] : [], snipErrors),
  };

  comparisons.forEach(function (c) {
    c.msHint = (msFields.hints && msFields.hints[c.key]) || "";
    c.snipHint = (snipFields.hints && snipFields.hints[c.key]) || "";
  });
  mismatches.forEach(function (m) {
    const full = comparisons.find(function (c) { return c.label === m.label; });
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
        "Could not read handing / FFL / house type from the files.\n" +
        "Check the labels are clear on MS TOP and SNIP.",
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
      "Handing: " + msFields.handing +
      "\nFFL: " + msFields.ffl +
      "\nHouse type: " + msFields.houseType +
      (msFields.plot ? "\nPlot: " + msFields.plot : ""),
    details: details,
    comparisons: comparisons,
  };
}

window.runLoadCheck = runLoadCheck;
