import http from 'node:http';
import crypto from 'node:crypto';

// Node 24 loads local development settings without introducing a dotenv dependency.
try { process.loadEnvFile('.env'); } catch (error) { if (error.code !== 'ENOENT') throw error; }

export function proxyConfig(env = process.env) {
  return {
    model: env.OPENAI_IMPORT_MODEL || 'gpt-4.1-mini',
    timeoutMs: positive(env.OPENAI_IMPORT_TIMEOUT_MS, 45000),
    maxRetries: nonNegative(env.OPENAI_IMPORT_MAX_RETRIES, 1),
    retryBaseMs: positive(env.OPENAI_IMPORT_RETRY_BASE_MS, 750),
    maxInputBytes: positive(env.OPENAI_IMPORT_MAX_INPUT_BYTES, 180000)
  };
}

export function mapOpenAIStatus(status) {
  if (status === 401 || status === 403) return 'OPENAI_AUTH_FAILED';
  if (status === 429) return 'OPENAI_RATE_LIMITED';
  if (status >= 500 && status <= 599) return 'OPENAI_REQUEST_FAILED';
  return 'OPENAI_REQUEST_FAILED';
}

export function extractStructuredOutput(payload) {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) return payload.output_text;
  for (const item of payload?.output || []) for (const content of item?.content || []) {
    if ((content.type === 'output_text' || content.type === 'text') && typeof content.text === 'string' && content.text.trim()) return content.text;
  }
  throw coded('OPENAI_INVALID_RESPONSE');
}

export function createImportHandler({ fetchImpl = fetch, apiKey = process.env.OPENAI_API_KEY, config = proxyConfig() } = {}) {
  return async (request, response) => {
    const origin = request.headers.origin; response.setHeader('Access-Control-Allow-Origin', process.env.IMPORT_PROXY_ORIGIN || (/^http:\/\/localhost:\d+$/.test(origin || '') ? origin : 'http://localhost:8080')); response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (request.method === 'OPTIONS') return response.writeHead(204).end();
    if (request.method !== 'POST' || request.url !== '/api/import/parse') return response.writeHead(404).end();
    const requestId = crypto.randomUUID(); const started = Date.now();
    try {
      const body = await jsonBody(request, config.maxInputBytes);
      if (!apiKey) throw coded('OPENAI_API_KEY_MISSING');
      if (!body?.importId || !body?.normalizedDocument?.blocks?.length) throw coded('OPENAI_INVALID_RESPONSE');
      if (Buffer.byteLength(JSON.stringify(body.normalizedDocument), 'utf8') > config.maxInputBytes) throw coded('DOCUMENT_TOO_LARGE');
      const { payload, upstream, attempts } = await requestOpenAI({ fetchImpl, apiKey, config, input: body, requestId });
      const output = extractStructuredOutput(payload); let preview;
      try { preview = JSON.parse(output); } catch { throw coded('OPENAI_INVALID_RESPONSE'); }
      validatePreview(preview, body.importId, body.normalizedDocument);
      const metadata = observability({ requestId, config, payload, upstream, attempts, started, status: 'ok' });
      response.writeHead(200, { 'Content-Type': 'application/json', 'X-Import-Request-Id': requestId }); response.end(JSON.stringify({ preview, observability: metadata }));
    } catch (error) {
      const code = error.code || 'OPENAI_REQUEST_FAILED'; const metadata = { requestId, model: config.model, attemptCount: error.attempts || 0, durationMs: Date.now() - started, status: code };
      console.warn(JSON.stringify(metadata));
      response.writeHead(code === 'DOCUMENT_TOO_LARGE' ? 413 : 400, { 'Content-Type': 'application/json', 'X-Import-Request-Id': requestId }); response.end(JSON.stringify({ code, observability: metadata }));
    }
  };
}

export async function requestOpenAI({ fetchImpl, apiKey, config, input, requestId, sleep = wait }) {
  let attempts = 0; let lastError;
  while (attempts <= config.maxRetries) {
    attempts += 1;
    try {
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), config.timeoutMs);
      let upstream;
      try { upstream = await fetchImpl('https://api.openai.com/v1/responses', { method: 'POST', signal: controller.signal, headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Client-Request-Id': requestId }, body: JSON.stringify(requestBody(config.model, input, requestId)) }); }
      catch (error) { if (controller.signal.aborted || error?.name === 'AbortError') throw coded('OPENAI_TIMEOUT'); throw coded('OPENAI_NETWORK_ERROR'); }
      finally { clearTimeout(timer); }
      if (!upstream.ok) { const error = coded(mapOpenAIStatus(upstream.status)); error.status = upstream.status; error.retryAfterMs = retryAfter(upstream.headers?.get?.('retry-after')); throw error; }
      return { payload: await upstream.json(), upstream, attempts };
    } catch (error) {
      error.attempts = attempts; lastError = error;
      if (attempts > config.maxRetries || !retryable(error)) throw error;
      await sleep(Math.min(error.retryAfterMs ?? config.retryBaseMs * 2 ** (attempts - 1), 10000));
    }
  }
  throw lastError;
}

function requestBody(model, input, requestId) { return { model, temperature: 0, metadata: { import_request_id: requestId }, input: [{ role: 'developer', content: [{ type: 'input_text', text: prompt() }] }, { role: 'user', content: [{ type: 'input_text', text: JSON.stringify({ importId: input.importId, normalizedDocument: sanitize(input.normalizedDocument) }) }] }], text: { format: { type: 'json_schema', name: 'import_program_v1_1', strict: true, schema: responseSchema } } }; }
function retryable(error) { return error.code === 'OPENAI_RATE_LIMITED' || error.code === 'OPENAI_NETWORK_ERROR' || (error.code === 'OPENAI_REQUEST_FAILED' && error.status >= 500); }
function retryAfter(value) { const seconds = Number(value); return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null; }
function observability({ requestId, config, payload, upstream, attempts, started, status }) { const usage = payload?.usage || {}; return { requestId, model: payload?.model || config.model, attemptCount: attempts, durationMs: Date.now() - started, status, inputTokens: usage.input_tokens ?? null, outputTokens: usage.output_tokens ?? null, totalTokens: usage.total_tokens ?? null, openaiRequestId: upstream?.headers?.get?.('x-request-id') || payload?.id || null }; }
function prompt() { return 'Extract, do not coach. Convert only source evidence into the supplied JSON shape. Never add exercises, prescriptions, RIR, RPE, rest, tempo, sections or advice. exerciseMatch must be null. Preserve free-form prescription text. Put ambiguous source content in unparsedContent.'; }
function sanitize(document) { return { fileName: document.fileName, fileType: document.fileType, language: document.language || null, blocks: document.blocks.filter(block => block?.type && (block.text || block.rows)).slice(0, 1000) }; }
function validatePreview(value, importId, document) { if (!value || value.schemaVersion !== '1.1' || !value.program?.name || !Array.isArray(value.program.days)) throw coded('OPENAI_SCHEMA_VALIDATION_FAILED'); value.importId = importId; value.importedAt ||= new Date().toISOString(); value.source ||= { fileName: document.fileName, fileType: document.fileType, language: document.language || null, documentTitle: null }; value.warnings ||= []; value.unparsedContent ||= []; }
function jsonBody(request, limit) { return new Promise((resolve, reject) => { let size = 0; const chunks = []; request.on('data', chunk => { size += chunk.length; if (size > limit * 2) reject(coded('DOCUMENT_TOO_LARGE')); else chunks.push(chunk); }); request.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(coded('OPENAI_INVALID_RESPONSE')); } }); request.on('error', () => reject(coded('OPENAI_NETWORK_ERROR'))); }); }
function positive(value, fallback) { return Number(value) > 0 ? Number(value) : fallback; } function nonNegative(value, fallback) { return Number.isInteger(Number(value)) && Number(value) >= 0 ? Number(value) : fallback; } function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); } function coded(code) { return Object.assign(new Error(code), { code }); }
// OpenAI transport schema: deliberately separate from the canonical product schema.
const n = type => ({ type: [type, 'null'] }); const closed = properties => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const ref = closed({ page: n('integer'), sheet: n('string'), cellRange: n('string'), text: n('string') });
const source = closed({ fileName: { type: 'string' }, fileType: { type: 'string', enum: ['pdf','docx','xlsx'] }, language: n('string'), documentTitle: n('string') });
const set = closed({ setNumber: { type: 'integer' }, setType: { type: 'string', enum: ['warmup','working','activation','core','backoff','drop','custom'] }, reps: n('integer'), repsText: n('string'), weight: n('number'), weightUnit: { type: ['string','null'], enum: ['kg','lb',null] }, weightText: n('string'), rir: n('number'), rirText: n('string'), rpe: n('number'), rpeText: n('string'), restSeconds: n('integer'), restText: n('string'), notes: n('string') });
const prescription = closed({ sets: n('integer'), setsText: n('string'), repsMin: n('integer'), repsMax: n('integer'), repsText: n('string'), weight: n('number'), weightUnit: { type: ['string','null'], enum: ['kg','lb',null] }, weightText: n('string'), rir: n('number'), rirText: n('string'), rpe: n('number'), rpeText: n('string'), restSeconds: n('integer'), restText: n('string'), tempo: n('string'), tempoText: n('string'), durationSeconds: n('integer'), durationText: n('string'), distance: n('number'), distanceUnit: { type: ['string','null'], enum: ['m','km','mi',null] }, distanceText: n('string'), individualSets: { type: 'array', items: set } });
const match = closed({ status: { type: 'string', enum: ['matched','probable','unmatched','custom'] }, exerciseId: n('string'), matchedName: n('string'), score: n('number'), candidates: { type: 'array', items: closed({ exerciseId: { type: 'string' }, name: { type: 'string' }, score: { type: 'number' } }) } });
const exercise = closed({ itemType: { type: 'string', enum: ['exercise'] }, order: { type: 'integer' }, sourceExerciseName: { type: 'string' }, normalizedExerciseName: { type: 'string' }, exerciseMatch: { type: ['object','null'], additionalProperties: false, properties: match.properties, required: match.required }, prescription, notes: n('string'), sourceReference: ref });
const instruction = closed({ itemType: { type: 'string', enum: ['instruction'] }, order: { type: 'integer' }, text: { type: 'string' }, sourceReference: ref });
const section = closed({ title: { type: 'string' }, sectionType: { type: 'string', enum: ['warmup','activation','strength','core','cardio','stretch','mobility','cooldown','custom'] }, order: { type: 'integer' }, notes: n('string'), sourceReference: ref, items: { type: 'array', items: { anyOf: [exercise, instruction] } } });
const day = closed({ name: { type: 'string' }, order: { type: 'integer' }, notes: n('string'), sourceReference: ref, sections: { type: 'array', items: section } });
const warning = closed({ code: { type: 'string' }, severity: { type: 'string', enum: ['info','warning','error'] }, message: { type: 'string' }, dayOrder: n('integer'), sectionOrder: n('integer'), exerciseOrder: n('integer'), sourceReference: ref });
const unparsed = closed({ text: { type: 'string' }, reason: { type: 'string' }, sourceReference: ref });
const responseSchema = closed({ schemaVersion: { type: 'string', enum: ['1.1'] }, importId: { type: 'string' }, importedAt: { type: 'string' }, source, program: closed({ id: n('string'), name: { type: 'string' }, description: n('string'), sourceType: { type: 'string', enum: ['pdf-import','docx-import','xlsx-import'] }, notes: n('string'), days: { type: 'array', items: day } }), warnings: { type: 'array', items: warning }, unparsedContent: { type: 'array', items: unparsed } });
const server = http.createServer(createImportHandler()); if (process.argv[1]?.endsWith('import-proxy-server.mjs')) server.listen(Number(process.env.IMPORT_PROXY_PORT || 8787), () => console.log('Import proxy ready'));
