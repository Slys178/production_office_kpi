/**
 * Main application logic (extracted from original single file)
 * Config comes from config.js. Theme is handled in app.js.
 */

import { CONFIG } from "./config.js";

// Map old constant names to the central config so the rest of the code stays unchanged
const PROJECT_TRACKING_SHEET_ID = CONFIG.sheets.projectTracking.id;
const PROJECT_TRACKING_GID     = CONFIG.sheets.projectTracking.gid;
const HOLIDAYS_SHEET_ID        = CONFIG.sheets.holidays.id;
const HOLIDAYS_GID             = CONFIG.sheets.holidays.gid;
const ERRORS_SHEET_ID          = CONFIG.sheets.errors.id;
const ERRORS_GID               = CONFIG.sheets.errors.gid;
const REPLACEMENT_PARTS_SHEET_ID = CONFIG.sheets.replacementParts.id;
const REPLACEMENT_PARTS_GID      = CONFIG.sheets.replacementParts.gid;

const PEOPLE     = CONFIG.people;
const HOURS      = CONFIG.hours;
const BASE_RATE  = CONFIG.baseRate;
const REFRESH_MS = CONFIG.refreshMs;
const FORECAST_WEEKS = CONFIG.forecastWeeks;
const TREND_WEEKS    = CONFIG.trendWeeks;

const CLIENT_ID = CONFIG.drive.clientId;
const API_KEY   = CONFIG.drive.apiKey;
const SCOPES    = CONFIG.drive.scopes;

/* =========================================================
   GOOGLE DRIVE API - AUTO SEARCH
   ========================================================= */

let gapiInitialized = false;
let gapiSignedIn = false;
let driveAccessToken = null;
let tokenClient = null;
let driveSearchCache = {};

const driveStatusDot = document.getElementById('driveStatusDot');
const driveStatusText = document.getElementById('driveStatusText');

function updateDriveStatus(status, text) {
  driveStatusDot.className = 'status-dot ' + status;
  driveStatusText.textContent = 'Drive: ' + text;
}

function loadGoogleIdentityServices() {
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

async function initGapiClient() {
  try {
    await loadGoogleIdentityServices();

    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: (tokenResponse) => {
        if (tokenResponse && tokenResponse.access_token) {
          driveAccessToken = tokenResponse.access_token;
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

function requestDriveToken(interactive){
  return new Promise((resolve) => {
    if(!tokenClient){ resolve(false); return; }
    tokenClient.callback = (tokenResponse) => {
      if (tokenResponse && tokenResponse.access_token) {
        driveAccessToken = tokenResponse.access_token;
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

async function searchDriveForLoad(loadNumber) {
  if (!gapiInitialized) {
    updateDriveStatus('disconnected', 'Not ready yet');
    return null;
  }
  if (!gapiSignedIn || !driveAccessToken) {
    const gotToken = await requestDriveToken(true);
    if (!gotToken) {
      updateDriveStatus('disconnected', 'Sign in needed');
      return null;
    }
  }

  try {
    updateDriveStatus('searching', 'Searching...');

    const query = `name contains '${loadNumber}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=${encodeURIComponent('files(id, name, webViewLink)')}&pageSize=10&key=${API_KEY}&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=allDrives`;

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

function showDriveSignIn() {
  if (gapiInitialized) {
    requestDriveToken(true).then((ok) => {
      if (ok) {
        renderLoads();
      } else {
        updateDriveStatus('disconnected', 'Sign in cancelled');
      }
    });
  }
}

document.getElementById('driveAuthStatus').addEventListener('click', function() {
  if (!gapiSignedIn) {
    showDriveSignIn();
  }
});

/* =========================================================
   LOADS SYSTEM
   ========================================================= */
let loadItems = [];
let loadsFiltered = [];
let loadsPageSize = 12;
let loadsCurrentPage = 1;

function parseLoadsFromSheet(stairEntries, forecastEntries) {
  const allEntries = [...stairEntries, ...forecastEntries];
  const loadMap = {};
  
  allEntries.forEach(entry => {
    const dueDate = entry.deliveryDate ? entry.deliveryDate.toISOString().split('T')[0] : null;
    const loadNumber = entry.loadNo && entry.loadNo.trim() ? entry.loadNo.trim() : ('#' + entry.stairs + '_' + (dueDate || ''));
    const key = loadNumber + '_' + (dueDate || '');
    
    let status = 'pending';
    if (entry.initials) {
      // Every entry already carries its own isCompleted flag from the sheet's
      // tick-box column (set when it was first parsed) — "completed" array
      // entries just don't repeat the field since it's always true for them.
      const isCompleted = entry.isCompleted !== undefined ? entry.isCompleted : true;
      status = isCompleted ? 'completed' : 'in-progress';
    }
    
    if (!loadMap[key]) {
      loadMap[key] = {
        loadNumber: loadNumber,
        stairs: entry.stairs,
        person: entry.initials || '',
        personName: entry.initials ? PEOPLE.find(p => p.initials === entry.initials)?.name || entry.initials : 'Unassigned',
        status: status,
        dueDate: dueDate,
        date: entry.date ? entry.date.toISOString().split('T')[0] : null
      };
    }
  });
  
  return Object.values(loadMap);
}

function getSavedDriveLinks() {
  try {
    return JSON.parse(localStorage.getItem('driveLinks') || '{}');
  } catch {
    return {};
  }
}

function saveDriveLink(loadNumber, link) {
  const links = getSavedDriveLinks();
  links[loadNumber] = link;
  localStorage.setItem('driveLinks', JSON.stringify(links));
}

async function getDriveLink(loadNumber) {
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

function renderLoads() {
  const searchTerm = document.getElementById('loadSearch')?.value?.toLowerCase() || '';
  const personFilter = document.getElementById('personFilter')?.value || 'all';
  const statusFilter = document.getElementById('statusFilter')?.value || 'all';
  
  loadsFiltered = loadItems.filter(load => {
    if (searchTerm) {
      const loadNumStr = load.loadNumber.toString();
      if (!loadNumStr.includes(searchTerm)) return false;
    }
    if (personFilter !== 'all' && load.person !== personFilter) return false;
    if (statusFilter !== 'all' && load.status !== statusFilter) return false;
    return true;
  });
  
  loadsFiltered.sort((a, b) => {
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return new Date(a.dueDate) - new Date(b.dueDate);
  });
  
  document.getElementById('loadsTotal').textContent = loadsFiltered.length;
  
  const totalPages = Math.ceil(loadsFiltered.length / loadsPageSize);
  if (loadsCurrentPage > totalPages) loadsCurrentPage = Math.max(1, totalPages);
  const start = (loadsCurrentPage - 1) * loadsPageSize;
  const end = Math.min(start + loadsPageSize, loadsFiltered.length);
  const pageData = loadsFiltered.slice(start, end);
  
  document.getElementById('loadsShowing').textContent = pageData.length;
  
  const grid = document.getElementById('loadsGrid');
  if (pageData.length === 0) {
    grid.innerHTML = `
      <div class="loads-empty" style="grid-column:1/-1;">
        <span class="icon">📭</span>
        No loads found. Try adjusting your filters or add loads to the Google Sheet.
      </div>
    `;
  } else {
    grid.innerHTML = pageData.map((load, index) => {
      const statusLabels = {
        'in-progress': '🔄 In Progress',
        'completed': '✅ Completed',
        'pending': '⏳ Pending'
      };
      const statusClass = load.status || 'pending';
      const personColor = PEOPLE.find(p => p.initials === load.person)?.color || '#8993ab';
      const loadNum = load.loadNumber;
      const hasLink = driveSearchCache[loadNum] || getSavedDriveLinks()[loadNum];
      
      return `
        <div class="load-card" data-load="${loadNum}" data-index="${index}">
          <div class="load-header">
            <span class="load-number">#${loadNum}</span>
            <span class="load-status status-${statusClass}">${statusLabels[statusClass] || statusClass}</span>
          </div>
          <div class="load-details">
            <span><span class="person-dot" style="background:${personColor};"></span> ${load.personName || 'Unassigned'}</span>
            ${load.dueDate ? `<span>📅 Due: ${new Date(load.dueDate).toLocaleDateString('en-GB')}</span>` : ''}
          </div>
          <div class="load-stairs">
            ${load.stairs ? `📊 ${load.stairs} stairs` : ''}
          </div>
          <div class="load-actions">
            <button class="drive-btn" data-load="${loadNum}" id="driveBtn_${loadNum}">
              ${hasLink ? '📁 Open Drive Folder' : '🔍 Find in Drive'}
            </button>
            ${hasLink ? `<span class="drive-link-found">✅ Link saved</span>` : ''}
          </div>
        </div>
      `;
    }).join('');
    
    document.querySelectorAll('.drive-btn').forEach(btn => {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        const loadNum = this.dataset.load;
        handleDriveClick(loadNum, this);
      });
    });
  }
  
  const pagination = document.getElementById('loadsPagination');
  if (totalPages > 1) {
    pagination.innerHTML = `
      <button ${loadsCurrentPage === 1 ? 'disabled' : ''} onclick="loadsGoToPage(${loadsCurrentPage - 1})">◀ Prev</button>
      <span class="page-info">Page <span class="current">${loadsCurrentPage}</span> of ${totalPages}</span>
      <button ${loadsCurrentPage === totalPages ? 'disabled' : ''} onclick="loadsGoToPage(${loadsCurrentPage + 1})">Next ▶</button>
    `;
  } else {
    pagination.innerHTML = '';
  }
}

function loadsGoToPage(page) {
  const totalPages = Math.ceil(loadsFiltered.length / loadsPageSize);
  if (page < 1 || page > totalPages) return;
  loadsCurrentPage = page;
  renderLoads();
}

async function handleDriveClick(loadNum, button) {
  const savedLinks = getSavedDriveLinks();
  if (savedLinks[loadNum]) {
    window.open(savedLinks[loadNum], '_blank');
    return;
  }
  if (driveSearchCache[loadNum]) {
    window.open(driveSearchCache[loadNum], '_blank');
    return;
  }
  if (!gapiSignedIn) {
    showDriveSignIn();
    setTimeout(() => {
      if (gapiSignedIn) {
        handleDriveClick(loadNum, button);
      }
    }, 2000);
    return;
  }
  button.textContent = '🔍 Searching...';
  button.classList.add('searching');
  button.disabled = true;
  try {
    const link = await searchDriveForLoad(loadNum);
    if (link) {
      saveDriveLink(loadNum, link);
      button.textContent = '📁 Open Drive Folder';
      button.classList.remove('searching');
      button.disabled = false;
      window.open(link, '_blank');
      renderLoads();
    } else {
      button.textContent = '❌ Not found';
      button.classList.remove('searching');
      button.disabled = false;
      const openSearch = confirm(`No folder found for load #${loadNum}.\n\nWould you like to open Google Drive and search for it manually?`);
      if (openSearch) {
        window.open(`https://drive.google.com/drive/search?q=${loadNum}`, '_blank');
      }
      setTimeout(() => {
        button.textContent = '🔍 Find in Drive';
      }, 3000);
    }
  } catch (error) {
    console.error('Drive search error:', error);
    button.textContent = '❌ Error';
    button.classList.remove('searching');
    button.disabled = false;
    setTimeout(() => {
      button.textContent = '🔍 Find in Drive';
    }, 3000);
  }
}

function updateLoadsBadge() {
  const badge = document.getElementById('tileLoadsBadge');
  const pending = loadItems.filter(l => l.status === 'pending' || l.status === 'in-progress').length;
  if (pending > 0) {
    badge.style.display = 'inline-block';
    badge.textContent = `${pending} active`;
    badge.className = 'tile-badge';
  } else {
    badge.style.display = 'none';
  }
}

/* =========================================================
   HELPER FUNCTIONS
   ========================================================= */
function parseUKDate(str){
  if(!str) return null;
  const parts = str.trim().split(/[\/\-]/);
  if(parts.length !== 3) return null;
  let [d,m,y] = parts.map(p=>parseInt(p,10));
  if(y < 100) y += 2000;
  if(!d || !m || !y) return null;
  return new Date(y, m-1, d);
}

function sameDay(a,b){
  return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
}

function mondayOf(date){
  const monday = new Date(date);
  const dow = (date.getDay()+6)%7;
  monday.setDate(date.getDate()-dow);
  monday.setHours(0,0,0,0);
  return monday;
}

function dayBucket(date){
  const dow = date.getDay();
  if(dow===5) return 'Fri';
  if(dow>=1 && dow<=4) return 'MonThu';
  return null;
}

let jsonpCounter = 0;
function fetchGvizRows(sheetId, gid){
  return new Promise((resolve, reject)=>{
    jsonpCounter++;
    const callbackName = `__gvizCallback_${jsonpCounter}_${Date.now()}`;
    const script = document.createElement('script');
    let settled = false;
    const timeout = setTimeout(()=>{
      if(settled) return;
      settled = true;
      cleanup();
      reject(new Error('Timed out loading sheet data'));
    }, 15000);
    function cleanup(){
      clearTimeout(timeout);
      delete window[callbackName];
      script.remove();
    }
    window[callbackName] = function(response){
      if(settled) return;
      settled = true;
      cleanup();
      try{
        if(response.status === 'error'){ reject(new Error('Sheet returned an error')); return; }
        const table = response.table;
        const dataRows = table.rows.map(r =>
          table.cols.map((c,i)=>{
            const cell = r.c ? r.c[i] : null;
            if(!cell) return '';
            if(cell.f !== undefined && cell.f !== null) return String(cell.f);
            if(cell.v !== undefined && cell.v !== null) return String(cell.v);
            return '';
          })
        );
        const labelRow = table.cols.map(c => c.label || '');
        const hasLabels = labelRow.some(v => v.trim() !== '');
        const rows = hasLabels ? [labelRow, ...dataRows] : dataRows;
        resolve(rows);
      } catch(e){ reject(e); }
    };
    script.onerror = ()=>{
      if(settled) return;
      settled = true;
      cleanup();
      reject(new Error('Failed to load sheet'));
    };
    function gvizJsonUrl(sheetId, callbackName, gid){
      const gidPart = gid ? `&gid=${gid}` : '';
      return `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json;responseHandler:${callbackName}${gidPart}`;
    }
    script.src = gvizJsonUrl(sheetId, callbackName, gid);
    document.body.appendChild(script);
  });
}

function buildHolidayIndex(rows){
  let dateRowIdx = -1;
  for(let i=0;i<rows.length;i++){
    const matches = rows[i].filter(c=>/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(c.trim())).length;
    if(matches > 20){ dateRowIdx = i; break; }
  }
  if(dateRowIdx === -1) throw new Error("Could not find date header row in HOLIDAYS sheet");
  const dateRow = rows[dateRowIdx];
  const dateCols = dateRow.map((c,idx)=>{
    const d = parseUKDate(c);
    return d ? {idx, date:d} : null;
  }).filter(Boolean);
  const thisYear = new Date().getFullYear();
  const yearCols = dateCols.filter(dc => dc.date.getFullYear() === thisYear);
  const colsToUse = yearCols.length ? yearCols : dateCols;
  const nameIndex = {};
  for(let i=dateRowIdx;i<rows.length;i++){
    const nameCell = (rows[i][0]||'').trim();
    if(nameCell) nameIndex[nameCell] = rows[i];
  }
  return { colsToUse, nameIndex };
}

function getCodeForPerson(holidayIndex, personName, date){
  const row = holidayIndex.nameIndex[personName];
  if(!row) return '';
  const match = holidayIndex.colsToUse.find(dc => sameDay(dc.date, date));
  if(!match) return '';
  return (row[match.idx] || '').trim();
}

function hoursLostForCode(code, fullDayHours){
  if(!code) return 0;
  const c = code.toLowerCase();
  if(c === 'h' || c === 'b' || c === 'o' || c.startsWith('2nd')) return fullDayHours;
  if(c === 'h/am' || c === 'h/pm') return fullDayHours/2;
  if(c === 'c') return 2;
  return 0;
}

function creditableHoursLost(code, fullDayHours){
  if(!code) return 0;
  const c = code.toLowerCase();
  if(c === 'c') return 0;
  return hoursLostForCode(code, fullDayHours);
}

function targetFor(initials, date, code){
  const bucket = dayBucket(date);
  if(!bucket) return 0;
  const fullDayHours = HOURS[initials][bucket];
  const lost = hoursLostForCode(code, fullDayHours);
  const available = Math.max(0, fullDayHours - lost);
  return Math.round(BASE_RATE * available);
}

function isAbsenceCode(code){
  if(!code) return false;
  const c = code.toLowerCase();
  return c==='h' || c==='h/am' || c==='h/pm' || c==='b' || c==='o';
}

function statusLabel(code){
  if(!code) return null;
  const c = code.toLowerCase();
  if(c==='h') return 'Full day off';
  if(c==='h/am') return 'Half day (AM) off';
  if(c==='h/pm') return 'Half day (PM) off';
  if(c==='b') return 'Bank holiday';
  if(c==='o') return 'Other / away';
  if(c==='c') return 'Carrier run';
  if(c.startsWith('2nd')) return '2nd fix help';
  return code;
}

function computeDayStats(person, date, stairEntries, holidayIndex){
  const bucket = dayBucket(date);
  const code = getCodeForPerson(holidayIndex, person.holidayName, date);
  if(!bucket) return { actual:0, target:0, credit:0, code };
  const target = targetFor(person.initials, date, code);
  const actual = stairEntries.filter(e=>e.initials===person.initials && sameDay(e.date, date))
                              .reduce((s,e)=>s+e.stairs,0);
  const fullDayHours = HOURS[person.initials][bucket];
  const lostHours = creditableHoursLost(code, fullDayHours);
  const credit = lostHours > 0 ? Math.round(BASE_RATE * lostHours) : 0;
  return { actual, target, credit, code };
}

/* =========================================================
   PARSE STAIR ROWS
   ========================================================= */
function parseStairRows(rows){
  let headerIdx = rows.findIndex(r => r.some(c => c.trim().toUpperCase()==='INITIALS'));
  if(headerIdx === -1) throw new Error("Could not find INITIALS header in Project Tracking sheet");
  const header = rows[headerIdx].map(c=>c.trim().toUpperCase());
  const dateCol = header.findIndex(c=>c.includes('START') && c.includes('DATE'));
  const initialsCol = header.findIndex(c=>c==='INITIALS');
  const stairsCol = header.findIndex(c=>c.includes('NUMBER OF STAIRS'));
  const deliveryDateCol = header.findIndex(c=>c.includes('DELIVERY') && c.includes('DATE'));
  const loadNoCol = header.findIndex(c=>c.includes('LOAD') && c.includes('NO'));

  const winderStringPlatesCol = header.findIndex(c=>c.includes('WINDER') && c.includes('STRING') && c.includes('PLATES'));
  const smallStringPlatesCol  = header.findIndex(c=>c.includes('SMALL') && c.includes('STRING') && c.includes('PLATES'));
  const straightStringsCol    = header.findIndex(c=>c.includes('STRAIGHT') && c.includes('STRINGS'));
  const postsCol               = header.findIndex(c=>c.includes('POSTS') && !c.includes('COMPLETED'));
  const windersCol             = header.findIndex(c=>c.includes('WINDERS') && !c.includes('COMPLETED'));
  const bullnoseCol            = header.findIndex(c=>c.includes('BULLNOSE') && c.includes('ASSEMBLED'));

  let completedCol = header.findIndex(c => c.includes('COMPLETED') || c.includes('DONE') || c.includes('TICK'));
  if(completedCol === -1) completedCol = 3;

  const completed = [];
  const forecast = [];

  for(let i=headerIdx+1;i<rows.length;i++){
    const r = rows[i];
    const deliveryDate = deliveryDateCol > -1 ? parseUKDate(r[deliveryDateCol]) : null;
    const stairs = parseInt(r[stairsCol],10);
    
    if(deliveryDate && !isNaN(stairs) && stairs > 0) {
      const initials = (r[initialsCol]||'').trim().toUpperCase();
      
      const completedVal = (r[completedCol] || '').toString().trim().toUpperCase();
      const isCompleted = completedVal === 'TRUE' || completedVal === 'YES' || completedVal === '1' || completedVal === '✓';
      
      const parts = {
        winderStringPlates: parseInt(r[winderStringPlatesCol],10) || 0,
        smallStringPlates:  parseInt(r[smallStringPlatesCol],10) || 0,
        straightStrings:    parseInt(r[straightStringsCol],10) || 0,
        posts:               parseInt(r[postsCol],10) || 0,
        winders:             parseInt(r[windersCol],10) || 0,
        bullnose:            parseInt(r[bullnoseCol],10) || 0
      };
      
      const date = parseUKDate(r[dateCol]);
      const loadNo = loadNoCol > -1 ? (r[loadNoCol]||'').toString().trim().replace(/^#+/, '') : '';
      
      if(deliveryDate && !isNaN(stairs) && stairs > 0) {
        const entry = {
          date: date || null,
          initials: initials || null,
          stairs: stairs,
          parts: parts,
          deliveryDate: deliveryDate,
          isCompleted: isCompleted,
          loadNo: loadNo
        };
        
        if(isCompleted && date && initials && PEOPLE.some(p => p.initials === initials)) {
          completed.push({date, initials, stairs, parts, deliveryDate, loadNo});
        } else {
          forecast.push({
            date: date || null,
            initials: initials || null,
            stairs: stairs,
            parts: parts,
            deliveryDate: deliveryDate,
            isCompleted: isCompleted,
            loadNo: loadNo
          });
        }
      }
    }
  }
  return { completed, forecast };
}

/* =========================================================
   PARSE ERROR ROWS
   ========================================================= */
function parseErrorRows(rows){
  let headerIdx = -1;
  for(let i=0;i<rows.length;i++){
    const r = rows[i];
    if(r && r.length > 2) {
      const upper = r.map(c => (c||'').trim().toUpperCase());
      if(upper.some(c => c.includes('DATE')) && upper.some(c => c.includes('PERSON'))) {
        headerIdx = i;
        break;
      }
    }
  }
  if(headerIdx === -1) return [];
  const header = rows[headerIdx].map(c => (c||'').trim().toUpperCase());
  const dateCol = header.findIndex(c => c.includes('DATE'));
  const personCol = header.findIndex(c => c.includes('PERSON'));
  const issueCol = header.findIndex(c => c.includes('ISSUE'));
  const quantityCol = header.findIndex(c => c.includes('QUANTITY'));
  const plotCol = header.findIndex(c => c.includes('PLOT'));
  const sectionCol = header.findIndex(c => c.includes('SECTION'));
  const impactCol = header.findIndex(c => c.includes('IMPACT'));
  const pointsCol = header.findIndex(c => c.includes('POINTS') && !c.includes('ADDITIONAL'));
  const additionalPointsCol = header.findIndex(c => c.includes('ADDITIONAL'));
  const loadCol = header.findIndex(c => c.includes('LOAD'));

  const out = [];
  for(let i=headerIdx+1;i<rows.length;i++){
    const r = rows[i];
    if(!r || r.length < 2) continue;
    const dateStr = (r[dateCol]||'').trim();
    if(!dateStr) continue;
    const date = parseUKDate(dateStr);
    if(!date) continue;
    const personName = (r[personCol]||'').trim().toUpperCase();
    const person = PEOPLE.find(p => p.initials === personName);
    if(!person) continue;
    const points = parseInt(r[pointsCol],10) || 0;
    const additional = parseInt(r[additionalPointsCol],10) || 0;
    out.push({
      initials: person.initials,
      date: date,
      issue: (r[issueCol]||'').trim(),
      quantity: parseInt(r[quantityCol],10) || 1,
      plot: (r[plotCol]||'').trim(),
      section: (r[sectionCol]||'').trim(),
      impact: (r[impactCol]||'').trim(),
      points: points,
      additionalPoints: additional,
      loadLink: (r[loadCol]||'').trim()
    });
  }
  return out;
}

// Parses the "STAIR PARTS" tab of the Replacement Parts sheet, filtered to
// only rows logged against the OFFICE section (i.e. mistakes caused by the
// office — wrong program, missing paperwork — not shop-floor/CNC issues).
function parseReplacementPartsRows(rows){
  let headerIdx = -1;
  for(let i=0;i<rows.length;i++){
    const r = rows[i];
    if(r && r.length > 5) {
      const upper = r.map(c => (c||'').trim().toUpperCase());
      if(upper.some(c => c.includes('WEEK NO')) && upper.some(c => c.includes('SECTION'))) {
        headerIdx = i;
        break;
      }
    }
  }
  if(headerIdx === -1) return [];
  const header = rows[headerIdx].map(c => (c||'').trim().toUpperCase());
  const dateCol = header.findIndex(c => c.includes('DATE'));
  const partCol = header.findIndex(c => c.includes('PART REPLACED'));
  const costCol = header.findIndex(c => c.includes('COST'));
  const qtyCol = header.findIndex(c => c.includes('QUANTITY'));
  const materialCol = header.findIndex(c => c.includes('MATERIAL'));
  const reasonCol = header.findIndex(c => c.includes('REASON'));
  const sectionCol = header.findIndex(c => c.includes('SECTION'));
  const operatorCol = header.findIndex(c => c.includes('OPERATOR'));
  const loadCol = header.findIndex(c => c.includes('LOAD'));
  const plotCol = header.findIndex(c => c.includes('PLOT'));

  const out = [];
  for(let i=headerIdx+1;i<rows.length;i++){
    const r = rows[i];
    if(!r || r.length < 3) continue;
    const dateStr = (r[dateCol]||'').trim();
    if(!dateStr) continue;
    const date = parseUKDate(dateStr);
    if(!date) continue;
    const section = (r[sectionCol]||'').trim().toUpperCase();
    if(section !== 'OFFICE') continue; // only office-caused mistakes for this view

    const costStr = (r[costCol]||'').replace(/[£,\s]/g, '');
    const cost = parseFloat(costStr) || 0;

    // Operator names are stored like "SIMON FAULKS (OFFICE)" — strip the
    // suffix and match against our tracked PEOPLE by full name so this cost
    // can be tied to that person's own page. Names that don't match anyone
    // we track (blank, other staff, inconsistent entries) are left unmatched
    // and simply won't appear on any person's page.
    const cleanOperator = (r[operatorCol]||'').replace(/\(office\)/i, '').trim().toUpperCase();
    const matchedPerson = PEOPLE.find(p => p.name.toUpperCase() === cleanOperator);

    out.push({
      date: date,
      part: (r[partCol]||'').trim() || 'Unspecified',
      cost: cost,
      quantity: parseInt(r[qtyCol],10) || 1,
      material: (r[materialCol]||'').trim(),
      reason: (r[reasonCol]||'').trim() || 'Unspecified',
      operator: (r[operatorCol]||'').trim(),
      initials: matchedPerson ? matchedPerson.initials : null,
      loadNo: (r[loadCol]||'').trim(),
      plot: (r[plotCol]||'').trim()
    });
  }
  return out;
}

/* =========================================================
   RENDER FUNCTIONS - UPDATED WITH "COMPLETED DAYS ONLY" LOGIC
   ========================================================= */
function fmtDate(d){
  return d.toLocaleDateString('en-GB', {weekday:'short', day:'numeric', month:'short'});
}
function fmtDateShort(d){
  return d.toLocaleDateString('en-GB', {day:'numeric', month:'short'});
}

// NEW: Calculate the cumulative target for COMPLETED days only
function getCompletedDaysTarget(person, today, stairEntries, holidayIndex) {
  const monday = mondayOf(today);
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  
  let completedTarget = 0;
  let completedActual = 0;
  
  // Loop through each day of the week (Mon-Fri)
  for (let d = new Date(monday); d <= friday; d.setDate(d.getDate() + 1)) {
    const dCopy = new Date(d);
    if (!dayBucket(dCopy)) continue;
    
    // Check if this day is COMPLETED (yesterday or earlier)
    // A day is "completed" if it's strictly before today
    const isCompletedDay = dCopy < new Date(today.setHours(0,0,0,0));
    
    if (isCompletedDay) {
      // Add this day's target to the completed target
      const code = getCodeForPerson(holidayIndex, person.holidayName, dCopy);
      const dayTarget = targetFor(person.initials, dCopy, code);
      completedTarget += dayTarget;
      
      // Also track actual for this day (for reference)
      const dayActual = stairEntries
        .filter(e => e.initials === person.initials && sameDay(e.date, dCopy))
        .reduce((s, e) => s + e.stairs, 0);
      completedActual += dayActual;
    }
  }
  
  return { completedTarget, completedActual };
}

function statusForProgress(actual, projected){
  if(projected === 0) return 'off';
  const ratio = actual / projected;
  if(ratio >= 1) return 'over';
  if(ratio >= 0.85) return 'green';
  if(ratio >= 0.6) return 'amber';
  return 'red';
}

function statusLabelText(status, code){
  if(status === 'off') return statusLabel(code) || 'Off today';
  if(status === 'over') return '🌟 Ahead of pace!';
  if(status === 'green') return '✅ On pace';
  if(status === 'amber') return '⚠️ Slipping';
  if(status === 'red') return '❌ Behind pace';
  return '';
}

// UPDATED: Dial showing actual vs completed-days target
function drawProjectedDial(actual, completedTarget, weekTarget, colorClass, person, today) {
  const size=200, stroke=16, r=(size-stroke)/2, cx=size/2, cy=size/2;
  const circumference = 2*Math.PI*r;
  
  // Use the week target as the max value for the dial
  const maxVal = Math.max(weekTarget, actual, completedTarget);
  const displayMax = Math.max(maxVal, weekTarget * 1.1);
  
  const pctActual = Math.min(1, actual / displayMax);
  const pctCompleted = Math.min(1, completedTarget / displayMax);
  const pctTarget = Math.min(1, weekTarget / displayMax);
  
  const dashActual = circumference * pctActual;
  const dashCompleted = circumference * pctCompleted;
  
  // Determine color based on status
  const status = statusForProgress(actual, completedTarget);
  const colorMap = {green:'#2ecc71', over:'#3498db', amber:'#f5a623', red:'#e74c3c', off:'#8993ab'};
  const color = colorMap[status] || '#4a90e2';
  
  // Determine status text
  let statusText = '';
  let statusColor = color;
  
  const todayDate = new Date(today);
  todayDate.setHours(0,0,0,0);
  const dayOfWeek = todayDate.getDay(); // 1=Mon, 5=Fri, 0=Sun, 6=Sat
  
  // If it's Monday or before, no completed days yet
  if (dayOfWeek === 1 || dayOfWeek === 0 || dayOfWeek === 6) {
    statusText = '📅 Week just started';
    statusColor = '#8993ab';
  } else if (completedTarget === 0 && actual === 0) {
    statusText = '📌 No target yet';
    statusColor = '#8993ab';
  } else if (actual >= completedTarget && actual >= weekTarget) {
    statusText = '🎯 Target met!';
    statusColor = '#2ecc71';
  } else if (actual >= completedTarget) {
    statusText = '✅ On pace!';
    statusColor = '#2ecc71';
  } else {
    const pctOfPace = Math.round((actual / completedTarget) * 100);
    if (pctOfPace >= 85) {
      statusText = `⚠️ ${pctOfPace}% of pace`;
      statusColor = '#f5a623';
    } else {
      statusText = `❌ ${pctOfPace}% of pace`;
      statusColor = '#e74c3c';
    }
  }
  
  return `
    <svg viewBox="0 0 ${size} ${size}" width="100%" style="max-width:200px;">
      <!-- Background ring -->
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--card-border)" stroke-width="${stroke}">
        <title>The full ring is the gauge's scale — a bit past the weekly target, leaving room to show over-performance. The white marker below shows exactly where the target sits on it.</title>
      </circle>
      <!-- Completed days target (faded) ring -->
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"
        stroke-dasharray="${dashCompleted} ${circumference}" stroke-linecap="round"
        opacity="0.25"
        transform="rotate(-90 ${cx} ${cy})">
        <title>Expected progress by today, based on the days worked so far this week</title>
      </circle>
      <!-- Actual (solid) ring -->
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}"
        stroke-dasharray="${dashActual} ${circumference}" stroke-linecap="round"
        transform="rotate(-90 ${cx} ${cy})">
        <title>Actual stairs completed so far this week</title>
      </circle>
      <!-- Weekly target marker -->
      <line x1="${cx + (r-4) * Math.sin(-Math.PI/2 + 2*Math.PI*pctTarget)}" 
            y1="${cy - (r-4) * Math.cos(-Math.PI/2 + 2*Math.PI*pctTarget)}"
            x2="${cx + (r+6) * Math.sin(-Math.PI/2 + 2*Math.PI*pctTarget)}" 
            y2="${cy - (r+6) * Math.cos(-Math.PI/2 + 2*Math.PI*pctTarget)}"
            stroke="var(--text)" stroke-width="2" stroke-linecap="round">
        <title>Marks where the full week's target (${weekTarget}) sits on the ring — the finish line</title>
      </line>
      <!-- Small dot on target marker -->
      <circle cx="${cx + r * Math.sin(-Math.PI/2 + 2*Math.PI*pctTarget)}" 
              cy="${cy - r * Math.cos(-Math.PI/2 + 2*Math.PI*pctTarget)}"
              r="3" fill="var(--text)" opacity="0.3">
        <title>Marks where the full week's target (${weekTarget}) sits on the ring — the finish line</title>
      </circle>
    </svg>
    <div class="dial-num">
      <div class="big" style="color:${statusColor};" title="Stairs completed so far this week">${actual}</div>
      <div class="small" title="The full week's target">done · weekly target ${weekTarget}</div>
      <div class="projected" title="What you'd expect to have done by today if working exactly on pace">📈 expected from completed days: ${completedTarget}</div>
      <div class="small" style="font-weight:600;color:${statusColor};font-size:0.65rem;" title="How today's actual compares to the pace-adjusted expectation above">${statusText}</div>
    </div>
  `;
}

function drawMiniTrendProjected(weeks, person, stairEntries, holidayIndex, today){
  const bars = weeks.map(w => {
    let actual = 0, target = 0;
    for(let d = new Date(w.start); d <= w.end; d.setDate(d.getDate()+1)){
      if(!dayBucket(d)) continue;
      const stats = computeDayStats(person, new Date(d), stairEntries, holidayIndex);
      actual += stats.actual;
      target += stats.target;
    }
    let projected = actual;
    const todayCopy = new Date(today);
    const isCurrentWeek = w.isCurrent;
    if(isCurrentWeek){
      for(let d = new Date(todayCopy); d <= w.end; d.setDate(d.getDate()+1)){
        const dCopy = new Date(d);
        if(!dayBucket(dCopy)) continue;
        if(dCopy > todayCopy) {
          const code = getCodeForPerson(holidayIndex, person.holidayName, dCopy);
          projected += targetFor(person.initials, dCopy, code);
        }
      }
    }
    
    const pctActual = target > 0 ? Math.min(1, actual/target) : 0;
    const pctProjected = target > 0 ? Math.min(1, projected/target) : 0;
    const heightActual = Math.max(4, Math.round(pctActual * 100));
    const heightProjected = Math.max(4, Math.round(pctProjected * 100));
    
    const status = statusForProgress(actual, projected);
    const colorMap = {green:'#2ecc71', over:'#3498db', amber:'#f5a623', red:'#e74c3c', off:'#8993ab'};
    const color = colorMap[status] || '#4a90e2';
    const label = w.isCurrent ? 'Now' : fmtDateShort(w.start);
    
    return `
      <div class="bar-col">
        <div class="bar-track">
          <div class="bar-fill faded" style="height:${heightProjected}%;background:${color};"></div>
          <div class="bar-fill solid" style="height:${heightActual}%;background:${color};"></div>
          <div class="bar-target-line" style="bottom:${Math.round((1 - Math.min(1, target/Math.max(target, actual, projected))) * 100)}%;"></div>
        </div>
        <div class="bar-val">${actual}</div>
        <div class="bar-label">${label}</div>
      </div>
    `;
  }).join('');
  return `
    <div class="mini-trend">
      <div class="mini-trend-label">Last ${weeks.length} weeks · dark=done, faded=projected</div>
      <div class="bars">${bars}</div>
    </div>
  `;
}

function renderTeamSummary(leaderboardData){
  const container = document.getElementById('teamSummary');
  if(!container) return;

  const teamActual = leaderboardData.reduce((s,d) => s + d.weekActual, 0);
  const teamCompletedTarget = leaderboardData.reduce((s,d) => s + d.completedTarget, 0);
  const teamTarget = leaderboardData.reduce((s,d) => s + d.weekTarget, 0);
  const teamStatus = statusForProgress(teamActual, teamCompletedTarget);

  const ranked = [...leaderboardData].sort((a,b) => {
    const pctA = a.completedTarget > 0 ? a.weekActual / a.completedTarget : (a.weekActual > 0 ? 2 : -1);
    const pctB = b.completedTarget > 0 ? b.weekActual / b.completedTarget : (b.weekActual > 0 ? 2 : -1);
    return pctB - pctA;
  });

  const lbRows = ranked.map((d, idx) => {
    const pct = d.completedTarget > 0 ? Math.round((d.weekActual / d.completedTarget) * 100) : (d.weekActual > 0 ? 100 : null);
    const diff = d.weekActual - d.completedTarget;
    const pctClass = diff > 0 ? 'positive' : (diff < 0 ? 'negative' : 'neutral');
    const pctLabel = pct === null ? '—' : pct + '%';
    return `
      <div class="lb-row">
        <span class="lb-rank">${idx+1}</span>
        <span class="lb-dot" style="background:${d.person.color};"></span>
        <span class="lb-name">${d.person.name}</span>
        <span class="lb-figures">${d.weekActual} done · expected ${d.completedTarget}</span>
        <span class="lb-pct ${pctClass}" title="Actual so far vs what's expected by today's pace — over 100% means ahead of pace">${pctLabel}</span>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <div class="team-summary-wrap">
      <div class="team-dial-card">
        <h3>🏢 Whole Office</h3>
        <div class="team-sub">Actual vs completed days target</div>
        <div class="dial-wrap">
          ${drawProjectedDial(teamActual, teamCompletedTarget, teamTarget, teamStatus, null, new Date())}
        </div>
        <span class="badge ${teamStatus}">${statusLabelText(teamStatus, null)}</span>
      </div>
      <div class="leaderboard-card">
        <h3>🏆 Pace Leaderboard</h3>
        <div class="leaderboard">${lbRows}</div>
      </div>
    </div>
  `;
}

function renderHolidayCalendar(holidayIndex, month, year) {
  const container = document.getElementById('holidayGrid');
  const monthLabel = document.getElementById('monthLabel');
  monthLabel.textContent = new Date(year, month).toLocaleDateString('en-GB', { month:'short', year:'numeric' });
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startDayOfWeek = firstDay.getDay();
  const holidayData = {};
  for(let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    holidayData[day] = [];
    PEOPLE.forEach(person => {
      const code = getCodeForPerson(holidayIndex, person.holidayName, date);
      if(code) holidayData[day].push({ initials: person.initials, code: code, color: person.color });
    });
  }
  let html = '<div class="holiday-grid">';
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  dayNames.forEach(name => html += `<div class="day-header">${name}</div>`);
  for(let i=0; i<startDayOfWeek; i++) html += `<div class="day-cell"></div>`;
  for(let day=1; day<=daysInMonth; day++){
    const date = new Date(year, month, day);
    const isWeekend = date.getDay()===0 || date.getDay()===6;
    const holidays = holidayData[day] || [];
    const hasHoliday = holidays.length > 0;
    let cellClass = 'day-cell';
    if(isWeekend) cellClass += ' weekend';
    if(hasHoliday) cellClass += ' has-holiday';
    html += `<div class="${cellClass}">`;
    html += `<div class="day-number">${day}</div>`;
    if(hasHoliday){
      holidays.forEach(h=>{
        html += `<div class="code-line" style="background:${h.color}22;color:${h.color};" title="${h.initials}: ${statusLabel(h.code) || h.code}">${h.initials}: ${h.code}</div>`;
      });
    }
    html += '</div>';
  }
  html += '</div>';
  container.innerHTML = html;
}

/* =========================================================
   CAPACITY & MANPOWER
   ========================================================= */
function getPrevWeekCapacity(person, forecastWeekStart, holidayIndex){
  const prevWeekStart = new Date(forecastWeekStart);
  prevWeekStart.setDate(prevWeekStart.getDate() - 7);
  const prevWeekEnd = new Date(prevWeekStart);
  prevWeekEnd.setDate(prevWeekStart.getDate() + 4);

  let capacity = 0;
  const offDays = [];
  for(let d = new Date(prevWeekStart); d <= prevWeekEnd; d.setDate(d.getDate()+1)){
    const dCopy = new Date(d);
    if(!dayBucket(dCopy)) continue;
    const code = getCodeForPerson(holidayIndex, person.holidayName, dCopy);
    if(isAbsenceCode(code)){
      offDays.push({ date: new Date(dCopy), code });
      continue;
    }
    capacity += targetFor(person.initials, dCopy, code);
  }
  return { prevWeekStart, prevWeekEnd, capacity, offDays };
}

function getWarningLevel(forecast, capacity) {
  if(capacity === 0) return { level: 'danger', label: '🔴 No capacity!', class: 'danger' };
  const ratio = forecast / capacity;
  if(ratio > 0.95) return { level: 'danger', label: '🔴 Critical!', class: 'danger' };
  if(ratio > 0.75) return { level: 'warning', label: '🟡 Tight', class: 'warning' };
  return { level: 'ok', label: '✅ OK', class: 'ok' };
}

function renderForecast(forecastEntries, holidayIndex, today) {
  const startMonday = mondayOf(today);
  const weeks = [];
  for(let i=0;i<FORECAST_WEEKS;i++){
    const wStart = new Date(startMonday);
    wStart.setDate(wStart.getDate() + (7*i));
    const wEnd = new Date(wStart);
    wEnd.setDate(wStart.getDate() + 6);
    weeks.push({ start:wStart, end:wEnd, total:0, byPerson:{}, isCurrent:i===0 });
  }
  const lastWeekEnd = weeks[weeks.length-1].end;

  forecastEntries.forEach(e=>{
    if(!e.deliveryDate) return;
    if(e.deliveryDate < startMonday || e.deliveryDate > lastWeekEnd) return;
    const wk = weeks.find(w => e.deliveryDate >= w.start && e.deliveryDate <= w.end);
    if(!wk) return;
    wk.total += e.stairs;
    if(e.initials) {
      wk.byPerson[e.initials] = (wk.byPerson[e.initials]||0) + e.stairs;
    } else {
      wk.byPerson['UNASSIGNED'] = (wk.byPerson['UNASSIGNED']||0) + e.stairs;
    }
  });

  const container = document.getElementById('forecastWeeks');
  const displayWeeks = weeks.filter((w, i) => {
    if(i === 0 || i === 1) return true;
    return w.total > 0;
  });
  
  if(displayWeeks.length === 0 || displayWeeks.every(w => w.total === 0)){
    container.innerHTML = '<div class="forecast-empty">No upcoming stairs found with a delivery date.</div>';
    const tileBadge = document.getElementById('tileForecastBadge');
    tileBadge.style.display = 'none';
    return;
  }

  let hasManpowerWarning = false;

  const html = displayWeeks.map(w => {
    let totalCapacity = 0;
    const holidayImpacts = [];
    PEOPLE.forEach(person => {
      const cap = getPrevWeekCapacity(person, w.start, holidayIndex);
      totalCapacity += cap.capacity;
      if(cap.offDays.length > 0){
        holidayImpacts.push({ person, offDays: cap.offDays });
      }
    });

    const warning = getWarningLevel(w.total, totalCapacity);
    if(warning.level === 'danger') hasManpowerWarning = true;

    const chips = [];
    Object.keys(w.byPerson).forEach(initials => {
      const person = PEOPLE.find(p => p.initials === initials);
      const color = person ? person.color : '#8993ab';
      const name = person ? initials : 'Unassigned';
      chips.push(`<span class="fw-person-chip"><span class="dot" style="background:${color};"></span>${name}: ${w.byPerson[initials]}</span>`);
    });

    let holidayWarning = '';
    if(holidayImpacts.length > 0) {
      holidayWarning = `<div class="holiday-impact">⚠️ Previous week absences: `;
      holidayImpacts.forEach(p => {
        const days = p.offDays.map(o => fmtDateShort(o.date) + ' (' + o.code + ')').join(', ');
        holidayWarning += `<span class="chip">${p.person.initials}: ${days}</span>`;
      });
      holidayWarning += `</div>`;
    }

    const capacityUsed = w.total > 0 && totalCapacity > 0 ? Math.min(100, Math.round((w.total / totalCapacity) * 100)) : (w.total > 0 ? 100 : 0);
    const barClass = warning.level === 'danger' ? 'danger' : (warning.level === 'warning' ? 'warning' : 'ok');

    let cardClass = 'forecast-week-card';
    if(w.isCurrent) cardClass += ' current-week';
    if(warning.level === 'danger') cardClass += ' danger-week';

    return `
      <div class="${cardClass}">
        <div class="fw-header">
          <span class="fw-label">${w.isCurrent ? 'This week' : 'W/C ' + fmtDateShort(w.start)}</span>
          <div style="display:flex;align-items:center;gap:8px;">
            <span class="fw-total ${warning.level === 'danger' ? 'danger' : ''}">${w.total}<span class="unit">stairs</span></span>
            <span class="warning-badge ${warning.class}">${warning.label}</span>
          </div>
        </div>
        <div class="capacity-detail">
          <span>Prev-week capacity: ${totalCapacity} stairs</span>
          <span>${capacityUsed}% used</span>
        </div>
        <div class="capacity-bar">
          <div class="fill ${barClass}" style="width:${Math.min(100, capacityUsed)}%;"></div>
        </div>
        <div class="fw-breakdown">${chips.join('')}</div>
        ${holidayWarning}
        ${warning.level === 'danger' ? `<div style="margin-top:6px;font-size:0.7rem;color:var(--red);font-weight:700;">⚠️ Manpower shortage — ${totalCapacity} capacity vs ${w.total} required. May need overtime.</div>` : ''}
        ${warning.level === 'warning' ? `<div style="margin-top:6px;font-size:0.65rem;color:var(--amber);">⚠️ Getting tight — ${totalCapacity} capacity vs ${w.total} required.</div>` : ''}
      </div>
    `;
  }).join('');

  container.innerHTML = html;

  const tileBadge = document.getElementById('tileForecastBadge');
  if(hasManpowerWarning) {
    tileBadge.style.display = 'inline-block';
    tileBadge.textContent = '⚠️ Manpower alert!';
    tileBadge.className = 'tile-badge danger';
  } else {
    tileBadge.style.display = 'none';
  }
}

function renderLookaheadBanner(forecastEntries, holidayIndex, today){
  const container = document.getElementById('lookaheadBanner');
  if(!container) return;
  const startMonday = mondayOf(today);
  const nextWeekStart = new Date(startMonday); nextWeekStart.setDate(nextWeekStart.getDate()+7);
  const nextWeekEnd = new Date(nextWeekStart); nextWeekEnd.setDate(nextWeekStart.getDate()+6);

  const nextWeekTotal = forecastEntries
    .filter(e => e.deliveryDate && e.deliveryDate >= nextWeekStart && e.deliveryDate <= nextWeekEnd)
    .reduce((s,e) => s + e.stairs, 0);

  if(nextWeekTotal === 0){ container.innerHTML = ''; return; }

  let capacity = 0;
  PEOPLE.forEach(person => {
    capacity += getPrevWeekCapacity(person, nextWeekStart, holidayIndex).capacity;
  });

  const diff = capacity - nextWeekTotal;
  const short = diff < 0;
  const color = short ? 'var(--red)' : 'var(--green)';
  const bg = short ? 'rgba(231,76,60,0.08)' : 'rgba(46,204,113,0.08)';
  const msg = short
    ? `Next week needs ${nextWeekTotal} stairs, capacity is ${capacity} — ${Math.abs(diff)} short`
    : `Next week needs ${nextWeekTotal} stairs, capacity is ${capacity} — comfortable`;
  container.innerHTML = `<div style="background:${bg};border:1px solid ${color};border-radius:10px;padding:10px 16px;margin-bottom:16px;text-align:center;font-size:0.85rem;font-weight:600;color:${color};max-width:900px;margin-left:auto;margin-right:auto;">${short?'⚠️':'✅'} ${msg}</div>`;
}

function renderForecastAccuracy(stairEntries, forecastEntries, today){
  const container = document.getElementById('forecastAccuracy');
  if(!container) return;
  const startMonday = mondayOf(today);
  let html = '';
  for(let i=1; i<=4; i++){
    const wStart = new Date(startMonday); wStart.setDate(wStart.getDate() - (7*i));
    const wEnd = new Date(wStart); wEnd.setDate(wStart.getDate()+6);

    const completedTotal = stairEntries
      .filter(e => e.deliveryDate && e.deliveryDate >= wStart && e.deliveryDate <= wEnd)
      .reduce((s,e) => s + e.stairs, 0);
    const outstandingTotal = forecastEntries
      .filter(e => e.deliveryDate && e.deliveryDate >= wStart && e.deliveryDate <= wEnd)
      .reduce((s,e) => s + e.stairs, 0);
    const predictedTotal = completedTotal + outstandingTotal;
    if(predictedTotal === 0) continue;

    const onTimePct = Math.round((completedTotal/predictedTotal)*100);
    const pctClass = onTimePct >= 95 ? 'positive' : (onTimePct >= 75 ? 'gold' : 'negative');

    html += `
      <div class="detail-week-card">
        <div class="week-label">W/C ${fmtDateShort(wStart)}</div>
        <div class="week-row"><span>Predicted (due that week)</span><span class="val">${predictedTotal}</span></div>
        <div class="week-row"><span>Actually completed</span><span class="val positive">${completedTotal}</span></div>
        <div class="week-row"><span>Still outstanding</span><span class="val negative">${outstandingTotal}</span></div>
        <div class="week-row" style="border-top:1px solid var(--card-border);padding-top:4px;margin-top:4px;">
          <span><strong>On-time rate</strong></span>
          <span class="val ${pctClass}"><strong>${onTimePct}%</strong></span>
        </div>
      </div>
    `;
  }
  container.innerHTML = html || '<div class="forecast-empty">No past weeks with delivery dates yet.</div>';
}

/* =========================================================
   QUALITY VS SPEED CHART
   ========================================================= */
function renderQualitySpeedChart(stairEntries, holidayIndex, errorEntries, today){
  const container = document.getElementById('qualitySpeedChart');
  if(!container) return;

  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - (TREND_WEEKS * 7));

  const points = PEOPLE.map(person => {
    const weeks = getWeeklyTotals(person, stairEntries, holidayIndex, today, TREND_WEEKS);
    const totalStairs = weeks.reduce((s,w) => s + w.actual, 0);
    const totalErrorPoints = errorEntries
      .filter(e => e.initials === person.initials && e.date >= cutoff && e.date <= today)
      .reduce((s,e) => s + e.points, 0);
    const errorCount = errorEntries.filter(e => e.initials === person.initials && e.date >= cutoff && e.date <= today).length;
    return { person, totalStairs, totalErrorPoints, errorCount };
  });

  const maxStairs = Math.max(...points.map(p => p.totalStairs), 1);
  const minPoints = Math.min(...points.map(p => p.totalErrorPoints), 0);

  const size = 400, pad = 40;
  const plotW = size - pad*2, plotH = size - pad*2;

  const xFor = (stairs) => pad + (stairs / maxStairs) * plotW;
  const yFor = (pts) => {
    // 0 (no errors) sits near the top; most negative sits at the bottom
    if(minPoints === 0) return pad;
    return pad + ((0 - pts) / (0 - minPoints)) * plotH;
  };

  const dots = points.map(p => {
    const x = xFor(p.totalStairs);
    const y = yFor(p.totalErrorPoints);
    return `
      <circle cx="${x}" cy="${y}" r="9" fill="${p.person.color}" stroke="var(--card)" stroke-width="2">
        <title>${p.person.name}: ${p.totalStairs} stairs, ${p.totalErrorPoints} error points (${p.errorCount} error${p.errorCount===1?'':'s'}) over the last ${TREND_WEEKS} weeks</title>
      </circle>
      <text x="${x}" y="${y - 14}" text-anchor="middle" font-size="11" font-weight="700" fill="var(--text)">${p.person.initials}</text>
    `;
  }).join('');

  container.innerHTML = `
    <svg viewBox="0 0 ${size} ${size}" width="100%" style="max-width:420px;display:block;margin:0 auto;">
      <!-- Axes -->
      <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${size-pad}" stroke="var(--card-border)" stroke-width="1.5"/>
      <line x1="${pad}" y1="${size-pad}" x2="${size-pad}" y2="${size-pad}" stroke="var(--card-border)" stroke-width="1.5"/>
      <!-- Axis labels -->
      <text x="${size/2}" y="${size-8}" text-anchor="middle" font-size="11" fill="var(--muted)">Stairs completed (last ${TREND_WEEKS} weeks) →</text>
      <text x="12" y="${size/2}" text-anchor="middle" font-size="11" fill="var(--muted)" transform="rotate(-90 12 ${size/2})">← More error points</text>
      <!-- Corner hint -->
      <text x="${size-pad-4}" y="${size-pad-8}" text-anchor="end" font-size="9" fill="var(--red)" opacity="0.6">fast but sloppy</text>
      <text x="${size-pad-4}" y="${pad+12}" text-anchor="end" font-size="9" fill="var(--green)" opacity="0.6">fast &amp; clean</text>
      ${dots}
    </svg>
  `;
}

/* =========================================================
   ERROR LOG TRENDS - UPDATED WITH CORRECT LAYOUT
   ========================================================= */
function renderReplacementParts(rpEntries, today){
  const totalCost = rpEntries.reduce((s,e) => s + e.cost, 0);
  const totalCount = rpEntries.length;

  const thisMonth = rpEntries.filter(e => e.date.getFullYear()===today.getFullYear() && e.date.getMonth()===today.getMonth());
  const thisMonthCost = thisMonth.reduce((s,e) => s + e.cost, 0);

  document.getElementById('rpSummaryStats').innerHTML = `
    <div class="detail-stat-card">
      <div class="label">Total Incidents</div>
      <div class="value">${totalCount}</div>
    </div>
    <div class="detail-stat-card">
      <div class="label">Total Cost</div>
      <div class="value negative">£${totalCost.toFixed(2)}</div>
    </div>
    <div class="detail-stat-card">
      <div class="label">This Month</div>
      <div class="value">${thisMonth.length}</div>
    </div>
    <div class="detail-stat-card">
      <div class="label">This Month Cost</div>
      <div class="value negative">£${thisMonthCost.toFixed(2)}</div>
    </div>
  `;

  // ----- Cost & count, last 6 months -----
  const months = [];
  for(let i=5; i>=0; i--){
    const d = new Date(today.getFullYear(), today.getMonth()-i, 1);
    months.push({ year:d.getFullYear(), month:d.getMonth(), label:d.toLocaleDateString('en-GB',{month:'short'}), count:0, cost:0 });
  }
  rpEntries.forEach(e=>{
    const m = months.find(m2 => m2.year===e.date.getFullYear() && m2.month===e.date.getMonth());
    if(m){ m.count++; m.cost += e.cost; }
  });

  const maxCost = Math.max(1, ...months.map(m => m.cost));
  const costBars = months.map(m => {
    const heightPct = Math.max(4, Math.round((m.cost/maxCost)*100));
    return `
      <div class="bar-col">
        <div class="bar-track"><div class="bar-fill" style="height:${heightPct}%;background:#e74c3c;"></div></div>
        <div class="bar-val">£${m.cost.toFixed(0)}</div>
        <div class="bar-label">${m.label}</div>
      </div>
    `;
  }).join('');
  document.getElementById('rpCostTrend').innerHTML = `<div class="mini-trend" style="border-top:none;padding-top:0;margin-top:0;"><div class="bars">${costBars}</div></div>`;

  const maxCount = Math.max(1, ...months.map(m => m.count));
  const countBars = months.map(m => {
    const heightPct = Math.max(4, Math.round((m.count/maxCount)*100));
    return `
      <div class="bar-col">
        <div class="bar-track"><div class="bar-fill" style="height:${heightPct}%;background:#4a90e2;"></div></div>
        <div class="bar-val">${m.count}</div>
        <div class="bar-label">${m.label}</div>
      </div>
    `;
  }).join('');
  document.getElementById('rpCountTrend').innerHTML = `<div class="mini-trend" style="border-top:none;padding-top:0;margin-top:0;"><div class="bars">${countBars}</div></div>`;

  // ----- Top reasons -----
  function topBreakdown(field, limit){
    const map = {};
    rpEntries.forEach(e => {
      const key = (e[field]||'').trim() || 'Unspecified';
      if(!map[key]) map[key] = { count:0, cost:0 };
      map[key].count++;
      map[key].cost += e.cost;
    });
    return Object.entries(map).sort((a,b) => b[1].count - a[1].count).slice(0, limit);
  }

  function renderBreakdownList(containerId, breakdown){
    const container = document.getElementById(containerId);
    if(breakdown.length === 0){ container.innerHTML = '<div class="forecast-empty">No data yet.</div>'; return; }
    container.innerHTML = breakdown.map(([name, stats], idx) => `
      <div class="lb-row">
        <span class="lb-rank">${idx+1}</span>
        <span class="lb-dot" style="background:var(--muted);width:0;height:0;"></span>
        <span class="lb-name">${name}</span>
        <span class="lb-figures">${stats.count} incident${stats.count===1?'':'s'}</span>
        <span class="lb-pct negative">£${stats.cost.toFixed(2)}</span>
      </div>
    `).join('');
  }

  renderBreakdownList('rpTopReasons', topBreakdown('reason', 6));
  renderBreakdownList('rpTopParts', topBreakdown('part', 6));

  // ----- Recent incidents -----
  const recent = [...rpEntries].sort((a,b) => b.date - a.date).slice(0, 20);
  const listEl = document.getElementById('rpRecentList');
  if(recent.length === 0){
    listEl.innerHTML = '<div class="forecast-empty">No OFFICE-caused incidents logged.</div>';
  } else {
    listEl.innerHTML = recent.map(e => `
      <div class="detail-error-item">
        <div class="error-left">
          <div class="error-date">${fmtDate(e.date)}${e.plot ? ' · Plot ' + e.plot : ''}${e.loadNo ? ' · Load ' + e.loadNo : ''}</div>
          <div class="error-desc">${e.part}${e.quantity>1 ? ' (x'+e.quantity+')' : ''} — ${e.reason}${e.material ? ' · '+e.material : ''}${e.operator ? ' · '+e.operator : ''}</div>
        </div>
        <div class="error-points">£${e.cost.toFixed(2)}</div>
      </div>
    `).join('');
  }
}

function renderErrorTrends(errorEntries, today){
  // ----- last 6 months, points & count -----
  const months = [];
  for(let i=5; i>=0; i--){
    const d = new Date(today.getFullYear(), today.getMonth()-i, 1);
    months.push({ year:d.getFullYear(), month:d.getMonth(), label:d.toLocaleDateString('en-GB',{month:'short'}), count:0, points:0 });
  }
  errorEntries.forEach(e=>{
    const m = months.find(m2 => m2.year===e.date.getFullYear() && m2.month===e.date.getMonth());
    if(m){ m.count++; m.points += e.points; }
  });

  const maxAbsPoints = Math.max(1, ...months.map(m => Math.abs(m.points)));
  const pointsBars = months.map(m => {
    const heightPct = Math.max(4, Math.round((Math.abs(m.points)/maxAbsPoints)*100));
    const color = m.points < 0 ? '#e74c3c' : (m.points > 0 ? '#2ecc71' : '#8993ab');
    return `
      <div class="bar-col">
        <div class="bar-track"><div class="bar-fill" style="height:${heightPct}%;background:${color};"></div></div>
        <div class="bar-val">${m.points}</div>
        <div class="bar-label">${m.label}</div>
      </div>
    `;
  }).join('');
  document.getElementById('errorPointsTrend').innerHTML = `<div class="mini-trend" style="border-top:none;padding-top:0;margin-top:0;"><div class="bars">${pointsBars}</div></div>`;

  const maxCount = Math.max(1, ...months.map(m => m.count));
  const countBars = months.map(m => {
    const heightPct = Math.max(4, Math.round((m.count/maxCount)*100));
    return `
      <div class="bar-col">
        <div class="bar-track"><div class="bar-fill" style="height:${heightPct}%;background:#4a90e2;"></div></div>
        <div class="bar-val">${m.count}</div>
        <div class="bar-label">${m.label}</div>
      </div>
    `;
  }).join('');
  document.getElementById('errorCountTrend').innerHTML = `<div class="mini-trend" style="border-top:none;padding-top:0;margin-top:0;"><div class="bars">${countBars}</div></div>`;

  // ----- TOP SECTIONS -----
  function topBreakdown(field, limit){
    const map = {};
    errorEntries.forEach(e => {
      const key = (e[field]||'').trim() || 'Unspecified';
      if(!map[key]) map[key] = { count:0, points:0 };
      map[key].count++;
      map[key].points += e.points;
    });
    return Object.entries(map).sort((a,b) => b[1].count - a[1].count).slice(0, limit);
  }
  
  function renderBreakdownList(containerId, breakdown){
    const container = document.getElementById(containerId);
    if(breakdown.length === 0){ container.innerHTML = '<div class="forecast-empty">No data yet.</div>'; return; }
    container.innerHTML = breakdown.map(([name, stats], idx) => `
      <div class="lb-row">
        <span class="lb-rank">${idx+1}</span>
        <span class="lb-dot" style="background:var(--muted);width:0;height:0;"></span>
        <span class="lb-name">${name}</span>
        <span class="lb-figures">${stats.count} error${stats.count===1?'':'s'}</span>
        <span class="lb-pct ${stats.points<0?'negative':(stats.points>0?'positive':'neutral')}">${stats.points} pts</span>
      </div>
    `).join('');
  }
  
  renderBreakdownList('topSections', topBreakdown('section', 5));
  
  // ----- Top Errors (was Top Plots) - now shows error types -----
  function topErrorTypes(limit){
    const map = {};
    errorEntries.forEach(e => {
      const key = (e.issue||'').trim() || 'Unspecified Error';
      if(!map[key]) map[key] = { count:0, points:0 };
      map[key].count++;
      map[key].points += e.points;
    });
    return Object.entries(map).sort((a,b) => b[1].count - a[1].count).slice(0, limit);
  }
  renderBreakdownList('topErrors', topErrorTypes(5));

  // ----- BY PERSON -----
  const byPerson = PEOPLE.map(p => {
    const entries = errorEntries.filter(e => e.initials === p.initials);
    const points = entries.reduce((s,e) => s + e.points, 0);
    return { person:p, count: entries.length, points };
  }).sort((a,b) => a.points - b.points);
  document.getElementById('errorsByPerson').innerHTML = byPerson.map((d, idx) => `
    <div class="lb-row">
      <span class="lb-rank">${idx+1}</span>
      <span class="lb-dot" style="background:${d.person.color};"></span>
      <span class="lb-name">${d.person.name}</span>
      <span class="lb-figures">${d.count} error${d.count===1?'':'s'}</span>
      <span class="lb-pct ${d.points<0?'negative':(d.points>0?'positive':'neutral')}">${d.points} pts</span>
    </div>
  `).join('');

  // ----- NEW: Repeated Errors Detection (3+ times) -----
  function getRepeatedErrors() {
    const errorMap = {};
    const personErrorMap = {};
    
    errorEntries.forEach(e => {
      // Count by error type
      const key = (e.issue||'').trim() || 'Unspecified Error';
      if(!errorMap[key]) errorMap[key] = { count:0, points:0, examples: [] };
      errorMap[key].count++;
      errorMap[key].points += e.points;
      if(errorMap[key].examples.length < 3) {
        errorMap[key].examples.push({
          date: e.date,
          person: e.initials,
          section: e.section,
          plot: e.plot
        });
      }
      
      // Count by person
      if(e.initials) {
        if(!personErrorMap[e.initials]) personErrorMap[e.initials] = { count:0, points:0, errors: [] };
        personErrorMap[e.initials].count++;
        personErrorMap[e.initials].points += e.points;
        if(personErrorMap[e.initials].errors.length < 5) {
          personErrorMap[e.initials].errors.push({
            issue: e.issue,
            date: e.date,
            section: e.section
          });
        }
      }
    });
    
    // Find repeated errors (3+ times)
    const repeatedErrors = Object.entries(errorMap)
      .filter(([_, data]) => data.count >= 3)
      .sort((a, b) => b[1].count - a[1].count);
    
    // Find people with 3+ errors
    const repeatedPeople = Object.entries(personErrorMap)
      .filter(([_, data]) => data.count >= 3)
      .sort((a, b) => b[1].count - a[1].count);
    
    return { repeatedErrors, repeatedPeople };
  }

  const { repeatedErrors, repeatedPeople } = getRepeatedErrors();
  
  // Render Repeated Errors section
  const repeatedContainer = document.getElementById('repeatedErrors');
  if (repeatedContainer) {
    if (repeatedErrors.length === 0 && repeatedPeople.length === 0) {
      repeatedContainer.innerHTML = `
        <div class="forecast-empty" style="padding:15px 0;">
          ✅ No repeated errors or patterns detected. All errors appear to be isolated.
        </div>
      `;
    } else {
      let html = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;">';
      
      // Repeated errors
      if (repeatedErrors.length > 0) {
        html += `
          <div style="background:var(--section-bg);border-radius:8px;padding:12px;border:1px solid var(--card-border);">
            <div style="font-weight:700;color:var(--red);margin-bottom:8px;">🔴 Repeated Errors (3+ times)</div>
        `;
        repeatedErrors.forEach(([error, data]) => {
          const examples = data.examples.map(ex => 
            `${fmtDateShort(ex.date)} - ${ex.person}${ex.section ? ' ('+ex.section+')' : ''}`
          ).join('; ');
          html += `
            <div style="font-size:0.8rem;padding:4px 0;border-bottom:1px solid var(--card-border);">
              <div style="font-weight:600;">${error}</div>
              <div style="color:var(--muted);font-size:0.7rem;">${data.count} times · ${data.points} pts</div>
              <div style="color:var(--muted);font-size:0.65rem;margin-top:2px;">📌 ${examples}</div>
            </div>
          `;
        });
        html += `</div>`;
      }
      
      // People with repeated errors
      if (repeatedPeople.length > 0) {
        html += `
          <div style="background:var(--section-bg);border-radius:8px;padding:12px;border:1px solid var(--card-border);">
            <div style="font-weight:700;color:var(--amber);margin-bottom:8px;">⚠️ People with 3+ Errors</div>
        `;
        repeatedPeople.forEach(([initials, data]) => {
          const person = PEOPLE.find(p => p.initials === initials);
          const color = person ? person.color : '#8993ab';
          const name = person ? person.name : initials;
          const errorSummary = data.errors.map(e => 
            `${e.issue}${e.section ? ' ('+e.section+')' : ''}`
          ).slice(0, 3).join('; ');
          html += `
            <div style="font-size:0.8rem;padding:4px 0;border-bottom:1px solid var(--card-border);">
              <div style="display:flex;align-items:center;gap:6px;">
                <span class="lb-dot" style="background:${color};width:8px;height:8px;border-radius:50%;display:inline-block;"></span>
                <span style="font-weight:600;">${name}</span>
                <span style="color:var(--muted);font-size:0.7rem;">${data.count} errors · ${data.points} pts</span>
              </div>
              <div style="color:var(--muted);font-size:0.65rem;margin-top:2px;">📌 ${errorSummary}${data.errors.length > 3 ? '...' : ''}</div>
            </div>
          `;
        });
        html += `</div>`;
      }
      
      html += '</div>';
      repeatedContainer.innerHTML = html;
    }
  }
}

/* =========================================================
   PERSON DETAIL PAGE
   ========================================================= */
function getWeeklyTotals(person, stairEntries, holidayIndex, today, numWeeks){
  const monday = mondayOf(today);
  const weeks = [];
  for(let i=numWeeks-1;i>=0;i--){
    const wStart = new Date(monday); wStart.setDate(wStart.getDate()-(7*i));
    const wEnd = new Date(wStart); wEnd.setDate(wStart.getDate()+4);
    let actual=0, target=0;
    for(let d=new Date(wStart); d<=wEnd; d.setDate(d.getDate()+1)){
      if(!dayBucket(d)) continue;
      const stats = computeDayStats(person, new Date(d), stairEntries, holidayIndex);
      actual += stats.actual;
      target += stats.target;
    }
    weeks.push({ start:wStart, end:wEnd, actual, target, isCurrent: i===0 });
  }
  return weeks;
}

function showDetailPage(person, stairEntries, forecastEntries, holidayIndex, today, errorEntries, rpEntries) {
  const detailPage = document.getElementById('detailPage');
  document.getElementById('landingPage').classList.remove('active');
  document.getElementById('kpiPage').classList.remove('active');
  document.getElementById('loadsPage').classList.remove('active');
  document.getElementById('holidaysPage').classList.remove('active');
  document.getElementById('forecastPage').classList.remove('active');
  detailPage.classList.add('active');
  
  document.getElementById('detailPersonColor').style.background = person.color;
  document.getElementById('detailPersonName').textContent = person.name;

  const monday = mondayOf(today);
  const weeks = [];
  for(let i=3; i>=0; i--){
    const wStart = new Date(monday);
    wStart.setDate(wStart.getDate() - (7*i));
    const wEnd = new Date(wStart);
    wEnd.setDate(wStart.getDate() + 4);
    weeks.push({ start: wStart, end: wEnd, index: i });
  }

  let totalActual = 0, totalTarget = 0, totalHolidayCredit = 0;
  let totalErrorPoints = 0;
  const weekData = [];

  weeks.forEach((week, idx) => {
    let actual = 0, target = 0, holidayCredit = 0;
    let days = [];
    for(let d = new Date(week.start); d <= week.end; d.setDate(d.getDate()+1)){
      const dCopy = new Date(d);
      if(!dayBucket(dCopy)) {
        days.push({ date: dCopy, isWeekend: true });
        continue;
      }
      const stats = computeDayStats(person, dCopy, stairEntries, holidayIndex);
      target += stats.target;
      actual += stats.actual;
      holidayCredit += stats.credit;
      days.push({ date: dCopy, actual: stats.actual, target: stats.target, credit: stats.credit, code: stats.code, isWeekend: false });
    }
    let weekErrorPoints = 0;
    const weekErrors = errorEntries.filter(e => 
      e.initials === person.initials && 
      e.date >= week.start && e.date <= week.end
    );
    weekErrors.forEach(e => weekErrorPoints += e.points);

    const stairsOver = (actual + holidayCredit) - target;
    const netPoints = stairsOver + weekErrorPoints;
    
    const forecastForWeek = forecastEntries
      .filter(e => e.initials === person.initials && e.deliveryDate && e.deliveryDate >= week.start && e.deliveryDate <= week.end)
      .reduce((s,e) => s + e.stairs, 0);

    totalActual += actual;
    totalTarget += target;
    totalHolidayCredit += holidayCredit;
    totalErrorPoints += weekErrorPoints;

    weekData.push({
      label: idx === 0 ? 'This Week' : `${fmtDateShort(week.start)} - ${fmtDateShort(week.end)}`,
      actual: actual,
      target: target,
      holidayCredit: holidayCredit,
      stairsOver: stairsOver,
      errorPoints: weekErrorPoints,
      netPoints: netPoints,
      forecast: forecastForWeek,
      days: days,
      errors: weekErrors,
      start: week.start
    });
  });

  const totalStairsOver = (totalActual + totalHolidayCredit) - totalTarget;
  const totalNetPoints = totalStairsOver + totalErrorPoints;
  const diffClass = totalNetPoints > 0 ? 'positive' : (totalNetPoints < 0 ? 'negative' : 'neutral');
  const diffDisplay = totalNetPoints > 0 ? '+' + totalNetPoints : totalNetPoints;

  document.getElementById('detailStats').innerHTML = `
    <div class="detail-stat-card">
      <div class="label">Total Stairs</div>
      <div class="value">${totalActual}</div>
    </div>
    <div class="detail-stat-card">
      <div class="label">Target</div>
      <div class="value">${totalTarget}</div>
    </div>
    <div class="detail-stat-card">
      <div class="label">Holiday Credit</div>
      <div class="value">+${totalHolidayCredit}</div>
    </div>
    <div class="detail-stat-card">
      <div class="label">Total Error Points</div>
      <div class="value negative">${totalErrorPoints}</div>
    </div>
    <div class="detail-stat-card">
      <div class="label">Net Points</div>
      <div class="value ${diffClass}">${diffDisplay}</div>
    </div>
  `;

  document.getElementById('detailWeeks').innerHTML = weekData.map(w => {
    const overClass = w.stairsOver > 0 ? 'positive' : (w.stairsOver < 0 ? 'negative' : 'neutral');
    const netClass = w.netPoints > 0 ? 'gold' : (w.netPoints < 0 ? 'negative' : 'neutral');
    return `
      <div class="detail-week-card">
        <div class="week-label">${w.label}</div>
        <div class="week-row">
          <span>Stairs</span>
          <span class="val">${w.actual}${w.holidayCredit > 0 ? ` (+${w.holidayCredit})` : ''} / ${w.target}</span>
        </div>
        <div class="week-row">
          <span>Over target</span>
          <span class="val ${overClass}">${w.stairsOver > 0 ? '+' : ''}${w.stairsOver}</span>
        </div>
        <div class="week-row error-points-row">
          <span>Error points</span>
          <span class="val negative">${w.errorPoints}</span>
        </div>
        <div class="week-row" style="border-top:1px solid var(--card-border);padding-top:4px;margin-top:4px;">
          <span><strong>Net points</strong></span>
          <span class="val ${netClass}"><strong>${w.netPoints > 0 ? '+' : ''}${w.netPoints}</strong></span>
        </div>
        <div class="week-row forecast-row">
          <span>📦 Forecast (uncompleted)</span>
          <span class="val" style="color:var(--blue);">${w.forecast}</span>
        </div>
        ${w.errors.length > 0 ? `<div style="font-size:0.6rem;color:var(--muted);margin-top:4px;">${w.errors.length} error(s) this week</div>` : ''}
      </div>
    `;
  }).join('');

  const allDays = [];
  weekData.forEach(w => w.days.forEach(d => { if(!d.isWeekend) allDays.push(d); }));
  document.getElementById('detailDays').innerHTML = allDays.map((d, idx) => {
    const status = statusForProgress(d.actual, d.target);
    const total = d.actual + d.credit;
    const diff = total - d.target;
    const codeLabel = d.code ? statusLabel(d.code) : null;
    let diffDisplay = diff > 0 ? '+' + diff : diff;
    let diffClass = diff > 0 ? 'positive' : (diff < 0 ? 'negative' : 'neutral');
    return `
      <div class="detail-day-card" data-day-idx="${idx}">
        <div class="day-date">${fmtDateShort(d.date)}</div>
        <div class="day-stairs">${d.actual}</div>
        <div class="day-target">/ ${d.target}</div>
        ${d.credit > 0 ? `<div class="holiday-badge">+${d.credit}</div>` : ''}
        ${codeLabel ? `<div class="holiday-badge">${codeLabel}</div>` : ''}
        <div class="day-status ${status}">${statusLabelText(status, d.code)}</div>
        <div style="font-size:0.6rem;margin-top:2px;color:var(--muted);">${diffDisplay}</div>
        <div class="tap-hint">Tap for parts →</div>
      </div>
    `;
  }).join('');

  document.querySelectorAll('#detailDays .detail-day-card').forEach(el => {
    el.addEventListener('click', function(){
      const idx = parseInt(this.dataset.dayIdx, 10);
      const day = allDays[idx];
      showDayDetailPage(person, day.date, stairEntries, holidayIndex);
    });
  });

  const personErrors = errorEntries.filter(e => e.initials === person.initials).sort((a,b) => b.date - a.date);
  document.getElementById('detailErrors').innerHTML = personErrors.length === 0 ?
    '<div style="color:var(--muted);font-style:italic;padding:8px 0;">No errors logged</div>' :
    personErrors.map(e => `
      <div class="detail-error-item">
        <div class="error-left">
          <div class="error-date">${fmtDate(e.date)} ${e.section ? '· ' + e.section : ''} ${e.plot ? '· Plot ' + e.plot : ''}</div>
          <div class="error-desc">${e.issue}${e.quantity > 1 ? ' (x'+e.quantity+')' : ''} ${e.impact ? '— ' + e.impact : ''}</div>
        </div>
        <div class="error-points">${e.points}</div>
      </div>
    `).join('');

  const personRp = (rpEntries||[]).filter(e => e.initials === person.initials).sort((a,b) => b.date - a.date);
  const personRpCost = personRp.reduce((s,e) => s + e.cost, 0);
  document.getElementById('detailRpStats').innerHTML = `
    <div class="detail-stat-card">
      <div class="label">Incidents (this year)</div>
      <div class="value">${personRp.length}</div>
    </div>
    <div class="detail-stat-card">
      <div class="label">Total Cost</div>
      <div class="value negative">£${personRpCost.toFixed(2)}</div>
    </div>
  `;
  document.getElementById('detailRp').innerHTML = personRp.length === 0 ?
    '<div style="color:var(--muted);font-style:italic;padding:8px 0;">No office-caused replacement parts logged for this year</div>' :
    personRp.map(e => `
      <div class="detail-error-item">
        <div class="error-left">
          <div class="error-date">${fmtDate(e.date)}${e.plot ? ' · Plot ' + e.plot : ''}${e.loadNo ? ' · Load ' + e.loadNo : ''}</div>
          <div class="error-desc">${e.part}${e.quantity>1 ? ' (x'+e.quantity+')' : ''} — ${e.reason}${e.material ? ' · '+e.material : ''}</div>
        </div>
        <div class="error-points">£${e.cost.toFixed(2)}</div>
      </div>
    `).join('');
}

/* =========================================================
   DAY DETAIL PAGE
   ========================================================= */
function showDayDetailPage(person, date, stairEntries, holidayIndex){
  document.getElementById('detailPage').classList.remove('active');
  document.getElementById('dayDetailPage').classList.add('active');
  
  document.getElementById('dayDetailPersonColor').style.background = person.color;
  document.getElementById('dayDetailPersonName').textContent = person.name;
  document.getElementById('dayDetailDate').textContent = fmtDate(date);

  const stats = computeDayStats(person, date, stairEntries, holidayIndex);
  const dayEntries = stairEntries.filter(e => e.initials === person.initials && sameDay(e.date, date));

  const totals = {
    winderStringPlates: 0,
    smallStringPlates: 0,
    straightStrings: 0,
    posts: 0,
    winders: 0,
    bullnose: 0
  };
  dayEntries.forEach(e => {
    totals.winderStringPlates += e.parts.winderStringPlates;
    totals.smallStringPlates  += e.parts.smallStringPlates;
    totals.straightStrings    += e.parts.straightStrings;
    totals.posts               += e.parts.posts;
    totals.winders             += e.parts.winders;
    totals.bullnose            += e.parts.bullnose;
  });

  document.getElementById('dayDetailStats').innerHTML = `
    <div class="detail-stat-card">
      <div class="label">Stairs</div>
      <div class="value">${stats.actual}</div>
    </div>
    <div class="detail-stat-card">
      <div class="label">Winder String Plates</div>
      <div class="value">${totals.winderStringPlates}</div>
    </div>
    <div class="detail-stat-card">
      <div class="label">Small String Plates</div>
      <div class="value">${totals.smallStringPlates}</div>
    </div>
    <div class="detail-stat-card">
      <div class="label">Straight Strings</div>
      <div class="value">${totals.straightStrings}</div>
    </div>
    <div class="detail-stat-card">
      <div class="label">Posts</div>
      <div class="value">${totals.posts}</div>
    </div>
    <div class="detail-stat-card">
      <div class="label">Winders</div>
      <div class="value">${totals.winders}</div>
    </div>
    <div class="detail-stat-card">
      <div class="label">Assembled Bullnose</div>
      <div class="value">${totals.bullnose}</div>
    </div>
  `;
}

/* =========================================================
   NAVIGATION
   ========================================================= */
const VIEW_IDS = {
  landing: 'landingPage',
  kpi: 'kpiPage',
  loads: 'loadsPage',
  detail: 'detailPage',
  day: 'dayDetailPage',
  holidays: 'holidaysPage',
  forecast: 'forecastPage',
  errors: 'errorsPage',
  replacementParts: 'replacementPartsPage'
};

function setActiveView(view){
  window._currentView = view;
  Object.values(VIEW_IDS).forEach(id => document.getElementById(id).classList.remove('active'));
  const activeEl = document.getElementById(VIEW_IDS[view]);
  activeEl.classList.add('active');
  activeEl.style.removeProperty('display');
}

document.getElementById('tileKpi').addEventListener('click', ()=> setActiveView('kpi'));
document.getElementById('tileLoads').addEventListener('click', ()=>{
  setActiveView('loads');
  renderLoads();
  updateLoadsBadge();
});
document.getElementById('tileHolidays').addEventListener('click', ()=>{
  setActiveView('holidays');
  if(window._holidayIndex){
    renderHolidayCalendar(window._holidayIndex, window._holidayMonth, window._holidayYear);
  }
});
document.getElementById('tileForecast').addEventListener('click', ()=>{
  setActiveView('forecast');
  if(window._forecastEntries) {
    renderForecast(window._forecastEntries, window._holidayIndex, window._today);
    renderForecastAccuracy(window._stairEntries, window._forecastEntries, window._today);
  }
});
document.getElementById('tileErrors').addEventListener('click', ()=>{
  setActiveView('errors');
  if(window._errorEntries) renderErrorTrends(window._errorEntries, window._today);
  if(window._stairEntries && window._holidayIndex && window._errorEntries) renderQualitySpeedChart(window._stairEntries, window._holidayIndex, window._errorEntries, window._today);
});
document.getElementById('tileReplacementParts').addEventListener('click', ()=>{
  setActiveView('replacementParts');
  if(window._rpEntries) renderReplacementParts(window._rpEntries, window._today);
});

document.getElementById('backToLandingFromLoads').addEventListener('click', ()=> setActiveView('landing'));
document.getElementById('backToLandingFromErrors').addEventListener('click', ()=> setActiveView('landing'));
document.getElementById('backToLandingFromReplacementParts').addEventListener('click', ()=> setActiveView('landing'));
document.getElementById('backToLandingFromKpi').addEventListener('click', ()=> setActiveView('landing'));
document.getElementById('backToLandingFromHolidays').addEventListener('click', ()=> setActiveView('landing'));
document.getElementById('backToLandingFromForecast').addEventListener('click', ()=> setActiveView('landing'));
document.getElementById('backToKpi').addEventListener('click', ()=> setActiveView('kpi'));
document.getElementById('backToDetail').addEventListener('click', ()=> setActiveView('detail'));

document.getElementById('prevMonth').addEventListener('click', function(){
  window._holidayMonth--;
  if(window._holidayMonth < 0){ window._holidayMonth = 11; window._holidayYear--; }
  renderHolidayCalendar(window._holidayIndex, window._holidayMonth, window._holidayYear);
});
document.getElementById('nextMonth').addEventListener('click', function(){
  window._holidayMonth++;
  if(window._holidayMonth > 11){ window._holidayMonth = 0; window._holidayYear++; }
  renderHolidayCalendar(window._holidayIndex, window._holidayMonth, window._holidayYear);
});

/* =========================================================
   LOADS EVENT LISTENERS
   ========================================================= */
document.getElementById('loadSearch').addEventListener('input', renderLoads);
document.getElementById('personFilter').addEventListener('change', renderLoads);
document.getElementById('statusFilter').addEventListener('change', renderLoads);

document.getElementById('refreshLoadsBtn').addEventListener('click', function() {
  renderLoads();
  this.textContent = '✅ Refreshed!';
  setTimeout(() => { this.textContent = '🔄 Refresh'; }, 2000);
});

/* =========================================================
   MAIN LOAD
   ========================================================= */
async function loadAndRender(){
  try{
    const [trackingRows, holidayRows, errorRows, rpRows] = await Promise.all([
      fetchGvizRows(PROJECT_TRACKING_SHEET_ID, PROJECT_TRACKING_GID),
      fetchGvizRows(HOLIDAYS_SHEET_ID, HOLIDAYS_GID),
      fetchGvizRows(ERRORS_SHEET_ID, ERRORS_GID).catch(()=>[]),
      fetchGvizRows(REPLACEMENT_PARTS_SHEET_ID, REPLACEMENT_PARTS_GID).catch(()=>[])
    ]);

    const { completed: stairEntries, forecast: forecastEntries } = parseStairRows(trackingRows);
    const holidayIndex = buildHolidayIndex(holidayRows);
    const errorEntries = parseErrorRows(errorRows);
    const rpEntriesAll = parseReplacementPartsRows(rpRows);
    const currentYear = new Date().getFullYear();
    const rpEntries = rpEntriesAll.filter(e => e.date.getFullYear() === currentYear);

    const today = new Date(); today.setHours(0,0,0,0);
    const monday = mondayOf(today);
    const friday = new Date(monday); friday.setDate(monday.getDate()+4);

    const wasFirstLoad = !window._loadedOnce;
    window._loadedOnce = true;

    if(wasFirstLoad){
      window._holidayMonth = today.getMonth();
      window._holidayYear = today.getFullYear();
    }
    window._holidayIndex = holidayIndex;
    window._stairEntries = stairEntries;
    window._forecastEntries = forecastEntries;
    window._errorEntries = errorEntries;
    window._rpEntries = rpEntries;
    window._today = today;
    
    loadItems = parseLoadsFromSheet(stairEntries, forecastEntries);
    updateLoadsBadge();

    const personFilter = document.getElementById('personFilter');
    personFilter.innerHTML = '<option value="all">👤 All People</option>';
    const uniquePersons = [...new Set(loadItems.map(l => l.person).filter(p => p))];
    uniquePersons.forEach(p => {
      const person = PEOPLE.find(pp => pp.initials === p);
      personFilter.innerHTML += `<option value="${p}">${person ? person.name : p}</option>`;
    });

    if (!gapiInitialized) {
      try {
        await initGapiClient();
      } catch (e) {
        console.warn('Drive API not initialized:', e);
        updateDriveStatus('disconnected', 'API not available');
      }
    }

    renderLoads();

    const dialGrid = document.getElementById('dialGrid');
    dialGrid.innerHTML = '';
    const offToday = [];
    const leaderboardData = [];

    PEOPLE.forEach(person => {
      const initials = person.initials;
      const todayCode = getCodeForPerson(holidayIndex, person.holidayName, today);
      if(todayCode && isAbsenceCode(todayCode)) offToday.push({ person, code: todayCode });
      
      // Get today's target
      const todayTarget = targetFor(initials, today, todayCode);
      
      // Get weekly totals
      let weekActual = 0, weekTarget = 0;
      for(let d = new Date(monday); d <= friday; d.setDate(d.getDate() + 1)){
        const stats = computeDayStats(person, new Date(d), stairEntries, holidayIndex);
        weekActual += stats.actual;
        weekTarget += stats.target;
      }
      
      // NEW: Calculate completed days target (days that are fully finished)
      const { completedTarget, completedActual } = getCompletedDaysTarget(person, today, stairEntries, holidayIndex);
      
      const status = statusForProgress(weekActual, completedTarget);
      const trendWeeks = getWeeklyTotals(person, stairEntries, holidayIndex, today, TREND_WEEKS);
      
      leaderboardData.push({ 
        person, 
        weekActual, 
        completedTarget, 
        weekTarget,
        weekProjected: completedTarget // for backward compatibility
      });

      const card = document.createElement('div');
      card.className = `card status-${status}`;
      card.dataset.person = initials;

      const personErrors = errorEntries.filter(e => e.initials === initials);
      const totalErrorPoints = personErrors.reduce((sum, e) => sum + e.points, 0);
      let pointsBadgeClass = 'zero';
      let pointsLabel = '0 pts';
      if(totalErrorPoints < 0){ pointsBadgeClass = 'negative'; pointsLabel = totalErrorPoints + ' pts'; }
      else if(totalErrorPoints > 0){ pointsBadgeClass = ''; pointsLabel = '+' + totalErrorPoints + ' pts'; }

      const nextMonday = new Date(monday);
      nextMonday.setDate(monday.getDate() + 7);
      const nextFriday = new Date(nextMonday);
      nextFriday.setDate(nextMonday.getDate() + 4);
      const personForecast = forecastEntries
        .filter(e => e.initials === initials && e.deliveryDate && e.deliveryDate >= nextMonday && e.deliveryDate <= nextFriday)
        .reduce((s,e) => s + e.stairs, 0);
      const forecastBadge = personForecast > 0 ? `<div class="forecast-badge" title="Stairs already logged against this person for next week's deliveries">🔮 ${personForecast} next wk</div>` : '';

      card.innerHTML = `
        <div class="status-indicator"></div>
        <div class="points-badge ${pointsBadgeClass}" title="Running total: bonus for stairs over target, minus points for logged errors — click through for the full breakdown">${pointsLabel}</div>
        ${forecastBadge}
        <h2>${person.name}</h2>
        <div class="role">${initials}${todayCode ? ' · '+ (statusLabel(todayCode)||todayCode) : ''}</div>
        <div class="dial-wrap">
          ${drawProjectedDial(weekActual, completedTarget, weekTarget, status, person, today)}
        </div>
        <span class="badge ${status}" title="How this week's pace compares to a straight-line pace toward the weekly target">${statusLabelText(status, weekTarget===0 ? todayCode : null)}</span>
        <div class="weekly-row">
          <div><span class="label">Today</span><span class="val">${todayTarget}</span></div>
          <div><span class="label">Errors</span><span class="val"><span class="error-count">${personErrors.length}</span></span></div>
        </div>
        ${drawMiniTrendProjected(trendWeeks, person, stairEntries, holidayIndex, today)}
      `;
      card.addEventListener('click', function(){
        const p = PEOPLE.find(p => p.initials === this.dataset.person);
        if(p) showDetailPage(p, window._stairEntries, window._forecastEntries, window._holidayIndex, window._today, window._errorEntries, window._rpEntries);
      });
      dialGrid.appendChild(card);
    });

    renderTeamSummary(leaderboardData);

    const bannerEl = document.getElementById('todayOffBanner');
    if(offToday.length > 0){
      const chips = offToday.map(o =>
        `<span class="chip"><span class="dot" style="background:${o.person.color};"></span>${o.person.name} — ${statusLabel(o.code) || o.code}</span>`
      ).join('');
      bannerEl.innerHTML = `<div class="today-off-banner"><span class="title">📌 ALERT:</span>${chips}</div>`;
    } else bannerEl.innerHTML = '';

    const kpiBadge = document.getElementById('tileKpiBadge');
    if(offToday.length > 0){
      kpiBadge.style.display = 'inline-block';
      kpiBadge.textContent = offToday.length + ' off today';
      kpiBadge.className = 'tile-badge';
    } else {
      kpiBadge.style.display = 'none';
    }

    renderForecast(forecastEntries, holidayIndex, today);
    renderLookaheadBanner(forecastEntries, holidayIndex, today);
    renderForecastAccuracy(stairEntries, forecastEntries, today);

    if(window._currentView === 'holidays'){
      renderHolidayCalendar(holidayIndex, window._holidayMonth, window._holidayYear);
    }
    if(window._currentView === 'errors'){
      renderErrorTrends(errorEntries, today);
      renderQualitySpeedChart(stairEntries, holidayIndex, errorEntries, today);
    }
    if(window._currentView === 'replacementParts'){
      renderReplacementParts(rpEntries, today);
    }

    document.getElementById('errorBanner').innerHTML = '';
    document.getElementById('loadingMsg').style.display = 'none';

    if(wasFirstLoad){
      setActiveView('landing');
    }

    document.getElementById('lastUpdated').textContent = 'Updated ' + new Date().toLocaleTimeString('en-GB');

  } catch(err){
    console.error(err);
    document.getElementById('errorBanner').innerHTML =
      `<div class="error-banner">Couldn't load live data: ${err.message}. Make sure sheets are shared as "Anyone with the link can view".</div>`;
    document.getElementById('loadingMsg').style.display = 'none';
    if(!window._loadedOnce) setActiveView('landing');
  }
}

async function initAndLoad() {
  try {
    await initGapiClient();
  } catch (e) {
    console.warn('Drive API init failed, continuing without Drive:', e);
  }
  await loadAndRender();
}




export { initAndLoad, loadAndRender, setActiveView, REFRESH_MS };
