const CONFIG = {
  SPREADSHEET_ID: '1GlPcGP7ByU8SDv3XetsZn0oM33fnoUIrLLoEciBhaFg',
  INCIDENTS_SHEET: 'Incidents',
  ACTIONS_SHEET: 'Incident Actions',
  LISTS_SHEET: 'Incident Lists',
  MANAGER_FIELDS: [
    'Manager Severity','Assigned Manager','Second Manager','Review Date','Completion Date',
    'Manager Status','Investigation Level','Manager Review','Immediate Actions','Review Notes',
    'Investigation Data','Reviewed By','Reviewed At','Manager Updated At'
  ]
};

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Staircraft | Near Miss & Incident Register')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function setupIncidentRegister() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const incident = ss.getSheetByName(CONFIG.INCIDENTS_SHEET);
  if (!incident) throw new Error('The Incidents sheet was not found. Check the spreadsheet and tab name.');
  ensureHeaders_(incident, CONFIG.MANAGER_FIELDS);
  let actions = ss.getSheetByName(CONFIG.ACTIONS_SHEET);
  if (!actions) actions = ss.insertSheet(CONFIG.ACTIONS_SHEET);
  ensureHeaders_(actions, ['Reference','Created','Action','Assigned To','Due Date','Status','Completed Date','Updated By']);
  let lists = ss.getSheetByName(CONFIG.LISTS_SHEET);
  if (!lists) {
    lists = ss.insertSheet(CONFIG.LISTS_SHEET);
    lists.getRange(1,1,1,2).setValues([['Managers','Departments']]);
    lists.getRange(2,1,5,2).setValues([
      ['Add manager names here','CNC'],
      ['','1st Fix Assembly'],
      ['','2nd Fix Assembly'],
      ['','Paintline'],
      ['','Other']
    ]);
    lists.setFrozenRows(1);
  }
  return {ok:true, message:'Register setup complete. Manager fields and action/list tabs are ready.'};
}

function getRegisterData() {
  const sh = getIncidentSheet_();
  const values = sh.getDataRange().getDisplayValues();
  if (!values.length) return {rows:[], managers:getManagers_(), departments:getDepartments_(), actions:getActions_()};
  const headers = values[0];
  const rows = values.slice(1).map((r,i) => {
    const o = {_row:i+2};
    headers.forEach((h,j) => o[h] = r[j] || '');
    return o;
  }).filter(o => String(o.Ref || o.Timestamp || o.Date || '').trim());
  rows.sort((a,b) => dateSort_(b['Logged'] || b.Timestamp || b['Timestamp'] || b.Date) - dateSort_(a['Logged'] || a.Timestamp || a['Timestamp'] || a.Date));
  return {rows, managers:getManagers_(), departments:getDepartments_(), actions:getActions_()};
}

function getIncidentDetail(ref) {
  const row = findIncidentRow_(ref);
  if (!row) throw new Error('Incident ' + ref + ' could not be found.');
  const actions = getActions_().filter(a => String(a.Reference) === String(ref));
  return {incident:row, actions, managers:getManagers_(), departments:getDepartments_()};
}

function saveManagerReview(ref, payload) {
  if (!ref || !payload) throw new Error('Missing incident reference or review details.');
  const sh = getIncidentSheet_();
  const found = findIncidentRow_(ref);
  if (!found) throw new Error('Incident not found.');
  ensureHeaders_(sh, CONFIG.MANAGER_FIELDS);
  const headers = headerMap_(sh);
  const allowed = CONFIG.MANAGER_FIELDS.filter(k => k !== 'Reviewed By' && k !== 'Reviewed At' && k !== 'Manager Updated At');
  const row = found._row;
  allowed.forEach(k => {
    if (payload[k] !== undefined) sh.getRange(row, headers[k]).setValue(safeCell_(payload[k]));
  });
  sh.getRange(row, headers['Manager Updated At']).setValue(new Date());
  if (payload.markReviewed) {
    const email = Session.getActiveUser().getEmail() || 'Manager';
    sh.getRange(row, headers['Reviewed By']).setValue(email);
    sh.getRange(row, headers['Reviewed At']).setValue(new Date());
  }
  return {ok:true};
}

function saveInvestigation(ref, data) {
  const sh = getIncidentSheet_();
  const found = findIncidentRow_(ref);
  if (!found) throw new Error('Incident not found.');
  ensureHeaders_(sh, CONFIG.MANAGER_FIELDS);
  const headers = headerMap_(sh);
  const cell = JSON.stringify(data || {});
  if (cell.length > 45000) throw new Error('Investigation is too long to save. Please shorten some answers.');
  sh.getRange(found._row, headers['Investigation Data']).setValue(cell);
  sh.getRange(found._row, headers['Manager Updated At']).setValue(new Date());
  return {ok:true};
}

function addIncidentAction(ref, action) {
  if (!ref || !action || !String(action.Action || '').trim()) throw new Error('Please enter an action.');
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  let sh = ss.getSheetByName(CONFIG.ACTIONS_SHEET);
  if (!sh) { setupIncidentRegister(); sh = ss.getSheetByName(CONFIG.ACTIONS_SHEET); }
  const email = Session.getActiveUser().getEmail() || 'Manager';
  sh.appendRow([String(ref), new Date(), safeCell_(action.Action), safeCell_(action['Assigned To']), safeCell_(action['Due Date']), 'Open', '', email]);
  return {ok:true};
}

function updateIncidentAction(rowNumber, status) {
  const sh = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID).getSheetByName(CONFIG.ACTIONS_SHEET);
  if (!sh || rowNumber < 2 || rowNumber > sh.getLastRow()) throw new Error('Action not found.');
  const h = headerMap_(sh);
  sh.getRange(rowNumber, h.Status).setValue(status);
  if (status === 'Complete') sh.getRange(rowNumber, h['Completed Date']).setValue(new Date());
  return {ok:true};
}

function getRegisterLists() {
  return {managers:getManagers_(), departments:getDepartments_()};
}

function getIncidentSheet_() {
  const sh = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID).getSheetByName(CONFIG.INCIDENTS_SHEET);
  if (!sh) throw new Error('Missing sheet: ' + CONFIG.INCIDENTS_SHEET);
  return sh;
}
function ensureHeaders_(sh, names) {
  const last = Math.max(sh.getLastColumn(), 1);
  const existing = sh.getRange(1,1,1,last).getDisplayValues()[0];
  names.forEach(name => {
    if (existing.indexOf(name) < 0) {
      sh.getRange(1, sh.getLastColumn()+1).setValue(name);
      existing.push(name);
    }
  });
}
function headerMap_(sh) {
  const h = sh.getRange(1,1,1,sh.getLastColumn()).getDisplayValues()[0];
  const out = {};
  h.forEach((v,i) => { if (v) out[v] = i+1; });
  return out;
}
function findIncidentRow_(ref) {
  const sh = getIncidentSheet_();
  const v = sh.getDataRange().getDisplayValues();
  if (!v.length) return null;
  const idx = v[0].indexOf('Ref');
  if (idx < 0) throw new Error('The Incidents sheet needs a Ref column.');
  for (let i=1;i<v.length;i++) if (String(v[i][idx]) === String(ref)) {
    const o = {_row:i+1};
    v[0].forEach((h,j) => o[h] = v[i][j] || '');
    return o;
  }
  return null;
}
function getActions_() {
  const sh = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID).getSheetByName(CONFIG.ACTIONS_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  const v = sh.getDataRange().getDisplayValues(), h = v[0];
  return v.slice(1).map((r,i) => {
    const o = {_row:i+2}; h.forEach((k,j) => o[k]=r[j]||''); return o;
  }).filter(o => o.Reference);
}
function getManagers_() {
  const sh = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID).getSheetByName(CONFIG.LISTS_SHEET);
  if (!sh || sh.getLastRow()<2) return [];
  return sh.getRange(2,1,sh.getLastRow()-1,1).getDisplayValues().flat().map(x=>x.trim()).filter(Boolean);
}
function getDepartments_() {
  const sh = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID).getSheetByName(CONFIG.LISTS_SHEET);
  if (!sh || sh.getLastRow()<2) return [];
  return sh.getRange(2,2,sh.getLastRow()-1,1).getDisplayValues().flat().map(x=>x.trim()).filter(Boolean);
}
function safeCell_(v) {
  const s = String(v == null ? '' : v).slice(0,49000);
  return /^[=+@]/.test(s) ? "'" + s : s;
}
function dateSort_(v) {
  const d = new Date(v);
  return isNaN(d) ? 0 : d.getTime();
}
