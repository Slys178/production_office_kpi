/**
 * Google Drive integration (folder search for loads)
 */

import { CONFIG } from "./config.js";
import { showToast } from "./utils.js";

let gapiInitialized = false;
let gapiSignedIn = false;
let driveAccessToken = null;
let tokenClient = null;
export let driveSearchCache = {};

function getStatusElements() {
  return {
    dot: document.getElementById("driveStatusDot"),
    text: document.getElementById("driveStatusText"),
  };
}

export function updateDriveStatus(status, text) {
  const { dot, text: textEl } = getStatusElements();
  if (dot) dot.className = "status-dot " + status;
  if (textEl) textEl.textContent = "Drive: " + text;
}

function loadGoogleIdentityServices() {
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
    await loadGoogleIdentityServices();
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.drive.clientId,
      scope: CONFIG.drive.scopes,
      callback: (tokenResponse) => {
        if (tokenResponse && tokenResponse.access_token) {
          driveAccessToken = tokenResponse.access_token;
          gapiSignedIn = true;
          updateDriveStatus("connected", "Connected");
        }
      },
    });
    gapiInitialized = true;
    updateDriveStatus("disconnected", "Ready to connect");
  } catch (err) {
    console.error("Drive init error:", err);
    updateDriveStatus("disconnected", "Init failed");
    showToast("Google Drive could not be initialised", "error");
  }
}

function requestDriveToken(interactive = true) {
  return new Promise((resolve) => {
    if (driveAccessToken && gapiSignedIn) {
      resolve(true);
      return;
    }
    if (!tokenClient) {
      resolve(false);
      return;
    }
    tokenClient.callback = (tokenResponse) => {
      if (tokenResponse && tokenResponse.access_token) {
        driveAccessToken = tokenResponse.access_token;
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

export async function searchDriveForLoad(loadNumber) {
  updateDriveStatus("searching", "Searching…");
  try {
    if (!driveAccessToken) {
      const gotToken = await requestDriveToken(true);
      if (!gotToken) {
        updateDriveStatus("disconnected", "Not signed in");
        return null;
      }
    }

    const query = `name contains '${loadNumber}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=${encodeURIComponent(
      "files(id, name, webViewLink)"
    )}&pageSize=10&key=${CONFIG.drive.apiKey}&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=allDrives`;

    let resp = await fetch(url, {
      headers: { Authorization: `Bearer ${driveAccessToken}` },
    });

    if (resp.status === 401) {
      const gotToken = await requestDriveToken(false);
      if (!gotToken) {
        updateDriveStatus("disconnected", "Auth expired");
        return null;
      }
      resp = await fetch(url, {
        headers: { Authorization: `Bearer ${driveAccessToken}` },
      });
    }

    const data = await resp.json();
    const folders = data.files || [];

    if (folders.length > 0) {
      const folder = folders[0];
      driveSearchCache[loadNumber] = folder.webViewLink;
      updateDriveStatus("connected", "Connected");
      return folder.webViewLink;
    }

    updateDriveStatus("connected", "Connected");
    return null;
  } catch (err) {
    console.error("Drive search error:", err);
    updateDriveStatus("disconnected", "Search failed");
    showToast(`Drive search failed for #${loadNumber}`, "error");
    return null;
  }
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
  if (driveSearchCache[loadNumber]) return driveSearchCache[loadNumber];
  const saved = getSavedDriveLinks();
  if (saved[loadNumber]) {
    driveSearchCache[loadNumber] = saved[loadNumber];
    return saved[loadNumber];
  }
  const link = await searchDriveForLoad(loadNumber);
  if (link) saveDriveLink(loadNumber, link);
  return link;
}

export function showDriveSignIn() {
  requestDriveToken(true);
}
