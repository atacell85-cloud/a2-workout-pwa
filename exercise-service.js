let databasePromise;

export async function loadExerciseDatabase() {
  databasePromise ||= fetch('./data/exercises.v1.json')
    .then(response => response.ok ? response : fetch('./data/exercises-master-v1.1.json'))
    .then(response => {
      if (!response.ok) throw new Error('EXERCISE_DATABASE_UNAVAILABLE');
      return response.json();
    })
    .then(dataset => {
      if (!Array.isArray(dataset.exercises) || dataset.exercises.length !== 250) {
        throw new Error('INVALID_EXERCISE_DATABASE');
      }
      return dataset.exercises;
    });
  return databasePromise;
}

export async function getCanonicalExercise(exerciseId) {
  return (await loadExerciseDatabase()).find(exercise => exercise.id === exerciseId) || null;
}

export async function searchExercises(query, limit = 12) {
  const normalized = normalize(query);
  if (!normalized) return (await loadExerciseDatabase()).filter(item => item.active).slice(0, limit);
  return (await loadExerciseDatabase())
    .filter(item => item.active)
    .map(item => ({ item, score: score(item, normalized) }))
    .filter(result => result.score > 0)
    .sort((a, b) => b.score - a.score || a.item.nameTr.localeCompare(b.item.nameTr, 'tr'))
    .slice(0, limit)
    .map(result => result.item);
}

export async function browseExercises({ muscle = '', equipment = '', limit = 24 } = {}) {
  const normalizedMuscle = normalize(muscle);
  const normalizedEquipment = normalize(equipment);
  return (await loadExerciseDatabase())
    .filter(item => item.active)
    .filter(item => !normalizedMuscle || [...(item.primaryMuscles || []), ...(item.secondaryMuscles || [])]
      .some(value => normalize(value) === normalizedMuscle))
    .filter(item => !normalizedEquipment || (item.equipment || []).some(value => normalize(value) === normalizedEquipment))
    .sort((a, b) => (a.priority || 999) - (b.priority || 999) || a.nameTr.localeCompare(b.nameTr, 'tr'))
    .slice(0, limit);
}

export function normalize(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function score(item, query) {
  const fields = [item.nameTr, item.nameEn, item.id, ...(item.aliases || [])].map(normalize);
  let best = 0;
  fields.forEach((field, index) => {
    if (field === query) best = Math.max(best, 100 - index);
    else if (field.startsWith(query)) best = Math.max(best, 80 - index);
    else if (field.includes(query)) best = Math.max(best, 60 - index);
    else if (query.split(' ').every(token => field.includes(token))) best = Math.max(best, 40 - index);
  });
  return best;
}
