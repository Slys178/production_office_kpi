// This-week finish day prediction (loaded after main.js helpers exist)
function renderCurrentWeekFinish(stairEntries, holidayIndex, today) {
  const container = document.getElementById('currentWeekFinish');
  if (!container) return;

  const monday = mondayOf(today);
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  const todayStart = new Date(today);
  todayStart.setHours(0, 0, 0, 0);

  const days = [];
  for (let d = new Date(monday); d <= friday; d.setDate(d.getDate() + 1)) {
    const dCopy = new Date(d);
    if (!dayBucket(dCopy)) continue;
    days.push(dCopy);
  }

  const people = PEOPLE.filter(p => p.initials !== CONFIG.excludeFromKpiDisplay);

  const personStats = people.map(person => {
    let weekTarget = 0;
    let actualSoFar = 0;
    const dayInfo = [];

    days.forEach(day => {
      const code = getCodeForPerson(holidayIndex, person.holidayName, day);
      const dayTarget = targetFor(person.initials, day, code);
      const dayActual = stairEntries
        .filter(e => e.initials === person.initials && sameDay(e.date, day))
        .reduce((s, e) => s + e.stairs, 0);

      weekTarget += dayTarget;
      if (day <= todayStart) actualSoFar += dayActual;

      const isPast = day < todayStart;
      const isToday = sameDay(day, todayStart);
      const remainingCapacity = (isPast ? 0 : dayTarget);

      dayInfo.push({
        date: new Date(day),
        target: dayTarget,
        actual: dayActual,
        code,
        isPast,
        isToday,
        remainingCapacity,
        available: dayTarget > 0
      });
    });

    const remaining = Math.max(0, weekTarget - actualSoFar);

    let left = remaining;
    let finishDay = null;
    let finishLabel = null;
    for (const di of dayInfo) {
      if (di.isPast) continue;
      if (left <= 0) break;
      if (di.remainingCapacity <= 0) continue;
      left -= di.remainingCapacity;
      if (left <= 0) {
        finishDay = di.date;
        break;
      }
    }
    if (remaining === 0) {
      finishLabel = 'Already done';
    } else if (finishDay) {
      finishLabel = sameDay(finishDay, todayStart)
        ? 'Today'
        : finishDay.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
    } else {
      finishLabel = "Won't hit target";
    }

    const remainingCapacityTotal = dayInfo
      .filter(di => !di.isPast)
      .reduce((s, di) => s + di.remainingCapacity, 0);

    return {
      person, weekTarget, actualSoFar, remaining, remainingCapacityTotal,
      finishDay, finishLabel, dayInfo, fullyOff: weekTarget === 0
    };
  });

  let teamRemaining = personStats.reduce((s, p) => s + p.remaining, 0);
  let teamFinishDay = null;
  let teamFinishLabel = 'Already done';
  if (teamRemaining > 0) {
    const remainingDays = days.filter(d => d >= todayStart);
    let left = teamRemaining;
    for (const day of remainingDays) {
      const dayCap = personStats.reduce((s, ps) => {
        const di = ps.dayInfo.find(x => sameDay(x.date, day));
        return s + (di ? di.remainingCapacity : 0);
      }, 0);
      left -= dayCap;
      if (left <= 0) {
        teamFinishDay = day;
        teamFinishLabel = sameDay(day, todayStart)
          ? 'Today'
          : day.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
        break;
      }
    }
    if (!teamFinishDay) teamFinishLabel = "Won't hit target this week";
  }

  const teamWeekTarget = personStats.reduce((s, p) => s + p.weekTarget, 0);
  const teamActual = personStats.reduce((s, p) => s + p.actualSoFar, 0);
  const teamRemCap = personStats.reduce((s, p) => s + p.remainingCapacityTotal, 0);
  const headlineClass = teamRemaining === 0 ? 'ok' : (teamFinishDay ? 'ok' : 'danger');

  let html = `
    <div class="finish-summary">
      <div class="finish-headline ${headlineClass}">
        ${teamRemaining === 0
          ? '🎯 Week targets already met'
          : (teamFinishDay
              ? `📅 Predicted finish: ${teamFinishLabel}`
              : '⚠️ Short of capacity this week')}
      </div>
      <div class="finish-meta">
        Team done <strong>${teamActual}</strong> of <strong>${teamWeekTarget}</strong>
        · Remaining <strong>${teamRemaining}</strong>
        · Capacity left <strong>${teamRemCap}</strong>
      </div>
    </div>
  `;

  html += '<div class="finish-person-grid">';
  personStats.forEach(ps => {
    const { person, weekTarget, actualSoFar, remaining, finishLabel, dayInfo, fullyOff, remainingCapacityTotal } = ps;
    let badgeClass = 'friday';
    let badgeText = finishLabel;
    if (fullyOff) { badgeClass = 'off'; badgeText = 'Off this week'; }
    else if (remaining === 0) { badgeClass = 'done'; badgeText = '✅ Done'; }
    else if (finishLabel === 'Today') { badgeClass = 'today'; badgeText = 'Today'; }
    else if (finishLabel === "Won't hit target") { badgeClass = 'short'; badgeText = 'Short'; }

    const dayChips = dayInfo.map(di => {
      const dayName = di.date.toLocaleDateString('en-GB', { weekday: 'short' });
      let cls = 'available';
      let tip = `${di.target} target`;
      if (di.code && isAbsenceCode(di.code)) {
        cls = 'off';
        tip = statusLabel(di.code) || di.code;
      } else if (di.target > 0 && di.target < targetFor(person.initials, di.date, '')) {
        cls = 'partial';
        tip = `${di.code || 'partial'}: ${di.target}`;
      } else if (di.target === 0) {
        cls = 'off';
        tip = 'No capacity';
      }
      return `<span class="fp-day-chip ${cls}" title="${tip}">${dayName}${di.isToday ? '*' : ''}</span>`;
    }).join('');

    html += `
      <div class="finish-person-card">
        <div class="fp-header">
          <span class="fp-name"><span class="dot" style="background:${person.color};"></span>${person.initials} · ${person.name.split(' ')[0]}</span>
          <span class="fp-badge ${badgeClass}">${badgeText}</span>
        </div>
        <div class="fp-row"><span>Week target</span><span class="val">${weekTarget}</span></div>
        <div class="fp-row"><span>Done so far</span><span class="val">${actualSoFar}</span></div>
        <div class="fp-row"><span>Still needed</span><span class="val">${remaining}</span></div>
        <div class="fp-row"><span>Capacity left</span><span class="val">${remainingCapacityTotal}</span></div>
        <div class="fp-days">${dayChips}</div>
      </div>
    `;
  });
  html += '</div>';

  const remainingDays = days.filter(d => d >= todayStart);
  if (remainingDays.length > 0 && teamRemaining > 0) {
    let running = teamRemaining;
    html += `
      <div class="finish-day-timeline">
        <table>
          <thead>
            <tr>
              <th>Day</th>
              <th>Team capacity</th>
              <th>Remaining after</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
    `;
    remainingDays.forEach(day => {
      const dayCap = personStats.reduce((s, ps) => {
        const di = ps.dayInfo.find(x => sameDay(x.date, day));
        return s + (di ? di.remainingCapacity : 0);
      }, 0);
      const before = running;
      running = Math.max(0, running - dayCap);
      const isFinish = before > 0 && running === 0;
      const dayName = day.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
      const todayMark = sameDay(day, todayStart) ? ' (today)' : '';
      html += `
        <tr class="${isFinish ? 'finish-row' : ''}">
          <td class="day-label">${dayName}${todayMark}</td>
          <td class="cap-cell">${dayCap}</td>
          <td class="rem-cell">${running}</td>
          <td>${isFinish ? '🏁 Finish' : (running === 0 ? '—' : '')}</td>
        </tr>
      `;
    });
    html += '</tbody></table></div>';
  }

  container.innerHTML = html;
}

window.renderCurrentWeekFinish = renderCurrentWeekFinish;
