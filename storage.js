import { findExercise } from './data/programs.js';

export const SCHEMA_VERSION = 2;
const DB_NAME = 'a2-workout-db';
const DB_VERSION = 1;
const LEGACY_STORE_KEY = 'a2WorkoutData.v1';
const LEGACY_DRAFT_KEY = 'a2WorkoutDraft.v1';
const FALLBACK_KEY = 'a2WorkoutData.v2.fallback';

let dbPromise;

export const workoutRepository = {
  async init() {
    const data = await readData();
    if (!data.migratedFromV1) {
      const legacy = readLegacy();
      if (legacy) {
        const merged = migrateLegacy(legacy, data);
        merged.migratedFromV1 = true;
        await writeData(merged);
      }
    }
  },

  async getData() {
    return readData();
  },

  async replaceData(candidate) {
    const normalized = normalizeData(candidate);
    await writeData(normalized);
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
    if (data.draft) return data.draft;
    const legacyDraft = readLegacyDraft();
    return legacyDraft ? migrateDraft(legacyDraft) : null;
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

  async exportBackup() {
    const data = await readData();
    return {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      app: {
        id: 'a2-workout-pwa',
        name: 'A2 Antrenman Takip',
        version: '1.0.0'
      },
      programs: [{ id: 'a2', name: 'A2 Antrenman' }],
      settings: data.settings,
      sessions: data.sessions
    };
  },

  validateBackup(candidate) {
    return normalizeData(candidate);
  }
};

async function readData() {
  const stored = await storageGet('appData');
  return normalizeData(stored);
}

async function writeData(data) {
  await storageSet('appData', normalizeData(data));
}

function defaultData() {
  return {
    schemaVersion: SCHEMA_VERSION,
    migratedFromV1: false,
    settings: { rest: 90 },
    sessions: [],
    draft: null
  };
}

function normalizeData(candidate) {
  const source = candidate && typeof candidate === 'object' ? candidate : {};
  const nested = Array.isArray(source.sessions) ? source : source.data || {};
  return {
    schemaVersion: SCHEMA_VERSION,
    migratedFromV1: Boolean(source.migratedFromV1 || nested.migratedFromV1),
    settings: { rest: Number(nested.settings?.rest || source.settings?.rest) || 90 },
    sessions: Array.isArray(nested.sessions) ? nested.sessions.map(normalizeSession).filter(Boolean) : [],
    draft: nested.draft ? normalizeDraft(nested.draft) : null
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
    sets: draft.sets || {}
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
