import { readFile } from 'node:fs/promises';
import { extractStructuredOutput, mapOpenAIStatus, requestOpenAI } from './import-proxy-server.mjs';

const success = JSON.parse(await readFile('tests/fixtures/openai-responses/success.json'));
const malformed = JSON.parse(await readFile('tests/fixtures/openai-responses/malformed-output.json'));
const empty = JSON.parse(await readFile('tests/fixtures/openai-responses/empty-output.json'));
const config = { model: 'test-model', timeoutMs: 15, maxRetries: 1, retryBaseMs: 1, maxInputBytes: 1000 };
const input = { importId: 'fixture', normalizedDocument: { fileName: 'fixture.pdf', fileType: 'pdf', blocks: [{ type: 'paragraph', text: 'Lat Pulldown 3x10' }] } };
const makeResponse = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });
let calls429 = 0; const retry429 = await requestOpenAI({ fetchImpl: async () => (++calls429 === 1 ? makeResponse({}, 429, { 'retry-after': '0' }) : makeResponse(success, 200, { 'x-request-id': 'oa_1' })), apiKey: 'test', config, input, requestId: 'local_1', sleep: async () => {} });
let calls500 = 0; const retry500 = await requestOpenAI({ fetchImpl: async () => (++calls500 === 1 ? makeResponse({}, 500) : makeResponse(success)), apiKey: 'test', config, input, requestId: 'local_2', sleep: async () => {} });
let calls400 = 0; const noRetry400 = await failure(() => requestOpenAI({ fetchImpl: async () => { calls400 += 1; return makeResponse({}, 400); }, apiKey: 'test', config, input, requestId: 'local_3', sleep: async () => {} }));
let calls401 = 0; const noRetry401 = await failure(() => requestOpenAI({ fetchImpl: async () => { calls401 += 1; return makeResponse({}, 401); }, apiKey: 'test', config, input, requestId: 'local_4', sleep: async () => {} }));
const timeoutFetch = (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
const timeout = await failure(() => requestOpenAI({ fetchImpl: timeoutFetch, apiKey: 'test', config, input, requestId: 'local_5', sleep: async () => {} }));
const malformedError = await failure(async () => JSON.parse(extractStructuredOutput(malformed))); const emptyError = await failure(async () => extractStructuredOutput(empty));
const report = { ok: retry429.attempts === 2 && calls429 === 2 && retry500.attempts === 2 && calls500 === 2 && noRetry400 === 'OPENAI_REQUEST_FAILED' && calls400 === 1 && noRetry401 === 'OPENAI_AUTH_FAILED' && calls401 === 1 && timeout === 'OPENAI_TIMEOUT' && malformedError === 'SyntaxError' && emptyError === 'OPENAI_INVALID_RESPONSE' && extractStructuredOutput(success).includes('Fixture Workout') && mapOpenAIStatus(401) === 'OPENAI_AUTH_FAILED', retry429Attempts: retry429.attempts, retry500Attempts: retry500.attempts, noRetry400, noRetry401, timeout, malformedError, emptyError };
console.log(JSON.stringify(report, null, 2)); if (!report.ok) process.exitCode = 1;
async function failure(fn) { try { await fn(); return 'NO_ERROR'; } catch (error) { return error.code || error.name; } }
