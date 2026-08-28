import http from 'node:http';
import { createReadStream, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { getChromePath } from './chrome-path.mjs';

try { process.loadEnvFile('.env'); } catch {}
const mockImport = process.env.A2_IMPORT_E2E_MOCK === '1';
if (!mockImport && !process.env.OPENAI_API_KEY) { console.log('SKIPPED: OPENAI_API_KEY missing'); process.exit(0); }

const root = resolve('.');
const port = 8092;
const externalBaseUrl = process.env.A2_E2E_BASE_URL || null;
const appUrl = externalBaseUrl || `http://localhost:${port}`;
const cdpPort = 9226;
const chromePath = getChromePath();
const profile = join(root, `.tmp-ui-e2e-${Date.now()}`);
const artifacts = join(root, 'tests', 'artifacts');
const fixture = join(root, 'tests', 'fixtures', 'sample-workout.pdf');
const testEmail = `import-e2e-${Date.now()}@example.test`;
const testPassword = 'ImportE2E!2026';
const diagnostic = process.env.A2_IMPORT_E2E_DIAGNOSTIC === '1';
const trace = []; const startedAt = Date.now();
const mark = (step, status = 'ok', detail = null) => { const entry = { step, timestamp: new Date().toISOString(), elapsedMs: Date.now() - startedAt, status, ...(detail ? { detail } : {}) }; trace.push(entry); console.log(`${step} ${status} ${entry.elapsedMs}ms`); };
const safeWriteTrace = () => writeFileSync(join(artifacts, 'authenticated-import-e2e-log.json'), JSON.stringify(trace, null, 2));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.pdf': 'application/pdf' };

if (existsSync(profile)) rmSync(profile, { recursive: true, force: true });
mkdirSync(profile, { recursive: true });
mkdirSync(artifacts, { recursive: true });

const server = externalBaseUrl ? null : http.createServer((request, response) => {
  const pathname = new URL(request.url, `http://localhost:${port}`).pathname;
  const path = join(root, pathname === '/' ? 'index.html' : pathname);
  if (!path.startsWith(root) || !existsSync(path)) return response.writeHead(404).end();
  response.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream' });
  createReadStream(path).pipe(response);
});
if (server) await new Promise(resolveServer => server.listen(port, resolveServer));

const proxy = externalBaseUrl ? null : spawn('node', ['scripts/import-proxy-server.mjs'], { cwd: root, windowsHide: true, stdio: 'ignore' });
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });

let cdp;
try {
  cdp = await connect(await waitForWs());
  mark('STEP 01 browser_started');
  await cdp.send('Runtime.enable');
  await cdp.send('DOM.enable');
  await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { mobile: true, width: 375, height: 812, deviceScaleFactor: 1 });
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `
    ${externalBaseUrl ? '' : "globalThis.A2_IMPORT_PROXY_URL = 'http://localhost:8787/api/import/parse'; globalThis.A2_IMPORT_PARSER_PROVIDER = 'openai';"}
    globalThis.__a2E2eMetrics = null;
    try {
      const saved = JSON.parse(globalThis.name || '{}');
      globalThis.__a2E2eCalls = Number(saved.a2E2eCalls || 0);
      globalThis.__a2E2eMetrics = saved.a2E2eMetrics || null;
    } catch { globalThis.__a2E2eCalls = 0; }
    const originalFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = async (...args) => {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
      if (${mockImport} && url.includes('/api/import/parse')) {
        const request = JSON.parse(args[1]?.body || '{}');
        const preview = await globalThis.__a2.localImportParser.parse(request.normalizedDocument, { importId: request.importId });
        globalThis.__a2E2eCalls += 1; globalThis.__a2E2eMetrics = { requestId: 'mock-import-request', attemptCount: 0, durationMs: 1, status: 'mock' };
        return new Response(JSON.stringify({ preview, observability: globalThis.__a2E2eMetrics }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      const response = await originalFetch(...args);
      if (url.includes('/api/import/parse')) {
        globalThis.__a2E2eCalls += 1;
        response.clone().json().then(body => {
          globalThis.__a2E2eMetrics = body.observability || null;
          globalThis.name = JSON.stringify({ a2E2eCalls: globalThis.__a2E2eCalls, a2E2eMetrics: globalThis.__a2E2eMetrics });
        }).catch(() => {});
      }
      return response;
    };
  ` });
  await cdp.send('Page.navigate', { url: appUrl });
  mark('STEP 02 public_url_loaded');
  await waitFor(() => evaluate(cdp, 'Boolean(window.__a2)'), 'application startup', 15000);

  await waitFor(async () => (await evaluate(cdp, 'document.body?.innerText || ""')).includes("Reptrio'ya hoş geldin") || await evaluate(cdp, "Boolean(document.querySelector('#authEmail'))"), 'welcome or authentication screen');
  if (!(await evaluate(cdp, "Boolean(document.querySelector('#authEmail'))"))) {
    await beginOnboarding(cdp);
  }
  await waitFor(() => evaluate(cdp, "Boolean(document.querySelector('#authEmail'))"), 'authentication screen');
  await evaluate(cdp, `document.querySelector('#authEmail').value = ${JSON.stringify(testEmail)}; document.querySelector('#authPassword').value = ${JSON.stringify(testPassword)}; document.querySelector('[data-action=register]').click()`);
  await waitFor(() => evaluate(cdp, "Boolean(document.querySelector('[data-action=new-program]'))"), 'authenticated program list');
  mark('STEP 03 authenticated');

  await evaluate(cdp, "document.querySelector('[data-nav=programs]').click()");
  await waitFor(() => evaluate(cdp, "Boolean(document.querySelector('[data-action=file-import]'))"), 'program list');
  await evaluate(cdp, "document.querySelector('[data-action=file-import]').click()");
  const documentNode = await cdp.send('DOM.getDocument');
  const input = await cdp.send('DOM.querySelector', { nodeId: documentNode.root.nodeId, selector: '#importFile' });
  if (!input.nodeId) throw new Error('file input missing');
  await cdp.send('DOM.setFileInputFiles', { nodeId: input.nodeId, files: [fixture] });
  mark('STEP 04 file_input_set');
  mark('STEP 05 extraction_started');
  await waitFor(() => evaluate(cdp, "document.querySelector('#importStatus')?.textContent.includes('analiz') || document.querySelector('#importStatus')?.textContent.includes('çıkarılıyor') || Number(globalThis.__a2E2eCalls || 0) > 0 || document.body.innerText.includes('Aktarım Önizlemesi')"), 'extraction start', 15000);
  mark('STEP 06 extraction_completed');
  if (process.env.A2_IMPORT_E2E_STOP_BEFORE_OPENAI === '1') { mark('STEP 06 extraction_completed', 'stopped'); safeWriteTrace(); process.exitCode = 0; }
  if (process.env.A2_IMPORT_E2E_STOP_BEFORE_OPENAI === '1') throw Object.assign(new Error('PRE_OPENAI_COMPLETE'), { preOpenAI: true });
  await waitFor(() => evaluate(cdp, 'Number(globalThis.__a2E2eCalls || 0) > 0'), 'OpenAI request start', 15000);
  mark('STEP 07 openai_request_started');
  await waitFor(() => evaluate(cdp, 'Boolean(globalThis.__a2E2eMetrics)'), 'OpenAI response', 60000);
  mark('STEP 08 openai_response_received');
  if (diagnostic) throw Object.assign(new Error('DIAGNOSTIC_COMPLETE'), { preOpenAI: true });

  await waitFor(() => evaluate(cdp, "window.__a2.repository.getData().then(data => Object.values(data.importPreviews).some(item => item.parserProvider === 'openai'))"), 'parser storage', 15000);
  mark('STEP 09 parser_result_stored');
  await waitFor(async () => (await evaluate(cdp, 'document.body.innerText')).includes('Aktarım Önizlemesi'), 'OpenAI preview', 15000);
  mark('STEP 10 preview_route_opened'); mark('STEP 11 preview_rendered');
  const previewChecks = await evaluate(cdp, `window.__a2.repository.getData().then(data => Object.values(data.importPreviews).at(-1)).then(preview => {
    const sections = preview.program.days.flatMap(day => day.sections);
    const exercises = sections.flatMap(section => section.items).filter(item => item.itemType === 'exercise');
    const byId = Object.fromEntries(exercises.map(item => [item.exerciseMatch?.exerciseId, item]));
    const expectedIds = ['wall-slide', 'band-external-rotation', 'machine-chest-fly', 'incline-smith-machine-press', 'lat-pulldown', 'cable-crunch'];
    const machineFly = byId['machine-chest-fly']?.prescription || {};
    const latPulldown = byId['lat-pulldown']?.prescription || {};
    const incline = byId['incline-smith-machine-press']?.prescription || {};
    const exactReps = (prescription, value) => String(prescription.repsText || '') === String(value) || (prescription.repsMin === value && prescription.repsMax === value);
    return {
      sections: ['Warmup', 'Main Workout', 'Core'].every(title => sections.some(section => section.title === title)),
      provider: preview.parserProvider === 'openai',
      canonical: expectedIds.every(id => byId[id]?.resolutionStatus === 'accepted-canonical'),
      prescription: String(machineFly.setsText || machineFly.sets) === '3' && exactReps(machineFly, 12) && String(latPulldown.setsText || latPulldown.sets) === '3' && exactReps(latPulldown, 10) && String(latPulldown.rirText || latPulldown.rir) === '2' && /120/.test(String(latPulldown.restText || latPulldown.restSeconds || '')) && ((/2 warmup \\+ 2 x 8-10/i.test([incline.notes, incline.setsText, incline.repsText].filter(Boolean).join(' '))) || (/2 warmup\\s+\\+\\s+2/i.test(String(incline.setsText || '')) && String(incline.repsText || '') === '8-10')),
      unresolved: exercises.some(item => item.resolutionStatus !== 'accepted-canonical')
    };
  })`);
  const previewDebug = await evaluate(cdp, `window.__a2.repository.getData().then(data => Object.values(data.importPreviews).at(-1)).then(preview => ({ program: preview.program.name, days: preview.program.days.map(day => ({ name: day.name, sections: day.sections.map(section => ({ title: section.title, exercises: section.items.filter(item => item.itemType === 'exercise').map(item => ({ sourceExerciseName: item.sourceExerciseName, exerciseId: item.exerciseMatch?.exerciseId || null, matchStatus: item.resolutionStatus || null, prescription: item.prescription })) })) })) }))`);
  writeFileSync(join(artifacts, 'authenticated-openai-preview-debug.json'), JSON.stringify(previewDebug, null, 2));
  if (!previewChecks.provider || !previewChecks.sections || !previewChecks.canonical || !previewChecks.prescription || previewChecks.unresolved) throw new Error(`preview validation failed: ${JSON.stringify(previewChecks)}`);

  const previewDocument = await cdp.send('DOM.getDocument');
  const programNameInput = await cdp.send('DOM.querySelector', { nodeId: previewDocument.root.nodeId, selector: '[data-import-program-name]' });
  await cdp.send('DOM.focus', { nodeId: programNameInput.nodeId });
  await evaluate(cdp, 'document.activeElement.select()');
  await cdp.send('Input.insertText', { text: 'Fixture Workout Edited' });
  await wait(500);
  for (let resolutionCount = 0; resolutionCount < 20; resolutionCount += 1) {
    const unresolvedIndex = await evaluate(cdp, `window.__a2.repository.getData().then(data => {
      const preview = Object.values(data.importPreviews).at(-1);
      return preview.unparsedContent.findIndex(item => !['assigned', 'instruction', 'dismissed'].includes(item.resolutionStatus));
    })`);
    if (unresolvedIndex < 0) break;
    await evaluate(cdp, `document.querySelector('[data-unparsed="${unresolvedIndex}:dismissed"]').click()`);
    await waitFor(() => evaluate(cdp, `window.__a2.repository.getData().then(data => Object.values(data.importPreviews).at(-1)?.unparsedContent?.[${unresolvedIndex}]?.resolutionStatus === 'dismissed')`), 'unparsed resolution persistence');
    if (resolutionCount === 19) throw new Error('unparsed content resolution limit reached');
  }
  const finalizationErrors = await evaluate(cdp, `Promise.all([window.__a2.repository.getData(), window.__a2.loadExerciseDatabase()]).then(([data, exercises]) => {
    const preview = Object.values(data.importPreviews).at(-1);
    return window.__a2.validateImportPreview(preview, new Set(exercises.map(exercise => exercise.id)));
  })`);
  if (finalizationErrors.length) throw new Error(`preview remains blocked: ${finalizationErrors.join(',')}`);
  await evaluate(cdp, "document.querySelector('[data-action=finalize-import]').click()");
  await waitFor(() => evaluate(cdp, "window.__a2.repository.getPrograms().then(programs => programs.some(program => program.name === 'Fixture Workout Edited'))"), 'permanent program persistence');
  await evaluate(cdp, "document.querySelector('[data-nav=programs]').click()");
  await waitFor(async () => (await evaluate(cdp, 'document.body.innerText')).includes('Fixture Workout Edited'), 'finalized program list');
  const listed = await evaluate(cdp, 'document.body.innerText');
  if (!listed.includes('Fixture Workout Edited')) throw new Error('edited program name was not persisted');

  await evaluate(cdp, "document.querySelector('[data-open-program]').click()");
  await waitFor(() => evaluate(cdp, "Boolean(document.querySelector('[data-start-program-day]'))"), 'program detail');
  await evaluate(cdp, "document.querySelector('[data-start-program-day]').click()");
  await waitFor(async () => {
    const workoutText = await evaluate(cdp, 'document.body.innerText');
    return ['Machine Fly', 'Incline Smith Press', 'Lat Pulldown'].every(value => workoutText.includes(value));
  }, 'workout startup');

  await evaluate(cdp, `(() => {
    const card = [...document.querySelectorAll('.exercise-card')].find(item => item.innerText.includes('Machine Fly'));
    if (!card) throw new Error('Machine Fly card missing');
    card.querySelector('input[placeholder="kg"]').value = '20';
    card.querySelector('input[placeholder="tekrar"]').value = '10';
    card.querySelector('[data-save-set]').click();
  })()`);
  await waitFor(() => evaluate(cdp, "window.__a2.repository.getDraft().then(draft => Object.values(draft.sets || {}).flatMap(Object.values).some(set => String(set.weight) === '20' && String(set.reps) === '10'))"), 'Machine Fly set save');

  await evaluate(cdp, "document.querySelector('[data-action=finish]').click()");
  await wait(250);
  if (await evaluate(cdp, "Boolean(document.querySelector('[data-action=force-finish]'))")) {
    await evaluate(cdp, "document.querySelector('[data-action=force-finish]').click()");
  }
  await waitFor(async () => (await evaluate(cdp, 'document.body.innerText')).includes('Antrenman Kaydedildi'), 'workout completion');
  await evaluate(cdp, "document.querySelector('[data-action=history]').click()");
  await waitFor(async () => (await evaluate(cdp, 'document.body.innerText')).includes('Machine Fly'), 'history');
  const historyOk = await evaluate(cdp, "document.body.innerText.includes('Machine Fly')");
  await cdp.send('Page.reload', { ignoreCache: true });
  await waitFor(() => evaluate(cdp, 'Boolean(window.__a2)'), 'reload');
  const persistence = await evaluate(cdp, `Promise.all([window.__a2.repository.getPrograms(), window.__a2.repository.getDraft()]).then(([programs, draft]) => ({
    program: programs.some(program => program.name === 'Fixture Workout Edited'),
    history: !draft && programs.some(program => program.name === 'Fixture Workout Edited'),
    overflow: document.documentElement.scrollWidth <= window.innerWidth
  }))`);
  const metrics = await evaluate(cdp, "(() => { try { const saved = JSON.parse(window.name || '{}'); return { calls: Number(saved.a2E2eCalls || 0), metrics: saved.a2E2eMetrics || null }; } catch { return { calls: 0, metrics: null }; } })()");
  if (!persistence.program || !persistence.history || !persistence.overflow) throw new Error('persistence or mobile overflow failed');
  await evaluate(cdp, "document.querySelector('[data-nav=account]').click()");
  await waitFor(() => evaluate(cdp, "Boolean(document.querySelector('[data-action=logout]'))"), 'account screen');
  await evaluate(cdp, "document.querySelector('[data-action=logout]').click()");
  await waitFor(() => evaluate(cdp, "Boolean(document.querySelector('#authEmail'))"), 'logout');
  await evaluate(cdp, `document.querySelector('#authEmail').value = ${JSON.stringify(testEmail)}; document.querySelector('#authPassword').value = ${JSON.stringify(testPassword)}; document.querySelector('[data-action=login]').click()`);
  await waitFor(async () => (await evaluate(cdp, 'document.body.innerText')).includes('Fixture Workout Edited'), 'cloud restore');
  console.log(JSON.stringify({ ok: true, preview: true, finalized: true, workout: true, setLogged: true, historyOk, cloudRestore: true, persistence, ...metrics }, null, 2));
} catch (error) {
  if (error.preOpenAI) { console.log(JSON.stringify({ ok: true, preOpenAI: true, trace }, null, 2)); }
  else {
  mark(trace.at(-1)?.step || 'STEP unknown', 'failed', String(error.message || 'error').slice(0, 180)); safeWriteTrace();
  if (cdp) {
    try { writeFileSync(join(artifacts, 'import-ui-e2e-failure.png'), Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64')); } catch {}
  }
  console.error(`UI_E2E_FAILED: ${error.message}`);
  process.exitCode = 1;
  }
} finally {
  safeWriteTrace();
  if (cdp) {
    try { await evaluate(cdp, `fetch('/api/auth/delete', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: 'DELETE', password: ${JSON.stringify(testPassword)} }) })`); } catch {}
  }
  chrome.kill();
  proxy?.kill();
  if (server) await new Promise(resolveServer => server.close(resolveServer));
}

async function waitForWs() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json(); const page = targets.find(target => target.type === 'page'); if (page) return page.webSocketDebuggerUrl; } catch {}
    await wait(100);
  }
  throw new Error('Chrome CDP unavailable');
}

async function waitFor(check, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await wait(150); }
  throw new Error(`${label} timed out`);
}

async function beginOnboarding(cdp) {
  await evaluate(cdp, "document.querySelector('[data-action=onboarding-start]').click()");
  await waitFor(() => evaluate(cdp, "Boolean(document.querySelector('[data-onboarding-value=\"goal:fitness\"]'))"), 'goal step');
  await evaluate(cdp, "document.querySelector('[data-onboarding-value=\"goal:fitness\"]').click()");
  await wait(150);
  await evaluate(cdp, "document.querySelector('[data-action=onboarding-next]').click()");
  await waitFor(() => evaluate(cdp, "Boolean(document.querySelector('[data-onboarding-value=\"experience:beginner\"]'))"), 'experience step');
  await evaluate(cdp, "document.querySelector('[data-onboarding-value=\"experience:beginner\"]').click()");
  await wait(150);
  await evaluate(cdp, "document.querySelector('[data-action=onboarding-next]').click()");
  for (let index = 0; index < 5; index += 1) {
    await wait(100);
    await evaluate(cdp, "document.querySelector('[data-action=onboarding-skip]')?.click() || document.querySelector('[data-action=onboarding-next]')?.click()");
  }
}

function connect(url) {
  const socket = new WebSocket(url); let id = 0; const pending = new Map();
  socket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { const item = pending.get(message.id); pending.delete(message.id); message.error ? item.reject(new Error(message.error.message)) : item.resolve(message.result); } });
  return new Promise((resolveConnection, reject) => { socket.addEventListener('open', () => resolveConnection({ send(method, params = {}) { const callId = ++id; socket.send(JSON.stringify({ id: callId, method, params })); return new Promise((resolveCall, rejectCall) => pending.set(callId, { resolve: resolveCall, reject: rejectCall })); } })); socket.addEventListener('error', reject); });
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

function wait(ms) { return new Promise(resolveWait => setTimeout(resolveWait, ms)); }
