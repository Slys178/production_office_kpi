/**
 * Minimal Google Identity Services token handling for incidents
 * (Sheets append + Drive photo upload). No dependency on the main app.
 */
import { CONFIG } from "./config.js";

export let gapiInitialized = false;
export let gapiSignedIn = false;
export let driveAccessToken = null;
let tokenClient = null;

// Separate storage keys from the main app so the two never share/clobber tokens
const TOKEN_KEY = "incidentsGoogleToken";
const TOKEN_TIME_KEY = "incidentsGoogleTokenTime";

function storeToken(accessToken) {
  driveAccessToken = accessToken;
  gapiSignedIn = true;
  try {
    sessionStorage.setItem(TOKEN_KEY, accessToken);
    sessionStorage.setItem(TOKEN_TIME_KEY, Date.now().toString());
  } catch (_) {}
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
    const savedToken = sessionStorage.getItem(TOKEN_KEY);
    const savedTime = sessionStorage.getItem(TOKEN_TIME_KEY);
    if (savedToken && savedTime) {
      const ageMinutes = (Date.now() - parseInt(savedTime, 10)) / (1000 * 60);
      if (ageMinutes < 55) {
        driveAccessToken = savedToken;
        gapiSignedIn = true;
      }
    }

    await loadGoogleIdentityServices();

    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.google.clientId,
      scope: CONFIG.google.scopes,
      callback: (tokenResponse) => {
        if (tokenResponse && tokenResponse.access_token) storeToken(tokenResponse.access_token);
      },
      error_callback: (err) => {
        console.error("Google sign-in error:", err);
        gapiSignedIn = false;
      },
    });

    gapiInitialized = true;
    return true;
  } catch (error) {
    console.error("Failed to init Google Identity Services:", error);
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
        storeToken(tokenResponse.access_token);
        resolve(true);
      } else {
        resolve(false);
      }
    };
    tokenClient.requestAccessToken({ prompt: interactive ? "consent" : "" });
  });
}
