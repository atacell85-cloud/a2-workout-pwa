let databasePromise;

export async function loadExerciseDatabase() {
  databasePromise ||= fetch('./data/exercises.v1.json')
    .then(response => response.ok ? response : fetch('./data/exercises-master-v1.1.json'))
    .then(response => {
      if (!response.ok) throw new Error('EXERCISE_DATABASE_UNAVAILABLE');
      return response.json();
    })
    .then(dataset => {
      if (!Array.isArray(dataset.exercises) || !dataset.exercises.length) {
        throw new Error('INVALID_EXERCISE_DATABASE');
      }
      return isRepDbDataset(dataset) ? normalizeRepDbDataset(dataset) : dataset.exercises;
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
    .sort((a, b) => b.score - a.score || typeRank(a.item.exerciseType) - typeRank(b.item.exerciseType) || priorityRank(a.item.priority) - priorityRank(b.item.priority) || a.item.nameTr.localeCompare(b.item.nameTr, 'tr'))
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
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.nameTr.localeCompare(b.nameTr, 'tr'))
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
  let best = 0;
  best = Math.max(best, fieldScore(item.nameTr, query, 120, 104, 88, 78, 58, 68));
  best = Math.max(best, fieldScore(item.nameEn, query, 112, 96, 82, 72, 52, 62));
  best = Math.max(best, fieldScore(item.id, query, 92, 76, 66, 58, 40, 46));
  (item.aliases || []).forEach(alias => {
    best = Math.max(best, fieldScore(alias, query, 70, 56, 48, 42, 28, 32));
  });
  return best;
}

function fieldScore(value, query, exactScore, prefixScore, wordScore, wordPrefixScore, containsScore, tokenScore) {
  const field = normalize(value);
  if (!field) return 0;
  const words = field.split(' ').filter(Boolean);
  const queryWords = query.split(' ').filter(Boolean);
  if (field === query) return exactScore;
  if (queryWords.length > 1 && field.startsWith(query)) return prefixScore;
  if (queryWords.length === 1 && words.includes(query)) return wordScore;
  if (queryWords.length === 1 && words.some(word => word.startsWith(query))) return wordPrefixScore;
  if (query.length >= 4 && field.includes(query)) return containsScore;
  if (queryWords.length > 1 && queryWords.every(token => words.some(word => word === token || word.startsWith(token) || (token.length >= 4 && word.includes(token))))) return tokenScore;
  return 0;
}

function priorityRank(priority) {
  return ({ core: 0, standard: 1, specialist: 2 })[priority] ?? 9;
}

function typeRank(type) {
  return ({ strength: 0, bodyweight: 1, activation: 2, core: 3, plyometric: 4, conditioning: 5, cardio: 6, mobility: 7, stretch: 8, rehabilitation: 9 })[type] ?? 9;
}

function isRepDbDataset(dataset) {
  return dataset.schema_version && dataset.exercises?.[0]?.name_en;
}

function normalizeRepDbDataset(dataset) {
  return dataset.exercises.map(exercise => {
    const image = repDbImage(exercise);
    return {
      schemaVersion: String(dataset.schema_version || 'repdb'),
      source: 'repdb',
      sourceVersion: dataset.name || dataset.schema_version || null,
      id: exercise.id,
      nameTr: exercise.name_en,
      nameEn: exercise.name_en,
      aliases: [exercise.name_de, exercise.name_es, exercise.body_part, exercise.equipment, ...(exercise.primary_muscles || [])].filter(Boolean),
      exerciseType: mapCategory(exercise.category, exercise.is_bodyweight),
      movementPattern: exercise.force_type || exercise.mechanic || 'general',
      laterality: exercise.is_unilateral ? 'unilateral' : 'bilateral',
      equipment: normalizeList([exercise.equipment || (exercise.is_bodyweight ? 'bodyweight' : null)]),
      primaryMuscles: normalizeList(exercise.primary_muscles || [exercise.body_part]),
      secondaryMuscles: normalizeList(exercise.secondary_muscles || []),
      defaultSection: mapCategory(exercise.category, exercise.is_bodyweight) === 'stretch' ? 'stretch' : 'strength',
      custom: false,
      active: true,
      variationOf: null,
      priority: exercise.difficulty === 'beginner' ? 'core' : 'standard',
      description: exercise.description_en || null,
      instructions: exercise.instructions_en || [],
      tips: exercise.tips_en || [],
      media: {
        image,
        start: repDbImage(exercise, 'start'),
        peak: repDbImage(exercise, 'peak'),
        youtube: null
      },
      repdb: exercise
    };
  });
}

function repDbImage(exercise, preferred = 'peak') {
  const flat = exercise.images?.flat || {};
  return flat[preferred] || flat.main || flat.peak || flat.start || null;
}

function normalizeList(values) {
  return values.filter(Boolean).map(value => normalize(value).replace(/\s+/g, '-'));
}

function mapCategory(category, bodyweight) {
  if (bodyweight) return 'bodyweight';
  return ({ stretching: 'stretch', stretch: 'stretch', cardio: 'cardio', mobility: 'mobility', plyometrics: 'plyometric' })[category] || category || 'strength';
}
