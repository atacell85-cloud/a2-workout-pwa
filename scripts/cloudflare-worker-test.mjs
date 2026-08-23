import worker from '../worker/index.js';

const baseEnv = {
  ASSETS: { fetch: async () => new Response('<!doctype html><title>A2</title>', { headers: { 'Content-Type': 'text/html' } }) },
  OPENAI_IMPORT_MODEL: 'gpt-4.1-mini', OPENAI_IMPORT_TIMEOUT_MS: '1000', OPENAI_IMPORT_MAX_RETRIES: '0', OPENAI_IMPORT_RETRY_BASE_MS: '1', OPENAI_IMPORT_MAX_INPUT_BYTES: '180000'
};

const health = await worker.fetch(new Request('https://a2.example/api/health'), baseEnv);
const staticAsset = await worker.fetch(new Request('https://a2.example/'), baseEnv);
const invalidMethod = await worker.fetch(new Request('https://a2.example/api/import/parse'), baseEnv);
const invalidContentType = await worker.fetch(new Request('https://a2.example/api/import/parse', { method: 'POST', body: '{}' }), baseEnv);
const missingSecret = await worker.fetch(new Request('https://a2.example/api/import/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ importId: 'fixture', normalizedDocument: { blocks: [{ type: 'paragraph', text: 'Lat Pulldown 3x10' }] } }) }), baseEnv);
const oversized = await worker.fetch(new Request('https://a2.example/api/import/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ importId: 'fixture', normalizedDocument: { blocks: [{ type: 'paragraph', text: 'x'.repeat(180001) }] } }) }), { ...baseEnv, OPENAI_API_KEY: 'test' });
const limited = await worker.fetch(new Request('https://a2.example/api/import/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ importId: 'fixture', normalizedDocument: { blocks: [{ type: 'paragraph', text: 'Lat Pulldown 3x10' }] } }) }), { ...baseEnv, OPENAI_API_KEY: 'test', AI_IMPORT_LIMITER: { limit: async () => ({ success: false }) } });
const youtubeMissingSecret = await worker.fetch(new Request('https://a2.example/api/youtube/search?q=lat%20pulldown'), baseEnv);
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => new Response(JSON.stringify({ items: [{ id: { videoId: 'abc123' }, snippet: { title: 'Lat Pulldown Form', channelTitle: 'Coach', thumbnails: { medium: { url: 'https://img.example/lat.jpg' } } } }] }), { headers: { 'Content-Type': 'application/json' } });
const youtubeOk = await worker.fetch(new Request('https://a2.example/api/youtube/search?q=lat%20pulldown'), { ...baseEnv, YOUTUBE_API_KEY: 'test' });
globalThis.fetch = originalFetch;
const googleOauthUnconfigured = await worker.fetch(new Request('https://a2.example/api/auth/oauth/google/start'), baseEnv);
const appleOauthUnconfigured = await worker.fetch(new Request('https://a2.example/api/auth/oauth/apple/start'), baseEnv);
const youtubeOkBody = await youtubeOk.json();

const result = {
  ok: health.ok && staticAsset.ok && invalidMethod.status === 405 && invalidContentType.status === 415 && missingSecret.status === 503 && oversized.status === 413 && limited.status === 429 && youtubeMissingSecret.status === 503 && youtubeOk.ok && youtubeOkBody.videos?.[0]?.videoId === 'abc123' && googleOauthUnconfigured.status === 303 && appleOauthUnconfigured.status === 303,
  health: await health.json(), staticAsset: staticAsset.headers.get('content-type'), invalidMethod: invalidMethod.status, invalidContentType: invalidContentType.status, missingSecret: (await missingSecret.json()).code, oversized: (await oversized.json()).code, limited: (await limited.json()).code, youtubeMissingSecret: (await youtubeMissingSecret.json()).code, youtubeOk: youtubeOkBody.videos?.length || 0, googleOauthUnconfigured: googleOauthUnconfigured.headers.get('location'), appleOauthUnconfigured: appleOauthUnconfigured.headers.get('location')
};
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
