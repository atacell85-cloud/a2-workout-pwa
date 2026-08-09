# Architecture

## Current v1

The app is vanilla HTML/CSS/JS and local-first.

- `data/programs.js`: central program config. A2 is the first program, not UI hard-code.
- `storage.js`: versioned persistence and repository layer. UI does not call IndexedDB directly.
- `app.js`: UI rendering, workout flow, timers, export/import orchestration.
- `sw.js`: offline app-shell caching.

## Data model

Program -> Workout Day -> Section -> Exercise -> Set Prescription.

Workout history is stored as sessions and sets:

- `WorkoutSession`: `id`, `programId`, `workoutDayId`, `startedAt`, `completedAt`, `status`, `completedActivities`, `summary`, `sets`
- `WorkoutSet`: `id`, `sessionId`, `exerciseId`, `exerciseName`, `setNumber`, `setType`, `weight`, `reps`, `rir`, `completedAt`, `updatedAt`

Exercise history and progressive overload checks use `exerciseId`, not display names.

## Schema versioning

The current schema is `schemaVersion: 2`. JSON backups include schema version and export metadata. `storage.js` normalizes/restores data through one boundary so future migrations can be added without touching UI code.

## Future Commercial Architecture

The repository boundary is the replacement point for a future backend. An authenticated cloud version can keep the same session/set model and replace IndexedDB persistence with REST API, Supabase, or another database adapter. Multi-device sync can be implemented by syncing sessions and sets by stable IDs and timestamps. Program builder support can extend the program config model into persisted user/team programs. Coach features and analytics can read the same normalized set history. Subscription and account features should live outside this v1 UI and attach at the auth/API layer when needed.
