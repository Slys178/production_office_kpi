/**
 * Live "last seen" presence.
 * - Every logged-in user sends a quiet heartbeat while the app is open.
 * - ADMIN (and SF) see a small panel on the landing page: who is active now.
 *
 * Requires a one-time Google Apps Script deploy — see PRESENCE_SETUP.md
 * Until scriptUrl is set, heartbeats are skipped and the panel shows a setup hint.
 */

const PRESENCE = {
  // Paste your Apps Script web-app URL after deploying (PRESENCE_SETUP.md)
  scriptUrl: "",

  // Same spreadsheet as the login user list; add a tab named "Presence"
  sheetId: "1uX_f3jc123mX2SsK7vIVIxN_zpQ3GkUqmA9U0QdJ2Dw",
  // Set after creating the Presence tab (from the sheet URL: gid=……)
  sheetGid: "",

  heartbeatMs: 2 * 60 * 1000,       // ping every 2 minutes
  activeWithinMs: 10 * 60 * 1000,   // green = seen in last 10 min
  recentWithinMs: 60 * 60 * 1000,   // amber = seen in last hour
  refreshPanelMs: 60 * 1000,        // re-read sheet every minute for admins
};

const FULL_VIEW_INITIALS = new Set(["SF"]);

function getViewer() {
  let userName = "";
  let userEmail = "";
  let userRole = "";
  try {
    userName = (localStorage.getItem("userName") || "").trim();
    userEmail = (localStorage.getItem("userEmail") || "").trim().toLowerCase();
    userRole = (localStorage.getItem("userRole") || "").trim().toUpperCase();
  } catch (_) {}

  const nameUpper = userName.toUpperCase();
  const people = [
    { initials: "SF", name: "Simon Faulks" },
    { initials: "LA", name: "Liam Aiello" },
    { initials: "AS", name: "Adam Stanislawski" },
    { initials: "DF", name: "Dominika Formanowicz" },
  ];
  const matched = people.find(p => {
    const full = p.name.toUpperCase();
    return full === nameUpper
      || nameUpper === full.split(" ")[0]
      || full.startsWith(nameUpper)
      || nameUpper === p.initials;
  }) || null;

  const canSeeAll =
    userRole === "ADMIN"
    || (matched && FULL_VIEW_INITIALS.has(matched.initials));

  return { userName, userEmail, userRole, canSeeAll };
}

/** Fire-and-forget heartbeat (GET avoids CORS hassle with Apps Script). */
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

  // Image beacon — works cross-origin, no CORS preflight
  const img = new Image();
  img.referrerPolicy = "no-referrer";
  img.src = `${PRESENCE.scriptUrl}?${params.toString()}`;
}

function parseGvizDate(cell) {
  if (!cell) return null;
  // GViz sometimes returns Date(yyyy,m,d,h,min,s) as string in v
  if (typeof cell === "string" && cell.startsWith("Date(")) {
    const nums = cell.replace(/Date\(|\)/g, "").split(",").map(n => parseInt(n, 10));
    if (nums.length >= 3) {
      return new Date(nums[0], nums[1], nums[2], nums[3] || 0, nums[4] || 0, nums[5] || 0);
    }
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
        // Expect header: Email | Name | Role | LastSeen
        for (let i = 0; i < table.rows.length; i++) {
          const c = table.rows[i].c || [];
          const email = (c[0]?.v ?? c[0]?.f ?? "").toString().trim().toLowerCase();
          if (!email || email === "email") continue;
          const name = (c[1]?.v ?? c[1]?.f ?? "").toString().trim();
          const role = (c[2]?.v ?? c[2]?.f ?? "").toString().trim();
          const rawSeen = c[3]?.v ?? c[3]?.f ?? "";
          const lastSeen = parseGvizDate(rawSeen) || (typeof rawSeen === "string" ? new Date(rawSeen) : null);
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

async function renderPresencePanel() {
  const el = document.getElementById("presencePanel");
  if (!el) return;

  const viewer = getViewer();
  if (!viewer.canSeeAll) {
    el.style.display = "none";
    return;
  }
  el.style.display = "";

  if (!PRESENCE.scriptUrl || !PRESENCE.sheetGid) {
    el.innerHTML = `
      <div class="presence-card">
        <div class="presence-title">👥 Who's online</div>
        <div class="presence-setup">
          Presence is almost ready. Complete the short setup in
          <code>PRESENCE_SETUP.md</code> (create Presence tab, deploy Apps Script,
          paste script URL + gid into <code>presence.js</code>).
        </div>
      </div>`;
    return;
  }

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
      body += `<div class="presence-empty">No one active in the last hour</div>`;
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
        <div class="presence-setup">Could not load presence sheet. Check the tab is shared (Anyone with link → Viewer) and gid is correct.</div>
      </div>`;
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function startPresence() {
  // Heartbeat for everyone
  sendHeartbeat();
  setInterval(sendHeartbeat, PRESENCE.heartbeatMs);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") sendHeartbeat();
  });

  // Admin panel
  const viewer = getViewer();
  if (viewer.canSeeAll) {
    renderPresencePanel();
    setInterval(renderPresencePanel, PRESENCE.refreshPanelMs);
  }
}

// Auto-start when loaded as module
startPresence();
