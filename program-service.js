const SECTION_TYPES = ['warmup', 'activation', 'strength', 'core', 'cardio', 'stretch', 'mobility', 'cooldown', 'custom'];
const SET_TYPES = ['warmup', 'working', 'activation', 'core', 'backoff', 'drop', 'custom'];
const SOURCE_TYPES = ['manual', 'pdf-import', 'docx-import', 'xlsx-import', 'template', 'coach'];

export function uid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function blankProgram({ id = uid(), name = '', description = null, sourceType = 'manual', now = new Date().toISOString() } = {}) {
  return { schemaVersion: '1.0', id, name, description, sourceType, createdAt: now, updatedAt: now, days: [] };
}

export function blankDay(programId, order = 1) {
  return { id: uid(), programId, name: `Gün ${order}`, order, notes: null, sections: [] };
}

export function blankSection(workoutDayId, type = 'strength', order = 1) {
  return { id: uid(), workoutDayId, title: sectionTitle(type), sectionType: type, order, notes: null, items: [] };
}

export function blankExercise(sectionId, order = 1, exerciseId = null, customExerciseName = null) {
  return {
    id: uid(), itemType: 'exercise', sectionId, exerciseId, customExerciseName, order,
    sets: null, setsText: null, repsMin: null, repsMax: null, repsText: null,
    weight: null, weightUnit: null, weightText: null, rir: null, rirText: null,
    rpe: null, rpeText: null, restSeconds: null, restText: null, tempoText: null,
    durationSeconds: null, durationText: null, distance: null, distanceUnit: null,
    distanceText: null, notes: null, groupId: null, groupType: null, individualSets: []
  };
}

export function blankInstruction(order = 1) { return { id: uid(), itemType: 'instruction', order, text: '' }; }

export function normalizeProgram(input, now = new Date().toISOString()) {
  const program = structuredClone(input || blankProgram());
  program.schemaVersion = '1.0';
  program.id ||= uid();
  program.name = String(program.name || '').trim();
  program.description = nullableText(program.description);
  program.sourceType = SOURCE_TYPES.includes(program.sourceType) ? program.sourceType : 'manual';
  program.createdAt ||= now;
  program.updatedAt = now;
  program.days = Array.isArray(program.days) ? program.days : [];
  program.days.forEach((day, dayIndex) => {
    day.id ||= uid(); day.programId = program.id; day.order = dayIndex + 1; day.name = String(day.name || '').trim(); day.notes = nullableText(day.notes);
    day.sections = Array.isArray(day.sections) ? day.sections : [];
    day.sections.forEach((section, sectionIndex) => {
      section.id ||= uid(); section.workoutDayId = day.id; section.order = sectionIndex + 1; section.title = String(section.title || '').trim();
      section.sectionType = SECTION_TYPES.includes(section.sectionType) ? section.sectionType : 'custom'; section.notes = nullableText(section.notes);
      section.items = Array.isArray(section.items) ? section.items : [];
      section.items.forEach((item, itemIndex) => normalizeItem(item, section.id, itemIndex + 1));
    });
  });
  return program;
}

export function validateProgram(program, canonicalIds = null) {
  const errors = [];
  if (!program?.name?.trim()) errors.push('PROGRAM_NAME_MISSING');
  if (!Array.isArray(program?.days) || !program.days.length) errors.push('NO_WORKOUT_DAYS');
  const ids = new Set();
  const addId = id => { if (!id || ids.has(id)) errors.push('BROKEN_PARENT_REFERENCE'); ids.add(id); };
  program?.days?.forEach(day => {
    addId(day.id); if (day.programId !== program.id || !day.name) errors.push('BROKEN_PARENT_REFERENCE');
    day.sections?.forEach(section => {
      addId(section.id); if (section.workoutDayId !== day.id || !section.title || !SECTION_TYPES.includes(section.sectionType)) errors.push('BROKEN_PARENT_REFERENCE');
      section.items?.forEach(item => {
        addId(item.id);
        if (item.itemType === 'instruction' && !item.text?.trim()) errors.push('BROKEN_PARENT_REFERENCE');
        if (item.itemType === 'exercise') {
          if (item.sectionId !== section.id || (!item.exerciseId && !item.customExerciseName?.trim())) errors.push('UNRESOLVED_EXERCISE');
          if (canonicalIds && item.exerciseId && !canonicalIds.has(item.exerciseId)) errors.push('UNKNOWN_CANONICAL_EXERCISE');
          if (item.repsMin != null && item.repsMax != null && item.repsMin > item.repsMax) errors.push('INVALID_REP_RANGE');
          const numbers = new Set();
          item.individualSets?.forEach(set => { if (numbers.has(set.setNumber) || set.exercisePrescriptionId !== item.id) errors.push('DUPLICATE_SET_NUMBER'); numbers.add(set.setNumber); });
        }
      });
    });
  });
  return [...new Set(errors)];
}

export function permanentDayToLegacy(day, exerciseNames = new Map()) {
  return {
    id: day.id, label: day.name, sections: day.sections.map(section => ({
      id: section.id, name: section.title, type: section.sectionType,
      exercises: section.items.filter(item => item.itemType === 'exercise').map(item => ({
        id: item.id, canonicalExerciseId: item.exerciseId, name: exerciseNames.get(item.exerciseId) || item.customExerciseName || item.exerciseId,
        setType: item.individualSets?.[0]?.setType || (section.sectionType === 'warmup' ? 'warmup' : section.sectionType === 'core' ? 'core' : 'working'),
        prescription: { text: prescriptionText(item), plannedSets: item.individualSets?.length || item.sets || 1 }
      }))
    }))
  };
}

function normalizeItem(item, sectionId, order) {
  item.id ||= uid(); item.order = order;
  if (item.itemType === 'instruction') { item.text = String(item.text || '').trim(); return; }
  item.itemType = 'exercise'; item.sectionId = sectionId; item.exerciseId ||= null; item.customExerciseName = nullableText(item.customExerciseName);
  ['sets', 'repsMin', 'repsMax', 'restSeconds', 'durationSeconds'].forEach(key => item[key] = nullableInteger(item[key]));
  ['weight', 'rir', 'rpe', 'distance'].forEach(key => item[key] = nullableNumber(item[key]));
  ['setsText', 'repsText', 'weightText', 'rirText', 'rpeText', 'restText', 'tempoText', 'durationText', 'distanceText', 'notes', 'groupId'].forEach(key => item[key] = nullableText(item[key]));
  item.weightUnit = ['kg', 'lb'].includes(item.weightUnit) ? item.weightUnit : null; item.distanceUnit = ['m', 'km', 'mi'].includes(item.distanceUnit) ? item.distanceUnit : null;
  item.groupType = ['superset', 'giant-set', 'circuit', 'drop-set', 'rest-pause'].includes(item.groupType) ? item.groupType : null;
  item.individualSets = Array.isArray(item.individualSets) ? item.individualSets : [];
  item.individualSets.forEach((set, index) => {
    set.id ||= uid(); set.exercisePrescriptionId = item.id; set.setNumber = Number.isInteger(Number(set.setNumber)) && Number(set.setNumber) >= 1 ? Number(set.setNumber) : index + 1; set.setType = SET_TYPES.includes(set.setType) ? set.setType : 'working';
    ['reps', 'restSeconds'].forEach(key => set[key] = nullableInteger(set[key])); ['weight', 'rir', 'rpe'].forEach(key => set[key] = nullableNumber(set[key]));
    ['repsText', 'weightText', 'rirText', 'rpeText', 'restText', 'notes'].forEach(key => set[key] = nullableText(set[key])); set.weightUnit = ['kg', 'lb'].includes(set.weightUnit) ? set.weightUnit : null;
  });
}
function nullableText(value) { const text = String(value ?? '').trim(); return text || null; }
function nullableInteger(value) { return value === '' || value == null ? null : Number.isInteger(Number(value)) ? Number(value) : null; }
function nullableNumber(value) { return value === '' || value == null ? null : Number.isFinite(Number(value)) ? Number(value) : null; }
function sectionTitle(type) { return ({ warmup: 'Isınma', activation: 'Aktivasyon', strength: 'Ana Antrenman', core: 'Core', cardio: 'Kardiyo', stretch: 'Stretch', mobility: 'Mobilite', cooldown: 'Soğuma', custom: 'Özel Bölüm' })[type] || 'Özel Bölüm'; }
function prescriptionText(item) { const sets = item.setsText || item.sets || ''; const reps = item.repsText || (item.repsMin != null ? `${item.repsMin}${item.repsMax != null && item.repsMax !== item.repsMin ? `-${item.repsMax}` : ''}` : ''); return [sets, reps].filter(Boolean).join(' × ') || 'Serbest'; }
