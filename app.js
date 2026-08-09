import { A2_PROGRAM, findExercise, findWorkoutDay, exercisesForDay } from './data/programs.js';
import { SCHEMA_VERSION, workoutRepository } from './storage.js';

const app = document.querySelector('#app');
const title = document.querySelector('#pageTitle');
let state = { view: 'home', workout: null, timer: null, timerLeft: 0 };

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function jsString(value) {
  return JSON.stringify(String(value));
}

function toast(message) {
  const t = document.querySelector('#toast');
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 1800);
}

function nav(view) {
  document.querySelectorAll('.nav-btn').forEach(button => button.classList.toggle('active', button.dataset.nav === view));
}

function workoutCounts(workout) {
  const planned = exercisesForDay(workout.programId, workout.workoutDayId);
  const completedStrength = planned.filter(ex => ['warmup', 'working', 'core'].includes(ex.setType) && Object.values(workout.sets[ex.id] || {}).length).length;
  const completedActivities = Object.keys(workout.completedActivities || {}).length;
  return { total: planned.length, done: completedStrength + completedActivities };
}

async function home() {
  state.view = 'home';
  state.workout = null;
  title.textContent = 'Antrenman';
  const draft = await workoutRepository.getDraft();
  app.innerHTML = `
    ${draft ? `<section class="resume-card">
      <div><b>Devam eden antrenman</b><span>${escapeHtml(findWorkoutDay(draft.programId, draft.workoutDayId)?.label)} • ${new Date(draft.startedAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</span></div>
      <button class="primary-btn" data-action="resume">Sürdür</button>
    </section>` : ''}
    <section class="hero"><h2>A2 Antrenman Takip</h2><p>Günü seç, önceki performansını gör, setlerini kaydet.</p></section>
    <div class="day-grid">${A2_PROGRAM.workoutDays.map(day => `
      <article class="day-card">
        <div class="day">${escapeHtml(day.label)}</div>
        <div class="meta">${day.sections.reduce((n, s) => n + s.exercises.length, 0)} hareket/blok</div>
        <button class="primary-btn full" data-start-day="${day.id}">Başlat</button>
      </article>`).join('')}</div>`;
  nav('home');
}

async function startWorkout(workoutDayId) {
  const draft = await workoutRepository.getDraft();
  if (draft && !confirm('Devam eden antrenman silinip yeni antrenman başlatılsın mı?')) return;
  state.workout = {
    id: uid(),
    programId: A2_PROGRAM.id,
    workoutDayId,
    startedAt: new Date().toISOString(),
    status: 'active',
    completedActivities: {},
    sets: {}
  };
  await workoutRepository.saveDraft(state.workout);
  await renderWorkout();
}

async function resumeWorkout() {
  state.workout = await workoutRepository.getDraft();
  await renderWorkout();
}

async function renderWorkout() {
  const workout = state.workout;
  const day = findWorkoutDay(workout.programId, workout.workoutDayId);
  const counts = workoutCounts(workout);
  title.textContent = day.label;
  app.innerHTML = `
    ${timerHtml()}
    <section class="summary-card">
      <b>${escapeHtml(day.label)}</b>
      <div class="progress"><div style="width:${Math.min(100, counts.done / counts.total * 100)}%"></div></div>
      <div class="small muted">${counts.done}/${counts.total} hareket/blok kayıtlandı • Başlangıç ${new Date(workout.startedAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</div>
    </section>
    ${day.sections.map(section => `<div class="section-title ${section.type}">${escapeHtml(section.name)}</div>${section.exercises.map(exercise => exerciseCard(exercise, section.type)).join('')}`).join('')}
    <div class="workout-toolbar">
      <button class="secondary-btn" data-action="home">Kapat</button>
      <button class="primary-btn" data-action="finish">Antrenmanı Bitir</button>
    </div>`;
  nav('home');
}

function timerHtml() {
  if (state.timerLeft <= 0) return '';
  return `<div class="timer" aria-live="polite">
    <span>Dinlenme</span><strong id="timerText">${fmt(state.timerLeft)}</strong>
    <div><button data-action="timer-reset">Sıfırla</button><button data-action="timer-stop">Atla</button></div>
  </div>`;
}

function exerciseCard(exercise, sectionType) {
  if (['activation', 'stretch'].includes(exercise.setType)) {
    const done = Boolean(state.workout.completedActivities[exercise.id]);
    return `<article class="exercise-card simple ${sectionType}">
      <div class="exercise-head"><div class="exercise-name">${escapeHtml(exercise.name)}</div><div class="prescription">Plan: ${escapeHtml(exercise.prescription.text)}</div></div>
      <div class="simple-done">
        ${done ? '<span class="done-badge">Tamamlandı</span>' : '<span class="muted small">Aktivasyon / süre çalışması</span>'}
        <button class="secondary-btn" data-toggle-activity="${exercise.id}">${done ? 'Geri Al' : 'Tamam'}</button>
      </div>
    </article>`;
  }
  const current = state.workout.sets[exercise.id] || {};
  const rows = Array.from({ length: exercise.prescription.plannedSets }, (_, i) => setRow(exercise, i + 1, current[i + 1])).join('');
  return `<article class="exercise-card ${exercise.setType}" id="ex-${exercise.id}">
    <div class="exercise-head">
      <div><div class="exercise-name">${escapeHtml(exercise.name)}</div>${exercise.setType === 'warmup' ? '<div class="warmup-label">Isınma seti</div>' : ''}</div>
      <div class="prescription">Plan: ${escapeHtml(exercise.prescription.text)}</div>
    </div>
    <div data-last="${exercise.id}">${lastBlock(exercise.id)}</div>
    ${progressionText(exercise.id)}
    <div class="labels"><span>Set</span><span>KG</span><span>Tekrar</span><span>RIR</span><span></span></div>
    ${rows}
  </article>`;
}

function setRow(exercise, setNumber, set) {
  return `<div class="set-row ${set ? 'saved' : ''}">
    <div class="set-n">${setNumber}</div>
    <input inputmode="decimal" autocomplete="off" pattern="[0-9]*[.,]?[0-9]*" placeholder="kg" id="kg-${exercise.id}-${setNumber}" value="${escapeHtml(set?.weight ?? '')}">
    <input inputmode="numeric" autocomplete="off" pattern="[0-9]*" placeholder="tekrar" id="rp-${exercise.id}-${setNumber}" value="${escapeHtml(set?.reps ?? '')}">
    <input inputmode="numeric" autocomplete="off" pattern="[0-9]*" placeholder="RIR" id="ri-${exercise.id}-${setNumber}" value="${escapeHtml(set?.rir ?? '')}">
    <div class="set-actions">
      <button class="save-set" data-save-set="${exercise.id}:${setNumber}" aria-label="Set kaydet">${set ? '↻' : '✓'}</button>
      ${set ? `<button class="delete-set" data-delete-set="${exercise.id}:${setNumber}" aria-label="Set sil">×</button>` : ''}
    </div>
  </div>`;
}

function lastBlock(exerciseId) {
  const last = lastFor(exerciseId);
  if (!last) return '<div class="last empty">Geçen Antrenman: İlk kayıt</div>';
  const rows = last.sets.map(set => `<div>${escapeHtml(set.weight || '-')} kg × ${escapeHtml(set.reps || '-')} @ RIR ${escapeHtml(set.rir || '-')}</div>`).join('');
  return `<div class="last"><b>Geçen Antrenman</b><span>${new Date(last.session.startedAt).toLocaleDateString('tr-TR')}</span>${rows}</div>`;
}

let cachedSessions = [];

function lastFor(exerciseId) {
  for (let i = cachedSessions.length - 1; i >= 0; i -= 1) {
    const sets = cachedSessions[i].sets.filter(set => set.exerciseId === exerciseId);
    if (sets.length) return { session: cachedSessions[i], sets };
  }
  return null;
}

function progressionText(exerciseId) {
  const entries = [];
  for (let i = cachedSessions.length - 1; i >= 0 && entries.length < 2; i -= 1) {
    const sets = cachedSessions[i].sets.filter(set => set.exerciseId === exerciseId);
    if (sets.length) entries.push(sets);
  }
  if (entries.length < 2) return '';
  const current = aggregateByWeight(entries[0]);
  const previous = aggregateByWeight(entries[1]);
  const messages = [];
  Object.entries(current).forEach(([weight, reps]) => {
    if (previous[weight] !== undefined && reps > previous[weight]) messages.push(`${weight} kg toplam tekrar: ${previous[weight]} → ${reps}`);
  });
  return messages.length ? `<div class="progress-note">Progresyon: ${escapeHtml(messages.join(' • '))}</div>` : '';
}

function aggregateByWeight(sets) {
  return sets.reduce((acc, set) => {
    const weight = String(set.weight ?? '').trim();
    const reps = Number(set.reps);
    if (weight && Number.isFinite(reps)) acc[weight] = (acc[weight] || 0) + reps;
    return acc;
  }, {});
}

async function saveSet(exerciseId, setNumber) {
  const exercise = findExercise(exerciseId);
  const weight = document.querySelector(`#kg-${exerciseId}-${setNumber}`).value.trim().replace(',', '.');
  const reps = document.querySelector(`#rp-${exerciseId}-${setNumber}`).value.trim();
  const rir = document.querySelector(`#ri-${exerciseId}-${setNumber}`).value.trim();
  if (!weight && !reps) return toast('Kg veya tekrar gir');
  state.workout.sets[exerciseId] ??= {};
  const old = state.workout.sets[exerciseId][setNumber];
  state.workout.sets[exerciseId][setNumber] = {
    id: old?.id || uid(),
    sessionId: state.workout.id,
    exerciseId,
    exerciseName: exercise.name,
    setNumber,
    setType: exercise.setType,
    weight,
    reps,
    rir,
    completedAt: old?.completedAt || new Date().toISOString(),
    updatedAt: old ? new Date().toISOString() : null
  };
  await workoutRepository.saveDraft(state.workout);
  if (['working', 'core'].includes(exercise.setType)) await startTimer();
  await renderWorkout();
  toast(old ? 'Set güncellendi' : 'Set kaydedildi');
}

async function deleteSet(exerciseId, setNumber) {
  delete state.workout.sets[exerciseId]?.[setNumber];
  if (!Object.keys(state.workout.sets[exerciseId] || {}).length) delete state.workout.sets[exerciseId];
  await workoutRepository.saveDraft(state.workout);
  await renderWorkout();
  toast('Set silindi');
}

async function toggleActivity(exerciseId) {
  if (state.workout.completedActivities[exerciseId]) delete state.workout.completedActivities[exerciseId];
  else state.workout.completedActivities[exerciseId] = new Date().toISOString();
  await workoutRepository.saveDraft(state.workout);
  await renderWorkout();
}

async function startTimer() {
  stopTimer(false);
  const settings = await workoutRepository.getSettings();
  state.timerLeft = settings.rest || 90;
  state.timer = setInterval(() => {
    state.timerLeft -= 1;
    const el = document.querySelector('#timerText');
    if (el) el.textContent = fmt(state.timerLeft);
    if (state.timerLeft <= 0) {
      stopTimer(false);
      toast('Dinlenme tamam');
      renderWorkout();
    }
  }, 1000);
}

async function resetTimer() {
  await startTimer();
  await renderWorkout();
}

function stopTimer(rerender = true) {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  state.timerLeft = 0;
  if (rerender && state.workout) renderWorkout();
}

function fmt(seconds) {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

async function finishWorkout(force = false) {
  const counts = workoutCounts(state.workout);
  if (!force && counts.done < counts.total) {
    app.insertAdjacentHTML('afterbegin', `<div class="finish-warning">
      <b>Eksik hareket var</b><span>${counts.total - counts.done} hareket/blok tamamlanmamış görünüyor.</span>
      <button class="secondary-btn" data-action="render-workout">Devam Et</button>
      <button class="primary-btn" data-action="force-finish">Yine de Bitir</button>
    </div>`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  const session = buildSession(state.workout);
  session.summary = sessionSummary(session);
  await workoutRepository.addSession(session);
  await workoutRepository.clearDraft();
  cachedSessions = await workoutRepository.getSessions();
  stopTimer(false);
  state.workout = null;
  renderSummary(session);
}

function buildSession(workout) {
  return {
    id: workout.id,
    programId: workout.programId,
    workoutDayId: workout.workoutDayId,
    startedAt: workout.startedAt,
    completedAt: new Date().toISOString(),
    status: 'completed',
    completedActivities: Object.keys(workout.completedActivities || {}),
    sets: Object.values(workout.sets).flatMap(group => Object.values(group)).sort((a, b) => a.completedAt.localeCompare(b.completedAt))
  };
}

function sessionSummary(session) {
  const durationMin = Math.max(0, Math.round((new Date(session.completedAt) - new Date(session.startedAt)) / 60000));
  const setCount = session.sets.length;
  const completedExercises = new Set(session.sets.map(set => set.exerciseId)).size + (session.completedActivities?.length || 0);
  const volume = session.sets.reduce((sum, set) => {
    const weight = Number(set.weight);
    const reps = Number(set.reps);
    return Number.isFinite(weight) && Number.isFinite(reps) ? sum + weight * reps : sum;
  }, 0);
  return { durationMin, setCount, completedExercises, volume };
}

function renderSummary(session) {
  title.textContent = 'Özet';
  const s = session.summary || sessionSummary(session);
  app.innerHTML = `<section class="summary-card finish-summary">
    <h2>Antrenman Kaydedildi</h2>
    <div class="metric-grid">
      <div><b>${s.durationMin}</b><span>dk</span></div>
      <div><b>${s.completedExercises}</b><span>hareket</span></div>
      <div><b>${s.setCount}</b><span>set</span></div>
      <div><b>${Math.round(s.volume)}</b><span>kg × tekrar</span></div>
    </div>
    <button class="primary-btn full" data-action="history">Geçmişe Git</button>
  </section>`;
  nav('');
}

async function historyView() {
  state.view = 'history';
  title.textContent = 'Geçmiş';
  cachedSessions = await workoutRepository.getSessions();
  const sessions = [...cachedSessions].reverse();
  app.innerHTML = `
    <section class="history-tabs">
      <button class="tab-btn active" data-action="history">Antrenmanlar</button>
      <button class="tab-btn" data-action="exercise-history">Hareketler</button>
    </section>
    ${sessions.length ? sessions.map(sessionCard).join('') : '<div class="summary-card">Henüz kayıt yok.</div>'}`;
  nav('history');
}

function sessionCard(session) {
  const day = findWorkoutDay(session.programId, session.workoutDayId);
  const summary = session.summary || sessionSummary(session);
  const grouped = Object.groupBy ? Object.groupBy(session.sets, set => set.exerciseId) : groupBy(session.sets, set => set.exerciseId);
  return `<article class="history-card">
    <div class="history-head">
      <div><h3>${escapeHtml(day?.label || session.workoutDayId)}</h3><div class="sub">${new Date(session.startedAt).toLocaleString('tr-TR')} • ${summary.durationMin} dk</div></div>
      <button class="danger-btn small-btn" data-delete-session="${session.id}">Sil</button>
    </div>
    <div class="history-metrics">${summary.completedExercises} hareket • ${summary.setCount} set • ${Math.round(summary.volume)} kg × tekrar</div>
    <div class="session-lines">${Object.entries(grouped).map(([exerciseId, sets]) => `<p><b>${escapeHtml(findExercise(exerciseId)?.name || sets[0]?.exerciseName || exerciseId)}</b><br>${sets.map(set => `${escapeHtml(set.weight || '-')} kg × ${escapeHtml(set.reps || '-')} @ RIR ${escapeHtml(set.rir || '-')}`).join('<br>')}</p>`).join('')}</div>
  </article>`;
}

function groupBy(items, fn) {
  return items.reduce((acc, item) => {
    const key = fn(item);
    acc[key] ||= [];
    acc[key].push(item);
    return acc;
  }, {});
}

async function deleteSession(sessionId) {
  if (!confirm('Bu antrenman geçmişten silinsin mi?')) return;
  await workoutRepository.deleteSession(sessionId);
  await historyView();
  toast('Antrenman silindi');
}

async function exerciseHistory(selected = '') {
  state.view = 'history';
  title.textContent = 'Hareket Geçmişi';
  cachedSessions = await workoutRepository.getSessions();
  const exerciseIds = [...new Set(cachedSessions.flatMap(session => session.sets.map(set => set.exerciseId)))].sort();
  const chosen = selected || exerciseIds[0] || '';
  app.innerHTML = `
    <section class="history-tabs">
      <button class="tab-btn" data-action="history">Antrenmanlar</button>
      <button class="tab-btn active" data-action="exercise-history">Hareketler</button>
    </section>
    ${exerciseIds.length ? `<select class="exercise-select" id="exerciseSelect">${exerciseIds.map(id => `<option value="${id}" ${id === chosen ? 'selected' : ''}>${escapeHtml(findExercise(id)?.name || id)}</option>`).join('')}</select>${exerciseRows(chosen)}` : '<div class="summary-card">Henüz hareket kaydı yok.</div>'}`;
  nav('history');
}

function exerciseRows(exerciseId) {
  const rows = cachedSessions.flatMap(session => session.sets.filter(set => set.exerciseId === exerciseId).map(set => ({ session, set })));
  if (!rows.length) return '<div class="summary-card">Bu hareket için kayıt yok.</div>';
  return `<div class="history-card"><h3>${escapeHtml(findExercise(exerciseId)?.name || exerciseId)}</h3><div class="table-wrap"><table>
    <thead><tr><th>Tarih</th><th>Kg</th><th>Tekrar</th><th>RIR</th></tr></thead>
    <tbody>${rows.map(row => `<tr><td>${new Date(row.session.startedAt).toLocaleDateString('tr-TR')}</td><td>${escapeHtml(row.set.weight || '-')}</td><td>${escapeHtml(row.set.reps || '-')}</td><td>${escapeHtml(row.set.rir || '-')}</td></tr>`).join('')}</tbody>
  </table></div></div>`;
}

async function backup() {
  state.view = 'backup';
  title.textContent = 'Yedek';
  const settings = await workoutRepository.getSettings();
  app.innerHTML = `<section class="backup-card">
    <h3>Verilerini koru</h3>
    <p class="muted">Kayıtlar bu cihazdaki IndexedDB alanında saklanır. JSON tam yedek, CSV set log çıktısıdır.</p>
    <button class="primary-btn full" data-action="export-json">JSON Yedeği İndir</button>
    <button class="secondary-btn full" data-action="export-csv">CSV Log İndir</button>
  </section>
  <section class="backup-card">
    <h3>Geri yükle</h3>
    <input type="file" id="restoreFile" accept="application/json">
    <button class="secondary-btn full" data-action="restore-json">JSON'dan Geri Yükle</button>
  </section>
  <section class="backup-card">
    <h3>Dinlenme sayacı</h3>
    <label class="setting-row">Saniye <input id="restSetting" inputmode="numeric" type="number" min="15" step="5" value="${settings.rest || 90}"></label>
    <button class="secondary-btn" data-action="save-settings">Kaydet</button>
  </section>`;
  nav('backup');
}

async function saveSettings() {
  await workoutRepository.saveSettings({ rest: Number(document.querySelector('#restSetting').value) || 90 });
  toast('Ayar kaydedildi');
}

function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 500);
}

async function exportJSON() {
  download(`a2-yedek-${dateKey()}.json`, JSON.stringify(await workoutRepository.exportBackup(), null, 2), 'application/json');
}

async function exportCSV() {
  const data = await workoutRepository.getData();
  download(`a2-log-${dateKey()}.csv`, buildCsv(data), 'text/csv;charset=utf-8');
}

function buildCsv(data) {
  const rows = [['SessionId', 'ProgramId', 'WorkoutDayId', 'Tarih', 'Saat', 'HareketId', 'Hareket', 'Set', 'SetType', 'Kg', 'Tekrar', 'RIR', 'SetKayitZamani']];
  data.sessions.forEach(session => {
    session.sets.forEach(set => rows.push([
      session.id,
      session.programId,
      session.workoutDayId,
      new Date(session.startedAt).toLocaleDateString('tr-TR'),
      new Date(session.startedAt).toLocaleTimeString('tr-TR'),
      set.exerciseId,
      findExercise(set.exerciseId)?.name || set.exerciseName || set.exerciseId,
      set.setNumber,
      set.setType,
      set.weight,
      set.reps,
      set.rir,
      set.completedAt
    ]));
  });
  return rows.map(row => row.map(v => `"${String(v ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
}

async function restoreJSON() {
  const file = document.querySelector('#restoreFile').files[0];
  if (!file) return toast('Dosya seç');
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.sessions)) throw new Error('Invalid backup');
      await workoutRepository.replaceData(parsed);
      cachedSessions = await workoutRepository.getSessions();
      toast('Yedek geri yüklendi');
      await historyView();
    } catch {
      toast('Geçersiz JSON');
    }
  };
  reader.readAsText(file);
}

function dateKey() {
  return new Date().toISOString().slice(0, 10);
}

app.addEventListener('click', async event => {
  const target = event.target.closest('button');
  if (!target) return;
  if (target.dataset.startDay) return startWorkout(target.dataset.startDay);
  if (target.dataset.saveSet) {
    const [exerciseId, setNumber] = target.dataset.saveSet.split(':');
    return saveSet(exerciseId, Number(setNumber));
  }
  if (target.dataset.deleteSet) {
    const [exerciseId, setNumber] = target.dataset.deleteSet.split(':');
    return deleteSet(exerciseId, Number(setNumber));
  }
  if (target.dataset.toggleActivity) return toggleActivity(target.dataset.toggleActivity);
  if (target.dataset.deleteSession) return deleteSession(target.dataset.deleteSession);
  const action = target.dataset.action;
  if (action === 'resume') return resumeWorkout();
  if (action === 'home') return home();
  if (action === 'render-workout') return renderWorkout();
  if (action === 'finish') return finishWorkout();
  if (action === 'force-finish') return finishWorkout(true);
  if (action === 'timer-reset') return resetTimer();
  if (action === 'timer-stop') return stopTimer();
  if (action === 'history') return historyView();
  if (action === 'exercise-history') return exerciseHistory();
  if (action === 'export-json') return exportJSON();
  if (action === 'export-csv') return exportCSV();
  if (action === 'restore-json') return restoreJSON();
  if (action === 'save-settings') return saveSettings();
});

app.addEventListener('change', event => {
  if (event.target.id === 'exerciseSelect') exerciseHistory(event.target.value);
});

document.querySelectorAll('.nav-btn').forEach(button => {
  button.addEventListener('click', () => ({ home, history: historyView, backup }[button.dataset.nav]()));
});
document.querySelector('#historyBtn').addEventListener('click', historyView);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

init();

async function init() {
  try {
    await workoutRepository.init();
    cachedSessions = await workoutRepository.getSessions();
    await home();
    window.__a2 = { repository: workoutRepository, schemaVersion: SCHEMA_VERSION, buildCsv };
  } catch (error) {
    app.innerHTML = '<section class="summary-card">Uygulama başlatılamadı. Sayfayı yenileyin.</section>';
    console.error(error);
  }
}
