/**
 * Admin-only KPI target control.
 * Saves full-day stairs target to localStorage and applies CONFIG.baseRate.
 * Only visible when userRole contains ADMIN.
 */
import { CONFIG } from './config.js';

const STORAGE_KEY = 'kpiFullDayTarget';

export function getFullDayTarget() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved != null && saved !== '') {
    const n = parseFloat(saved);
    if (!isNaN(n) && n > 0) return n;
  }
  return CONFIG.fullDayTarget != null ? CONFIG.fullDayTarget : Math.round(CONFIG.baseRate * 9);
}

export function applyKpiTargetOverride() {
  const target = getFullDayTarget();
  CONFIG.baseRate = target / 9;
  if (CONFIG.fullDayTarget != null) CONFIG.fullDayTarget = target;
  return target;
}

function isAdmin() {
  const role = (localStorage.getItem('userRole') || '').toUpperCase();
  const roleText = (localStorage.getItem('userRoleText') || '').toUpperCase();
  return role.includes('ADMIN') || roleText.includes('ADMIN');
}

export function renderAdminTargetPanel() {
  const host = document.getElementById('adminTargetPanel');
  if (!host) return;

  if (!isAdmin()) {
    host.style.display = 'none';
    host.innerHTML = '';
    return;
  }

  host.style.display = 'block';
  const current = getFullDayTarget();
  const hoursSF = (CONFIG.hours.SF && CONFIG.hours.SF.MonThu) || 9;
  const hoursFri = (CONFIG.hours.SF && CONFIG.hours.SF.Fri) || 6.5;
  const weekEst = Math.round(CONFIG.baseRate * (hoursSF * 4 + hoursFri));

  host.innerHTML =
    '<div style="margin:12px 0 16px;padding:14px 16px;background:var(--section-bg,rgba(74,144,226,0.12));' +
    'border:1px solid var(--card-border,#232c42);border-radius:12px;max-width:420px;">' +
    '<div style="font-weight:700;font-size:0.9rem;margin-bottom:6px;">⚙️ Admin — daily stairs target</div>' +
    '<div style="font-size:0.75rem;color:var(--muted,#8993ab);margin-bottom:10px;line-height:1.35;">' +
    'Only visible to Admin. Changes apply on <strong>this device</strong> (set once on the TV if needed). ' +
    'Full-timers ≈ daily × 4 + Fri share; Domi scales by her hours.</div>' +
    '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">' +
    '<label style="font-size:0.8rem;">Full day (9h) target</label>' +
    '<input id="adminFullDayTargetInput" type="number" min="1" max="200" step="1" value="' + current + '" ' +
    'style="width:72px;padding:6px 8px;border-radius:8px;border:1px solid var(--card-border);' +
    'background:var(--card-bg,#161d2e);color:var(--text);font-size:0.95rem;font-weight:700;"/>' +
    '<button id="adminSaveTargetBtn" type="button" style="padding:6px 14px;border:none;border-radius:8px;' +
    'background:var(--blue,#4a90e2);color:#fff;font-weight:600;cursor:pointer;font-family:inherit;">Save & refresh</button>' +
    '<button id="adminResetTargetBtn" type="button" style="padding:6px 12px;border:1px solid var(--card-border);' +
    'border-radius:8px;background:transparent;color:var(--text);cursor:pointer;font-family:inherit;font-size:0.8rem;">Reset default</button>' +
    '</div>' +
    '<div id="adminTargetHint" style="font-size:0.75rem;color:var(--muted);margin-top:8px;">' +
    'Current rate → ~' + weekEst + ' stairs/week for Simon/Liam pattern</div>' +
    '</div>';

  const saveBtn = document.getElementById('adminSaveTargetBtn');
  const resetBtn = document.getElementById('adminResetTargetBtn');
  const input = document.getElementById('adminFullDayTargetInput');

  if (saveBtn) {
    saveBtn.addEventListener('click', function () {
      const n = parseFloat(input && input.value);
      if (isNaN(n) || n <= 0) {
        alert('Enter a valid daily target (e.g. 53).');
        return;
      }
      localStorage.setItem(STORAGE_KEY, String(n));
      applyKpiTargetOverride();
      const hint = document.getElementById('adminTargetHint');
      if (hint) {
        const w = Math.round(CONFIG.baseRate * (hoursSF * 4 + hoursFri));
        hint.textContent = 'Saved ' + n + ' / day → ~' + w + ' stairs/week. Refreshing…';
      }
      if (typeof window.loadAndRender === 'function') {
        window.loadAndRender().then(function () {
          renderAdminTargetPanel();
        }).catch(function () {
          location.reload();
        });
      } else {
        location.reload();
      }
    });
  }
  if (resetBtn) {
    resetBtn.addEventListener('click', function () {
      localStorage.removeItem(STORAGE_KEY);
      const def = 53;
      CONFIG.fullDayTarget = def;
      CONFIG.baseRate = def / 9;
      if (typeof window.loadAndRender === 'function') {
        window.loadAndRender().then(function () { renderAdminTargetPanel(); });
      } else {
        location.reload();
      }
    });
  }
}

export function initAdminTargets() {
  applyKpiTargetOverride();
  renderAdminTargetPanel();
}

window.applyKpiTargetOverride = applyKpiTargetOverride;
window.renderAdminTargetPanel = renderAdminTargetPanel;
