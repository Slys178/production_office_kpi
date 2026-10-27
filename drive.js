/**
 * Google Drive integration — auth, search, download
 */
export let gapiClient = null;
export let tokenClient = null;
export let gapiInitialized = false;
export let gapiSignedIn = false;
export let driveAccessToken = null;

export let driveSearchCache = {};
/** loadNumber -> folder meta { id, name, webViewLink } */
export let driveFolderIdCache = {};

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const TOKEN_STORAGE_KEY = "driveAccessToken";

export function updateDriveStatus(status, text) {
  const el = document.getElementById("driveStatus");
  if (!el) return;
  el.className = "drive-status " + (status || "");
  el.textContent = text || "";
}

export function loadGoogleIdentityServices() {
  return new Promise(function (resolve, reject) {
    if (typeof google !== "undefined" && google.accounts && google.accounts.oauth2) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.onload = function () { resolve(); };
    script.onerror = function () { reject(new Error("Failed to load GIS")); };
    document.head.appendChild(script);
  });
}

export async function initGapiClient() {
  if (gapiInitialized) return true;
  try {
    await loadGoogleIdentityServices();
    // Restore token from session if present
    try {
      const saved = sessionStorage.getItem(TOKEN_STORAGE_KEY);
      if (saved) {
        driveAccessToken = saved;
        gapiSignedIn = true;
      }
    } catch (_) {}

    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: window.DRIVE_CLIENT_ID || "",
      scope: DRIVE_SCOPE,
      callback: function (resp) {
        if (resp && resp.access_token) {
          driveAccessToken = resp.access_token;
          gapiSignedIn = true;
          try {
            sessionStorage.setItem(TOKEN_STORAGE_KEY, resp.access_token);
          } catch (_) {}
          updateDriveStatus("ready", "Drive: connected");
        }
      },
    });

    gapiInitialized = true;
    if (gapiSignedIn) {
      updateDriveStatus("ready", "Drive: connected");
    } else {
      updateDriveStatus("", "Drive: not signed in");
    }
    return true;
  } catch (e) {
    console.error("initGapiClient", e);
    updateDriveStatus("error", "Drive: init failed");
    return false;
  }
}

export function requestDriveToken(interactive) {
  return new Promise(function (resolve) {
    if (!tokenClient) {
      resolve(false);
      return;
    }
    const prev = tokenClient.callback;
    tokenClient.callback = function (resp) {
      tokenClient.callback = prev;
      if (resp && resp.access_token) {
        driveAccessToken = resp.access_token;
        gapiSignedIn = true;
        try {
          sessionStorage.setItem(TOKEN_STORAGE_KEY, resp.access_token);
        } catch (_) {}
        updateDriveStatus("ready", "Drive: connected");
        resolve(true);
      } else {
        resolve(false);
      }
    };
    try {
      tokenClient.requestAccessToken({ prompt: interactive ? "consent" : "" });
    } catch (e) {
      console.error(e);
      resolve(false);
    }
  });
}

export async function ensureDriveReady(interactiveSignIn) {
  if (!gapiInitialized) await initGapiClient();
  if (gapiSignedIn && driveAccessToken) return true;
  if (interactiveSignIn) {
    return await requestDriveToken(true);
  }
  return false;
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
      "&pageSize=5";
    const resp = await driveFetch(url);
    if (!resp || !resp.ok) return null;
    const data = await resp.json();
    const files = (data && data.files) || [];
    if (!files.length) return null;
    // Prefer exact-ish name match
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
    // Fallback: plain text export for Docs if HTML fails
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
  updateDriveStatus("", "Drive: sign in…");
  requestDriveToken(true).then(function (ok) {
    if (ok && typeof onSuccess === "function") onSuccess();
  });
}

window.ensureDriveReady = ensureDriveReady;
window.searchDriveForLoad = searchDriveForLoad;
