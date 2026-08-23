import { currentUser, handleAccountRequest } from './account-api.js';

const OPENAI_URL = 'https://api.openai.com/v1/responses';
const YOUTUBE_SEARCH_URL = 'https://www.googleapis.com/youtube/v3/search';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/runtime-config.js') return runtimeConfig(request);
    const accountResponse = await handleAccountRequest(request, env, url.pathname);
    if (accountResponse) return accountResponse;
    if (url.pathname === '/api/health') return health(request, env);
    if (url.pathname === '/api/import/parse') return parseImport(request, env);
    if (url.pathname === '/api/import/jobs') return createImportJob(request, env, ctx);
    const importJobMatch = url.pathname.match(/^\/api\/import\/jobs\/([^/]+)(?:\/retry)?$/);
    if (importJobMatch) return handleImportJob(request, env, ctx, importJobMatch[1], url.pathname.endsWith('/retry'));
    if (url.pathname === '/api/youtube/search') return searchYouTube(request, env, url);
    return env.ASSETS.fetch(request);
  },

  async queue(batch, env) {
    for (const message of batch.messages) {
      await processImportJob(env, message.body?.jobId);
      message.ack();
    }
  }
};

async function health(request, env) {
  if (request.method !== 'GET') return apiError('METHOD_NOT_ALLOWED', 405, { Allow: 'GET' });
  return json({ ok: true, service: 'a2-workout', aiImportConfigured: Boolean(env.OPENAI_API_KEY), youtubeConfigured: Boolean(env.YOUTUBE_API_KEY) });
}

function runtimeConfig(request) {
  if (request.method !== 'GET') return apiError('METHOD_NOT_ALLOWED', 405, { Allow: 'GET' });
  return new Response("globalThis.A2_IMPORT_PARSER_PROVIDER = 'openai';", { headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' } });
}

async function parseImport(request, env) {
  if (request.method !== 'POST') return apiError('METHOD_NOT_ALLOWED', 405, { Allow: 'POST' });
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return apiError('UNSUPPORTED_CONTENT_TYPE', 415);
  const requestId = crypto.randomUUID();
  const started = Date.now();
  const config = importConfig(env);
  try {
    const rate = await env.AI_IMPORT_LIMITER?.limit({ key: request.headers.get('cf-connecting-ip') || 'unknown' });
    if (rate && !rate.success) throw coded('AI_IMPORT_RATE_LIMITED');
    const body = await readJson(request, config.maxInputBytes);
    if (!env.OPENAI_API_KEY) throw coded('OPENAI_API_KEY_MISSING');
    if (!body?.importId || !body?.normalizedDocument?.blocks?.length) throw coded('OPENAI_INVALID_RESPONSE');
    if (bytes(JSON.stringify(body.normalizedDocument)) > config.maxInputBytes) throw coded('DOCUMENT_TOO_LARGE');

    const { payload, upstream, attempts } = await requestOpenAI({ apiKey: env.OPENAI_API_KEY, config, input: body, requestId });
    let preview;
    try { preview = JSON.parse(extractStructuredOutput(payload)); } catch (error) { if (error.code) throw error; throw coded('OPENAI_INVALID_RESPONSE'); }
    validatePreview(preview, body.importId, body.normalizedDocument);
    return json({ preview, observability: observability({ requestId, config, payload, upstream, attempts, started, status: 'ok' }) }, 200, { 'X-Import-Request-Id': requestId });
  } catch (error) {
    const code = error.code || 'OPENAI_REQUEST_FAILED';
    const metadata = { requestId, model: config.model, attemptCount: error.attempts || 0, durationMs: Date.now() - started, status: code };
    console.warn(JSON.stringify(metadata));
    return json({ code, observability: metadata }, statusFor(code), { 'X-Import-Request-Id': requestId });
  }
}

async function createImportJob(request, env, ctx) {
  if (request.method !== 'POST') return apiError('METHOD_NOT_ALLOWED', 405, { Allow: 'POST' });
  const contentType = request.headers.get('content-type')?.toLowerCase() || '';
  if (!contentType.startsWith('application/json') && !contentType.startsWith('multipart/form-data')) return apiError('UNSUPPORTED_CONTENT_TYPE', 415);
  const user = await currentUser(request, env);
  if (!user) return apiError('AUTH_REQUIRED', 401);
  if (!sameOrigin(request)) return apiError('AUTH_ORIGIN_INVALID', 403);
  const config = importConfig(env);
  const body = contentType.startsWith('multipart/form-data') ? await readImportForm(request, config) : await readJson(request, config.maxInputBytes);
  if (!body?.importId || !body?.normalizedDocument?.blocks?.length) return apiError('OPENAI_INVALID_RESPONSE', 400);
  const normalizedJson = JSON.stringify(sanitize(body.normalizedDocument));
  if (bytes(normalizedJson) > config.maxInputBytes) return apiError('DOCUMENT_TOO_LARGE', 413);
  const now = new Date().toISOString();
  const source = body.normalizedDocument;
  await env.DB.prepare(`INSERT INTO import_jobs (id, user_id, status, source_json, normalized_document_json, raw_file_name, raw_file_type, raw_file_size, attempts, created_at, updated_at)
    VALUES (?, ?, 'queued', ?, ?, ?, ?, ?, 0, ?, ?)
    ON CONFLICT(user_id, id) DO UPDATE SET status = 'queued', error_code = NULL, preview_json = NULL, observability_json = NULL, openai_response_id = NULL, normalized_document_json = excluded.normalized_document_json, source_json = excluded.source_json, raw_file_name = excluded.raw_file_name, raw_file_type = excluded.raw_file_type, raw_file_size = excluded.raw_file_size, updated_at = excluded.updated_at`)
    .bind(body.importId, user.id, JSON.stringify({ fileName: source.fileName, fileType: source.fileType, language: source.language || null }), normalizedJson, body.file?.name || null, body.file?.type || null, body.file?.size || null, now, now)
    .run();
  if (body.file) {
    if (!env.OPENAI_API_KEY) return apiError('OPENAI_API_KEY_MISSING', 503);
    try {
      const rawFile = await rawFileFromUpload(body.file, config);
      const requestId = crypto.randomUUID();
      const started = Date.now();
      const { payload, upstream, attempts } = await createOpenAIBackgroundResponse({ apiKey: env.OPENAI_API_KEY, config, input: { importId: body.importId, normalizedDocument: body.normalizedDocument, rawFile }, requestId });
      const metadata = observability({ requestId, config, payload, upstream, attempts, started, status: payload.status || 'queued' });
      await env.DB.prepare("UPDATE import_jobs SET status = 'processing', openai_response_id = ?, observability_json = ?, attempts = attempts + 1, updated_at = ? WHERE user_id = ? AND id = ?")
        .bind(payload.id, JSON.stringify(metadata), new Date().toISOString(), user.id, body.importId)
        .run();
      return json({ importId: body.importId, status: 'queued' }, 202);
    } catch (error) {
      const code = error.code || 'OPENAI_REQUEST_FAILED';
      await env.DB.prepare("UPDATE import_jobs SET status = 'failed', error_code = ?, updated_at = ? WHERE user_id = ? AND id = ?").bind(code, new Date().toISOString(), user.id, body.importId).run();
      return apiError(code, statusFor(code));
    }
  }
  await enqueueImportJob(env, ctx, body.importId);
  return json({ importId: body.importId, status: 'queued' }, 202);
}

async function handleImportJob(request, env, ctx, importId, retry) {
  const user = await currentUser(request, env);
  if (!user) return apiError('AUTH_REQUIRED', 401);
  if (retry) {
    if (request.method !== 'POST') return apiError('METHOD_NOT_ALLOWED', 405, { Allow: 'POST' });
    if (!sameOrigin(request)) return apiError('AUTH_ORIGIN_INVALID', 403);
    const row = await env.DB.prepare('SELECT id FROM import_jobs WHERE user_id = ? AND id = ?').bind(user.id, importId).first();
    if (!row) return apiError('IMPORT_JOB_NOT_FOUND', 404);
    await env.DB.prepare("UPDATE import_jobs SET status = 'queued', error_code = NULL, updated_at = ? WHERE user_id = ? AND id = ?").bind(new Date().toISOString(), user.id, importId).run();
    await enqueueImportJob(env, ctx, importId);
    return json({ importId, status: 'queued' }, 202);
  }
  if (request.method !== 'GET') return apiError('METHOD_NOT_ALLOWED', 405, { Allow: 'GET' });
  let row = await env.DB.prepare('SELECT id, status, error_code, source_json, normalized_document_json, preview_json, observability_json, openai_response_id, attempts, created_at, updated_at, completed_at FROM import_jobs WHERE user_id = ? AND id = ?').bind(user.id, importId).first();
  if (!row) return apiError('IMPORT_JOB_NOT_FOUND', 404);
  if (row.status === 'processing' && row.openai_response_id) row = await syncOpenAIBackgroundJob(env, row);
  return json({
    importId: row.id,
    status: row.status,
    errorCode: row.error_code || null,
    source: parseJson(row.source_json),
    preview: parseJson(row.preview_json),
    observability: parseJson(row.observability_json),
    attempts: row.attempts,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at
  });
}

async function enqueueImportJob(env, ctx, jobId) {
  if (env.IMPORT_QUEUE) await env.IMPORT_QUEUE.send({ jobId });
  else ctx?.waitUntil?.(processImportJob(env, jobId));
}

async function processImportJob(env, jobId) {
  if (!jobId) return;
  const job = await env.DB.prepare('SELECT * FROM import_jobs WHERE id = ?').bind(jobId).first();
  if (!job || !['queued', 'failed'].includes(job.status)) return;
  const now = new Date().toISOString();
  const attempts = Number(job.attempts || 0) + 1;
  await env.DB.prepare("UPDATE import_jobs SET status = 'processing', attempts = ?, updated_at = ? WHERE id = ?").bind(attempts, now, jobId).run();
  const config = importConfig(env);
  try {
    if (!env.OPENAI_API_KEY) throw coded('OPENAI_API_KEY_MISSING');
    const normalizedDocument = parseJson(job.normalized_document_json);
    if (!normalizedDocument?.blocks?.length) throw coded('OPENAI_INVALID_RESPONSE');
    const requestId = crypto.randomUUID();
    const started = Date.now();
    const { payload, upstream, attempts: upstreamAttempts } = await requestOpenAI({ apiKey: env.OPENAI_API_KEY, config, input: { importId: job.id, normalizedDocument }, requestId });
    let preview;
    try { preview = JSON.parse(extractStructuredOutput(payload)); } catch (error) { if (error.code) throw error; throw coded('OPENAI_INVALID_RESPONSE'); }
    validatePreview(preview, job.id, normalizedDocument);
    const metadata = observability({ requestId, config, payload, upstream, attempts: upstreamAttempts, started, status: 'ok' });
    await env.DB.prepare("UPDATE import_jobs SET status = 'done', preview_json = ?, observability_json = ?, error_code = NULL, updated_at = ?, completed_at = ? WHERE id = ?").bind(JSON.stringify(preview), JSON.stringify(metadata), new Date().toISOString(), new Date().toISOString(), job.id).run();
  } catch (error) {
    const code = error.code || 'OPENAI_REQUEST_FAILED';
    console.warn(JSON.stringify({ jobId, status: code, attempts }));
    await env.DB.prepare("UPDATE import_jobs SET status = 'failed', error_code = ?, updated_at = ? WHERE id = ?").bind(code, new Date().toISOString(), job.id).run();
  }
}

async function searchYouTube(request, env, url) {
  if (request.method !== 'GET') return apiError('METHOD_NOT_ALLOWED', 405, { Allow: 'GET' });
  const query = String(url.searchParams.get('q') || '').trim().slice(0, 120);
  if (!env.YOUTUBE_API_KEY) return apiError('YOUTUBE_API_KEY_MISSING', 503);
  if (!query) return apiError('YOUTUBE_QUERY_MISSING', 400);
  try {
    const endpoint = new URL(YOUTUBE_SEARCH_URL);
    Object.entries({ key: env.YOUTUBE_API_KEY, q: query, part: 'snippet', type: 'video', videoEmbeddable: 'true', safeSearch: 'strict', maxResults: '5', relevanceLanguage: 'en' }).forEach(([key, value]) => endpoint.searchParams.set(key, value));
    const response = await fetch(endpoint, { headers: { Referer: 'https://a2-workout.antrenmankocu.workers.dev/' } });
    if (!response.ok) throw coded(`YOUTUBE_${response.status}`);
    const payload = await response.json();
    const videos = (payload.items || []).slice(0, 5).map(item => ({
      videoId: item.id?.videoId || null,
      title: item.snippet?.title || '',
      channelTitle: item.snippet?.channelTitle || '',
      thumbnailUrl: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || ''
    })).filter(item => item.videoId && item.thumbnailUrl);
    return json({ query, videos });
  } catch (error) {
    console.warn(JSON.stringify({ status: error.code || 'YOUTUBE_REQUEST_FAILED' }));
    return apiError(error.code || 'YOUTUBE_REQUEST_FAILED', 502);
  }
}

export async function requestOpenAI({ apiKey, config, input, requestId, fetchImpl = fetch, sleep = delay }) {
  let attempts = 0;
  let lastError;
  while (attempts <= config.maxRetries) {
    attempts += 1;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);
      let upstream;
      try {
        upstream = await fetchImpl(OPENAI_URL, {
          method: 'POST', signal: controller.signal,
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Client-Request-Id': requestId },
          body: JSON.stringify(requestBody(config.model, input, requestId))
        });
      } catch (error) {
        throw coded(controller.signal.aborted || error?.name === 'AbortError' ? 'OPENAI_TIMEOUT' : 'OPENAI_NETWORK_ERROR');
      } finally { clearTimeout(timer); }
      if (!upstream.ok) {
        const error = coded(mapOpenAIStatus(upstream.status));
        error.status = upstream.status;
        error.retryAfterMs = retryAfter(upstream.headers.get('retry-after'));
        throw error;
      }
      return { payload: await upstream.json(), upstream, attempts };
    } catch (error) {
      error.attempts = attempts;
      lastError = error;
      if (attempts > config.maxRetries || !retryable(error)) throw error;
      await sleep(Math.min(error.retryAfterMs ?? config.retryBaseMs * 2 ** (attempts - 1), 10000));
    }
  }
  throw lastError;
}

async function createOpenAIBackgroundResponse({ apiKey, config, input, requestId, fetchImpl = fetch }) {
  const upstream = await fetchImpl(OPENAI_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Client-Request-Id': requestId },
    body: JSON.stringify(requestBody(config.model, input, requestId, { background: true }))
  });
  if (!upstream.ok) {
    const error = coded(mapOpenAIStatus(upstream.status));
    error.status = upstream.status;
    throw error;
  }
  return { payload: await upstream.json(), upstream, attempts: 1 };
}

async function retrieveOpenAIResponse({ apiKey, responseId, fetchImpl = fetch }) {
  const upstream = await fetchImpl(`${OPENAI_URL}/${encodeURIComponent(responseId)}`, { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' } });
  if (!upstream.ok) {
    const error = coded(mapOpenAIStatus(upstream.status));
    error.status = upstream.status;
    throw error;
  }
  return { payload: await upstream.json(), upstream };
}

async function syncOpenAIBackgroundJob(env, row) {
  const config = importConfig(env);
  try {
    if (!env.OPENAI_API_KEY) throw coded('OPENAI_API_KEY_MISSING');
    const { payload, upstream } = await retrieveOpenAIResponse({ apiKey: env.OPENAI_API_KEY, responseId: row.openai_response_id });
    if (payload.status === 'queued' || payload.status === 'in_progress') return row;
    const normalizedDocument = parseJson(row.normalized_document_json);
    if (payload.status !== 'completed') throw coded(payload.error?.code || 'OPENAI_REQUEST_FAILED');
    let preview;
    try { preview = JSON.parse(extractStructuredOutput(payload)); } catch (error) { if (error.code) throw error; throw coded('OPENAI_INVALID_RESPONSE'); }
    validatePreview(preview, row.id, normalizedDocument);
    const metadata = { ...(parseJson(row.observability_json) || {}), status: 'ok', model: payload.model || config.model, inputTokens: payload.usage?.input_tokens ?? null, outputTokens: payload.usage?.output_tokens ?? null, totalTokens: payload.usage?.total_tokens ?? null, openaiRequestId: upstream.headers?.get?.('x-request-id') || payload.id || row.openai_response_id };
    const now = new Date().toISOString();
    await env.DB.prepare("UPDATE import_jobs SET status = 'done', preview_json = ?, observability_json = ?, error_code = NULL, updated_at = ?, completed_at = ? WHERE id = ?")
      .bind(JSON.stringify(preview), JSON.stringify(metadata), now, now, row.id)
      .run();
    return { ...row, status: 'done', preview_json: JSON.stringify(preview), observability_json: JSON.stringify(metadata), error_code: null, updated_at: now, completed_at: now };
  } catch (error) {
    const code = error.code || 'OPENAI_REQUEST_FAILED';
    await env.DB.prepare("UPDATE import_jobs SET status = 'failed', error_code = ?, updated_at = ? WHERE id = ?").bind(code, new Date().toISOString(), row.id).run();
    return { ...row, status: 'failed', error_code: code, updated_at: new Date().toISOString() };
  }
}

export function extractStructuredOutput(payload) {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) return payload.output_text;
  for (const item of payload?.output || []) for (const content of item?.content || []) {
    if ((content.type === 'output_text' || content.type === 'text') && typeof content.text === 'string' && content.text.trim()) return content.text;
  }
  throw coded('OPENAI_INVALID_RESPONSE');
}

export function mapOpenAIStatus(status) {
  if (status === 401 || status === 403) return 'OPENAI_AUTH_FAILED';
  if (status === 429) return 'OPENAI_RATE_LIMITED';
  return 'OPENAI_REQUEST_FAILED';
}

function importConfig(env) { return { model: env.OPENAI_IMPORT_MODEL || 'gpt-4.1-mini', timeoutMs: positive(env.OPENAI_IMPORT_TIMEOUT_MS, 45000), maxRetries: nonNegative(env.OPENAI_IMPORT_MAX_RETRIES, 1), retryBaseMs: positive(env.OPENAI_IMPORT_RETRY_BASE_MS, 750), maxInputBytes: positive(env.OPENAI_IMPORT_MAX_INPUT_BYTES, 180000), maxFileBytes: positive(env.OPENAI_IMPORT_MAX_FILE_BYTES, 6000000) }; }
function requestBody(model, input, requestId, options = {}) {
  const content = [
    { type: 'input_text', text: JSON.stringify({ importId: input.importId, normalizedDocument: sanitize(input.normalizedDocument), note: input.rawFile ? 'The original uploaded file is attached as input_file. Use the original file as the primary source. Use normalizedDocument only as helper context.' : 'No original file is attached. Use normalizedDocument as the source.' }) }
  ];
  if (input.rawFile?.base64) content.push({ type: 'input_file', filename: input.rawFile.name, file_data: `data:${input.rawFile.type || 'application/octet-stream'};base64,${input.rawFile.base64}` });
  return { model, temperature: 0, metadata: { import_request_id: requestId }, background: Boolean(options.background), input: [{ role: 'developer', content: [{ type: 'input_text', text: prompt() }] }, { role: 'user', content }], text: { format: { type: 'json_schema', name: 'import_program_v1_1', strict: true, schema: responseSchema } } };
}
function prompt() { return 'Extract, do not coach. Convert only source evidence into the supplied JSON shape. Never add exercises, prescriptions, RIR, RPE, rest, tempo or advice. The product uses a simplified routine model: Program -> Day -> Exercise -> sets and reps. For every day, create exactly one section titled "Ana Antrenman" with sectionType "strength"; do not invent extra section headings. If the source clearly contains warmup, cardio, mobility or notes, preserve them as instructions or item notes inside the same "Ana Antrenman" section instead of creating additional sections. exerciseMatch must be null. Preserve free-form prescription text. Put ambiguous source content in unparsedContent.'; }
function sanitize(document) { return { fileName: document.fileName, fileType: document.fileType, language: document.language || null, blocks: document.blocks.filter(block => block?.type && (block.text || block.rows)).slice(0, 1000) }; }
function validatePreview(value, importId, document) { if (!value || value.schemaVersion !== '1.1' || !value.program?.name || !Array.isArray(value.program.days)) throw coded('OPENAI_SCHEMA_VALIDATION_FAILED'); value.importId = importId; value.importedAt ||= new Date().toISOString(); value.source ||= { fileName: document.fileName, fileType: document.fileType, language: document.language || null, documentTitle: null }; value.warnings ||= []; value.unparsedContent ||= []; }
function retryable(error) { return error.code === 'OPENAI_RATE_LIMITED' || error.code === 'OPENAI_NETWORK_ERROR' || (error.code === 'OPENAI_REQUEST_FAILED' && error.status >= 500); }
function retryAfter(value) { const seconds = Number(value); return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null; }
function observability({ requestId, config, payload, upstream, attempts, started, status }) { const usage = payload?.usage || {}; return { requestId, model: payload?.model || config.model, attemptCount: attempts, durationMs: Date.now() - started, status, inputTokens: usage.input_tokens ?? null, outputTokens: usage.output_tokens ?? null, totalTokens: usage.total_tokens ?? null, openaiRequestId: upstream?.headers?.get('x-request-id') || payload?.id || null }; }
async function readJson(request, limit) { const declared = Number(request.headers.get('content-length') || 0); if (declared > limit * 2) throw coded('DOCUMENT_TOO_LARGE'); const text = await request.text(); if (bytes(text) > limit * 2) throw coded('DOCUMENT_TOO_LARGE'); try { return JSON.parse(text); } catch { throw coded('OPENAI_INVALID_RESPONSE'); } }
async function readImportForm(request, config) {
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > config.maxFileBytes + config.maxInputBytes * 2) throw coded('DOCUMENT_TOO_LARGE');
  const form = await request.formData();
  const importId = String(form.get('importId') || '');
  let normalizedDocument;
  try { normalizedDocument = JSON.parse(String(form.get('normalizedDocument') || '')); } catch { throw coded('OPENAI_INVALID_RESPONSE'); }
  const file = form.get('file');
  return { importId, normalizedDocument, file: file && typeof file.arrayBuffer === 'function' ? file : null };
}
async function rawFileFromUpload(file, config) {
  if (!supportedUploadFile(file)) throw coded('UNSUPPORTED_FILE');
  if (file.size > config.maxFileBytes) throw coded('DOCUMENT_TOO_LARGE');
  return { name: file.name || 'program', type: file.type || contentTypeFor(file.name), size: file.size || 0, base64: arrayBufferToBase64(await file.arrayBuffer()) };
}
function supportedUploadFile(file) { return ['pdf', 'docx', 'xlsx'].includes(String(file.name || '').split('.').pop()?.toLowerCase()); }
function contentTypeFor(name) { const ext = String(name || '').split('.').pop()?.toLowerCase(); return ext === 'pdf' ? 'application/pdf' : ext === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : ext === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/octet-stream'; }
function arrayBufferToBase64(buffer) { let binary = ''; const bytes = new Uint8Array(buffer); for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(binary); }
function statusFor(code) { if (code === 'AI_IMPORT_RATE_LIMITED' || code === 'OPENAI_RATE_LIMITED') return 429; if (code === 'DOCUMENT_TOO_LARGE') return 413; if (code === 'OPENAI_API_KEY_MISSING') return 503; if (code === 'OPENAI_AUTH_FAILED') return 502; if (code === 'OPENAI_TIMEOUT') return 504; return 400; }
function json(body, status = 200, headers = {}) { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } }); }
function apiError(code, status, headers) { return json({ code }, status, headers); }
function sameOrigin(request) { const origin = request.headers.get('origin'); return !origin || origin === new URL(request.url).origin; }
function parseJson(value) { try { return value ? JSON.parse(value) : null; } catch { return null; } }
function bytes(value) { return new TextEncoder().encode(value).byteLength; }
function positive(value, fallback) { return Number(value) > 0 ? Number(value) : fallback; }
function nonNegative(value, fallback) { return Number.isInteger(Number(value)) && Number(value) >= 0 ? Number(value) : fallback; }
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function coded(code) { return Object.assign(new Error(code), { code }); }

// OpenAI strict transport schema. The canonical product schema remains unchanged.
const n = type => ({ type: [type, 'null'] });
const closed = properties => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const ref = closed({ page: n('integer'), sheet: n('string'), cellRange: n('string'), text: n('string') });
const source = closed({ fileName: { type: 'string' }, fileType: { type: 'string', enum: ['pdf', 'docx', 'xlsx'] }, language: n('string'), documentTitle: n('string') });
const set = closed({ setNumber: { type: 'integer' }, setType: { type: 'string', enum: ['warmup', 'working', 'activation', 'core', 'backoff', 'drop', 'custom'] }, reps: n('integer'), repsText: n('string'), weight: n('number'), weightUnit: { type: ['string', 'null'], enum: ['kg', 'lb', null] }, weightText: n('string'), rir: n('number'), rirText: n('string'), rpe: n('number'), rpeText: n('string'), restSeconds: n('integer'), restText: n('string'), notes: n('string') });
const prescription = closed({ sets: n('integer'), setsText: n('string'), repsMin: n('integer'), repsMax: n('integer'), repsText: n('string'), weight: n('number'), weightUnit: { type: ['string', 'null'], enum: ['kg', 'lb', null] }, weightText: n('string'), rir: n('number'), rirText: n('string'), rpe: n('number'), rpeText: n('string'), restSeconds: n('integer'), restText: n('string'), tempo: n('string'), tempoText: n('string'), durationSeconds: n('integer'), durationText: n('string'), distance: n('number'), distanceUnit: { type: ['string', 'null'], enum: ['m', 'km', 'mi', null] }, distanceText: n('string'), individualSets: { type: 'array', items: set } });
const match = closed({ status: { type: 'string', enum: ['matched', 'probable', 'unmatched', 'custom'] }, exerciseId: n('string'), matchedName: n('string'), score: n('number'), candidates: { type: 'array', items: closed({ exerciseId: { type: 'string' }, name: { type: 'string' }, score: { type: 'number' } }) } });
const exercise = closed({ itemType: { type: 'string', enum: ['exercise'] }, order: { type: 'integer' }, sourceExerciseName: { type: 'string' }, normalizedExerciseName: { type: 'string' }, exerciseMatch: { type: ['object', 'null'], additionalProperties: false, properties: match.properties, required: match.required }, prescription, notes: n('string'), sourceReference: ref });
const instruction = closed({ itemType: { type: 'string', enum: ['instruction'] }, order: { type: 'integer' }, text: { type: 'string' }, sourceReference: ref });
const section = closed({ title: { type: 'string' }, sectionType: { type: 'string', enum: ['warmup', 'activation', 'strength', 'core', 'cardio', 'stretch', 'mobility', 'cooldown', 'custom'] }, order: { type: 'integer' }, notes: n('string'), sourceReference: ref, items: { type: 'array', items: { anyOf: [exercise, instruction] } } });
const day = closed({ name: { type: 'string' }, order: { type: 'integer' }, notes: n('string'), sourceReference: ref, sections: { type: 'array', items: section } });
const warning = closed({ code: { type: 'string' }, severity: { type: 'string', enum: ['info', 'warning', 'error'] }, message: { type: 'string' }, dayOrder: n('integer'), sectionOrder: n('integer'), exerciseOrder: n('integer'), sourceReference: ref });
const unparsed = closed({ text: { type: 'string' }, reason: { type: 'string' }, sourceReference: ref });
const responseSchema = closed({ schemaVersion: { type: 'string', enum: ['1.1'] }, importId: { type: 'string' }, importedAt: { type: 'string' }, source, program: closed({ id: n('string'), name: { type: 'string' }, description: n('string'), sourceType: { type: 'string', enum: ['pdf-import', 'docx-import', 'xlsx-import'] }, notes: n('string'), days: { type: 'array', items: day } }), warnings: { type: 'array', items: warning }, unparsedContent: { type: 'array', items: unparsed } });
