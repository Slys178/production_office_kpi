/**
 * Google Drive integration — folder search for loads.
 * Real, working logic — moved here from main.js (not rewritten).
 *
 * State (gapiInitialized, gapiSignedIn, driveAccessToken, driveSearchCache) is
 * exported as live bindings so main.js can read current values directly,
 * exactly as it could when this all lived in one file.
 */

import { CONFIG } from "./config.js";

export let gapiInitialized = false;
export let gapiSignedIn = false;
export let driveAccessToken = null;
let tokenClient = null;
export let driveSearchCache = {};

const driveStatusDot = document.getElementById('driveStatusDot');
const driveStatusText = document.getElementById('driveStatusText');

export function updateDriveStatus(status, text) {
  driveStatusDot.className = 'status-dot ' + status;
  driveStatusText.textContent = 'Drive: ' + text;
}

export function loadGoogleIdentityServices() {
  return new Promise((resolve, reject) => {
    if (typeof google !== 'undefined' && google.accounts && google.accounts.oauth2) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Identity Services'));
    document.head.appendChild(script);
  });
}

export async function initGapiClient() {
  try {
    // ===== CHANGE 2: Check if we already have a valid token from this session =====
    const savedToken = sessionStorage.getItem('driveToken');
    const savedTime = sessionStorage.getItem('driveTokenTime');
    if (savedToken && savedTime) {
      const ageMinutes = (Date.now() - parseInt(savedTime, 10)) / (1000 * 60);
      if (ageMinutes < 55) {
        // Token is still valid (Google tokens last 1 hour)
        driveAccessToken = savedToken;
        gapiSignedIn = true;
        updateDriveStatus('connected', 'Connected');
        return true;
      }
    }
    // ===== END CHANGE 2 =====

    await loadGoogleIdentityServices();

    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.drive.clientId,
      scope: CONFIG.drive.scopes,
      callback: (tokenResponse) => {
        if (tokenResponse && tokenResponse.access_token) {
          driveAccessToken = tokenResponse.access_token;
          sessionStorage.setItem('driveToken', tokenResponse.access_token);
          sessionStorage.setItem('driveTokenTime', Date.now().toString());
          gapiSignedIn = true;
          updateDriveStatus('connected', 'Connected');
        }
      },
      error_callback: (err) => {
        console.error('Drive sign-in error:', err);
        gapiSignedIn = false;
        updateDriveStatus('disconnected', (err && err.type) ? err.type : 'Sign in failed');
      }
    });

    gapiInitialized = true;
    updateDriveStatus('disconnected', 'Not signed in');
    return true;
  } catch (error) {
    console.error('Failed to init Google Identity Services:', error);
    updateDriveStatus('disconnected', 'Error: ' + (error && error.message ? error.message : 'unknown'));
    return false;
  }
}

export function requestDriveToken(interactive){
  return new Promise((resolve) => {
    if(!tokenClient){ resolve(false); return; }
    tokenClient.callback = (tokenResponse) => {
      if (tokenResponse && tokenResponse.access_token) {
        driveAccessToken = tokenResponse.access_token;
        sessionStorage.setItem('driveToken', tokenResponse.access_token);
        sessionStorage.setItem('driveTokenTime', Date.now().toString());
        gapiSignedIn = true;
        updateDriveStatus('connected', 'Connected');
        resolve(true);
      } else {
        resolve(false);
      }
    };
    tokenClient.requestAccessToken({ prompt: interactive ? 'consent' : '' });
  });
}

export async function searchDriveForLoad(loadNumber) {
  if (!gapiInitialized) {
    updateDriveStatus('disconnected', 'Not ready yet');
    return null;
  }
  if (!gapiSignedIn || !driveAccessToken) {
   // handleDriveClick already handles sign-in — don't trigger it again here
   updateDriveStatus('disconnected', 'Sign in needed');
   return null;
 }

  try {
    updateDriveStatus('searching', 'Searching...');

    const query = `name contains '${loadNumber}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=${encodeURIComponent('files(id, name, webViewLink)')}&pageSize=10&key=${CONFIG.drive.apiKey}&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=allDrives`;

    const resp = await fetch(url, {
      headers: { Authorization: 'Bearer ' + driveAccessToken }
    });

    if (resp.status === 401) {
      driveAccessToken = null;
      gapiSignedIn = false;
      const gotToken = await requestDriveToken(false);
      if (!gotToken) { updateDriveStatus('disconnected', 'Sign in needed'); return null; }
      return searchDriveForLoad(loadNumber);
    }

    if (!resp.ok) {
      throw new Error('Drive API returned ' + resp.status);
    }

    const data = await resp.json();
    const folders = data.files || [];

    if (folders.length > 0) {
      const folder = folders[0];
      driveSearchCache[loadNumber] = folder.webViewLink;
      updateDriveStatus('connected', 'Connected');
      return folder.webViewLink;
    } else {
      updateDriveStatus('connected', 'Connected');
      return null;
    }
  } catch (error) {
    console.error('Drive search error:', error);
    updateDriveStatus('connected', 'Connected');
    return null;
  }
}

export function getSavedDriveLinks() {
  try {
    return JSON.parse(localStorage.getItem('driveLinks') || '{}');
  } catch {
    return {};
  }
}

export function saveDriveLink(loadNumber, link) {
  const links = getSavedDriveLinks();
  links[loadNumber] = link;
  localStorage.setItem('driveLinks', JSON.stringify(links));
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
  const link = await searchDriveForLoad(loadNumber);
  if (link) {
    saveDriveLink(loadNumber, link);
  }
  return link;
}

export function showDriveSignIn(onSuccess) {
  if (gapiInitialized) {
    requestDriveToken(true).then((ok) => {
      if (ok) {
        if (onSuccess) onSuccess();
      } else {
        updateDriveStatus('disconnected', 'Sign in cancelled');
      }
    });
  }
}
