/**
 * Application entry point
 * - Theme toggle
 * - Starts the main app
 */

import { initAndLoad, loadAndRender, REFRESH_MS } from "./main.js";

/* =========================================================
   THEME TOGGLE
   ========================================================= */
const themeToggle = document.getElementById("themeToggle");
let currentTheme = localStorage.getItem("theme") || "dark";
document.documentElement.setAttribute("data-theme", currentTheme);

if (themeToggle) {
  themeToggle.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme");
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("theme", next);
  });
}

/* =========================================================
   AUTH - Check Permissions
   ========================================================= */

// ===== REPLACE THIS WITH YOUR ACTUAL SHEET ID =====
// Your User List sheet URL: https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID_HERE/edit
const USER_LIST_SHEET_ID = '1uX_f3jc123mX2SsK7vIVIxN_zpQ3GkUqmA9U0QdJ2Dw'; // <-- REPLACE THIS!
const USER_LIST_GID = '0';

// Check if user is logged in
function checkLoginStatus() {
    const email = sessionStorage.getItem('userEmail');
    const role = sessionStorage.getItem('userRole');
    if (!email || !role) {
        window.location.href = 'login.html';
        return false;
    }
    return true;
}

// Apply permissions based on role
function applyPermissions() {
    const role = sessionStorage.getItem('userRole');
    
    if (role === 'USER') {
        // Hide Admin-only tiles
        const adminTiles = ['tileKpi', 'tileErrors', 'tileReplacementParts', 'tileReview'];
        adminTiles.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
        
        // Show a message for users
        const landingTitle = document.querySelector('.landing-title p');
        if (landingTitle) {
            landingTitle.textContent = '👤 User view — limited access';
        }
    }
}

// Logout function
function logout() {
    sessionStorage.clear();
    window.location.href = 'login.html';
}

// ===== Run auth checks on page load =====
// This runs when the page loads
(function initAuth() {
    // Only run on the dashboard page (not on login page)
    if (document.getElementById('landingPage')) {
        if (!checkLoginStatus()) {
            return; // Will redirect to login
        }
        applyPermissions();
        
        // Add logout button event
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', logout);
        }
        
        // Show user name in header
        const userName = sessionStorage.getItem('userName');
        if (userName) {
            const statusEl = document.querySelector('.status');
            if (statusEl) {
                const nameSpan = document.createElement('span');
                nameSpan.textContent = '👤 ' + userName;
                nameSpan.style.cssText = 'margin-right:12px;font-weight:600;color:var(--text);';
                statusEl.prepend(nameSpan);
            }
        }
    }
})();

/* =========================================================
   START
   ========================================================= */
initAndLoad();
setInterval(loadAndRender, REFRESH_MS);

console.log("%cProduction Office KPI – modular build", "color:#00A99D;font-weight:bold");
