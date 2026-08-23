import { A2_PROGRAM, findExercise, findWorkoutDay, exercisesForDay } from './data/public-programs.js';
import { SCHEMA_VERSION, workoutRepository } from './storage.js';
import { browseExercises, getCanonicalExercise, loadExerciseDatabase, searchExercises } from './exercise-service.js';
import { blankDay, blankExercise, blankInstruction, blankProgram, blankSection, normalizeProgram, permanentDayToLegacy, validateProgram } from './program-service.js';
import { finalizeImport, matchImportExercises, validateImportPreview } from './import-service.js';
import { createYouTubeSearchService } from './youtube-service.js';
import { documentExtractor } from './document-extractor.js';
import { localImportParser } from './local-import-parser.js';
import { getImportParser, IMPORT_PARSER_PROVIDER } from './import-provider.js';
import { openAIImportParser } from './openai-import-parser.js';
import { authService } from './auth-service.js';
import { createSyncService } from './sync-service.js';

const app = document.querySelector('#app');
const title = document.querySelector('#pageTitle');
let state = { view: 'home', workout: null, timer: null, timerLeft: 0, executionDay: null, executionExercises: new Map(), builder: null, picker: null, video: null, user: null, syncStatus: 'saved', installPrompt: null, onboarding: null, authMode: 'login', authBusy: false };
const youtube = createYouTubeSearchService(workoutRepository);
const sync = createSyncService(workoutRepository, status => { state.syncStatus = status; const indicator = document.querySelector('#syncStatus'); if (indicator) indicator.textContent = syncLabel(status); });

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
  const planned = executionExercisesFor(workout);
  const completedStrength = planned.filter(ex => ['warmup', 'working', 'core'].includes(ex.setType) && Object.values(workout.sets[ex.id] || {}).length).length;
  const completedActivities = Object.keys(workout.completedActivities || {}).length;
  return { total: planned.length, done: completedStrength + completedActivities };
}

function executionDayFor(workout) { return state.executionDay || findWorkoutDay(workout.programId, workout.workoutDayId); }
function executionExercisesFor(workout) { return state.executionDay ? state.executionDay.sections.flatMap(section => section.exercises.map(item => ({ ...item, sectionType: section.type }))) : exercisesForDay(workout.programId, workout.workoutDayId); }
function executionExercise(exerciseId) { return state.executionExercises.get(exerciseId) || findExercise(exerciseId); }

async function home() {
  return programsView();
}

async function programsView() {
  state.view = 'programs'; state.workout = null; state.executionDay = null; title.textContent = 'Programlar';
  const programs = await workoutRepository.getPrograms();
  const draft = await workoutRepository.getProgramBuilderDraft();
  const imports = (await workoutRepository.getData()).importPreviews;
  app.innerHTML = `
    ${draft ? `<section class="resume-card"><div><b>Taslak program</b><span>${escapeHtml(draft.name || 'İsimsiz program')}</span></div><button class="primary-btn" data-action="resume-builder">Sürdür</button></section>` : ''}
    <section class="sync-status" id="syncStatus">${syncLabel(state.syncStatus)}</section>
    <section class="create-program-actions"><button class="primary-btn" data-action="new-program">+ Elle Program Oluştur</button><button class="secondary-btn" data-action="file-import">+ Dosyadan Program Oluştur</button></section>
    ${Object.values(imports).length ? `<section class="resume-card"><div><b>Yarım kalan dosya aktarımı</b><span>${escapeHtml(Object.values(imports)[0].source.fileName)}</span></div><button class="primary-btn" data-resume-import="${Object.values(imports)[0].importId}">Sürdür</button></section>` : ''}
    ${programs.length ? programs.map(program => `<article class="program-card"><div><b>${escapeHtml(program.name)}</b><span>${program.days.length} gün · ${escapeHtml(program.sourceType)}</span></div><div class="compact-actions"><button class="secondary-btn" data-edit-program="${program.id}">Düzenle</button><button class="primary-btn" data-open-program="${program.id}">Aç</button></div></article>`).join('') : '<div class="summary-card muted">Henüz programınız yok.</div>'}`;
  nav('programs');
}

function syncLabel(status) { return ({ saved: 'Kaydedildi', syncing: 'Senkronize ediliyor...', offline: 'Çevrimdışı — sonra senkronize edilecek', pending: 'Senkronizasyon bekliyor' })[status] || 'Kaydedildi'; }

function welcomeView() {
  state.view = 'welcome'; state.onboarding = null; title.textContent = 'AKS'; nav('');
  app.innerHTML = `<section class="onboarding-screen welcome-screen"><div class="onboarding-mark">AKS</div><h2>AKS'ye hoş geldin</h2><p class="muted">Programını oluştur, antrenmanını takip et ve gelişimini hatırla. Hazır programını PDF, Word veya Excel'den de aktarabilirsin.</p><button class="primary-btn full" data-action="onboarding-start">Başla</button><button class="text-btn full" data-action="returning-login">Zaten hesabım var</button></section>`;
}

const onboardingSteps = [
  { key: 'goal', title: 'Şu anki hedefin ne?', options: [['muscle','Kas kazanmak'],['strength','Güçlenmek'],['fat-loss','Yağ kaybetmek'],['fitness','Genel fitness'],['performance','Performansımı artırmak'],['tracking','Sadece antrenmanlarımı takip etmek']] },
  { key: 'experience', title: 'Antrenman deneyimin nasıl?', options: [['new','Yeni başlıyorum'],['beginner','Başlangıç'],['intermediate','Orta'],['advanced','İleri']] },
  { key: 'age', title: 'Kaç yaşındasın?', input: 'number', placeholder: 'Yaş', optional: true },
  { key: 'gender', title: 'Cinsiyetini nasıl belirtmek istersin?', options: [['male','Erkek'],['female','Kadın'],['unspecified','Belirtmek istemiyorum']], optional: true },
  { key: 'height', title: 'Boyun kaç?', input: 'number', placeholder: 'cm', optional: true },
  { key: 'weight', title: 'Kilon kaç?', input: 'number', placeholder: 'kg', step: '0.1', optional: true },
  { key: 'weeklyFrequency', title: 'Haftada kaç gün antrenman yapıyorsun?', options: Array.from({ length: 7 }, (_, i) => [String(i + 1), `${i + 1} gün`]), optional: true }
];

function onboardingView() {
  const index = state.onboarding.step; const step = onboardingSteps[index]; state.view = 'onboarding'; title.textContent = 'AKS'; nav('');
  const selected = state.onboarding[step.key]; const progress = `${index + 1} / ${onboardingSteps.length}`;
  const body = step.options ? `<div class="choice-grid">${step.options.map(([value, label]) => `<button class="choice-card ${selected === value ? 'selected' : ''}" data-onboarding-value="${step.key}:${value}">${label}</button>`).join('')}</div>` : `<label class="onboarding-input"><span>${step.placeholder}</span><input id="onboardingInput" type="${step.input}" inputmode="decimal" step="${step.step || '1'}" value="${escapeHtml(selected || '')}" placeholder="${step.placeholder}"></label>`;
  app.innerHTML = `<section class="onboarding-screen"><div class="progress-label">${progress}</div><div class="progress"><div style="width:${((index + 1) / onboardingSteps.length) * 100}%"></div></div><h2>${step.title}</h2>${step.optional ? '<p class="small muted">Bu bilgi isteğe bağlı.</p>' : ''}${body}<div class="onboarding-actions"><button class="secondary-btn" data-action="onboarding-back">Geri</button>${step.optional ? '<button class="text-btn" data-action="onboarding-skip">Atla</button>' : ''}<button class="primary-btn" data-action="onboarding-next" ${step.options && !selected ? 'disabled' : ''}>Devam et</button></div></section>`;
}

function authView(message = '', mode = state.authMode) {
  state.view = 'auth'; state.authMode = mode; title.textContent = mode === 'register' ? 'Hesap oluştur' : 'Giriş yap'; nav('');
  app.innerHTML = `<section class="onboarding-screen auth-card"><div class="progress-label">Hesap</div><h2>${mode === 'register' ? 'Hesabını oluştur' : 'Tekrar hoş geldin'}</h2><div class="social-stack"><button class="secondary-btn full" data-oauth-provider="apple">Apple ile devam et</button><button class="secondary-btn full" data-oauth-provider="google">Google ile devam et</button><button class="secondary-btn full" data-provider-disabled>Facebook ile devam et</button><p class="or-divider">veya</p></div>${message ? `<p class="field-error" role="alert">${escapeHtml(message)}</p>` : ''}<label>E-posta<input id="authEmail" type="email" autocomplete="email" inputmode="email"></label><label>Şifre<div class="password-field"><input id="authPassword" type="password" autocomplete="${mode === 'register' ? 'new-password' : 'current-password'}" minlength="8"><button type="button" data-toggle-password aria-label="Şifreyi göster">Göster</button></div><span class="field-help">Şifren en az 8 karakter olmalı.</span></label><div class="builder-actions"><button class="secondary-btn" data-action="auth-back">Geri</button><button class="primary-btn" data-action="${mode}">${mode === 'register' ? 'Hesap oluştur' : 'Giriş yap'}</button></div></section>`;
}

function firstProgramView() {
  title.textContent = 'İlk programın'; nav('programs');
  app.innerHTML = `<section class="onboarding-screen"><h2>İlk programını oluştur</h2><p class="muted">Hazır programını aktar veya kendin oluşturmaya başla.</p><button class="primary-btn full" data-action="file-import">Program dosyamı yükle</button><p class="small muted center">PDF, Word veya Excel</p><button class="secondary-btn full" data-action="new-program">Kendim oluşturacağım</button><button class="text-btn full" data-action="programs">Daha sonra</button></section>`;
}

async function completeAuth(user, isNew = false) {
  state.user = user; await workoutRepository.setActiveAccount(user.id); await workoutRepository.init(); await sync.start(user); cachedSessions = await workoutRepository.getSessions();
  if (isNew && state.onboarding) { await workoutRepository.saveSettings({ profile: { goal: state.onboarding.goal || null, experience: state.onboarding.experience || null, age: state.onboarding.age || null, gender: state.onboarding.gender || null, height: state.onboarding.height || null, weight: state.onboarding.weight || null, weeklyFrequency: state.onboarding.weeklyFrequency || null } }); }
  const accountData = await workoutRepository.getData();
  const accountHasContent = Boolean(accountData.programs.length || accountData.sessions.length || accountData.draft || Object.keys(accountData.importPreviews).length);
  if (isNew) return firstProgramView();
  if (!accountHasContent && await workoutRepository.hasLegacyDeviceData()) return legacyMigrationView();
  return programsView();
}

async function submitAuth(mode) {
  if (state.authBusy) return; const email = document.querySelector('#authEmail')?.value.trim() || ''; const password = document.querySelector('#authPassword')?.value || '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return authView('E-posta adresini kontrol et.', mode);
  if (password.length < 8) return authView('Şifre en az 8 karakter olmalı.', mode);
  state.authBusy = true; const button = document.querySelector(`[data-action="${mode}"]`); if (button) { button.disabled = true; button.textContent = mode === 'register' ? 'Hesap oluşturuluyor...' : 'Giriş yapılıyor...'; }
  try { const result = mode === 'register' ? await authService.register(email, password) : await authService.login(email, password); await completeAuth(result.user, mode === 'register'); }
  catch (error) { const code = error.code; const message = code === 'AUTH_INVALID_EMAIL' ? 'E-posta adresini kontrol et.' : code === 'AUTH_PASSWORD_TOO_SHORT' ? 'Şifre en az 8 karakter olmalı.' : code === 'AUTH_EMAIL_IN_USE' ? 'Bu e-posta ile zaten bir hesap var. Giriş yap' : code === 'AUTH_INVALID_CREDENTIALS' ? 'E-posta veya şifre hatalı.' : error instanceof TypeError || !navigator.onLine ? 'İnternet bağlantını kontrol edip tekrar dene.' : code?.startsWith('AUTH_') ? 'Şu anda hesabını oluşturamıyoruz. Biraz sonra tekrar dene.' : 'Hesap oluşturulamadı. Tekrar deneyebilirsin.'; authView(message, mode); }
  finally { state.authBusy = false; }
}

function legacyMigrationView() { title.textContent = 'Mevcut Veriler'; nav('account'); app.innerHTML = `<section class="summary-card"><h2>Bu cihazda mevcut antrenman verileri bulundu.</h2><p class="muted">Veriler silinmez. İsterseniz bu hesabınıza aktarılır.</p><div class="builder-actions"><button class="secondary-btn" data-action="skip-legacy">Şimdilik Atla</button><button class="primary-btn" data-action="migrate-legacy">Bu verileri hesabıma aktar</button></div></section>`; }

async function accountView() { title.textContent = 'Hesabım'; nav('account'); const legacy = await workoutRepository.hasLegacyDeviceData(); const installed = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone; app.innerHTML = `<section class="summary-card"><h3>${escapeHtml(state.user?.email || '')}</h3><p id="syncStatus" class="muted">${syncLabel(state.syncStatus)}</p>${!installed ? `<button class="primary-btn full" data-action="install-app">AKS'yi Yükle</button><p class="small muted" id="installHelp" hidden>Safari'de Paylaş düğmesine dokunun → Ana Ekrana Ekle</p>` : ''}<button class="secondary-btn full" data-action="export-csv">CSV Log İndir</button><details><summary>Gelişmiş</summary>${legacy ? `<button class="secondary-btn full" data-action="migrate-legacy">Bu cihazdaki eski verileri içe aktar</button>` : ''}<button class="secondary-btn full" data-action="export-json">Veriyi Dışa Aktar</button><input type="file" id="restoreFile" accept="application/json"><button class="secondary-btn full" data-action="restore-json">JSON'dan Geri Yükle</button></details><button class="secondary-btn full" data-action="logout">Çıkış Yap</button><button class="danger-btn full" data-action="delete-account">Hesabımı Sil</button></section>`; }

function fileImportView() {
  state.view = 'import'; title.textContent = 'Dosyadan Oluştur'; nav('programs');
  app.innerHTML = `<section class="summary-card import-upload"><h3>Antrenman programı dosyanızı yükleyin</h3><p class="muted">PDF, Word veya Excel</p><p class="small muted">Yapay zekâ analizi seçildiğinde dosyadan çıkarılan program içeriği analiz için OpenAI'ye gönderilir. Dosyanın kendisi gönderilmez.</p><input id="importFile" type="file" accept=".pdf,.docx,.xlsx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"><div id="importStatus" class="small muted"></div><button class="secondary-btn full" data-action="programs">Geri</button></section>`;
}

async function importFile(file) {
  const status = document.querySelector('#importStatus');
  try {
    status.textContent = `${file.name} hazırlanıyor...`;
    const normalized = await documentExtractor.extract(file);
    state.pendingNormalizedDocument = normalized; state.pendingImportId = uid();
    await workoutRepository.saveImportPreview({ schemaVersion: '1.1', importId: state.pendingImportId, importedAt: new Date().toISOString(), source: { fileName: normalized.fileName, fileType: normalized.fileType, language: normalized.language, documentTitle: null }, program: { id: null, name: normalized.fileName.replace(/\.[^.]+$/, ''), description: null, sourceType: `${normalized.fileType}-import`, notes: null, days: [] }, warnings: [], unparsedContent: [], normalizedDocument: normalized, parserStatus: 'pending' });
    status.textContent = IMPORT_PARSER_PROVIDER === 'openai' ? 'Program yapay zekâ ile analiz ediliyor...' : 'Program yapısı çıkarılıyor...';
    const preview = await parseNormalizedDocument(IMPORT_PARSER_PROVIDER);
    preview.normalizedDocument = normalized;
    await workoutRepository.saveImportPreview(preview);
    await renderImportPreview(preview.importId);
  } catch (error) {
    console.error(error);
    if (IMPORT_PARSER_PROVIDER === 'openai' && state.pendingNormalizedDocument) status.innerHTML = `${escapeHtml(importErrorMessage(error.code || 'OPENAI_REQUEST_FAILED'))}<br><button class="secondary-btn" data-action="retry-openai">Tekrar Dene</button><button class="primary-btn" data-action="fallback-local">Yerel Ayrıştırıcı ile Devam Et</button>`;
    else status.textContent = importErrorMessage(error.code || 'PARSER_FAILURE');
  }
}

async function parseNormalizedDocument(provider) {
  const preview = await getImportParser(provider).parse(state.pendingNormalizedDocument, { importId: state.pendingImportId });
  preview.importId = state.pendingImportId; preview.normalizedDocument = state.pendingNormalizedDocument; preview.parserProvider = provider; delete preview.parserStatus;
  return matchImportExercises(preview);
}

async function resumePendingImport(provider) {
  try { const preview = await parseNormalizedDocument(provider); await workoutRepository.saveImportPreview(preview); await renderImportPreview(preview.importId); }
  catch (error) { console.error(error); toast(importErrorMessage(error.code || 'OPENAI_REQUEST_FAILED')); }
}

async function resumeImport(importId) {
  const preview = await workoutRepository.getImportPreview(importId);
  if (preview?.parserStatus === 'pending' && preview.normalizedDocument) { state.pendingImportId = importId; state.pendingNormalizedDocument = preview.normalizedDocument; fileImportView(); const status = document.querySelector('#importStatus'); status.innerHTML = `Aktarım yeniden başlatılmaya hazır.<br><button class="primary-btn" data-action="retry-openai">Yapay zekâ ile dene</button><button class="secondary-btn" data-action="fallback-local">Yerel Ayrıştırıcı ile Devam Et</button>`; return; }
  return renderImportPreview(importId);
}

async function renderImportPreview(importId) {
  const preview = await workoutRepository.getImportPreview(importId); if (!preview) return programsView();
  state.importId = importId; state.view = 'import-preview'; title.textContent = 'Aktarım Önizlemesi'; nav('programs');
  const errors = validateImportPreview(preview, new Set((await loadExerciseDatabase()).map(item => item.id)));
  app.innerHTML = `<section class="builder-head"><input data-import-program-name value="${escapeHtml(preview.program.name)}" aria-label="Program adı"><div class="small muted">${escapeHtml(preview.source.fileName)} · ${escapeHtml(preview.source.fileType.toUpperCase())}</div></section>
    ${preview.warnings.map(warning => `<div class="import-warning ${warning.severity}"><b>${escapeHtml(warning.severity)}</b> ${escapeHtml(warning.message)}</div>`).join('')}
    ${preview.program.days.map((day, dayIndex) => importDay(preview, day, dayIndex)).join('')}
    <section class="summary-card"><h3>Dosyadan Anlaşılamayan İçerikler</h3>${preview.unparsedContent.length ? preview.unparsedContent.map((item, index) => `<div class="unparsed"><b>${escapeHtml(item.text)}</b><span>${escapeHtml(item.reason)}</span><div><button data-unparsed="${index}:instruction">Talimat</button><button data-unparsed="${index}:note">Nota ekle</button><button data-unparsed="${index}:dismissed">Yok say</button></div></div>`).join('') : '<div class="muted small">Yok</div>'}</section>
    ${errors.length ? `<div class="import-warning error">Çözüm bekleyen kayıtlar var: ${escapeHtml(errors.join(', '))}</div>` : ''}
    <div class="workout-toolbar"><button class="secondary-btn" data-action="programs">Sonra Devam Et</button><button class="primary-btn" data-action="finalize-import">Programı Oluştur</button></div>`;
}

function importDay(preview, day, dayIndex) { return `<article class="builder-day import-day"><input data-import-day="${dayIndex}" value="${escapeHtml(day.name)}" aria-label="Gün adı">${day.sections.map((section, sectionIndex) => `<section class="builder-section"><div class="builder-row"><input data-import-section="${dayIndex}:${sectionIndex}" value="${escapeHtml(section.title)}"><select data-import-section-type="${dayIndex}:${sectionIndex}">${['warmup','activation','strength','core','cardio','stretch','mobility','cooldown','custom'].map(type => `<option value="${type}" ${section.sectionType === type ? 'selected' : ''}>${sectionLabel(type)}</option>`).join('')}</select></div>${section.items.map((item, itemIndex) => item.itemType === 'instruction' ? `<div class="instruction-row">${escapeHtml(item.text)}</div>` : importExercise(dayIndex, sectionIndex, itemIndex, item)).join('')}</section>`).join('')}</article>`; }
function importExercise(dayIndex, sectionIndex, itemIndex, item) { const p = item.prescription; const match = item.exerciseMatch; const status = item.resolutionStatus === 'accepted-canonical' ? 'Eşleşti' : match ? 'Kontrol gerekli' : 'Eşleşmedi'; const field = (label, key, value) => `<label>${label}<input data-import-field="${dayIndex}:${sectionIndex}:${itemIndex}:${key}" value="${escapeHtml(value || '')}"></label>`; return `<article class="builder-exercise import-exercise"><div class="match-status ${item.resolutionStatus === 'accepted-canonical' ? 'matched' : 'probable'}">${status}</div><b>${escapeHtml(item.sourceExerciseName)}</b><div class="small muted">${escapeHtml(match?.matchedName || item.normalizedExerciseName)}</div><div class="compact-fields"><label>Set<input data-import-field="${dayIndex}:${sectionIndex}:${itemIndex}:setsText" value="${escapeHtml(p.setsText || p.sets || '')}"></label><label>Tekrar<input data-import-field="${dayIndex}:${sectionIndex}:${itemIndex}:repsText" value="${escapeHtml(p.repsText || '')}"></label><button data-import-custom="${dayIndex}:${sectionIndex}:${itemIndex}">Özel Kullan</button></div><div class="details open"><div class="detail-grid">${field('Kilo','weightText',p.weightText)}${field('RIR','rirText',p.rirText)}${field('RPE','rpeText',p.rpeText)}${field('Dinlenme','restText',p.restText)}${field('Tempo','tempoText',p.tempoText)}${field('Süre','durationText',p.durationText)}${field('Mesafe','distanceText',p.distanceText)}${field('Not','notes',item.notes)}</div></div><input data-import-search="${dayIndex}:${sectionIndex}:${itemIndex}" placeholder="Başka hareket ara"><div class="search-results" id="import-search-${dayIndex}-${sectionIndex}-${itemIndex}"></div></article>`; }

function importErrorMessage(code) { return ({ UNSUPPORTED_FILE: 'PDF, DOCX veya XLSX dosyası seçin.', EMPTY_DOCUMENT: 'Dosya boş.', SCAN_ONLY_PDF: 'Bu PDF metin içermiyor. OCR desteği henüz eklenmedi.', CORRUPT_PDF: 'PDF okunamadı.', CORRUPT_DOCX: 'Word dosyası okunamadı.', CORRUPT_XLSX: 'Excel dosyası okunamadı.', UNSUPPORTED_BROWSER_COMPRESSION: 'Bu tarayıcı DOCX/XLSX dosyalarını açmak için gereken sıkıştırma desteğine sahip değil.', OPENAI_OFFLINE: 'Yapay zekâ analizi için internet bağlantısı gerekiyor.', OPENAI_API_KEY_MISSING: 'Yapay zekâ analizi şu anda yapılandırılmadı.', OPENAI_RATE_LIMITED: 'Yapay zekâ analizi geçici olarak yoğun.', AI_IMPORT_RATE_LIMITED: 'Yapay zekâ aktarım limiti doldu. Biraz sonra tekrar deneyin.', OPENAI_TIMEOUT: 'Yapay zekâ analizi zaman aşımına uğradı.', OPENAI_REQUEST_FAILED: 'Program yapay zekâ ile analiz edilirken bir sorun oluştu.', DOCUMENT_TOO_LARGE: 'Dosya analiz için çok büyük.', PARSER_FAILURE: 'Dosya içeriğinden güvenli bir program oluşturulamadı.' })[code] || 'Dosya işlenemedi.'; }

async function openProgram(programId) {
  const program = await workoutRepository.getProgram(programId);
  if (!program) return toast('Program bulunamadı');
  const names = new Map((await loadExerciseDatabase()).map(item => [item.id, item.nameTr]));
  title.textContent = program.name;
  app.innerHTML = `<section class="summary-card"><b>${escapeHtml(program.name)}</b><div class="small muted">Bir günü başlatarak kayıt akışına geç.</div></section>${program.days.map(day => `<article class="day-card program-day"><div class="day">${escapeHtml(day.name)}</div>${day.sections.map(section => `<div class="program-section"><b>${escapeHtml(section.title)}</b>${section.items.filter(item => item.itemType === 'exercise').map(item => `<div class="program-exercise"><span>${escapeHtml(names.get(item.exerciseId) || item.customExerciseName || item.exerciseId)}</span><small>${escapeHtml(programPrescription(item))}</small></div>`).join('')}</div>`).join('')}<button class="primary-btn full" data-start-program-day="${program.id}:${day.id}">Başlat</button></article>`).join('')}`;
  state.openProgram = { program, names }; nav('programs');
}

function programPrescription(item) {
  const sets = item.setsText || item.sets || '';
  const reps = item.repsText || (item.repsMin != null ? `${item.repsMin}${item.repsMax != null && item.repsMax !== item.repsMin ? `-${item.repsMax}` : ''}` : '');
  return [sets, reps].filter(Boolean).join(' × ') || 'Serbest';
}

async function startProgramWorkout(programId, dayId) {
  const program = await workoutRepository.getProgram(programId); const day = program?.days.find(item => item.id === dayId);
  if (!day) return toast('Gün bulunamadı');
  const names = new Map((await loadExerciseDatabase()).map(item => [item.id, item.nameTr]));
  state.executionDay = permanentDayToLegacy(day, names); state.executionExercises = new Map(state.executionDay.sections.flatMap(section => section.exercises).map(item => [item.id, item]));
  const draft = await workoutRepository.getDraft();
  if (draft && !confirm('Devam eden antrenman silinip yeni antrenman başlatılsın mı?')) return;
  state.workout = { id: uid(), programId, workoutDayId: dayId, startedAt: new Date().toISOString(), status: 'active', completedActivities: {}, sets: {} };
  await workoutRepository.saveDraft(state.workout); await renderWorkout();
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
  const day = executionDayFor(workout);
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
    <div data-last="${exercise.id}">${lastBlock(exercise.canonicalExerciseId || exercise.id)}</div>
    ${progressionText(exercise.id)}
    <div class="labels"><span>Set</span><span>KG</span><span>Tekrar</span><span>RIR</span><span></span></div>
    ${rows}
    ${exercise.canonicalExerciseId ? '<button class="video-link" data-video-exercise="' + exercise.canonicalExerciseId + '">Form Videosu</button>' : ''}
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
  const exercise = executionExercise(exerciseId);
  const weight = document.querySelector(`#kg-${exerciseId}-${setNumber}`).value.trim().replace(',', '.');
  const reps = document.querySelector(`#rp-${exerciseId}-${setNumber}`).value.trim();
  const rir = document.querySelector(`#ri-${exerciseId}-${setNumber}`).value.trim();
  if (!weight && !reps) return toast('Kg veya tekrar gir');
  state.workout.sets[exerciseId] ??= {};
  const old = state.workout.sets[exerciseId][setNumber];
  state.workout.sets[exerciseId][setNumber] = {
    id: old?.id || uid(),
    sessionId: state.workout.id,
    exerciseId: exercise.canonicalExerciseId || exerciseId,
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

function blankDayWithMainSection(programId, order = 1) {
  const day = blankDay(programId, order);
  day.sections.push(blankSection(day.id, 'strength', 1));
  return day;
}

function ensureMainSection(day) {
  day.sections = Array.isArray(day.sections) ? day.sections : [];
  if (!day.sections.length) day.sections.push(blankSection(day.id, 'strength', 1));
  return day.sections[0];
}

async function openBuilder(program = null) {
  state.builder = program ? structuredClone(program) : (await workoutRepository.getProgramBuilderDraft()) || blankProgram();
  state.builder.days.forEach(ensureMainSection);
  renderBuilder();
}

async function persistBuilder() {
  state.builder.days.forEach(ensureMainSection);
  state.builder = normalizeProgram(state.builder);
  await workoutRepository.saveProgramBuilderDraft(state.builder);
}

function renderBuilder() {
  const program = state.builder; title.textContent = program.id ? 'Program Builder' : 'Program Oluştur'; nav('programs');
  app.innerHTML = `<section class="builder-head"><input id="builderName" placeholder="Program adı" value="${escapeHtml(program.name)}"><textarea id="builderDescription" placeholder="Açıklama (opsiyonel)">${escapeHtml(program.description || '')}</textarea><div class="builder-actions"><button class="secondary-btn" data-action="programs">İptal</button><button class="primary-btn" data-action="save-program">Programı Kaydet</button></div></section>
  ${program.days.map((day, dayIndex) => builderDay(day, dayIndex)).join('')}
  <button class="secondary-btn full" data-action="add-day">+ Gün Ekle</button>`;
}

function builderDay(day, dayIndex) {
  ensureMainSection(day);
  return `<article class="builder-day"><div class="builder-row"><input data-builder-day-name="${day.id}" value="${escapeHtml(day.name)}" aria-label="Gün adı"><div class="compact-actions"><button class="icon-action" data-copy-day="${day.id}" title="Günü kopyala">Kopyala</button><button class="icon-action" data-delete-day="${day.id}" title="Günü sil">Sil</button></div></div>
    <div class="order-actions"><button data-move-day="${dayIndex}:-1">Yukarı</button><button data-move-day="${dayIndex}:1">Aşağı</button></div>
    ${day.sections.map(section => builderSection(section)).join('')}</article>`;
}

function builderSection(section) {
  return `<section class="builder-section builder-section-hidden">
    ${section.items.map((item, itemIndex) => item.itemType === 'instruction' ? builderInstruction(item) : builderExercise(item, itemIndex)).join('')}
    <div class="builder-add"><input data-exercise-search="${section.id}" placeholder="Hareket ara veya yaz..."><button class="secondary-btn" data-open-picker="${section.id}">+ Hareket Ekle</button><button data-add-instruction="${section.id}">Talimat Ekle</button></div><div class="search-results" id="search-${section.id}"></div>
    ${state.picker?.sectionId === section.id ? builderExercisePicker(section) : ''}</section>`;
}

function builderExercisePicker(section) {
  const picker = state.picker;
  const muscleFilters = [['','Tümü'],['chest','Göğüs'],['back','Sırt'],['shoulders','Omuz'],['arms','Kol'],['legs','Bacak'],['core','Core']];
  const equipmentFilters = [['','Tüm ekipman'],['dumbbell','Dumbbell'],['barbell','Barbell'],['cable','Cable'],['machine','Machine'],['bodyweight','Bodyweight']];
  const result = (picker.results || []).map(item => `<button data-select-exercise="${section.id}:${item.id}"><b>${escapeHtml(item.nameTr)}</b><span>${escapeHtml(item.nameEn)} · ${(item.primaryMuscles || []).join(', ') || 'Diğer'} · ${(item.equipment || []).join(', ') || 'Diğer'}</span></button>`).join('');
  const custom = picker.query?.trim() ? `<button data-custom-exercise="${section.id}">"${escapeHtml(picker.query.trim())}" adlı özel hareket oluştur</button>` : '';
  return `<div class="exercise-picker" aria-label="Hareket seçici"><div class="builder-row"><b>Hareket Ekle</b><button data-close-picker>Kapalı</button></div><input data-exercise-search="${section.id}" value="${escapeHtml(picker.query || '')}" placeholder="Hareket ara veya yaz..." autocomplete="off"><div class="picker-filters" aria-label="Kas grubu filtresi">${muscleFilters.map(([value,label]) => `<button class="${picker.muscle === value ? 'active' : ''}" data-picker-muscle="${section.id}:${value}">${label}</button>`).join('')}</div><div class="picker-filters" aria-label="Ekipman filtresi">${equipmentFilters.map(([value,label]) => `<button class="${picker.equipment === value ? 'active' : ''}" data-picker-equipment="${section.id}:${value}">${label}</button>`).join('')}</div><div class="search-results" id="search-${section.id}">${result || '<span class="muted small">Bu filtrelerle hareket bulunamadı.</span>'}${custom}</div></div>`;
}

function builderInstruction(item) { return `<div class="instruction-row"><input data-instruction="${item.id}" value="${escapeHtml(item.text)}" placeholder="Talimat"><button data-delete-item="${item.id}">Sil</button></div>`; }
function builderExercise(item, itemIndex) {
  const name = item.customExerciseName || item.displayName || item.exerciseId || 'Hareket';
  return `<article class="builder-exercise"><div class="builder-row"><b>${escapeHtml(name)}</b><div class="compact-actions"><button data-copy-item="${item.id}">Kopyala</button><button data-delete-item="${item.id}">Sil</button></div></div>
    <div class="compact-fields"><label>Set<input data-field="${item.id}:setsText" inputmode="text" value="${escapeHtml(item.setsText ?? item.sets ?? '')}"></label><label>Tekrar<input data-field="${item.id}:repsText" inputmode="text" value="${escapeHtml(item.repsText ?? '')}"></label><button data-toggle-details="${item.id}">+ Ayrıntılar</button></div>
    <div class="details ${item.showDetails ? 'open' : ''}" id="details-${item.id}"><div class="detail-grid"><label>Kilo<input data-field="${item.id}:weightText" value="${escapeHtml(item.weightText ?? '')}"></label><label>RIR<input data-field="${item.id}:rirText" value="${escapeHtml(item.rirText ?? '')}"></label><label>RPE<input data-field="${item.id}:rpeText" value="${escapeHtml(item.rpeText ?? '')}"></label><label>Dinlenme<input data-field="${item.id}:restText" value="${escapeHtml(item.restText ?? '')}"></label><label>Tempo<input data-field="${item.id}:tempoText" value="${escapeHtml(item.tempoText ?? '')}"></label><label>Süre<input data-field="${item.id}:durationText" value="${escapeHtml(item.durationText ?? '')}"></label><label>Mesafe<input data-field="${item.id}:distanceText" value="${escapeHtml(item.distanceText ?? '')}"></label><label>Not<input data-field="${item.id}:notes" value="${escapeHtml(item.notes ?? '')}"></label></div><button data-add-individual-set="${item.id}">Hareket setlerini ayrı düzenle</button>${(item.individualSets || []).map(set => `<div class="individual-set"><span>${set.setNumber}</span><select data-set-field="${item.id}:${set.id}:setType"><option value="working">Çalışma</option><option value="warmup">Isınma</option><option value="backoff">Backoff</option><option value="drop">Drop</option><option value="custom">Özel</option></select><input data-set-field="${item.id}:${set.id}:repsText" placeholder="Tekrar" value="${escapeHtml(set.repsText || '')}"><input data-set-field="${item.id}:${set.id}:weightText" placeholder="Kilo" value="${escapeHtml(set.weightText || '')}"><input data-set-field="${item.id}:${set.id}:rpeText" placeholder="RPE" value="${escapeHtml(set.rpeText || '')}"><select data-set-field="${item.id}:${set.id}:weightUnit"><option value="">Birim</option><option value="kg" ${set.weightUnit === 'kg' ? 'selected' : ''}>kg</option><option value="lb" ${set.weightUnit === 'lb' ? 'selected' : ''}>lb</option></select><button data-delete-individual-set="${item.id}:${set.id}" aria-label="Seti sil">Sil</button></div>`).join('')}</div>
    <div class="order-actions"><button data-move-item="${item.id}:${itemIndex}:-1">Yukarı</button><button data-move-item="${item.id}:${itemIndex}:1">Aşağı</button></div></article>`;
}

function sectionLabel(type) { return ({warmup:'Isınma',activation:'Aktivasyon',strength:'Ana Antrenman',core:'Core',cardio:'Kardiyo',stretch:'Stretch',mobility:'Mobilite',cooldown:'Soğuma',custom:'Özel Bölüm'})[type]; }
function findBuilderItem(id) { for (const day of state.builder.days) for (const section of day.sections) { const item = section.items.find(value => value.id === id); if (item) return { day, section, item }; } return null; }
function reorder(items, index, direction) { const target = index + direction; if (target < 0 || target >= items.length) return; [items[index], items[target]] = [items[target], items[index]]; }

async function saveProgram() {
  state.builder.name = document.querySelector('#builderName').value.trim(); state.builder.description = document.querySelector('#builderDescription').value.trim() || null;
  const canonicalIds = new Set((await loadExerciseDatabase()).map(item => item.id)); const program = normalizeProgram(state.builder); const errors = validateProgram(program, canonicalIds);
  if (errors.length) return toast(errors[0] === 'NO_WORKOUT_DAYS' ? 'En az bir gün ekleyin' : 'Programda eksik veya geçersiz alan var');
  await workoutRepository.saveProgram(program); await workoutRepository.clearProgramBuilderDraft(); state.builder = null; toast('Program kaydedildi'); await programsView();
}

async function showVideo(exerciseId) {
  const exercise = await getCanonicalExercise(exerciseId); const result = await youtube.search(exercise);
  if (result.status !== 'ok') return toast(result.message);
  state.video = result; title.textContent = 'Form Videosu';
  app.innerHTML = `<section class="summary-card"><b>${escapeHtml(exercise.nameTr)}</b><div class="video-results">${result.videos.map(video => `<button class="video-result" data-open-video="${video.videoId}"><img src="${escapeHtml(video.thumbnailUrl)}" alt=""><span><b>${escapeHtml(video.title)}</b><small>${escapeHtml(video.channelTitle)}</small></span></button>`).join('')}</div><button class="secondary-btn full" data-action="render-workout">Antrenmana Dön</button></section>`;
}

function openVideo(videoId) { app.innerHTML = `<section class="video-player"><iframe src="https://www.youtube.com/embed/${encodeURIComponent(videoId)}" title="YouTube form videosu" allowfullscreen></iframe><button class="secondary-btn full" data-action="render-workout">Antrenmana Dön</button></section>`; }

app.addEventListener('click', async event => {
  const target = event.target.closest('button');
  if (!target) return;
  if (target.dataset.providerDisabled !== undefined) return toast('Bu giriş yöntemi yakında kullanılabilir olacak. E-posta ile devam edebilirsin.');
  if (target.dataset.oauthProvider) return authService.startOAuth(target.dataset.oauthProvider, state.authMode);
  if (target.dataset.togglePassword !== undefined) { const input = document.querySelector('#authPassword'); if (input) { input.type = input.type === 'password' ? 'text' : 'password'; target.textContent = input.type === 'password' ? 'Göster' : 'Gizle'; } return; }
  if (target.dataset.onboardingValue) { const [key, value] = target.dataset.onboardingValue.split(':'); state.onboarding[key] = value; return onboardingView(); }
  if (target.dataset.startDay) return startWorkout(target.dataset.startDay);
  if (target.dataset.resumeImport) return resumeImport(target.dataset.resumeImport);
  if (target.dataset.importCustom) { const [day, section, item] = target.dataset.importCustom.split(':').map(Number); const exercise = (await workoutRepository.getImportPreview(state.importId)).program.days[day].sections[section].items[item]; exercise.resolutionStatus = 'accepted-custom'; exercise.userEditedExerciseName = exercise.userEditedExerciseName || exercise.normalizedExerciseName || exercise.sourceExerciseName; await workoutRepository.saveImportPreview(await workoutRepository.getImportPreview(state.importId)); return renderImportPreview(state.importId); }
  if (target.dataset.importSelect) { const [day, section, item, exerciseId] = target.dataset.importSelect.split(':'); const preview = await workoutRepository.getImportPreview(state.importId); const exercise = preview.program.days[Number(day)].sections[Number(section)].items[Number(item)]; const canonical = await getCanonicalExercise(exerciseId); exercise.exerciseMatch = { status: 'matched', exerciseId, matchedName: canonical?.nameTr || exerciseId, score: 1, candidates: [] }; exercise.resolutionStatus = 'accepted-canonical'; exercise.userEditedExerciseName = null; await workoutRepository.saveImportPreview(preview); return renderImportPreview(state.importId); }
  if (target.dataset.unparsed) { const [index, resolution] = target.dataset.unparsed.split(':'); const preview = await workoutRepository.getImportPreview(state.importId); const item = preview.unparsedContent[Number(index)]; item.resolutionStatus = resolution === 'note' ? 'assigned' : resolution; if (resolution === 'instruction') { const section = preview.program.days[0]?.sections[0]; if (section) section.items.push({ itemType: 'instruction', order: section.items.length + 1, text: item.text, sourceReference: item.sourceReference }); } else if (resolution === 'note') preview.program.notes = `${preview.program.notes ? `${preview.program.notes}\n` : ''}${item.text}`; await workoutRepository.saveImportPreview(preview); return renderImportPreview(state.importId); }
  if (target.dataset.openPicker) { const sectionId = target.dataset.openPicker; state.picker = { sectionId, query: '', muscle: '', equipment: '', results: await browseExercises() }; return renderBuilder(); }
  if (target.dataset.closePicker !== undefined) { state.picker = null; return renderBuilder(); }
  if (target.dataset.pickerMuscle !== undefined || target.dataset.pickerEquipment !== undefined) {
    const [sectionId, value] = (target.dataset.pickerMuscle ?? target.dataset.pickerEquipment).split(':');
    if (!state.picker || state.picker.sectionId !== sectionId) return;
    if (target.dataset.pickerMuscle !== undefined) state.picker.muscle = value;
    else state.picker.equipment = value;
    state.picker.results = state.picker.query.trim() ? await searchExercises(state.picker.query, 24) : await browseExercises({ muscle: state.picker.muscle, equipment: state.picker.equipment });
    return renderBuilder();
  }
  if (target.dataset.selectExercise) { const [sectionId, exerciseId] = target.dataset.selectExercise.split(':'); const section = state.builder.days.flatMap(day => day.sections).find(item => item.id === sectionId); const item = blankExercise(section.id, section.items.length + 1, exerciseId); const canonical = await getCanonicalExercise(exerciseId); item.displayName = canonical?.nameTr || canonical?.nameEn || exerciseId; section.items.push(item); state.picker = null; await persistBuilder(); return renderBuilder(); }
  if (target.dataset.customExercise) { const section = state.builder.days.flatMap(day => day.sections).find(item => item.id === target.dataset.customExercise); const value = document.querySelector(`[data-exercise-search="${section.id}"]`).value.trim(); section.items.push(blankExercise(section.id, section.items.length + 1, null, value)); await persistBuilder(); return renderBuilder(); }
  if (target.dataset.startProgramDay) { const [programId, dayId] = target.dataset.startProgramDay.split(':'); return startProgramWorkout(programId, dayId); }
  if (target.dataset.openProgram) return openProgram(target.dataset.openProgram);
  if (target.dataset.editProgram) return openBuilder(await workoutRepository.getProgram(target.dataset.editProgram));
  if (target.dataset.videoExercise) return showVideo(target.dataset.videoExercise);
  if (target.dataset.openVideo) return openVideo(target.dataset.openVideo);
  if (target.dataset.addDay) { state.builder.days.push(blankDayWithMainSection(state.builder.id, state.builder.days.length + 1)); await persistBuilder(); return renderBuilder(); }
  if (target.dataset.addSection) { const [dayId, type] = target.dataset.addSection.split(':'); const day = state.builder.days.find(item => item.id === dayId); day.sections.push(blankSection(day.id, type, day.sections.length + 1)); await persistBuilder(); return renderBuilder(); }
  if (target.dataset.addInstruction) { const section = state.builder.days.flatMap(day => day.sections).find(item => item.id === target.dataset.addInstruction); section.items.push(blankInstruction(section.items.length + 1)); await persistBuilder(); return renderBuilder(); }
  if (target.dataset.deleteDay) { state.builder.days = state.builder.days.filter(day => day.id !== target.dataset.deleteDay); await persistBuilder(); return renderBuilder(); }
  if (target.dataset.copyDay) { const index = state.builder.days.findIndex(day => day.id === target.dataset.copyDay); const copy = structuredClone(state.builder.days[index]); copy.id = uid(); copy.name = `${copy.name} Kopya`; copy.sections.forEach(section => { section.id = uid(); section.workoutDayId = copy.id; section.items.forEach(item => { item.id = uid(); item.sectionId = section.id; item.individualSets?.forEach(set => { set.id = uid(); set.exercisePrescriptionId = item.id; }); }); }); state.builder.days.splice(index + 1, 0, copy); await persistBuilder(); return renderBuilder(); }
  if (target.dataset.deleteSection) { state.builder.days.forEach(day => day.sections = day.sections.filter(section => section.id !== target.dataset.deleteSection)); await persistBuilder(); return renderBuilder(); }
  if (target.dataset.copySection) { for (const day of state.builder.days) { const index = day.sections.findIndex(section => section.id === target.dataset.copySection); if (index >= 0) { const copy = structuredClone(day.sections[index]); copy.id = uid(); copy.workoutDayId = day.id; copy.title = `${copy.title} Kopya`; copy.items.forEach(item => { item.id = uid(); item.sectionId = copy.id; item.individualSets?.forEach(set => { set.id = uid(); set.exercisePrescriptionId = item.id; }); }); day.sections.splice(index + 1, 0, copy); } } await persistBuilder(); return renderBuilder(); }
  if (target.dataset.deleteItem) { state.builder.days.forEach(day => day.sections.forEach(section => section.items = section.items.filter(item => item.id !== target.dataset.deleteItem))); await persistBuilder(); return renderBuilder(); }
  if (target.dataset.copyItem) { const found = findBuilderItem(target.dataset.copyItem); const index = found.section.items.findIndex(item => item.id === target.dataset.copyItem); const copy = structuredClone(found.item); copy.id = uid(); copy.individualSets?.forEach(set => { set.id = uid(); set.exercisePrescriptionId = copy.id; }); found.section.items.splice(index + 1, 0, copy); await persistBuilder(); return renderBuilder(); }
  if (target.dataset.toggleDetails) { const found = findBuilderItem(target.dataset.toggleDetails); found.item.showDetails = !found.item.showDetails; return renderBuilder(); }
  if (target.dataset.addIndividualSet) { const found = findBuilderItem(target.dataset.addIndividualSet); found.item.individualSets.push({ id: uid(), exercisePrescriptionId: found.item.id, setNumber: found.item.individualSets.length + 1, setType: 'working', reps: null, repsText: null, weight: null, weightUnit: null, weightText: null, rir: null, rirText: null, rpe: null, rpeText: null, restSeconds: null, restText: null, notes: null }); await persistBuilder(); return renderBuilder(); }
  if (target.dataset.deleteIndividualSet) { const [itemId, setId] = target.dataset.deleteIndividualSet.split(':'); const found = findBuilderItem(itemId); found.item.individualSets = found.item.individualSets.filter(set => set.id !== setId).map((set, index) => ({ ...set, setNumber: index + 1 })); await persistBuilder(); return renderBuilder(); }
  if (target.dataset.moveDay) { const [index, direction] = target.dataset.moveDay.split(':').map(Number); reorder(state.builder.days, index, direction); await persistBuilder(); return renderBuilder(); }
  if (target.dataset.moveSection) { const [dayId, index, direction] = target.dataset.moveSection.split(':'); reorder(state.builder.days.find(day => day.id === dayId).sections, Number(index), Number(direction)); await persistBuilder(); return renderBuilder(); }
  if (target.dataset.moveItem) { const [itemId, index, direction] = target.dataset.moveItem.split(':'); const found = findBuilderItem(itemId); reorder(found.section.items, Number(index), Number(direction)); await persistBuilder(); return renderBuilder(); }
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
  if (action === 'onboarding-start') { state.onboarding = { step: 0 }; return onboardingView(); }
  if (action === 'returning-login') { state.onboarding = null; return authView('', 'login'); }
  if (action === 'auth-back') { if (state.onboarding) return onboardingView(); return welcomeView(); }
  if (action === 'onboarding-back') { if (state.onboarding.step <= 0) return welcomeView(); state.onboarding.step -= 1; return onboardingView(); }
  if (action === 'onboarding-skip') { const step = onboardingSteps[state.onboarding.step]; state.onboarding[step.key] = null; state.onboarding.step += 1; return state.onboarding.step >= onboardingSteps.length ? authView('', 'register') : onboardingView(); }
  if (action === 'onboarding-next') { const step = onboardingSteps[state.onboarding.step]; if (step.input) state.onboarding[step.key] = document.querySelector('#onboardingInput')?.value || null; if (!step.optional && !state.onboarding[step.key]) return; state.onboarding.step += 1; return state.onboarding.step >= onboardingSteps.length ? authView('', 'register') : onboardingView(); }
  if (action === 'add-day') { state.builder.days.push(blankDayWithMainSection(state.builder.id, state.builder.days.length + 1)); await persistBuilder(); return renderBuilder(); }
  if (action === 'resume') return resumeWorkout();
  if (action === 'login') return submitAuth('login');
  if (action === 'register') return submitAuth('register');
  if (action === 'migrate-legacy') { try { await sync.migrateLegacy(); cachedSessions = await workoutRepository.getSessions(); toast('Mevcut veriler hesabınıza aktarıldı.'); return programsView(); } catch { return toast('Veriler aktarılırken bir sorun oluştu.'); } }
  if (action === 'skip-legacy') return programsView();
  if (action === 'install-app') { if (state.installPrompt) { state.installPrompt.prompt(); await state.installPrompt.userChoice; state.installPrompt = null; return accountView(); } const help = document.querySelector('#installHelp'); if (help) help.hidden = false; return; }
  if (action === 'logout') { await authService.logout(); sync.stop(); await workoutRepository.setActiveAccount(null); state.user = null; state.workout = null; state.onboarding = null; state.authMode = 'login'; cachedSessions = []; return welcomeView(); }
  if (action === 'delete-account') { const password = prompt('Hesabı silmek için şifrenizi girin. Bu işlem bulut verilerinizi siler.'); if (password === null) return; if (!confirm('Hesabınızı ve bulut verilerinizi silmek istediğinizi onaylıyor musunuz?')) return; try { await authService.deleteAccount(password); sync.stop(); await workoutRepository.setActiveAccount(null); state.user = null; state.onboarding = null; state.authMode = 'login'; cachedSessions = []; toast('Hesabınız silindi.'); return welcomeView(); } catch { return toast('Hesap silinemedi. Şifrenizi kontrol edin.'); } }
  if (action === 'programs') return programsView();
  if (action === 'new-program') return openBuilder(blankProgram());
  if (action === 'file-import') return fileImportView();
  if (action === 'retry-openai') return resumePendingImport('openai');
  if (action === 'fallback-local') return resumePendingImport('local');
  if (action === 'finalize-import') {
    try { const ids = new Set((await loadExerciseDatabase()).map(item => item.id)); const result = await workoutRepository.finalizeImportAtomically(state.importId, preview => finalizeImport(preview, ids)); toast(result.existing ? 'Program zaten oluşturulmuştu' : 'Program oluşturuldu'); return openProgram(result.program.id); } catch (error) { console.error(error); return toast('Program oluşturulamadı: çözülmemiş kayıtları kontrol edin'); }
  }
  if (action === 'resume-builder') return openBuilder();
  if (action === 'save-program') return saveProgram();
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

app.addEventListener('input', async event => {
  if (event.target.id === 'importFile') { const file = event.target.files[0]; if (file) return importFile(file); }
  if (state.importId) {
    const preview = await workoutRepository.getImportPreview(state.importId);
    if ('importProgramName' in event.target.dataset) { preview.program.name = event.target.value; await workoutRepository.saveImportPreview(preview); return; }
    if (event.target.dataset.importDay) { preview.program.days[Number(event.target.dataset.importDay)].name = event.target.value; await workoutRepository.saveImportPreview(preview); return; }
    if (event.target.dataset.importSection) { const [day, section] = event.target.dataset.importSection.split(':').map(Number); preview.program.days[day].sections[section].title = event.target.value; await workoutRepository.saveImportPreview(preview); return; }
    if (event.target.dataset.importField) { const [day, section, item, field] = event.target.dataset.importField.split(':'); const exercise = preview.program.days[Number(day)].sections[Number(section)].items[Number(item)]; if (field === 'notes') exercise.notes = event.target.value || null; else { const prescription = exercise.prescription; prescription[field] = event.target.value || null; if (field === 'setsText') prescription.sets = /^\d+$/.test(event.target.value) ? Number(event.target.value) : null; } await workoutRepository.saveImportPreview(preview); return; }
    if (event.target.dataset.importSearch) { const [day, section, item] = event.target.dataset.importSearch.split(':'); const results = await searchExercises(event.target.value, 5); const holder = document.querySelector(`#import-search-${day}-${section}-${item}`); holder.innerHTML = results.map(result => `<button data-import-select="${day}:${section}:${item}:${result.id}">${escapeHtml(result.nameTr)}</button>`).join(''); return; }
  }
  if (!state.builder) return;
  if (event.target.dataset.builderDayName) { state.builder.days.find(day => day.id === event.target.dataset.builderDayName).name = event.target.value; return persistBuilder(); }
  if (event.target.dataset.builderSectionTitle) { state.builder.days.flatMap(day => day.sections).find(section => section.id === event.target.dataset.builderSectionTitle).title = event.target.value; return persistBuilder(); }
  if (event.target.dataset.instruction) { findBuilderItem(event.target.dataset.instruction).item.text = event.target.value; return persistBuilder(); }
  if (event.target.dataset.field) { const [itemId, field] = event.target.dataset.field.split(':'); const item = findBuilderItem(itemId).item; const value = event.target.value; item[field] = value; if (field === 'setsText') item.sets = /^\d+$/.test(value.trim()) ? Number(value) : null; if (field === 'repsText') { const match = value.trim().match(/^(\d+)\s*(?:-\s*(\d+))?$/); item.repsMin = match ? Number(match[1]) : null; item.repsMax = match ? Number(match[2] || match[1]) : null; } return persistBuilder(); }
  if (event.target.dataset.setField) { const [itemId, setId, field] = event.target.dataset.setField.split(':'); const set = findBuilderItem(itemId).item.individualSets.find(item => item.id === setId); set[field] = event.target.value || null; return persistBuilder(); }
  if (event.target.dataset.exerciseSearch) {
    const sectionId = event.target.dataset.exerciseSearch; const query = event.target.value; const results = await searchExercises(query, 24); const holder = document.querySelector(`#search-${sectionId}`);
    if (state.picker?.sectionId === sectionId) state.picker = { ...state.picker, query, results };
    holder.innerHTML = results.map(item => `<button data-select-exercise="${sectionId}:${item.id}"><b>${escapeHtml(item.nameTr)}</b><span>${escapeHtml(item.nameEn)} · ${(item.primaryMuscles || []).join(', ') || 'Diğer'}</span></button>`).join('') + (query.trim() ? `<button data-custom-exercise="${sectionId}">"${escapeHtml(query.trim())}" adlı özel hareket oluştur</button>` : '');
  }
});

app.addEventListener('change', event => {
  if (state.importId && event.target.dataset.importSectionType) { workoutRepository.getImportPreview(state.importId).then(preview => { const [day, section] = event.target.dataset.importSectionType.split(':').map(Number); preview.program.days[day].sections[section].sectionType = event.target.value; return workoutRepository.saveImportPreview(preview); }); return; }
  if (state.builder && event.target.dataset.builderSectionType) { state.builder.days.flatMap(day => day.sections).find(section => section.id === event.target.dataset.builderSectionType).sectionType = event.target.value; persistBuilder(); return; }
  if (event.target.id === 'exerciseSelect') exerciseHistory(event.target.value);
});

document.querySelectorAll('.nav-btn').forEach(button => {
  button.addEventListener('click', () => ({ home, programs: programsView, history: historyView, account: accountView }[button.dataset.nav]()));
});
document.querySelector('#historyBtn').addEventListener('click', historyView);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); state.installPrompt = event; });
window.addEventListener('appinstalled', () => { state.installPrompt = null; });

init();

async function init() {
  try {
    const user = await authService.me();
    window.addEventListener('online', async () => sync.push(await workoutRepository.getData()));
    window.__a2 = { repository: workoutRepository, schemaVersion: SCHEMA_VERSION, buildCsv, searchExercises, loadExerciseDatabase, validateImportPreview, finalizeImport, matchImportExercises, youtube, documentExtractor, localImportParser, openAIImportParser, authService, sync };
    if (!user) return welcomeView();
    await completeAuth(user);
  } catch (error) {
    app.innerHTML = '<section class="summary-card">Uygulama başlatılamadı. Sayfayı yenileyin.</section>';
    console.error(error);
  }
}
