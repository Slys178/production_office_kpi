/**
 * Google Drive integration — folder search for loads + file list/download for checks.
 */

import { CONFIG } from "./config.js";

export let gapiInitialized = false;
export let gapiSignedIn = false;
export let driveAccessToken = null;
let tokenClient = null;
export let driveSearchCache = {};
/** loadNumber -> folder id */
export let driveFolderIdCache = {};

const driveStatusDot = document.getElementById("driveStatusDot");
const driveStatusText = document.getElementById("driveStatusText");

export function updateDriveStatus(status, text) {
  if (driveStatusDot) driveStatusDot.className = "status-dot " + status;
  if (driveStatusText) driveStatusText.textContent = "Drive: " + text;
}

export function loadGoogleIdentityServices() {
  return new Promise((resolve, reject) => {
    if (typeof google !== "undefined" && google.accounts && google.accounts.oauth2) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google Identity Services"));
    document.head.appendChild(script);
  });
}

export async function initGapiClient() {
  try {
    const savedToken = sessionStorage.getItem("driveToken");
    const savedTime = sessionStorage.getItem("driveTokenTime");
    let restored = false;
    if (savedToken && savedTime) {
      const ageMinutes = (Date.now() - parseInt(savedTime, 10)) / (1000 * 60);
      if (ageMinutes < 55) {
        driveAccessToken = savedToken;
        gapiSignedIn = true;
        restored = true;
        updateDriveStatus("connected", "Connected");
      }
    }

    await loadGoogleIdentityServices();

    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.drive.clientId,
      scope: CONFIG.drive.scopes,
      callback: (tokenResponse) => {
        if (tokenResponse && tokenResponse.access_token) {
          driveAccessToken = tokenResponse.access_token;
          sessionStorage.setItem("driveToken", tokenResponse.access_token);
          sessionStorage.setItem("driveTokenTime", Date.now().toString());
          gapiSignedIn = true;
          updateDriveStatus("connected", "Connected");
        }
      },
      error_callback: (err) => {
        console.error("Drive sign-in error:", err);
        gapiSignedIn = false;
        updateDriveStatus("disconnected", (err && err.type) ? err.type : "Sign in failed");
      },
    });

    gapiInitialized = true;
    if (!restored) {
      updateDriveStatus("disconnected", "Not signed in");
    } else {
      updateDriveStatus("connected", "Connected");
    }
    return true;
  } catch (error) {
    console.error("Failed to init Google Identity Services:", error);
    updateDriveStatus("disconnected", "Error: " + (error && error.message ? error.message : "unknown"));
    return false;
  }
}

export function requestDriveToken(interactive) {
  return new Promise((resolve) => {
    if (!tokenClient) {
      resolve(false);
      return;
    }
    tokenClient.callback = (tokenResponse) => {
      if (tokenResponse && tokenResponse.access_token) {
        driveAccessToken = tokenResponse.access_token;
        sessionStorage.setItem("driveToken", tokenResponse.access_token);
        sessionStorage.setItem("driveTokenTime", Date.now().toString());
        gapiSignedIn = true;
        updateDriveStatus("connected", "Connected");
        resolve(true);
      } else {
        resolve(false);
      }
    };
    tokenClient.requestAccessToken({ prompt: interactive ? "consent" : "" });
  });
}

export async function ensureDriveReady(interactiveSignIn) {
  try {
    if (!gapiInitialized) {
      await initGapiClient();
    }
    if (gapiSignedIn && driveAccessToken) {
      updateDriveStatus("connected", "Connected");
      return true;
    }
    if (interactiveSignIn) {
      const ok = await requestDriveToken(true);
      return !!ok;
    }
    return false;
  } catch (e) {
    console.error("ensureDriveReady", e);
    return false;
  }
}

async function driveFetch(url) {
  if (!driveAccessToken) return null;
  return fetch(url, {
    headers: { Authorization: "Bearer " + driveAccessToken },
  });
}

export async function searchDriveForLoad(loadNumber) {
  const folder = await searchDriveFolder(loadNumber);
  return folder && folder.webViewLink ? folder.webViewLink : null;
}

/**
 * Load folders are named like "#119592 AS" (not "LOAD #119592").
 * Search by digits only, then rank by full name match.
 */
function parseLoadId(loadNumber) {
  const raw = String(loadNumber || "").trim();
  const digits = (raw.match(/\d{4,}/) || [])[0] || "";
  const initialsMatch = raw.match(/\b([A-Z]{1,3})\s*$/i);
  const initials = initialsMatch ? initialsMatch[1].toUpperCase() : "";
  return { raw: raw, digits: digits, initials: initials };
}

async function driveListFoldersContaining(text) {
  if (!text) return [];
  const safe = String(text).replace(/'/g, "\\'");
  const q =
    "name contains '" +
    safe +
    "' and mimeType = 'application/vnd.google-apps.folder' and trashed = false";
  const url =
    "https://www.googleapis.com/drive/v3/files?q=" +
    encodeURIComponent(q) +
    "&fields=" +
    encodeURIComponent("files(id,name,webViewLink)") +
    "&pageSize=25" +
    "&supportsAllDrives=true" +
    "&includeItemsFromAllDrives=true" +
    "&corpora=allDrives";
  const resp = await driveFetch(url);
  if (!resp || !resp.ok) {
    const url2 =
      "https://www.googleapis.com/drive/v3/files?q=" +
      encodeURIComponent(q) +
      "&fields=" +
      encodeURIComponent("files(id,name,webViewLink)") +
      "&pageSize=25";
    const r2 = await driveFetch(url2);
    if (!r2 || !r2.ok) return [];
    const d2 = await r2.json();
    return (d2 && d2.files) || [];
  }
  const data = await resp.json();
  return (data && data.files) || [];
}

export async function searchDriveFolder(loadNumber) {
  if (!loadNumber || !driveAccessToken) return null;
  if (driveFolderIdCache[loadNumber]) return driveFolderIdCache[loadNumber];

  try {
    const parsed = parseLoadId(loadNumber);
    let files = [];
    if (parsed.digits) {
      files = await driveListFoldersContaining(parsed.digits);
    }
    if (!files.length && parsed.raw) {
      files = await driveListFoldersContaining(parsed.raw.replace(/^#/, ""));
    }
    if (!files.length) return null;

    function score(folder) {
      const n = (folder.name || "").toUpperCase();
      let s = 0;
      if (parsed.digits && n.indexOf(parsed.digits) !== -1) s += 10;
      if (parsed.initials && n.indexOf(parsed.initials) !== -1) s += 5;
      if (n.indexOf("#" + parsed.digits) !== -1) s += 3;
      return s;
    }
    files.sort(function (a, b) {
      return score(b) - score(a);
    });
    const best = files[0];
    driveFolderIdCache[loadNumber] = best;
    return best;
  } catch (e) {
    console.error("searchDriveFolder", e);
    return null;
  }
}

export async function listFolderFiles(folderId) {
  if (!folderId || !driveAccessToken) return [];
  const base =
    "https://www.googleapis.com/drive/v3/files?q=" +
    encodeURIComponent("'" + folderId + "' in parents and trashed = false") +
    "&fields=" +
    encodeURIComponent("files(id,name,mimeType,webViewLink)") +
    "&pageSize=100";
  let resp = await driveFetch(
    base + "&supportsAllDrives=true&includeItemsFromAllDrives=true"
  );
  if (!resp || !resp.ok) {
    resp = await driveFetch(base);
  }
  if (!resp || !resp.ok) return [];
  const data = await resp.json();
  return (data && data.files) || [];
}

export async function downloadDriveFile(fileId, mimeType, fileName) {
  if (!fileId || !driveAccessToken) return null;

  const mt = (mimeType || "").toLowerCase();
  const name = (fileName || "").toLowerCase();
  const isGoogleDoc = mt === "application/vnd.google-apps.document";
  let url;
  if (isGoogleDoc) {
    url =
      "https://www.googleapis.com/drive/v3/files/" +
      fileId +
      "/export?mimeType=" +
      encodeURIComponent("text/html");
  } else {
    url =
      "https://www.googleapis.com/drive/v3/files/" +
      fileId +
      "?alt=media";
  }

  const resp = await driveFetch(url);
  if (!resp || !resp.ok) {
    if (isGoogleDoc) {
      const plainUrl =
        "https://www.googleapis.com/drive/v3/files/" +
        fileId +
        "/export?mimeType=" +
        encodeURIComponent("text/plain");
      const r2 = await driveFetch(plainUrl);
      if (r2 && r2.ok) {
        return { type: "text", text: await r2.text(), via: "gdoc-plain" };
      }
    }
    console.error("downloadDriveFile failed", resp && resp.status);
    return null;
  }

  if (isGoogleDoc) {
    return { type: "text", text: await resp.text(), via: "gdoc-html" };
  }

  const isTextLike =
    mt.indexOf("text/") === 0 ||
    mt.indexOf("xml") !== -1 ||
    mt === "application/json" ||
    /\.(xml|txt|csv|json|html?)$/.test(name);

  if (isTextLike) {
    return { type: "text", text: await resp.text(), mimeType: mt };
  }

  return { type: "binary", buffer: await resp.arrayBuffer(), mimeType: mimeType };
}

export function getSavedDriveLinks() {
  try {
    return JSON.parse(localStorage.getItem("driveLinks") || "{}") || {};
  } catch (_) {
    return {};
  }
}

export function saveDriveLink(loadNumber, link) {
  const map = getSavedDriveLinks();
  map[loadNumber] = link;
  try {
    localStorage.setItem("driveLinks", JSON.stringify(map));
  } catch (_) {}
}

export async function getDriveLink(loadNumber) {
  const saved = getSavedDriveLinks()[loadNumber];
  if (saved) return saved;
  if (driveSearchCache[loadNumber]) return driveSearchCache[loadNumber];
  const link = await searchDriveForLoad(loadNumber);
  if (link) {
    driveSearchCache[loadNumber] = link;
    saveDriveLink(loadNumber, link);
  }
  return link;
}

export function showDriveSignIn(onSuccess) {
  updateDriveStatus("disconnected", "Sign in…");
  requestDriveToken(true).then(function (ok) {
    if (ok && typeof onSuccess === "function") onSuccess();
  });
}

window.ensureDriveReady = ensureDriveReady;
window.searchDriveForLoad = searchDriveForLoad;
