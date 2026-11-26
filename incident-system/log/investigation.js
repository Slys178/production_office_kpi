/**
 * Investigation form, signatures and summary document for the Incident Log.
 * FORM below drives BOTH the on-screen form and the printed summary, so edit fields there.
 * Classic script (like the page itself). Answers are saved as JSON in "Investigation Data".
 */
(function () {
  var SUB_TYPES = ['Injury', 'Occupational health or ill health', 'Unsafe condition', 'Unsafe Act', 'Property Damage', 'Environmental', 'Vehicle or FLT'];
  var YN = ['Yes', 'No'], YNU = ['Yes', 'No', 'Unknown'];

  // Flow chart for Just Culture: put the image in this folder and set its file name here.
  var FLOW_CHART = '';

  function level(d) { return d.level || ''; }
  var local = function (d) { return level(d) === 'Local review'; };
  var standard = function (d) { return level(d) === 'Standard Investigation'; };

  // col = also kept in its own sheet column. type: text (default), area, select, date, files.
  var FORM = [
    { title: 'Case', fields: [
      { k: 'title', col: 'Title', label: 'Title', hint: 'e.g. Fire on CNC machine in 1st Fix' },
      { k: 'location', col: 'Site', label: 'Location', type: 'select', options: ['Bayton Road', 'Ibstock Road', 'Ansty'] },
      { k: 'specificLocation', col: 'Specific Location', label: 'Specific location' },
      { k: 'subType', col: 'Sub Type', label: 'Sub type (added by investigator)', type: 'select', options: SUB_TYPES },
      { k: 'severity', col: 'Potential Severity', label: 'Potential severity (for near misses)', type: 'select', options: ['Low', 'Medium', 'High', 'Critical'] }
    ] },
    { title: 'Injury or harm', fields: [
      { k: 'injuryNature', from: 'Injury Type', label: 'Nature of injury' },
      { k: 'bodyPart', from: 'Body Parts', label: 'Body part' },
      { k: 'firstAid', from: 'First Aid', label: 'First aid required', type: 'select', options: YN },
      { k: 'hospital', from: 'Hospital', label: 'Hospitalisation', type: 'select', options: YN },
      { k: 'lti', col: 'LTI', label: 'Lost time injury (LTI)', type: 'select', options: YN },
      { k: 'lostDays', col: 'Lost Days', label: 'Lost days', type: 'number', show: function (d) { return d.lti === 'Yes'; } }
    ] },
    { title: 'RIDDOR', fields: [
      { k: 'riddor', col: 'RIDDOR', label: 'RIDDOR status', type: 'select', options: ['Not assessed', 'Not reportable', 'Potentially reportable', 'Reported'] },
      { k: 'riddorDate', col: 'RIDDOR Date', label: 'Date reported to HSE', type: 'date', show: function (d) { return d.riddor === 'Reported'; } }
    ] },
    { title: 'Person details', fields: [
      { k: 'personType', col: 'Person Type', label: 'Person type', type: 'select', options: ['Employee', 'Contractor', 'Agency worker', 'Visitor', 'Member of the public'] },
      { k: 'jobRole', label: 'Department and job role' },
      { k: 'experience', label: 'Length of experience' },
      { k: 'task', label: 'Task being performed', type: 'area' },
      { k: 'routine', label: 'Routine or non-routine task', type: 'select', options: ['Routine', 'Non-routine'] },
      { k: 'witnesses', label: 'Witnesses', hint: 'Initials only (GDPR)', type: 'area' },
      { k: 'witnessFiles', label: 'Witness statements', type: 'files' },
      { k: 'trained', label: 'Training', type: 'select', options: YNU },
      { k: 'trainingFiles', label: 'Training documents', type: 'files' }
    ] },
    { title: 'Risk assessment and safe system of work', fields: [
      { k: 'raAvailable', label: 'RA available', type: 'select', options: YN },
      { k: 'raFiles', label: 'Risk assessment', type: 'files', show: function (d) { return d.raAvailable === 'Yes'; } },
      { k: 'ssowAvailable', label: 'SSOW available', type: 'select', options: YN },
      { k: 'ssowFiles', label: 'SSOW', type: 'files', show: function (d) { return d.ssowAvailable === 'Yes'; } }
    ] },
    { title: 'Event information', fields: [
      { k: 'factual', label: 'Factual summary', type: 'area' },
      { k: 'detail', label: 'Detailed description', type: 'area' },
      { k: 'equipment', label: 'Equipment involved' },
      { k: 'chemicals', label: 'Chemicals involved' },
      { k: 'lighting', label: 'Lighting levels' },
      { k: 'weather', label: 'Weather (if applicable)' },
      { k: 'ppeRequired', label: 'PPE required' },
      { k: 'ppeUsed', label: 'Was the PPE being used?' },
      { k: 'immediateControls', label: 'Immediate controls', type: 'area' },
      { k: 'otherInfo', label: 'Other information', type: 'area' },
      { k: 'photoFiles', label: 'Other photos', type: 'files', accept: 'image/*' }
    ] },
    { title: 'Investigation level', fields: [
      { k: 'level', col: 'Investigation Level', label: 'Level', type: 'select', options: ['None required', 'Local review', 'Standard Investigation'] },
      { note: '<b>Use a local review when:</b><ul><li>No injury or minor first-aid injury</li><li>Low-potential near miss</li><li>Cause appears straightforward</li><li>Existing RA/SSOW is adequate</li><li>No evidence of significant equipment or control failure</li><li>No recurring trend</li><li>Corrective action can reasonably be managed locally</li></ul>Do not use a local review if there is any possibility of a disciplinary. The investigator may still do a full investigation on the recommendation of a manager or the H&amp;S manager.' },
      { k: 'status', col: 'Investigation', label: 'Investigation status', type: 'select', options: ['Required', 'In progress', 'Complete', 'Not required'] },
      { k: 'assigned', col: 'Assigned To', label: 'Assigned to' }
    ] },
    { title: 'Local review', show: local, fields: [
      { note: 'Needs: RA and SSOW check, witness statements and photos (upload above). Then go to Proposed actions.' },
      { k: 'happened', label: 'What happened, and what should have happened?', type: 'area' },
      { k: 'ledTo', label: 'What condition, action or change led to the incident, and why?', type: 'area' },
      { k: 'fix', label: 'What needs fixing?', type: 'area' },
      { k: 'raChecked', label: 'RA and SSOW checked', type: 'select', options: YN }
    ] },
    { title: 'Standard investigation', show: standard, fields: [
      { k: 'timeline', label: 'Timeline', type: 'area' },
      { k: 'failedControls', label: 'Failed or missing guarding or controls', type: 'area' },
      { k: 'raAdequate', label: 'RA was adequate', type: 'select', options: YN },
      { k: 'ssowAdequate', label: 'SSOW was adequate', type: 'select', options: YN },
      { k: 'ssowFollowed', label: 'SSOW was being followed', type: 'select', options: YN },
      { k: 'ssowNotes', label: 'SSOW comments', type: 'area' },
      { k: 'personTrained', label: 'Person was trained', type: 'select', options: YNU },
      { k: 'supervision', label: 'Supervision', type: 'area' },
      { k: 'housekeeping', label: 'Housekeeping', type: 'area' },
      { k: 'communication', label: 'Communication', type: 'area' },
      { k: 'maintained', label: 'Equipment properly maintained', type: 'area' },
      { k: 'otherFactors', label: 'Other', type: 'area' },
      { k: 'immediateCause', label: 'Immediate cause', type: 'area', hint: 'The direct, visible action or physical condition at the exact moment of the incident that caused the harm or loss.' },
      { k: 'contributingCauses', label: 'Contributing causes', type: 'area', hint: 'Secondary factors that did not directly trigger the incident, but made it more likely or made the outcome worse.' },
      { k: 'underlyingCause', label: 'Underlying cause', type: 'area', hint: 'The less obvious workplace conditions, practices or local management failings that allowed the immediate cause to happen.' },
      { k: 'rootCause', label: 'Root cause', type: 'area', hint: 'The fundamental organisational, cultural or management system failure from which the other causes came.' }
    ] },
    { title: 'Just Culture analysis', show: standard, fields: [
      { note: 'Disciplinary procedures are outside the scope of this process.' },
      { flow: true },
      { k: 'determination', label: 'Determination', type: 'area' },
      { k: 'reasoning', label: 'Reasoning', type: 'area' }
    ] },
    { title: 'Proposed actions', fields: [
      { actions: true },
      { k: 'actionsTaken', col: 'Actions Taken', label: 'Actions already taken / comments', type: 'area' },
      { k: 'corrective', col: 'Corrective Action', label: 'Corrective action', type: 'area' },
      { k: 'caseStatus', col: 'Status', label: 'Case status', type: 'select', options: ['Open', 'Closed'], required: true }
    ] }
  ];

  var ROLES = [
    ['Signature Person', 'Person involved in the incident'],
    ['Signature Supervisor', 'Area Supervisor'],
    ['Signature Ops Manager', 'Ops Manager'],
    ['Signature HS Manager', 'H&S Manager'],
    ['Signature Ops Director', 'Ops Director (if required)']
  ];

  var CSS = '.inv-hint{display:block;font-weight:400;font-size:13px;color:var(--muted)}' +
    '.inv-note{font-size:14px;background:var(--paper);border-radius:8px;padding:10px;margin-top:12px}.inv-note ul{margin:6px 0;padding-left:20px}' +
    '.inv-small{border:2px solid var(--line);background:#fff;border-radius:8px;padding:7px 12px;font:600 14px Barlow,sans-serif;cursor:pointer;margin-top:6px}' +
    '.inv-act{display:grid;grid-template-columns:1fr;gap:6px;border-bottom:1px solid var(--line);padding:8px 0}' +
    '@media(min-width:640px){.inv-act{grid-template-columns:3fr 2fr 160px auto}}' +
    '.inv-file{display:flex;gap:10px;align-items:center;font-size:14px;margin:4px 0}' +
    '.inv-sig{border-bottom:1px solid var(--line);padding:10px 0}.inv-sig img{max-width:260px;display:block;border:1px solid var(--line)}' +
    '.inv-pad{width:100%;max-width:480px;height:160px;border:2px dashed var(--line);border-radius:8px;background:#fff;touch-action:none;display:block;margin-top:6px}' +
    '.inv-warn{color:#7A1B0F;font-weight:600;font-size:14px}' +
    '#sum{position:fixed;inset:0;background:#fff;overflow:auto;z-index:40;padding:20px}#sum .doc{max-width:800px;margin:0 auto}' +
    '#sum table{width:100%;border-collapse:collapse;margin-bottom:14px;font-size:14px}#sum td{border:1px solid var(--line);padding:6px;vertical-align:top;white-space:pre-wrap}' +
    '#sum td:first-child{width:34%;font-weight:600}#sum img{max-width:220px;max-height:90px}' +
    '@media print{body>*:not(#sum){display:none!important}#sum{position:static;padding:0}#sum .noprint{display:none}#sum tr{break-inside:avoid}}';
  var style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);

  var R = null, D = null, REV = 0, DIRTY = false, BUSY = 0;
  function el(i) { return document.getElementById(i); }
  function parse(s) { try { return JSON.parse(s) || {}; } catch (e) { return {}; } }
  function fields() { var a = []; FORM.forEach(function (s) { s.fields.forEach(function (f) { if (f.k) a.push(f); }); }); return a; }

  function initial(r) {
    var saved = parse(r['Investigation Data']), d = saved.answers || {};
    fields().forEach(function (f) {
      // Sheet columns win, so edits made directly in the sheet still show
      if (f.col && r[f.col] !== undefined) d[f.k] = String(r[f.col]);
      else if (f.type === 'files') d[f.k] = d[f.k] || [];
      else if (d[f.k] === undefined) d[f.k] = f.from ? String(r[f.from] || '') : '';
      if (f.type === 'date') d[f.k] = String(d[f.k]).slice(0, 10);
    });
    d.caseStatus = d.caseStatus || 'Open';
    d.actions = d.actions || [];
    return { answers: d, rev: saved.rev || 0 };
  }

  function fieldHtml(f) {
    if (f.note) return '<div class="inv-note">' + f.note + '</div>';
    if (f.flow) return FLOW_CHART ? '<img alt="Just Culture flow chart" src="' + esc(FLOW_CHART) + '" style="max-width:100%;margin-top:10px">' : '<div class="inv-note">Flow chart to be added.</div>';
    if (f.actions) return '<div id="inv-actions"></div><button type="button" class="inv-small" id="inv-addAct">+ Add action</button>';
    var v = D[f.k], id = 'inv-' + f.k, h = '<div id="w-' + f.k + '"><label for="' + id + '">' + esc(f.label) + (f.hint ? '<span class="inv-hint">' + esc(f.hint) + '</span>' : '') + '</label>';
    if (f.type === 'area') h += '<textarea id="' + id + '" data-k="' + f.k + '" maxlength="2000">' + esc(v) + '</textarea>';
    else if (f.type === 'select') {
      var list = f.required ? f.options.slice() : [''].concat(f.options);
      if (v && list.indexOf(v) < 0) list.push(v); // keep older values such as Yes/No RIDDOR
      h += '<select id="' + id + '" data-k="' + f.k + '">' + opts(list, v) + '</select>';
    } else if (f.type === 'files') {
      h += '<div id="fl-' + f.k + '"></div><input type="file" id="' + id + '" data-files="' + f.k + '" multiple' + (f.accept ? ' accept="' + f.accept + '"' : '') + '>';
    } else h += '<input id="' + id + '" data-k="' + f.k + '" type="' + (f.type || 'text') + '" maxlength="200" value="' + esc(v) + '">';
    return h + '</div>';
  }

  function drawFiles(k) {
    el('fl-' + k).innerHTML = D[k].map(function (x, i) {
      var link = /^https:\/\//.test(x.link) ? x.link : '#';
      return '<div class="inv-file"><a target="_blank" rel="noopener" href="' + esc(link) + '">' + esc(x.name) + '</a><button type="button" class="inv-small" data-rm="' + k + ':' + i + '">Remove</button></div>';
    }).join('');
  }
  function drawActions() {
    el('inv-actions').innerHTML = D.actions.map(function (a, i) {
      function inp(key, ph, type) { return '<input aria-label="' + ph + '" placeholder="' + ph + '" type="' + (type || 'text') + '" maxlength="500" data-act="' + i + ':' + key + '" value="' + esc(a[key]) + '">'; }
      return '<div class="inv-act">' + inp('what', 'What') + inp('who', 'Who') + inp('when', 'By when', 'date') + '<button type="button" class="inv-small" data-delact="' + i + '">Remove</button></div>';
    }).join('') || '<p class="none">No actions added yet.</p>';
  }
  function visibility() {
    FORM.forEach(function (s, n) {
      if (s.show) el('sec-' + n).classList.toggle('hide', !s.show(D));
      s.fields.forEach(function (f) { if (f.show) el('w-' + f.k).classList.toggle('hide', !f.show(D)); });
    });
  }
  function changed() { DIRTY = true; el('saveMsg').innerHTML = ''; }

  function mount(root, r) {
    R = r; var start = initial(r); D = start.answers; REV = start.rev; DIRTY = false; BUSY = 0;
    root.innerHTML = FORM.map(function (s, n) {
      return '<div class="panel" id="sec-' + n + '"><h2>' + esc(s.title) + '</h2>' + s.fields.map(fieldHtml).join('') + '</div>';
    }).join('') +
      '<div class="panel">' + (r['Closed Date'] ? '<p class="none">Closed on ' + esc(fmtD(r['Closed Date'])) + '</p>' : '') +
      '<div id="saveMsg"></div><button type="button" class="btn" id="saveBtn">Save</button><button type="button" class="btn" id="sumBtn">Summary document</button></div>' +
      '<div class="panel"><h2>Approvals and signatures</h2><p class="none">Save the case first. Each signature is stored as soon as you press Save signature.</p><div id="inv-sigs"></div></div>';
    fields().forEach(function (f) { if (f.type === 'files') drawFiles(f.k); });
    drawActions(); drawSigs(); visibility();
    root.oninput = function (e) {
      var t = e.target;
      if (t.dataset.k) { D[t.dataset.k] = t.value; changed(); visibility(); }
      else if (t.dataset.act) { var p = t.dataset.act.split(':'); D.actions[p[0]][p[1]] = t.value; changed(); }
    };
    root.onchange = function (e) { if (e.target.dataset.files) upload(e.target); else if (e.target.dataset.k) root.oninput(e); };
    root.onclick = function (e) {
      var t = e.target;
      if (t.id === 'inv-addAct') { D.actions.push({ what: '', who: '', when: '' }); drawActions(); changed(); }
      else if (t.dataset.delact) { D.actions.splice(+t.dataset.delact, 1); drawActions(); changed(); }
      else if (t.dataset.rm) { var p = t.dataset.rm.split(':'); D[p[0]].splice(+p[1], 1); drawFiles(p[0]); changed(); }
      else if (t.id === 'saveBtn') save();
      else if (t.id === 'sumBtn') summary();
      else if (t.dataset.sign) pad(t.dataset.sign);
    };
  }

  function message(kind, text) { el('saveMsg').innerHTML = '<div class="msg ' + kind + '">' + esc(text) + '</div>'; }

  function upload(input) {
    var k = input.dataset.files, ref = R['Ref'], answers = D;
    [].slice.call(input.files).forEach(function (file) {
      BUSY++; message('ok', 'Uploading ' + file.name + '...');
      google.script.run.withSuccessHandler(function (res) {
        if (answers !== D) return;
        BUSY--; D[k].push(res); drawFiles(k); DIRTY = true; message('ok', 'Uploaded. Press Save to keep it on the case.');
      }).withFailureHandler(function (e) {
        if (answers !== D) return;
        BUSY--; message('err', 'Upload failed: ' + (e && e.message ? e.message : 'please try again'));
      }).uploadFile(ref, file);
    });
    input.value = '';
  }

  function save() {
    if (BUSY) return message('err', 'Please wait for uploads to finish.');
    var btn = el('saveBtn'), r = R, answers = D, flat = {};
    fields().forEach(function (f) { if (f.col) flat[f.col] = (f.show && !f.show(D)) ? '' : D[f.k]; });
    btn.disabled = true; btn.textContent = 'Saving...';
    google.script.run.withSuccessHandler(function (res) {
      btn.disabled = false; btn.textContent = 'Save';
      if (!res || !res.ok) return message('err', (res && res.error) || 'Could not save.');
      Object.keys(flat).forEach(function (k) { r[k] = flat[k]; });
      r['Investigation Data'] = res.data;
      if (flat['Status'] === 'Closed' && !r['Closed Date']) r['Closed Date'] = new Date().toISOString().slice(0, 10);
      if (flat['Status'] === 'Open') r['Closed Date'] = '';
      drawOv(); drawLog();
      if (answers !== D) return;
      REV = parse(res.data).rev; DIRTY = false; message('ok', 'Saved.'); drawSigs();
    }).withFailureHandler(function (e) {
      btn.disabled = false; btn.textContent = 'Save';
      message('err', 'Could not save. ' + (e && e.message ? e.message : 'Please try again.'));
    }).saveCase(r['Ref'], flat, D, REV);
  }

  function sigOf(col) { var s = parse(R[col]); return /^data:image\/png;base64,[A-Za-z0-9+\/=]+$/.test(s.img) ? s : null; }
  function stale(s) { return s.rev !== REV; }
  function drawSigs() {
    el('inv-sigs').innerHTML = ROLES.map(function (role) {
      var s = sigOf(role[0]);
      return '<div class="inv-sig"><b>' + esc(role[1]) + '</b>' + (s ?
        '<img alt="Signature" src="' + s.img + '"><div>' + esc(s.name) + ' · ' + esc(fmtD(s.date)) + '</div>' +
        (stale(s) ? '<div class="inv-warn">The case was changed after this signature.</div>' : '') : '<div class="none">Not signed</div>') +
        '<div id="pad-' + role[0].replace(/ /g, '_') + '"><button type="button" class="inv-small" data-sign="' + role[0] + '">' + (s ? 'Sign again' : 'Sign') + '</button></div></div>';
    }).join('');
  }
  function pad(col) {
    if (DIRTY || !REV) return message('err', 'Please Save the case before signing, so the signature matches what was signed.'), el('saveMsg').scrollIntoView({ block: 'center' });
    var box = el('pad-' + col.replace(/ /g, '_'));
    box.innerHTML = '<input placeholder="Full name" aria-label="Full name" maxlength="80"><canvas class="inv-pad" width="480" height="160"></canvas>' +
      '<button type="button" class="inv-small">Save signature</button> <button type="button" class="inv-small">Clear</button> <button type="button" class="inv-small">Cancel</button><div class="inv-warn"></div>';
    var c = box.querySelector('canvas'), x = c.getContext('2d'), down = false, drawn = false, btns = box.querySelectorAll('button'), err = box.querySelector('.inv-warn');
    x.lineWidth = 2.5; x.lineCap = 'round';
    function at(e) { var b = c.getBoundingClientRect(); return [(e.clientX - b.left) * c.width / b.width, (e.clientY - b.top) * c.height / b.height]; }
    c.onpointerdown = function (e) { down = true; c.setPointerCapture(e.pointerId); var p = at(e); x.beginPath(); x.moveTo(p[0], p[1]); };
    c.onpointermove = function (e) { if (!down) return; var p = at(e); x.lineTo(p[0], p[1]); x.stroke(); drawn = true; };
    c.onpointerup = c.onpointercancel = function () { down = false; };
    btns[1].onclick = function () { x.clearRect(0, 0, c.width, c.height); drawn = false; };
    btns[2].onclick = drawSigs;
    btns[0].onclick = function () {
      var name = box.querySelector('input').value.trim(), r = R;
      if (!name || !drawn) { err.textContent = 'Please enter a name and draw a signature.'; return; }
      if (DIRTY) { err.textContent = 'Please Save your changes to the case first.'; return; }
      var n = new Date(), sig = { name: name, date: n.getFullYear() + '-' + ('0' + (n.getMonth() + 1)).slice(-2) + '-' + ('0' + n.getDate()).slice(-2), rev: REV, img: c.toDataURL('image/png') };
      btns[0].disabled = true;
      google.script.run.withSuccessHandler(function (res) {
        if (!res || !res.ok) { btns[0].disabled = false; err.textContent = (res && res.error) || 'Could not save.'; return; }
        r[col] = res.value; if (r === R) drawSigs();
      }).withFailureHandler(function (e) { btns[0].disabled = false; err.textContent = 'Could not save. ' + (e && e.message ? e.message : ''); }).saveSignature(r['Ref'], col, sig);
    };
  }

  function table(rows) { return '<table>' + rows.map(function (x) { return '<tr><td>' + esc(x[0]) + '</td><td>' + (x[2] ? x[1] : esc(x[1] || '—')) + '</td></tr>'; }).join('') + '</table>'; }
  function summary() {
    var r = R;
    var h = '<div class="doc"><div class="noprint"><button class="back" id="sumBack">Back to case</button> <button class="back" id="sumPrint">Print / save as PDF</button></div>' +
      '<h1>Incident summary #' + esc(r['Ref']) + '</h1>' + (DIRTY ? '<p class="inv-warn">Includes changes that have not been saved.</p>' : '') +
      '<h2>Report</h2>' + table([['Unique ID', r['Ref']], ['Incident type', r['Type']], ['Date and time', fmtD(r['Date']) + ' ' + (r['Time'] || '')], ['Department', r['Department']], ['Reported by', r['Reporter'] || r['Name']], ['Injured person', r['Injured Person']], ['What happened (from report)', r['Description']]]);
    FORM.forEach(function (s) {
      if (s.show && !s.show(D)) return;
      var rows = [];
      s.fields.forEach(function (f) {
        if (!f.k || (f.show && !f.show(D))) return;
        var v = D[f.k];
        if (f.type === 'files') v = v.map(function (x) { return x.name; }).join('\n');
        if (f.type === 'date') v = fmtD(v);
        rows.push([f.label, v]);
      });
      h += '<h2>' + esc(s.title) + '</h2>';
      if (s.fields.some(function (f) { return f.actions; }))
        h += table(D.actions.length ? D.actions.map(function (a, i) { return ['Action ' + (i + 1), a.what + '\nWho: ' + (a.who || '—') + '\nBy: ' + (fmtD(a.when) || '—')]; }) : [['Actions', '']]);
      h += table(rows);
    });
    h += '<h2>Approvals and signatures</h2>' + table(ROLES.map(function (role) {
      var s = sigOf(role[0]);
      return [role[1], s ? '<img alt="Signature" src="' + s.img + '"><br>' + esc(s.name) + ' · ' + esc(fmtD(s.date)) + (stale(s) ? '<br><span class="inv-warn">Case changed after signing</span>' : '') : '<br><br>Signature: ______________________   Date: ____________', true];
    })) + '</div>';
    var v = document.createElement('div'); v.id = 'sum'; v.innerHTML = h; document.body.appendChild(v);
    el('sumBack').onclick = function () { v.remove(); };
    el('sumPrint').onclick = function () { window.print(); };
  }

  window.Investigation = {
    mount: mount,
    canLeave: function () { return (!DIRTY && !BUSY) || window.confirm('You have unsaved changes. Leave without saving?'); },
    left: function () { DIRTY = false; BUSY = 0; D = null; }
  };
})();
