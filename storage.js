import { findExercise } from './data/public-programs.js';

export const SCHEMA_VERSION = 5;
const DB_NAME = 'a2-workout-db';
const DB_VERSION = 1;
const LEGACY_STORE_KEY = 'a2WorkoutData.v1';
const LEGACY_DRAFT_KEY = 'a2WorkoutDraft.v1';
const FALLBACK_KEY = 'a2WorkoutData.v2.fallback';

let dbPromise;
let activeAccountId = null;
let syncHandler = null;

export const workoutRepository = {
  async setActiveAccount(userId) { activeAccountId = userId || null; },
  getActiveAccount() { return activeAccountId; },
  setSyncHandler(handler) { syncHandler = handler || null; },
  async getSyncMetadata() { return (await readData()).syncMetadata; },
  async markSyncSucceeded() { const data = await readData(); data.syncMetadata = { ...data.syncMetadata, dirty: false, lastSuccessAt: new Date().toISOString(), lastError: null }; await writeData(data, false); },
  async markSyncFailed(error) { const data = await readData(); data.syncMetadata = { ...data.syncMetadata, dirty: true, lastAttemptAt: new Date().toISOString(), lastError: String(error?.code || 'SYNC_FAILED') }; await writeData(data, false); },
  async getLegacyDeviceData() { return normalizeData(await storageGet('appData')); },
  async hasLegacyDeviceData() { const data = await this.getLegacyDeviceData(); return Boolean(data.sessions.length || data.programs.length || data.draft || data.programBuilderDraft || Object.keys(data.importPreviews).length); },
  async importLegacyDeviceData() {
    if (!activeAccountId) throw new Error('AUTH_REQUIRED');
    const legacy = await this.getLegacyDeviceData(); const account = await readData();
    const mergeById = (current, incoming) => [...current, ...incoming.filter(item => item?.id && !current.some(existing => existing.id === item.id))];
    const merged = { ...account, programs: mergeById(account.programs, legacy.programs), sessions: mergeById(account.sessions, legacy.sessions), settings: { ...legacy.settings, ...account.settings }, importHistory: mergeById(account.importHistory, legacy.importHistory) };
    await writeData(merged); return merged;
  },
  async init() {
    // Legacy data remains on-device until its owner explicitly imports it.
    // Never attach old device data to whichever account happens to sign in.
    await readData();
  },

  async getData() {
    return readData();
  },

  async replaceData(candidate) {
    const normalized = normalizeData(candidate);
    await writeData(normalized, false);
    return normalized;
  },

  async getSettings() {
    return (await readData()).settings;
  },

  async saveSettings(settings) {
    const data = await readData();
    data.settings = { ...data.settings, ...settings };
    await writeData(data);
  },

  async getSessions() {
    return (await readData()).sessions;
  },

  async addSession(session) {
    const data = await readData();
    data.sessions.push(normalizeSession(session));
    await writeData(data);
  },

  async deleteSession(sessionId) {
    const data = await readData();
    data.sessions = data.sessions.filter(session => session.id !== sessionId);
    await writeData(data);
  },

  async getDraft() {
    const data = await readData();
    return data.draft;
  },

  async saveDraft(draft) {
    const data = await readData();
    data.draft = draft;
    await writeData(data);
  },

  async clearDraft() {
    const data = await readData();
    data.draft = null;
    await writeData(data);
    localStorage.removeItem(LEGACY_DRAFT_KEY);
  },

  async getPrograms() { return (await readData()).programs; },

  async getProgram(programId) { return (await readData()).programs.find(program => program.id === programId) || null; },

  async saveProgram(program) {
    const data = await readData();
    const index = data.programs.findIndex(item => item.id === program.id);
    if (index >= 0) data.programs[index] = program; else data.programs.push(program);
    await writeData(data);
    return program;
  },

  async saveProgramBuilderDraft(draft) { const data = await readData(); data.programBuilderDraft = draft; await writeData(data); },
  async getProgramBuilderDraft() { return (await readData()).programBuilderDraft; },
  async clearProgramBuilderDraft() { const data = await readData(); data.programBuilderDraft = null; await writeData(data); },

  async saveImportPreview(preview) { const data = await readData(); data.importPreviews[preview.importId] = preview; await writeData(data); },
  async getImportPreview(importId) { return (await readData()).importPreviews[importId] || null; },

  async finalizeImportAtomically(importId, factory) {
    const data = await readData();
    if (data.finalizations[importId]) return { program: data.programs.find(item => item.id === data.finalizations[importId]) || null, existing: true };
    const preview = data.importPreviews[importId];
    if (!preview) throw Object.assign(new Error('INVALID_IMPORT_SCHEMA'), { code: 'INVALID_IMPORT_SCHEMA' });
    const program = factory(preview);
    data.programs.push(program);
    data.settings = { ...data.settings, activeProgramId: program.id };
    data.finalizations[importId] = program.id;
    data.importHistory.push({ importId, finalProgramId: program.id, finalizedAt: new Date().toISOString(), source: preview.source, warnings: preview.warnings || [], dismissedContent: (preview.unparsedContent || []).filter(item => item.resolutionStatus === 'dismissed') });
    delete data.importPreviews[importId];
    data.programBuilderDraft = null;
    await writeData(data);
    return { program, existing: false };
  },

  async getYoutubeCache(exerciseId, query) { return (await readData()).youtubeSearchCache[`youtube-search:${exerciseId}:${normalizeQuery(query)}`] || null; },
  async saveYoutubeCache(entry) { const data = await readData(); data.youtubeSearchCache[`youtube-search:${entry.exerciseId}:${normalizeQuery(entry.query)}`] = entry; await writeData(data); },

  async exportBackup() {
    const data = await readData();
    return {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      app: {
        id: 'a2-workout-pwa',
        name: 'Reptrio',
        version: '1.0.0'
      },
      programs: data.programs,
      settings: data.settings,
      sessions: data.sessions
    };
  },

  validateBackup(candidate) {
    return normalizeData(candidate);
  }
};

async function readData() {
  const stored = activeAccountId ? await storageGet(accountKey()) : null;
  return normalizeData(stored);
}

async function writeData(data, markDirty = true) {
  if (!activeAccountId) throw new Error('AUTH_REQUIRED');
  const normalized = normalizeData(data);
  if (markDirty) normalized.syncMetadata = { ...normalized.syncMetadata, accountId: activeAccountId, dirty: true, dirtySince: normalized.syncMetadata.dirtySince || new Date().toISOString(), lastAttemptAt: null, localRevision: Number(normalized.syncMetadata.localRevision || 0) + 1 };
  normalized.syncUpdatedAt = new Date().toISOString();
  await storageSet(accountKey(), normalized);
  if (markDirty) syncHandler?.(normalized).catch(() => {});
}

function accountKey() { return `account:${activeAccountId}:appData`; }

function defaultData() {
  return {
    schemaVersion: SCHEMA_VERSION,
    migratedFromV1: false,
    settings: { rest: 90, weightUnit: 'kg', activeProgramId: null, profile: { displayName: '', avatarDataUrl: '' } },
    sessions: [],
    draft: null,
    programs: [],
    programBuilderDraft: null,
    importPreviews: {},
    importHistory: [],
    youtubeSearchCache: {},
    finalizations: {},
    syncMetadata: { accountId: null, dirty: false, dirtySince: null, lastAttemptAt: null, lastSuccessAt: null, lastError: null, localRevision: 0 }
    ,syncUpdatedAt: null
  };
}

function normalizeData(candidate) {
  const source = candidate && typeof candidate === 'object' ? candidate : {};
  const nested = Array.isArray(source.sessions) ? source : source.data || {};
  return {
    schemaVersion: SCHEMA_VERSION,
    migratedFromV1: Boolean(source.migratedFromV1 || nested.migratedFromV1),
    settings: normalizeSettings(nested.settings || source.settings),
    sessions: Array.isArray(nested.sessions) ? nested.sessions.map(normalizeSession).filter(Boolean) : [],
    draft: nested.draft ? normalizeDraft(nested.draft) : null,
    programs: Array.isArray(nested.programs) ? nested.programs.filter(item => item?.schemaVersion === '1.0' && item.id) : [],
    programBuilderDraft: nested.programBuilderDraft && typeof nested.programBuilderDraft === 'object' ? nested.programBuilderDraft : null,
    importPreviews: nested.importPreviews && typeof nested.importPreviews === 'object' ? nested.importPreviews : {},
    importHistory: Array.isArray(nested.importHistory) ? nested.importHistory : [],
    youtubeSearchCache: nested.youtubeSearchCache && typeof nested.youtubeSearchCache === 'object' ? nested.youtubeSearchCache : {},
    finalizations: nested.finalizations && typeof nested.finalizations === 'object' ? nested.finalizations : {},
    syncMetadata: { accountId: nested.syncMetadata?.accountId || null, dirty: Boolean(nested.syncMetadata?.dirty), dirtySince: nested.syncMetadata?.dirtySince || null, lastAttemptAt: nested.syncMetadata?.lastAttemptAt || null, lastSuccessAt: nested.syncMetadata?.lastSuccessAt || null, lastError: nested.syncMetadata?.lastError || null, localRevision: Number(nested.syncMetadata?.localRevision || 0) }
    ,syncUpdatedAt: nested.syncUpdatedAt || null
  };
}

function normalizeSettings(settings = {}) {
  const profile = settings.profile && typeof settings.profile === 'object' ? settings.profile : {};
  return {
    ...settings,
    rest: Number(settings.rest) || 90,
    weightUnit: settings.weightUnit === 'lb' ? 'lb' : 'kg',
    activeProgramId: settings.activeProgramId || null,
    profile: {
      ...profile,
      displayName: String(profile.displayName || '').trim(),
      avatarDataUrl: typeof profile.avatarDataUrl === 'string' ? profile.avatarDataUrl : ''
    }
  };
}

function normalizeSession(session) {
  if (!session || typeof session !== 'object') return null;
  const sessionId = session.id || uid();
  const sets = Array.isArray(session.sets)
    ? session.sets
    : (session.exercises || []).flatMap(exercise => (exercise.sets || []).map(set => ({
      ...set,
      exerciseId: exercise.exerciseId || exercise.id,
      exerciseName: exercise.exerciseName || exercise.name,
      setType: set.setType || exercise.setType || 'working'
    })));
  if (!session.workoutDayId && !session.day) return null;
  return {
    id: sessionId,
    programId: session.programId || 'a2',
    workoutDayId: session.workoutDayId || session.day,
    startedAt: session.startedAt || session.start,
    completedAt: session.completedAt || session.end || null,
    status: session.status || (session.completedAt || session.end ? 'completed' : 'active'),
    completedActivities: Array.isArray(session.completedActivities) ? session.completedActivities : (session.completed || []),
    summary: session.summary || null,
    sets: sets.map((set, index) => normalizeSet({ ...set, sessionId }, index)).filter(Boolean)
  };
}

function normalizeSet(set, index) {
  const exerciseId = set.exerciseId || idFromName(set.exerciseName || set.name);
  if (!exerciseId) return null;
  const exercise = findExercise(exerciseId);
  return {
    id: set.id || uid(),
    sessionId: set.sessionId,
    exerciseId,
    exerciseName: set.exerciseName || exercise?.name || set.name || exerciseId,
    setNumber: Number(set.setNumber) || index + 1,
    setType: set.setType || exercise?.setType || 'working',
    weight: set.weight ?? set.kg ?? '',
    reps: set.reps ?? '',
    rir: set.rir ?? '',
    completedAt: set.completedAt || set.savedAt || new Date().toISOString(),
    updatedAt: set.updatedAt || null
  };
}

function normalizeDraft(draft) {
  if (!draft || !draft.workoutDayId) return null;
  return {
    id: draft.id || uid(),
    programId: draft.programId || 'a2',
    workoutDayId: draft.workoutDayId,
    startedAt: draft.startedAt || new Date().toISOString(),
    status: 'active',
    completedActivities: draft.completedActivities || {},
    sets: draft.sets || {},
    timer: draft.timer && typeof draft.timer === 'object' ? {
      exerciseId: draft.timer.exerciseId || null,
      endsAt: draft.timer.endsAt || null,
      durationSeconds: Number(draft.timer.durationSeconds) || null,
      notified: Boolean(draft.timer.notified)
    } : null
  };
}

function readLegacy() {
  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_STORE_KEY) || 'null');
    return legacy?.sessions ? legacy : null;
  } catch {
    return null;
  }
}

function readLegacyDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(LEGACY_DRAFT_KEY) || 'null');
    return draft?.day ? draft : null;
  } catch {
    return null;
  }
}

function migrateLegacy(legacy, data) {
  const migrated = normalizeData(data);
  migrated.settings = { rest: Number(legacy.settings?.rest) || migrated.settings.rest };
  migrated.sessions = [
    ...migrated.sessions,
    ...(legacy.sessions || []).map(session => normalizeSession({
      id: session.id,
      programId: 'a2',
      workoutDayId: session.day,
      startedAt: session.start,
      completedAt: session.end,
      status: 'completed',
      completedActivities: session.completed,
      exercises: Object.values(session.exercises || {}).length ? Object.values(session.exercises || {}) : session.exercises
    })).filter(Boolean)
  ];
  return migrated;
}

function migrateDraft(draft) {
  const migrated = {
    id: draft.id || uid(),
    programId: 'a2',
    workoutDayId: draft.day,
    startedAt: draft.start || new Date().toISOString(),
    status: 'active',
    completedActivities: draft.doneSimple || {},
    sets: {}
  };
  Object.values(draft.exercises || {}).forEach(exercise => {
    const exerciseId = idFromName(exercise.name);
    if (!exerciseId) return;
    migrated.sets[exerciseId] = {};
    (exercise.sets || []).forEach((set, index) => {
      if (set) migrated.sets[exerciseId][index + 1] = normalizeSet({ ...set, exerciseId, sessionId: migrated.id }, index);
    });
  });
  return migrated;
}

function idFromName(name) {
  const map = {
    'Machine Fly – Isınma': 'machine-fly-warmup',
    'Machine Fly – Work': 'machine-fly-work',
    'Incline Smith Press – Isınma': 'incline-smith-press-warmup',
    'Incline Smith Press – Work': 'incline-smith-press-work',
    'Chest Supported Row – Isınma': 'chest-supported-row-warmup',
    'Chest Supported Row – Work': 'chest-supported-row-work'
  };
  if (map[name]) return map[name];
  const found = findExercise(slug(name || ''));
  return found?.id || slug(name || '');
}

function slug(value) {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function storageGet(key) {
  if (!('indexedDB' in window)) return JSON.parse(localStorage.getItem(FALLBACK_KEY) || 'null')?.[key] || defaultData();
  try {
    const db = await openDb();
    return await requestToPromise(db.transaction('kv', 'readonly').objectStore('kv').get(key)) || defaultData();
  } catch {
    return JSON.parse(localStorage.getItem(FALLBACK_KEY) || 'null')?.[key] || defaultData();
  }
}

async function storageSet(key, value) {
  if (!('indexedDB' in window)) return fallbackSet(key, value);
  try {
    const db = await openDb();
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(value, key);
    await transactionDone(tx);
  } catch {
    fallbackSet(key, value);
  }
}

function fallbackSet(key, value) {
  const current = JSON.parse(localStorage.getItem(FALLBACK_KEY) || '{}');
  current[key] = value;
  localStorage.setItem(FALLBACK_KEY, JSON.stringify(current));
}

function openDb() {
  dbPromise ||= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('kv');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeQuery(value) { return String(value || '').trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' '); }
