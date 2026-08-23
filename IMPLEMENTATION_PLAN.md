# Commercial Foundation Implementation Plan

## Current architecture

The application is a vanilla HTML/CSS/ES module PWA. `app.js` owns rendering and
the active workout/timer flow. `data/programs.js` contains the immutable A2
configuration. `storage.js` is the sole IndexedDB/localStorage repository
boundary and currently persists a schema-v2 `appData` document with settings,
sessions and one active workout draft. History and progressive-overload lookups
already use `exerciseId`; the legacy A2 identifiers must remain unchanged.

## Working behavior to preserve

- A2 day selection, workout execution, set create/edit/delete and active-session
  resume.
- Rest timer, forced completion, summary and history/progression display.
- Existing JSON backup/restore, CSV export, IndexedDB fallback and service-worker
  app-shell offline behavior.
- Current mobile card typography, spacing, safe-area layout and 375px rendering.

## Modules to add or modify

- Add `data/exercises-master-v1.1.json` as the supplied immutable canonical
  exercise source, plus an `exercise-service.js` search/lookup module.
- Add `program-service.js` for permanent Program v1 construction, validation,
  normalization, duplicate and compatibility adaptation to the legacy workout
  executor.
- Add `import-service.js` for preview state validation and deterministic
  import-v1.1-to-program finalization.
- Add `youtube-service.js` behind a no-key-safe service boundary.
- Extend `storage.js`, `app.js`, `index.html`, styles and app-shell caching.

## Storage and schema migration

Keep the existing `appData` key and session structure intact. Migrate it
non-destructively to app schema v3 by retaining v2 settings/sessions/draft and
adding `programs`, `programBuilderDraft`, `importPreviews`, `importHistory`,
`youtubeSearchCache` and `finalizations`. Every read normalizes old data; all
new writes pass through the repository. Permanent programs retain their
contractual `schemaVersion: "1.0"`; imports retain `schemaVersion: "1.1"`.
Finalization is performed in one repository write and records `importId` so
repeated submissions return the original program.

## Program Builder order

1. Establish persistent program records/drafts and validation.
2. Add Programs list, creation, draft resume, save/load/edit/duplicate.
3. Add Program -> Day -> Section -> Exercise/Instruction editing with ordered
   sibling operations.
4. Start exercise entries compactly with Sets, Reps and expandable details;
   support individual-set editing without requiring numeric fields.
5. Adapt saved program days into the existing executor, while retaining the A2
   config as a compatibility program.

## Canonical exercise database and search

Bundle the supplied 250-record source unchanged. Search normalizes Turkish and
English text and scores canonical Turkish/English names, aliases and IDs.
Selection stores canonical `exerciseId`; custom entries store `exerciseId: null`
and `customExerciseName`, so visible names never become identity.

## AI import preview and finalization

No file extraction/API is added in this stage. The UI/repository accepts an
import-v1.1 preview payload for future PDF/DOCX/XLSX adapters. Preview review
state is held separately from import fields. The finalizer rejects unresolved
exercises/content and blocking errors, validates graph and prescriptions,
normalizes order, strips evidence/audit fields, preserves reviewed values, and
commits atomically/idempotently to a permanent Program.

## Dynamic YouTube service boundary

The UI requests `{nameEn} proper form` only after an explicit tap. The service
checks a seven-day local cache first, uses the configured YouTube Data API v3
parameters only when a restricted runtime key is supplied, returns at most five
embeddable results, and opens the selected official embed. Missing key, offline
state, quota and network errors remain non-blocking.

## Existing-workout integration

The compatibility adapter turns a permanent day’s exercise prescriptions into
the legacy executor shape. Structured individual sets take precedence for
planned count/type, while free-form values render as readable prescriptions.
Sessions retain their original fields and stable IDs; custom exercises preserve
the custom label on logged sets.

## Test and regression plan

- Retain and run the current 375px Chrome smoke test for A2 completion,
  history, progression, backup/restore, CSV and service-worker registration.
- Extend browser smoke coverage for canonical/alias search, custom exercises,
  builder hierarchy, free-form fields, draft recovery, permanent save/edit/
  duplicate, deterministic import finalization and no-key YouTube fallback.
- Verify permanent program validation, import blocking rules and preservation of
  individual-set RPE/weight unit with focused module tests.
- Recheck no horizontal overflow at 375px and service-worker app-shell assets.
