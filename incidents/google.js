/**
 * Google sign-in (Identity Services token flow) for the Incident Log.
 * Browsers only allow the Google popup from a click, so when there is no valid
 * token we show a small sign-in screen and wait for the button press.
 */
import { CONFIG } from "./config.js";

const TOKEN_KEY = "incidentLogGoogleToken";
const TIME_KEY = "incidentLogGoogleTokenTime";
let accessToken = null;
let email = "";
let pending = null;

function cached() {
  if (accessToken) return accessToken;
  try {
    const t = sessionStorage.getItem(TOKEN_KEY);
    const at = parseInt(sessionStorage.getItem(TIME_KEY) || "0", 10);
    if (t && at && (Date.now() - at) / 60000 < 55) {
      accessToken = t;
      return t;
    }
  } catch (_) {}
  return null;
}

function store(t) {
  accessToken = t;
  try {
    sessionStorage.setItem(TOKEN_KEY, t);
    sessionStorage.setItem(TIME_KEY, Date.now().toString());
  } catch (_) {}
}

export function clearToken() {
  accessToken = null;
  email = "";
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TIME_KEY);
  } catch (_) {}
}

function loadGIS() {
  return new Promise((resolve, reject) => {
    if (window.google && window.google.accounts && window.google.accounts.oauth2) return resolve();
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Could not load Google sign-in"));
    document.head.appendChild(s);
  });
}

function showSignIn() {
  return new Promise((resolve, reject) => {
    const ov = document.createElement("div");
    ov.style.cssText =
      "position:fixed;inset:0;z-index:50;background:var(--paper);display:flex;align-items:center;justify-content:center;padding:14px";
    ov.innerHTML =
      '<div class="panel" style="max-width:420px;width:100%;text-align:center">' +
      "<h2>Incident Log</h2>" +
      '<p class="none" style="margin-bottom:8px">Sign in with your Staircraft Google account to open the incident log.</p>' +
      '<div id="giMsg"></div>' +
      '<button class="btn" id="giBtn" disabled>Loading...</button></div>';
    document.body.appendChild(ov);
    const btn = ov.querySelector("#giBtn");
    const msg = ov.querySelector("#giMsg");

    loadGIS().then(
      () => {
        btn.disabled = false;
        btn.textContent = "Sign in with Google";
      },
      (e) => {
        ov.remove();
        reject(e);
      }
    );

    btn.onclick = () => {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: CONFIG.google.clientId,
        scope: CONFIG.google.scopes,
        callback: (r) => {
          if (r && r.access_token) {
            store(r.access_token);
            ov.remove();
            resolve(r.access_token);
          } else {
            msg.innerHTML = '<div class="msg err">Sign in failed. Please try again.</div>';
          }
        },
        error_callback: (err) => {
          msg.innerHTML =
            '<div class="msg err">Sign in was not completed' +
            (err && err.type ? " (" + err.type + ")" : "") +
            ". Please try again.</div>";
        },
      });
      client.requestAccessToken({ prompt: "" });
    };
  });
}

/** Valid access token, asking the person to sign in if needed. */
export function getToken() {
  const t = cached();
  if (t) return Promise.resolve(t);
  if (!pending) pending = showSignIn().finally(() => { pending = null; });
  return pending;
}

/** Email of the signed-in Google account (lower-cased). */
export async function getUserEmail() {
  if (email) return email;
  const token = await getToken();
  const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: "Bearer " + token },
  });
  if (!res.ok) throw new Error("Could not read your Google account (" + res.status + ")");
  const j = await res.json();
  email = String(j.email || "").toLowerCase();
  return email;
}
