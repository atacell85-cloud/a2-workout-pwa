// Public builds deliberately contain no developer or demo workout content.
// Existing local records preserve their own copied program data.
export const A2_PROGRAM = { id: 'legacy-program', name: '', workoutDays: [] };
export function findExercise() { return null; }
export function findWorkoutDay() { return null; }
export function exercisesForDay() { return []; }
