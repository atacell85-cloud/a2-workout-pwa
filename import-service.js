import { normalizeProgram, uid, validateProgram } from './program-service.js';
import { searchExercises, normalize } from './exercise-service.js';

export async function matchImportExercises(preview) {
  for (const day of preview.program?.days || []) for (const section of day.sections || []) for (const item of section.items || []) {
    if (item.itemType !== 'exercise') continue;
    const candidates = await searchExercises(item.normalizedExerciseName || item.sourceExerciseName, 5);
    const name = normalize(item.normalizedExerciseName || item.sourceExerciseName);
    const exact = candidates.find(candidate => [candidate.nameTr, candidate.nameEn, ...(candidate.aliases || [])].some(value => normalize(value) === name));
    item.exerciseMatch = exact ? { status: 'matched', exerciseId: exact.id, matchedName: exact.nameTr, score: 1, candidates: candidates.map(candidate => ({ exerciseId: candidate.id, name: candidate.nameTr, score: candidate.id === exact.id ? 1 : .35 })) } : null;
    item.resolutionStatus = exact ? 'accepted-canonical' : 'accepted-custom';
    item.userEditedExerciseName = exact ? null : (item.sourceExerciseName || item.normalizedExerciseName || '').trim();
  }
  return preview;
}

export function validateImportPreview(preview, canonicalIds) {
  const errors = [];
  if (!preview || preview.schemaVersion !== '1.1' || !preview.importId || !preview.program) errors.push('INVALID_IMPORT_SCHEMA');
  if (!preview?.program?.name?.trim()) errors.push('PROGRAM_NAME_MISSING');
  if (!preview?.program?.days?.length) errors.push('NO_WORKOUT_DAYS');
  preview?.program?.days?.forEach(day => day.sections?.forEach(section => section.items?.forEach(item => {
    if (item.itemType !== 'exercise') return;
    const status = item.resolutionStatus;
    if (status === 'accepted-canonical') {
      if (!item.exerciseMatch?.exerciseId || !canonicalIds.has(item.exerciseMatch.exerciseId)) errors.push('UNKNOWN_CANONICAL_EXERCISE');
    } else if (status !== 'accepted-custom' || !(item.userEditedExerciseName || item.normalizedExerciseName || item.sourceExerciseName)?.trim()) {
      errors.push('UNRESOLVED_EXERCISE');
    }
  })));
  return [...new Set(errors)];
}

export function finalizeImport(preview, canonicalIds, now = new Date().toISOString()) {
  const errors = validateImportPreview(preview, canonicalIds);
  if (errors.length) throw Object.assign(new Error(errors[0]), { code: errors[0], errors });
  const program = {
    schemaVersion: '1.0', id: uid(), name: preview.program.name, description: preview.program.description,
    sourceType: preview.program.sourceType, createdAt: now, updatedAt: now,
    days: (preview.program.days || []).map((day, dayIndex) => ({
      id: uid(), programId: null, name: day.name, order: dayIndex + 1, notes: day.notes,
      sections: (day.sections || []).map((section, sectionIndex) => ({
        id: uid(), workoutDayId: null, title: section.title, sectionType: section.sectionType, order: sectionIndex + 1, notes: section.notes,
        items: (section.items || []).map((item, itemIndex) => finalizeItem(item, itemIndex + 1))
      }))
    }))
  };
  const normalized = normalizeProgram(program, now);
  const permanentErrors = validateProgram(normalized, canonicalIds);
  if (permanentErrors.length) throw Object.assign(new Error(permanentErrors[0]), { code: 'PERMANENT_SCHEMA_VALIDATION_FAILED', errors: permanentErrors });
  return normalized;
}

function finalizeItem(item, order) {
  if (item.itemType === 'instruction') return { id: uid(), itemType: 'instruction', order, text: item.text };
  const prescription = item.prescription || {};
  const canonical = item.resolutionStatus === 'accepted-canonical';
  const id = uid();
  return {
    id, itemType: 'exercise', sectionId: null, exerciseId: canonical ? item.exerciseMatch.exerciseId : null,
    customExerciseName: canonical ? null : (item.userEditedExerciseName || item.normalizedExerciseName || item.sourceExerciseName), order,
    sets: prescription.sets, setsText: prescription.setsText, repsMin: prescription.repsMin, repsMax: prescription.repsMax, repsText: prescription.repsText,
    weight: prescription.weight, weightUnit: prescription.weightUnit, weightText: prescription.weightText, rir: prescription.rir, rirText: prescription.rirText,
    rpe: prescription.rpe, rpeText: prescription.rpeText, restSeconds: prescription.restSeconds, restText: prescription.restText,
    tempoText: prescription.tempoText ?? prescription.tempo, durationSeconds: prescription.durationSeconds, durationText: prescription.durationText,
    distance: prescription.distance, distanceUnit: prescription.distanceUnit, distanceText: prescription.distanceText, notes: null,
    groupId: null, groupType: null,
    individualSets: (prescription.individualSets || []).map(set => ({ ...set, id: uid(), exercisePrescriptionId: id, notes: null }))
  };
}
