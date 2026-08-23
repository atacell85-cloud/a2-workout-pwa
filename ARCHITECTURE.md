# Architecture

## Product Source of Truth

User-facing AKS product behavior is governed by the repository-level `/product`
package. Read its product spec, UX flows, execution protocol, feature registry,
and relevant schemas/specs before changing a feature. For exercise work, the
canonical source is `/product/data/exercises.v1.json`; the runtime database in
this app remains a compatibility copy until an explicit data migration.

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

The current app-data schema is `schemaVersion: 5`. It preserves prior settings,
sessions and active workout drafts, and adds persistent programs, Program Builder
draft, import previews/history/finalization keys and YouTube metadata cache.
Permanent programs independently use contractual `schemaVersion: "1.0"`; import
previews use `"1.1"`. JSON backups include app schema version and export metadata.
`storage.js` normalizes/restores data through one boundary so future migrations can
be added without touching UI code.

## Commercial modules

- `exercise-service.js`: immutable 250-record canonical database loader and
  Turkish/English/alias search.
- `program-service.js`: Program v1 construction, graph validation, order
  normalization and legacy workout adapter.
- `import-service.js`: deterministic, non-inventive import v1.1 finalizer.
- `document-extractor.js`: browser-local PDF text stream, DOCX ve XLSX
  extraction; binary fixture regression kapsamı `tests/fixtures` altındadır.
- `local-import-parser.js`: extractor çıktısından bağımsız, değiştirilebilir
  ImportParser adapterıdır; gerçek AI provider burada değil bu sınırın arkasında
  yer alacaktır.
- `openai-import-parser.js`: OpenAI modunda yalnız `/api/import/parse` proxy
  istemcisidir. `scripts/import-proxy-server.mjs` Responses Structured Outputs
  çağrısını, input guard'ını, abort timeout'ını, sınırlı transient retry/backoff'u
  ve token/latency/request-ID observability bilgisini yürütür.
- `worker/index.js`: Cloudflare Workers runtime adapterı. Aynı strict transport
  schema, timeout/retry/error mapping ve observability davranışını korur; `/api/health`
  ve `/api/import/parse` yollarını işler, diğer yolları Static Assets binding'ine
  geçirir. `AI_IMPORT_LIMITER` Cloudflare Rate Limiting binding'i IP tabanlı pilot
  abuse koruması sağlar.
- `youtube-service.js`: cache-first dynamic YouTube search boundary; no API key is
  required to start or use the PWA.

## Cloudflare delivery

`scripts/build-cloudflare-assets.mjs` yalnız uygulamanın allowlist edilmiş runtime
assetlerini `.cloudflare-assets` içine hazırlar; `.env`, testler ve kaynak secretlar
deploy edilmez. `wrangler.jsonc`, API yollarını Worker-first, kalan yolları Static
Assets olarak yapılandırır. Production browser istemcisi varsayılan same-origin
`/api/import/parse` yolunu kullanır; localhost override yalnız geliştirme/test içindir.
`sw.js` API yollarını cache dışı bırakır, böylece offline cache yalnız app shell'dir.

## Future Commercial Architecture

The repository boundary is the replacement point for a future backend. An authenticated cloud version can keep the same session/set model and replace IndexedDB persistence with REST API, Supabase, or another database adapter. Multi-device sync can be implemented by syncing sessions and sets by stable IDs and timestamps. Program builder support can extend the program config model into persisted user/team programs. Coach features and analytics can read the same normalized set history. Subscription and account features should live outside this v1 UI and attach at the auth/API layer when needed.
