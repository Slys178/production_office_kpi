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
    if (gapiInitialized) {
      const silent = await requestDriveToken(false);
      if (silent) return true;
      if (interactiveSignIn) {
        const ok = await requestDriveToken(true);
        return !!ok;
      }
    }
    updateDriveStatus("disconnected", "Sign in needed");
    return false;
  } catch (e) {
    console.warn("ensureDriveReady failed", e);
    updateDriveStatus("disconnected", "Error");
    return false;
  }
}

async function driveFetch(url) {
  const resp = await fetch(url, {
    headers: { Authorization: "Bearer " + driveAccessToken },
  });
  if (resp.status === 401) {
    driveAccessToken = null;
    gapiSignedIn = false;
    const gotToken = await requestDriveToken(false);
    if (!gotToken) {
      updateDriveStatus("disconnected", "Sign in needed");
      return null;
    }
    return fetch(url, {
      headers: { Authorization: "Bearer " + driveAccessToken },
    });
  }
  return resp;
}

export async function searchDriveForLoad(loadNumber) {
  const folder = await searchDriveFolder(loadNumber);
  return folder ? folder.webViewLink : null;
}

export async function searchDriveFolder(loadNumber) {
  if (!gapiInitialized || !gapiSignedIn || !driveAccessToken) {
    const ready = await ensureDriveReady(false);
    if (!ready || !driveAccessToken) {
      updateDriveStatus("disconnected", gapiInitialized ? "Sign in needed" : "Not ready yet");
      return null;
    }
  }

  if (driveFolderIdCache[loadNumber]) {
    return {
      id: driveFolderIdCache[loadNumber],
      name: String(loadNumber),
      webViewLink: driveSearchCache[loadNumber] || null,
    };
  }

  try {
    updateDriveStatus("searching", "Searching...");

    const query =
      "name contains '" +
      String(loadNumber).replace(/'/g, "\\'") +
      "' and mimeType = 'application/vnd.google-apps.folder' and trashed = false";
    const url =
      "https://www.googleapis.com/drive/v3/files?q=" +
      encodeURIComponent(query) +
      "&fields=" +
      encodeURIComponent("files(id, name, webViewLink)") +
      "&pageSize=10&key=" +
      CONFIG.drive.apiKey +
      "&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=allDrives";

    const resp = await driveFetch(url);
    if (!resp) return null;
    if (!resp.ok) throw new Error("Drive API returned " + resp.status);

    const data = await resp.json();
    const folders = data.files || [];

    if (folders.length > 0) {
      const folder = folders[0];
      driveSearchCache[loadNumber] = folder.webViewLink;
      driveFolderIdCache[loadNumber] = folder.id;
      try {
        const ids = JSON.parse(localStorage.getItem("driveFolderIds") || "{}");
        ids[loadNumber] = folder.id;
        localStorage.setItem("driveFolderIds", JSON.stringify(ids));
      } catch (_) {}
      updateDriveStatus("connected", "Connected");
      return folder;
    }

    updateDriveStatus("connected", "Connected");
    return null;
  } catch (error) {
    console.error("Drive search error:", error);
    updateDriveStatus("connected", "Connected");
    return null;
  }
}

export async function listFolderFiles(folderId) {
  if (!folderId || !driveAccessToken) return [];

  const query = "'" + folderId + "' in parents and trashed = false";
  const url =
    "https://www.googleapis.com/drive/v3/files?q=" +
    encodeURIComponent(query) +
    "&fields=" +
    encodeURIComponent("files(id,name,mimeType,webViewLink)") +
    "&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true";

  const resp = await driveFetch(url);
  if (!resp || !resp.ok) {
    console.error("listFolderFiles failed", resp && resp.status);
    return [];
  }
  const data = await resp.json();
  return data.files || [];
}

export async function downloadDriveFile(fileId, mimeType) {
  if (!fileId || !driveAccessToken) return null;

  let url;
  if (mimeType === "application/vnd.google-apps.document") {
    url =
      "https://www.googleapis.com/drive/v3/files/" +
      fileId +
      "/export?mimeType=" +
      encodeURIComponent("text/plain");
  } else {
    url =
      "https://www.googleapis.com/drive/v3/files/" +
      fileId +
      "?alt=media";
  }

  const resp = await driveFetch(url);
  if (!resp || !resp.ok) {
    console.error("downloadDriveFile failed", resp && resp.status);
    return null;
  }

  if (mimeType === "application/vnd.google-apps.document") {
    return { type: "text", text: await resp.text() };
  }
  return { type: "binary", buffer: await resp.arrayBuffer(), mimeType: mimeType };
}

export function getSavedDriveLinks() {
  try {
    return JSON.parse(localStorage.getItem("driveLinks") || "{}");
  } catch {
    return {};
  }
}

export function saveDriveLink(loadNumber, link) {
  const links = getSavedDriveLinks();
  links[loadNumber] = link;
  localStorage.setItem("driveLinks", JSON.stringify(links));
}

export async function getDriveLink(loadNumber) {
  if (driveSearchCache[loadNumber]) {
    return driveSearchCache[loadNumber];
  }
  const savedLinks = getSavedDriveLinks();
  if (savedLinks[loadNumber]) {
    driveSearchCache[loadNumber] = savedLinks[loadNumber];
    return savedLinks[loadNumber];
  }
  try {
    const ids = JSON.parse(localStorage.getItem("driveFolderIds") || "{}");
    if (ids[loadNumber]) driveFolderIdCache[loadNumber] = ids[loadNumber];
  } catch (_) {}
  const link = await searchDriveForLoad(loadNumber);
  if (link) {
    saveDriveLink(loadNumber, link);
  }
  return link;
}

export function showDriveSignIn(onSuccess) {
  ensureDriveReady(true).then(function (ok) {
    if (ok && onSuccess) onSuccess();
    else if (!ok) updateDriveStatus("disconnected", "Sign in cancelled");
  });
}

try {
  const ids = JSON.parse(localStorage.getItem("driveFolderIds") || "{}");
  Object.keys(ids).forEach(function (k) {
    driveFolderIdCache[k] = ids[k];
  });
} catch (_) {}
