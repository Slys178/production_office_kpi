/**
 * Live "last seen" presence.
 * - Every logged-in user sends a quiet heartbeat while the app is open.
 * - SA (manager) and ADMIN see a small panel on the landing page: who is active now.
 * - SF and other production users do not see the panel.
 */

const PRESENCE = {
  scriptUrl: "https://script.google.com/macros/s/AKfycbwW_MHHk7pJuihmkQzugfI22XfaUx4n7drJf7fcVfR0eJiKBcQZ8MP-h3QWl9VRy8pH/exec",
  sheetId: "1uX_f3jc123mX2SsK7vIVIxN_zpQ3GkUqmA9U0QdJ2Dw",
  sheetGid: "1449433029",

  heartbeatMs: 2 * 60 * 1000,
  activeWithinMs: 10 * 60 * 1000,
  recentWithinMs: 60 * 60 * 1000,
  refreshPanelMs: 60 * 1000,
};

/** Manager SA + ADMIN role get the who's-online panel. */
function isManagerViewer(userName, userEmail, userRole) {
  const role = (userRole || "").toUpperCase().trim();
  if (role === "ADMIN" || role === "ADMINISTRATOR" || role === "MANAGER" || role.includes("ADMIN")) {
    return true;
  }
  const n = (userName || "").trim().toUpperCase();
  const e = (userEmail || "").trim().toLowerCase();

  // Initials / name forms for SA
  if (n === "SA" || n.startsWith("SA ") || n.endsWith(" SA") || n === "S.A" || n === "S A") return true;
  if (/\bSA\b/.test(n)) return true;
  if (n.includes("SIMON ASK")) return true;
  if (n.includes("ASK") && n.includes("SIMON")) return true;

  // Email forms
  if (e.includes("simon.ask")) return true;
  if (e.includes("simon_ask")) return true;
  if (e.startsWith("sa@") || e.includes(".sa@")) return true;

  return false;
}

function getViewer() {
  let userName = "";
  let userEmail = "";
  let userRole = "";
  try {
    userName = (localStorage.getItem("userName") || "").trim();
    userEmail = (localStorage.getItem("userEmail") || "").trim().toLowerCase();
    userRole = (localStorage.getItem("userRole") || "").trim().toUpperCase();
  } catch (_) {}

  const canSeeAll = isManagerViewer(userName, userEmail, userRole);
  // Helpful in browser console if panel is missing
  console.log("[presence] viewer", { userName, userEmail, userRole, canSeeAll });

  return { userName, userEmail, userRole, canSeeAll };
}

function sendHeartbeat() {
  if (!PRESENCE.scriptUrl) return;
  const { userName, userEmail, userRole } = getViewer();
  if (!userEmail) return;

  const params = new URLSearchParams({
    email: userEmail,
    name: userName || userEmail,
    role: userRole || "",
    t: String(Date.now()),
  });

  const img = new Image();
  img.referrerPolicy = "no-referrer";
  img.src = `${PRESENCE.scriptUrl}?${params.toString()}`;
}

function parseGvizDate(cell) {
  if (cell == null || cell === "") return null;
  if (typeof cell === "object" && cell instanceof Date) return cell;
  if (typeof cell === "string" && cell.startsWith("Date(")) {
    const nums = cell.replace(/Date\(|\)/g, "").split(",").map(n => parseInt(n, 10));
    if (nums.length >= 3) {
      return new Date(nums[0], nums[1], nums[2], nums[3] || 0, nums[4] || 0, nums[5] || 0);
    }
  }
  // Google sometimes returns serial or ISO
  if (typeof cell === "number") {
    // Sheets serial date → JS (days since 1899-12-30)
    const ms = (cell - 25569) * 86400 * 1000;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(cell);
  return isNaN(d.getTime()) ? null : d;
}

function fetchPresenceRows() {
  return new Promise((resolve, reject) => {
    if (!PRESENCE.sheetId) {
      reject(new Error("No presence sheet configured"));
      return;
    }
    const cb = `__presenceCb_${Date.now()}`;
    const script = document.createElement("script");
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("Presence sheet timed out"));
    }, 12000);

    function cleanup() {
      clearTimeout(timeout);
      try { delete window[cb]; } catch (_) {}
      script.remove();
    }

    window[cb] = function (response) {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        if (response.status === "error") {
          reject(new Error("Sheet error"));
          return;
        }
        const table = response.table;
        const rows = [];
        for (let i = 0; i < table.rows.length; i++) {
          const c = table.rows[i].c || [];
          const email = (c[0]?.v ?? c[0]?.f ?? "").toString().trim().toLowerCase();
          if (!email || email === "email") continue;
          const name = (c[1]?.v ?? c[1]?.f ?? "").toString().trim();
          const role = (c[2]?.v ?? c[2]?.f ?? "").toString().trim();
          const rawSeen = c[3]?.v ?? c[3]?.f ?? "";
          const lastSeen = parseGvizDate(rawSeen);
          if (!lastSeen || isNaN(lastSeen.getTime())) continue;
          rows.push({ email, name, role, lastSeen });
        }
        resolve(rows);
      } catch (e) {
        reject(e);
      }
    };

    script.onerror = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("Failed to load presence sheet"));
    };

    const gidPart = PRESENCE.sheetGid ? `&gid=${PRESENCE.sheetGid}` : "";
    script.src = `https://docs.google.com/spreadsheets/d/${PRESENCE.sheetId}/gviz/tq?tqx=out:json;responseHandler:${cb}${gidPart}`;
    document.body.appendChild(script);
  });
}

function formatAgo(ms) {
  if (ms < 60 * 1000) return "just now";
  if (ms < 60 * 60 * 1000) return `${Math.round(ms / 60000)} min ago`;
  if (ms < 24 * 60 * 60 * 1000) return `${Math.round(ms / 3600000)} hr ago`;
  return `${Math.round(ms / 86400000)} day(s) ago`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, """);
}

async function renderPresencePanel() {
  const el = document.getElementById("presencePanel");
  if (!el) {
    console.warn("[presence] #presencePanel not found in page");
    return;
  }

  const viewer = getViewer();
  if (!viewer.canSeeAll) {
    el.style.display = "none";
    el.innerHTML = "";
    return;
  }
  el.style.display = "block";

  try {
    const rows = await fetchPresenceRows();
    const now = Date.now();
    rows.sort((a, b) => b.lastSeen - a.lastSeen);

    const active = rows.filter(r => now - r.lastSeen.getTime() <= PRESENCE.activeWithinMs);
    const recent = rows.filter(r => {
      const age = now - r.lastSeen.getTime();
      return age > PRESENCE.activeWithinMs && age <= PRESENCE.recentWithinMs;
    });
    const older = rows.filter(r => now - r.lastSeen.getTime() > PRESENCE.recentWithinMs).slice(0, 8);

    function rowHtml(r, cls) {
      const age = now - r.lastSeen.getTime();
      return `
        <div class="presence-row ${cls}">
          <span class="presence-dot"></span>
          <span class="presence-name">${escapeHtml(r.name || r.email)}</span>
          <span class="presence-role">${escapeHtml(r.role || "")}</span>
          <span class="presence-ago">${formatAgo(age)}</span>
        </div>`;
    }

    let body = "";
    if (active.length) {
      body += `<div class="presence-group-label">Active now</div>`;
      body += active.map(r => rowHtml(r, "active")).join("");
    }
    if (recent.length) {
      body += `<div class="presence-group-label">Last hour</div>`;
      body += recent.map(r => rowHtml(r, "recent")).join("");
    }
    if (!active.length && !recent.length) {
      body += `<div class="presence-empty">No one active in the last hour yet — open the app and wait ~1 min, or check the Presence sheet for rows.</div>`;
    }
    if (older.length) {
      body += `<div class="presence-group-label">Earlier</div>`;
      body += older.map(r => rowHtml(r, "older")).join("");
    }

    el.innerHTML = `
      <div class="presence-card">
        <div class="presence-title">👥 Who's online <span class="presence-sub">admin only · last 10 min = active</span></div>
        <div class="presence-list">${body}</div>
      </div>`;
  } catch (e) {
    console.warn("presence panel", e);
    el.innerHTML = `
      <div class="presence-card">
        <div class="presence-title">👥 Who's online</div>
        <div class="presence-setup">Could not load presence sheet (${escapeHtml(e.message || e)}). Check the Presence tab is shared (Anyone with link → Viewer) and gid is correct.</div>
      </div>`;
  }
}

export function startPresence() {
  sendHeartbeat();
  setInterval(sendHeartbeat, PRESENCE.heartbeatMs);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") sendHeartbeat();
  });

  const viewer = getViewer();
  if (viewer.canSeeAll) {
    renderPresencePanel();
    setInterval(renderPresencePanel, PRESENCE.refreshPanelMs);
  } else {
    console.warn("[presence] Panel hidden — login is not recognised as SA/ADMIN. userRole should be ADMIN in the user list sheet, or name/email should match SA.");
  }
}

startPresence();
