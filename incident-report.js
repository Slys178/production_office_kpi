/**
 * Incident Reporting — in-app capture with photos.
 * Saves to Google Sheet (append) + Drive (photos) when signed in;
 * always keeps a local backup so nothing is lost offline.
 */
import { CONFIG } from "./config.js";
import {
  driveAccessToken,
  gapiSignedIn,
  requestDriveToken,
  initGapiClient,
} from "./drive.js";

const LOCAL_KEY = "po_incidents_v1";
const MAX_PHOTOS = 4;
const MAX_PHOTO_EDGE = 1600;
const JPEG_QUALITY = 0.72;

const SITES = ["Bayton Road", "Ansty", "Ibstock Road"];
const TYPES = ["Near Miss or Unsafe Event", "Injury"];
const BODY_PARTS = [
  "Finger", "Hand", "Wrist", "Arm", "Shoulder", "Head", "Eye", "Face",
  "Back", "Leg", "Knee", "Foot", "Toe", "Other",
];

function escapeHtml(s) {
  const el = document.createElement("div");
  el.textContent = String(s == null ? "" : s);
  return el.innerHTML;
}

function loadLocal() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) || "[]") || [];
  } catch (_) {
    return [];
  }
}

function saveLocal(list) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(list));
  } catch (e) {
    console.warn("incident local save failed", e);
  }
}

function getLoggedInUser() {
  try {
    const raw =
      localStorage.getItem("po_user") ||
      localStorage.getItem("kpiUser") ||
      sessionStorage.getItem("po_user") ||
      "";
    if (!raw) return { name: "", email: "" };
    const u = raw.startsWith("{") ? JSON.parse(raw) : { name: raw };
    return {
      name: (u.name || u.userName || u.displayName || "").toString().trim(),
      email: (u.email || u.userEmail || "").toString().trim(),
    };
  } catch (_) {
    return { name: "", email: "" };
  }
}

function uid() {
  return "inc_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}

function todayISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function nowTime() {
  const d = new Date();
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let w = img.width;
      let h = img.height;
      const scale = Math.min(1, MAX_PHOTO_EDGE / Math.max(w, h));
      w = Math.round(w * scale);
      h = Math.round(h * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read image"));
    };
    img.src = url;
  });
}

function dataUrlToBlob(dataUrl) {
  const parts = dataUrl.split(",");
  const mime = (parts[0].match(/:(.*?);/) || [])[1] || "image/jpeg";
  const bin = atob(parts[1]);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

async function ensureWriteToken() {
  if (driveAccessToken && gapiSignedIn) return driveAccessToken;
  try {
    await initGapiClient();
  } catch (_) {}
  const ok = await requestDriveToken(true);
  if (!ok || !driveAccessToken) {
    throw new Error("Google sign-in required to save to Sheet / Drive");
  }
  return driveAccessToken;
}

async function uploadPhotoToDrive(dataUrl, fileName) {
  const token = await ensureWriteToken();
  const meta = { name: fileName, mimeType: "image/jpeg" };
  const folderId = (CONFIG.incidents && CONFIG.incidents.driveFolderId) || "";
  if (folderId) meta.parents = [folderId];

  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(meta)], { type: "application/json" }));
  form.append("file", dataUrlToBlob(dataUrl));

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink,webContentLink",
    { method: "POST", headers: { Authorization: "Bearer " + token }, body: form }
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error("Drive upload failed: " + res.status + " " + t.slice(0, 200));
  }
  return res.json();
}

async function appendIncidentRow(values) {
  const token = await ensureWriteToken();
  const sheetId =
    (CONFIG.incidents && CONFIG.incidents.writeSheetId) ||
    (CONFIG.sheets.incidents && CONFIG.sheets.incidents.id);
  if (!sheetId) throw new Error("No incident write sheet configured");

  const range = (CONFIG.incidents && CONFIG.incidents.writeRange) || "Form responses 1!A:AB";

  const res = await fetch(
    "https://sheets.googleapis.com/v4/spreadsheets/" +
      sheetId +
      "/values/" +
      encodeURIComponent(range) +
      ":append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ values: [values] }),
    }
  );
  if (!res.ok) {
    const t = await res.text();
    throw new Error("Sheet append failed: " + res.status + " " + t.slice(0, 200));
  }
  return res.json();
}

function incidentToSheetRow(inc) {
  const ts = new Date().toLocaleString("en-GB");
  const photoLinks = (inc.photoLinks || []).join(" | ");
  return [
    ts,
    inc.incidentDate || "",
    inc.incidentTime || "",
    inc.reporterName || "",
    inc.reporterEmail || "",
    inc.site || "",
    inc.location || "",
    "",
    inc.type || "",
    inc.type === "Injury" ? inc.injuryDetail || inc.description || "" : "",
    inc.type === "Injury" ? inc.bodyPart || "" : "",
    inc.type === "Injury" ? inc.hospital || "" : "",
    inc.type === "Injury" ? inc.firstAid || "" : "",
    inc.type === "Injury" ? inc.firstAidDetail || "" : "",
    inc.injuredPerson || "",
    inc.lineManager || "",
    inc.reporterEmail || "",
    inc.description || "",
    inc.area || "",
    inc.incidentNumber || "",
    (inc.actions || "") + (photoLinks ? " | Photos: " + photoLinks : ""),
    inc.resolved || "",
    "",
    "",
    "",
    "",
    "",
    "",
  ];
}

let photoDataUrls = [];
let viewMode = "list";
let selectedId = null;

function setStatus(msg, isError) {
  const el = document.getElementById("incidentStatus");
  if (!el) return;
  el.textContent = msg || "";
  el.style.color = isError ? "var(--red)" : "var(--muted)";
}

function renderShell() {
  const root = document.getElementById("incidentsPageBody");
  if (!root) return;
  if (viewMode === "form") renderForm(root);
  else if (viewMode === "detail") renderDetail(root);
  else renderList(root);
}

function renderList(root) {
  const local = loadLocal().slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const user = getLoggedInUser();

  let cards = local
    .map((inc) => {
      const when = (inc.incidentDate || "") + (inc.incidentTime ? " " + inc.incidentTime : "");
      const typeCls = inc.type && inc.type.indexOf("Injury") >= 0 ? "injury" : "near-miss";
      const thumbs = (inc.photos || [])
        .slice(0, 3)
        .map((p) => '<img class="inc-thumb" src="' + p + '" alt="" />')
        .join("");
      return (
        '<button type="button" class="inc-card" data-id="' +
        escapeHtml(inc.id) +
        '">' +
        '<div class="inc-card-top">' +
        '<span class="inc-type ' +
        typeCls +
        '">' +
        escapeHtml(inc.type || "Incident") +
        "</span>" +
        '<span class="inc-when">' +
        escapeHtml(when) +
        "</span></div>" +
        '<div class="inc-card-title">' +
        escapeHtml((inc.description || "").slice(0, 120) || "No description") +
        "</div>" +
        '<div class="inc-card-meta">' +
        escapeHtml(inc.site || "") +
        (inc.area ? " · " + escapeHtml(inc.area) : "") +
        (inc.reporterName ? " · " + escapeHtml(inc.reporterName) : "") +
        "</div>" +
        (thumbs ? '<div class="inc-thumbs">' + thumbs + "</div>" : "") +
        "</button>"
      );
    })
    .join("");

  if (!cards) {
    cards =
      '<div class="inc-empty">No incidents logged in this app yet.<br/>Tap <strong>Report incident</strong> to add one (with photos).</div>';
  }

  root.innerHTML =
    '<div class="inc-toolbar">' +
    '<button type="button" class="inc-btn primary" id="incNewBtn">+ Report incident</button>' +
    '<span class="inc-hint">' +
    (user.name ? "Logged in as " + escapeHtml(user.name) : "Sign in on the app for your name to pre-fill") +
    "</span></div>" +
    '<div id="incidentStatus" class="inc-status"></div>' +
    '<div class="inc-list">' +
    cards +
    "</div>";

  document.getElementById("incNewBtn")?.addEventListener("click", () => {
    photoDataUrls = [];
    viewMode = "form";
    selectedId = null;
    renderShell();
  });
  root.querySelectorAll(".inc-card").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedId = btn.getAttribute("data-id");
      viewMode = "detail";
      renderShell();
    });
  });
}

function renderForm(root) {
  const user = getLoggedInUser();
  root.innerHTML =
    '<div class="inc-toolbar">' +
    '<button type="button" class="inc-btn" id="incBackList">← Back</button>' +
    '<h3 class="inc-form-title">Report incident</h3></div>' +
    '<div id="incidentStatus" class="inc-status"></div>' +
    '<form id="incForm" class="inc-form">' +
    '<label>Type<select name="type" required>' +
    TYPES.map((t) => "<option>" + t + "</option>").join("") +
    "</select></label>" +
    '<div class="inc-row">' +
    '<label>Date<input type="date" name="incidentDate" value="' +
    todayISO() +
    '" required /></label>' +
    '<label>Time<input type="time" name="incidentTime" value="' +
    nowTime() +
    '" required /></label></div>' +
    '<label>Site<select name="site" required>' +
    SITES.map((s) => "<option>" + s + "</option>").join("") +
    "</select></label>" +
    '<label>Incident location<input name="location" placeholder="e.g. Bayton Road / paint line" required /></label>' +
    '<label>Factory / area<input name="area" placeholder="e.g. F5, F1 1st fix" /></label>' +
    '<label>Description<textarea name="description" rows="4" required placeholder="What happened?"></textarea></label>' +
    '<div id="incInjuryFields" class="inc-injury" style="display:none;">' +
    '<label>Injury detail<textarea name="injuryDetail" rows="2" placeholder="How was the person hurt?"></textarea></label>' +
    '<label>Body part<select name="bodyPart"><option value="">—</option>' +
    BODY_PARTS.map((b) => "<option>" + b + "</option>").join("") +
    "</select></label>" +
    '<div class="inc-row">' +
    '<label>Taken to hospital?<select name="hospital"><option>No</option><option>Yes</option></select></label>' +
    '<label>First aid given?<select name="firstAid"><option>No</option><option>Yes</option></select></label></div>' +
    '<label>First aid detail<input name="firstAidDetail" placeholder="e.g. plaster, wet wipes" /></label>' +
    '<label>Injured person<input name="injuredPerson" /></label>' +
    '<label>Line manager<input name="lineManager" /></label></div>' +
    '<div class="inc-row">' +
    '<label>Your name<input name="reporterName" value="' +
    escapeHtml(user.name) +
    '" required /></label>' +
    '<label>Your email<input name="reporterEmail" type="email" value="' +
    escapeHtml(user.email) +
    '" /></label></div>' +
    '<label>Actions taken / comments<textarea name="actions" rows="2"></textarea></label>' +
    '<div class="inc-photos">' +
    "<strong>Photos</strong> <span class=\"inc-hint\">(up to " +
    MAX_PHOTOS +
    " — camera or gallery)</span>" +
    '<div class="inc-photo-actions">' +
    '<label class="inc-btn file-btn">Add photo<input type="file" id="incPhotoInput" accept="image/*" capture="environment" hidden /></label>' +
    "</div>" +
    '<div id="incPhotoPreview" class="inc-photo-preview"></div></div>' +
    '<button type="submit" class="inc-btn primary inc-submit" id="incSubmitBtn">Save incident</button>' +
    "</form>";

  document.getElementById("incBackList")?.addEventListener("click", () => {
    viewMode = "list";
    renderShell();
  });

  const typeSel = root.querySelector('select[name="type"]');
  const injuryBox = document.getElementById("incInjuryFields");
  function syncInjury() {
    injuryBox.style.display = typeSel.value === "Injury" ? "block" : "none";
  }
  typeSel.addEventListener("change", syncInjury);
  syncInjury();

  document.getElementById("incPhotoInput")?.addEventListener("change", async (ev) => {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = "";
    if (!file) return;
    if (photoDataUrls.length >= MAX_PHOTOS) {
      setStatus("Maximum " + MAX_PHOTOS + " photos", true);
      return;
    }
    try {
      setStatus("Compressing photo…");
      const dataUrl = await compressImage(file);
      photoDataUrls.push(dataUrl);
      renderPhotoPreview();
      setStatus("");
    } catch (e) {
      setStatus(e.message || "Photo failed", true);
    }
  });

  document.getElementById("incForm")?.addEventListener("submit", onSubmit);
}

function renderPhotoPreview() {
  const box = document.getElementById("incPhotoPreview");
  if (!box) return;
  box.innerHTML = photoDataUrls
    .map(
      (p, i) =>
        '<div class="inc-photo-item"><img src="' +
        p +
        '" alt="" /><button type="button" data-i="' +
        i +
        '" class="inc-photo-remove">×</button></div>'
    )
    .join("");
  box.querySelectorAll(".inc-photo-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      photoDataUrls.splice(parseInt(btn.getAttribute("data-i"), 10), 1);
      renderPhotoPreview();
    });
  });
}

async function onSubmit(ev) {
  ev.preventDefault();
  const form = ev.target;
  const fd = new FormData(form);
  const get = (k) => (fd.get(k) || "").toString().trim();

  const inc = {
    id: uid(),
    createdAt: Date.now(),
    type: get("type"),
    incidentDate: get("incidentDate"),
    incidentTime: get("incidentTime"),
    site: get("site"),
    location: get("location"),
    area: get("area"),
    description: get("description"),
    injuryDetail: get("injuryDetail"),
    bodyPart: get("bodyPart"),
    hospital: get("hospital"),
    firstAid: get("firstAid"),
    firstAidDetail: get("firstAidDetail"),
    injuredPerson: get("injuredPerson"),
    lineManager: get("lineManager"),
    reporterName: get("reporterName"),
    reporterEmail: get("reporterEmail"),
    actions: get("actions"),
    resolved: "",
    photos: photoDataUrls.slice(),
    photoLinks: [],
    synced: false,
  };

  const btn = document.getElementById("incSubmitBtn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Saving…";
  }
  setStatus("Saving locally…");

  const list = loadLocal();
  list.unshift(inc);
  saveLocal(list);

  let remoteOk = false;
  try {
    setStatus("Uploading photos & saving to sheet (sign in if asked)…");
    const links = [];
    for (let i = 0; i < inc.photos.length; i++) {
      try {
        const file = await uploadPhotoToDrive(
          inc.photos[i],
          "incident_" + inc.id + "_" + (i + 1) + ".jpg"
        );
        if (file.webViewLink) links.push(file.webViewLink);
        else if (file.id) links.push("https://drive.google.com/file/d/" + file.id + "/view");
      } catch (pe) {
        console.warn("photo upload", pe);
      }
    }
    inc.photoLinks = links;
    await appendIncidentRow(incidentToSheetRow(inc));
    inc.synced = true;
    const all = loadLocal().map((x) => (x.id === inc.id ? inc : x));
    saveLocal(all);
    remoteOk = true;
    setStatus("Saved to sheet" + (links.length ? " · " + links.length + " photo(s) on Drive" : ""));
  } catch (e) {
    console.warn("remote save", e);
    setStatus(
      "Saved on this device only. Sheet/Drive sync failed: " +
        (e.message || String(e)) +
        " — sign in with Google (Drive) and ensure you can edit the incident sheet.",
      true
    );
  }

  if (btn) {
    btn.disabled = false;
    btn.textContent = "Save incident";
  }

  photoDataUrls = [];
  viewMode = "detail";
  selectedId = inc.id;
  renderShell();
  if (remoteOk) setStatus("Incident saved");
}

function renderDetail(root) {
  const inc = loadLocal().find((x) => x.id === selectedId);
  if (!inc) {
    viewMode = "list";
    renderShell();
    return;
  }
  const photos = (inc.photos || [])
    .map(
      (p, i) =>
        '<button type="button" class="inc-photo-open" data-i="' +
        i +
        '"><img src="' +
        p +
        '" class="inc-detail-photo" alt="Photo ' +
        (i + 1) +
        '" /></button>'
    )
    .join("");
  const links = (inc.photoLinks || [])
    .map((l) => '<a href="' + escapeHtml(l) + '" target="_blank" rel="noopener">Open on Drive</a>')
    .join(" · ");

  root.innerHTML =
    '<div class="inc-toolbar">' +
    '<button type="button" class="inc-btn" id="incBackList">← Back</button>' +
    '<span class="inc-type ' +
    (inc.type && inc.type.indexOf("Injury") >= 0 ? "injury" : "near-miss") +
    '">' +
    escapeHtml(inc.type || "") +
    "</span></div>" +
    '<div id="incidentStatus" class="inc-status"></div>' +
    '<div class="inc-detail">' +
    "<p><strong>When:</strong> " +
    escapeHtml(inc.incidentDate + " " + (inc.incidentTime || "")) +
    "</p>" +
    "<p><strong>Site:</strong> " +
    escapeHtml(inc.site) +
    " · <strong>Location:</strong> " +
    escapeHtml(inc.location) +
    (inc.area ? " · <strong>Area:</strong> " + escapeHtml(inc.area) : "") +
    "</p>" +
    "<p><strong>Description:</strong><br/>" +
    escapeHtml(inc.description) +
    "</p>" +
    (inc.type === "Injury"
      ? "<p><strong>Injury:</strong> " +
        escapeHtml(inc.injuryDetail || "") +
        " · " +
        escapeHtml(inc.bodyPart || "") +
        "<br/>Hospital: " +
        escapeHtml(inc.hospital || "—") +
        " · First aid: " +
        escapeHtml(inc.firstAid || "—") +
        " " +
        escapeHtml(inc.firstAidDetail || "") +
        "<br/>Injured: " +
        escapeHtml(inc.injuredPerson || "—") +
        " · Manager: " +
        escapeHtml(inc.lineManager || "—") +
        "</p>"
      : "") +
    "<p><strong>Reported by:</strong> " +
    escapeHtml(inc.reporterName || "") +
    (inc.reporterEmail ? " (" + escapeHtml(inc.reporterEmail) + ")" : "") +
    "</p>" +
    (inc.actions ? "<p><strong>Actions:</strong> " + escapeHtml(inc.actions) + "</p>" : "") +
    "<p><strong>Sync:</strong> " +
    (inc.synced
      ? "Saved to Google Sheet" +
        (inc.photoLinks && inc.photoLinks.length ? " · photos on Drive" : "")
      : "On this device only — not yet on the Google Sheet (sign-in or permissions may have failed)") +
    "</p>" +
    (!inc.synced
      ? '<p><button type="button" class="inc-btn primary" id="incRetrySync">Retry save to Sheet / Drive</button></p>'
      : "") +
    (photos ? '<div class="inc-detail-photos">' + photos + "</div>" : "") +
    (links ? "<p>" + links + "</p>" : "") +
    '<div id="incLightbox" class="inc-lightbox" style="display:none;" aria-hidden="true">' +
    '<button type="button" class="inc-lightbox-close" id="incLightboxClose">×</button>' +
    '<img id="incLightboxImg" alt="Incident photo" />' +
    "</div>" +
    "</div>";

  document.getElementById("incBackList")?.addEventListener("click", () => {
    viewMode = "list";
    renderShell();
  });

  const lb = document.getElementById("incLightbox");
  const lbImg = document.getElementById("incLightboxImg");
  const closeLb = function () {
    if (lb) {
      lb.style.display = "none";
      lb.setAttribute("aria-hidden", "true");
    }
    if (lbImg) lbImg.removeAttribute("src");
  };
  document.getElementById("incLightboxClose")?.addEventListener("click", closeLb);
  lb?.addEventListener("click", function (e) {
    if (e.target === lb) closeLb();
  });
  root.querySelectorAll(".inc-photo-open").forEach(function (btn) {
    btn.addEventListener("click", function () {
      const i = parseInt(btn.getAttribute("data-i"), 10);
      const src = (inc.photos || [])[i];
      if (!src || !lb || !lbImg) return;
      lbImg.src = src;
      lb.style.display = "flex";
      lb.setAttribute("aria-hidden", "false");
    });
  });

  document.getElementById("incRetrySync")?.addEventListener("click", async function () {
    const btn = document.getElementById("incRetrySync");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Saving…";
    }
    setStatus("Retrying Sheet / Drive save…");
    try {
      const links = [];
      for (let i = 0; i < (inc.photos || []).length; i++) {
        try {
          const file = await uploadPhotoToDrive(
            inc.photos[i],
            "incident_" + inc.id + "_" + (i + 1) + ".jpg"
          );
          if (file.webViewLink) links.push(file.webViewLink);
          else if (file.id)
            links.push("https://drive.google.com/file/d/" + file.id + "/view");
        } catch (pe) {
          console.warn("photo upload", pe);
        }
      }
      inc.photoLinks = links;
      await appendIncidentRow(incidentToSheetRow(inc));
      inc.synced = true;
      const all = loadLocal().map((x) => (x.id === inc.id ? inc : x));
      saveLocal(all);
      setStatus("Saved to sheet" + (links.length ? " · " + links.length + " photo(s) on Drive" : ""));
      renderShell();
    } catch (e) {
      setStatus(
        "Still could not sync: " +
          (e.message || String(e)) +
          " — check Google sign-in and edit access on the incident sheet.",
        true
      );
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Retry save to Sheet / Drive";
      }
    }
  });
}

export function renderIncidents() {
  const page = document.getElementById("incidentsPage");
  if (!page) return;
  viewMode = "list";
  selectedId = null;
  renderShell();
}

window.renderIncidents = renderIncidents;
