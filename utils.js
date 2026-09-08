/**
 * Shared utility helpers (dates, formatting, etc.)
 */

/**
 * Parse a UK-style date string (DD/MM/YYYY or DD-MM-YYYY)
 * @param {string} str
 * @returns {Date|null}
 */
export function parseUKDate(str) {
  if (!str) return null;
  const parts = str.trim().split(/[\/\-]/);
  if (parts.length !== 3) return null;
  let [d, m, y] = parts.map((p) => parseInt(p, 10));
  if (y < 100) y += 2000;
  if (!d || !m || !y) return null;
  return new Date(y, m - 1, d);
}

/**
 * @param {Date} a
 * @param {Date} b
 */
export function sameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Return the Monday of the week containing the given date
 * @param {Date} date
 */
export function mondayOf(date) {
  const monday = new Date(date);
  const dow = (date.getDay() + 6) % 7;
  monday.setDate(date.getDate() - dow);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

/**
 * @param {Date} date
 * @returns {'MonThu'|'Fri'|null}
 */
export function dayBucket(date) {
  const dow = date.getDay();
  if (dow === 5) return "Fri";
  if (dow >= 1 && dow <= 4) return "MonThu";
  return null;
}

export function fmtDate(d) {
  if (!d) return "";
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function fmtDateShort(d) {
  if (!d) return "";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
}

/**
 * Simple toast notification system
 */
export function showToast(message, type = "info", duration = 4000) {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.style.cssText = `
      position: fixed; bottom: 24px; right: 24px; z-index: 9999;
      display: flex; flex-direction: column; gap: 8px; max-width: 360px;
    `;
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  const colors = {
    info: "var(--blue)",
    success: "var(--green)",
    error: "var(--red)",
    warning: "var(--amber)",
  };
  toast.style.cssText = `
    background: var(--card); border: 1px solid ${colors[type] || colors.info};
    color: var(--text); padding: 12px 16px; border-radius: 10px;
    box-shadow: var(--shadow); font-size: 0.85rem; animation: toastIn 0.3s ease;
    display: flex; align-items: center; gap: 10px;
  `;
  toast.innerHTML = `<span>${message}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transition = "opacity 0.3s";
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

/**
 * Show / hide a simple full-page or section loading overlay
 * @param {boolean} show
 * @param {string} [message]
 */
export function setLoading(show, message = "Loading data…") {
  let el = document.getElementById("global-loader");
  if (show) {
    if (!el) {
      el = document.createElement("div");
      el.id = "global-loader";
      el.style.cssText = `
        position: fixed; inset: 0; background: rgba(0,0,0,0.45);
        display: flex; align-items: center; justify-content: center;
        z-index: 2000; backdrop-filter: blur(3px);
      `;
      el.innerHTML = `
        <div style="background:var(--card);border:1px solid var(--card-border);
          padding:24px 32px;border-radius:14px;text-align:center;color:var(--text)">
          <div class="spinner" style="width:28px;height:28px;border:3px solid var(--card-border);
            border-top-color:var(--teal);border-radius:50%;margin:0 auto 12px;
            animation:spin 0.8s linear infinite"></div>
          <div id="loader-msg">${message}</div>
        </div>`;
      document.body.appendChild(el);
    } else {
      el.style.display = "flex";
      const msg = document.getElementById("loader-msg");
      if (msg) msg.textContent = message;
    }
  } else if (el) {
    el.style.display = "none";
  }
}
