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

/**
 * Make sure the local Drive module is initialized and (if possible) signed in.
 * CDN main.js initializes a *different* copy of drive.js — our modules use this one.
 */
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

export async function searchDriveFolder(loadNumber) {
  if (!loadNumber || !driveAccessToken) return null;
  if (driveFolderIdCache[loadNumber]) return driveFolderIdCache[loadNumber];

  try {
    const q =
      "name contains '" +
      String(loadNumber).replace(/'/g, "\\'") +
      "' and mimeType = 'application/vnd.google-apps.folder' and trashed = false";
    const url =
      "https://www.googleapis.com/drive/v3/files?q=" +
      encodeURIComponent(q) +
      "&fields=" +
      encodeURIComponent("files(id,name,webViewLink)") +
      "&pageSize=10";
    const resp = await driveFetch(url);
    if (!resp || !resp.ok) return null;
    const data = await resp.json();
    const files = (data && data.files) || [];
    if (!files.length) return null;
    let best = files[0];
    const num = String(loadNumber);
    const exact = files.find(function (f) {
      return (f.name || "").indexOf(num) !== -1;
    });
    if (exact) best = exact;
    driveFolderIdCache[loadNumber] = best;
    return best;
  } catch (e) {
    console.error("searchDriveFolder", e);
    return null;
  }
}

export async function listFolderFiles(folderId) {
  if (!folderId || !driveAccessToken) return [];
  const url =
    "https://www.googleapis.com/drive/v3/files?q=" +
    encodeURIComponent("'" + folderId + "' in parents and trashed = false") +
    "&fields=" +
    encodeURIComponent("files(id,name,mimeType,webViewLink)") +
    "&pageSize=100";
  const resp = await driveFetch(url);
  if (!resp || !resp.ok) return [];
  const data = await resp.json();
  return (data && data.files) || [];
}

export async function downloadDriveFile(fileId, mimeType, fileName) {
  if (!fileId || !driveAccessToken) return null;

  const mt = (mimeType || "").toLowerCase();
  const name = (fileName || "").toLowerCase();
  const isGoogleDoc = mt === "application/vnd.google-apps.document";
  // Prefer HTML export so tables keep cell boundaries
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
