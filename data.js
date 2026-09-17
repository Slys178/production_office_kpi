/**
 * Data fetching & parsing layer (Google Sheets via GViz).
 * Real, working logic — moved here from main.js (not rewritten).
 */

import { CONFIG } from "./config.js";
import { parseUKDate, sameDay, dayBucket } from "./utils.js";

let jsonpCounter = 0;

export function fetchGvizRows(sheetId, gid){
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

/* ---------- Holiday helpers ---------- */

export function buildHolidayIndex(rows){
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

export function getCodeForPerson(holidayIndex, personName, date){
  const row = holidayIndex.nameIndex[personName];
  if(!row) return '';
  const match = holidayIndex.colsToUse.find(dc => sameDay(dc.date, date));
  if(!match) return '';
  return (row[match.idx] || '').trim();
}

export function hoursLostForCode(code, fullDayHours){
  if(!code) return 0;
  const c = code.toLowerCase();
  if(c === 'h' || c === 'b' || c === 'o' || c.startsWith('2nd')) return fullDayHours;
  if(c === 'h/am' || c === 'h/pm') return fullDayHours/2;
  if(c === 'c') return 2;
  return 0;
}

export function creditableHoursLost(code, fullDayHours){
  if(!code) return 0;
  const c = code.toLowerCase();
  if(c === 'c') return 0;
  return hoursLostForCode(code, fullDayHours);
}

export function targetFor(initials, date, code){
  const bucket = dayBucket(date);
  if(!bucket) return 0;
  const fullDayHours = CONFIG.hours[initials][bucket];
  const lost = hoursLostForCode(code, fullDayHours);
  const available = Math.max(0, fullDayHours - lost);
  return Math.round(CONFIG.baseRate * available);
}

export function isAbsenceCode(code){
  if(!code) return false;
  const c = code.toLowerCase();
  return c==='h' || c==='h/am' || c==='h/pm' || c==='b' || c==='o';
}

export function statusLabel(code){
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

export function computeDayStats(person, date, stairEntries, holidayIndex){
  const bucket = dayBucket(date);
  const code = getCodeForPerson(holidayIndex, person.holidayName, date);
  if(!bucket) return { actual:0, target:0, credit:0, code };
  const target = targetFor(person.initials, date, code);
  const actual = stairEntries.filter(e=>e.initials===person.initials && sameDay(e.date, date))
                              .reduce((s,e)=>s+e.stairs,0);
  const fullDayHours = CONFIG.hours[person.initials][bucket];
  const lostHours = creditableHoursLost(code, fullDayHours);
  const credit = lostHours > 0 ? Math.round(CONFIG.baseRate * lostHours) : 0;
  return { actual, target, credit, code };
}

/* ---------- Sheet row parsers ---------- */

export function parseStairRows(rows){
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
        
        if(isCompleted && date && initials && CONFIG.people.some(p => p.initials === initials)) {
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

export function parseErrorRows(rows){
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

  function matchPerson(raw) {
    const name = (raw || '').trim();
    if (!name) return null;
    const upper = name.toUpperCase();
    return CONFIG.people.find(p =>
      p.initials === upper ||
      p.initials === name ||
      p.name.toUpperCase() === upper ||
      p.name.toUpperCase().startsWith(upper) ||
      upper.startsWith(p.name.toUpperCase()) ||
      p.name.split(' ')[0].toUpperCase() === upper ||
      upper.includes(p.initials)
    ) || null;
  }

  const out = [];
  for(let i=headerIdx+1;i<rows.length;i++){
    const r = rows[i];
    if(!r || r.length < 2) continue;
    const dateStr = (r[dateCol]||'').trim();
    if(!dateStr) continue;
    const date = parseUKDate(dateStr);
    if(!date) continue;
    const person = matchPerson(r[personCol]);
    if(!person) continue;
    const basePoints = pointsCol >= 0 ? (parseInt(r[pointsCol], 10) || 0) : 0;
    const additional = additionalPointsCol >= 0 ? (parseInt(r[additionalPointsCol], 10) || 0) : 0;
    // Combined total used everywhere on dials / badges / trends
    const points = basePoints + additional;
    out.push({
      initials: person.initials,
      date: date,
      issue: (r[issueCol]||'').trim(),
      quantity: parseInt(r[quantityCol],10) || 1,
      plot: (r[plotCol]||'').trim(),
      section: (r[sectionCol]||'').trim(),
      impact: (r[impactCol]||'').trim(),
      points: points,
      basePoints: basePoints,
      additionalPoints: additional,
      loadLink: (r[loadCol]||'').trim()
    });
  }
  return out;
}

export function parseReplacementPartsRows(rows){
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
    // suffix and match against our tracked people list by full name so this cost
    // can be tied to that person's own page. Names that don't match anyone
    // we track (blank, other staff, inconsistent entries) are left unmatched
    // and simply won't appear on any person's page.
    const cleanOperator = (r[operatorCol]||'').replace(/\(office\)/i, '').trim().toUpperCase();
    const matchedPerson = CONFIG.people.find(p => p.name.toUpperCase() === cleanOperator);

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
