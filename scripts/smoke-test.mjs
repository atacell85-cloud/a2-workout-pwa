import http from 'node:http';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { getChromePath } from './chrome-path.mjs';

const root = resolve('.');
const port = 8090;
const cdpPort = Number(process.env.SMOKE_CDP_PORT || 9200 + Math.floor(Math.random() * 500));
const chromePath = getChromePath();
const userDataDir = process.env.SMOKE_USER_DATA_DIR || mkdtempSync(join(tmpdir(), 'a2-smoke-chrome-'));

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png'
};

if (existsSync(userDataDir)) rmSync(userDataDir, { recursive: true, force: true });
mkdirSync(userDataDir, { recursive: true });

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, `http://localhost:${port}`).pathname;
  const filePath = join(root, pathname === '/' ? 'index.html' : pathname);
  if (!filePath.startsWith(root) || !existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': mime[extname(filePath)] || 'application/octet-stream' });
  createReadStream(filePath).pipe(res);
});

await new Promise(resolveServer => server.listen(port, resolveServer));

const chrome = spawn(chromePath, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  `--remote-debugging-port=${cdpPort}`,
  `--user-data-dir=${userDataDir}`,
  `http://localhost:${port}`
], { stdio: 'ignore' });

try {
  const wsUrl = await waitForWsUrl();
  const cdp = await connect(wsUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 375,
    height: 812,
    deviceScaleFactor: 3,
    mobile: true
  });
  await wait(2000);

  await evalInPage(cdp, `
    localStorage.clear();
    indexedDB.deleteDatabase('a2-workout-db');
  `);
  await cdp.send('Page.reload', { ignoreCache: true });
  await wait(2500);

  const report = await evalInPage(cdp, `(${scenario.toString()})()`, true);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
} finally {
  chrome.kill();
  server.close();
}

async function scenario() {
  const click = selector => {
    const target = document.querySelector(selector);
    if (!target) throw new Error(`Missing selector: ${selector}`);
    target.click();
  };
  const fill = (selector, value) => {
    const input = document.querySelector(selector);
    if (!input) throw new Error(`Missing input: ${selector}`);
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const text = () => document.body.innerText || '';
  const exerciseCardByName = name => [...document.querySelectorAll('.exercise-card')].find(card => card.innerText.includes(name));
  const saveSetByCard = (name, rowIndex, weight, reps, rir) => {
    const card = exerciseCardByName(name);
    if (!card) throw new Error(`Missing exercise card: ${name}`);
    const row = card.querySelectorAll('.set-row')[rowIndex - 1];
    if (!row) throw new Error(`Missing set row: ${name} ${rowIndex}`);
    const inputs = row.querySelectorAll('input');
    inputs[0].value = weight;
    inputs[1].value = reps;
    inputs[2].value = rir;
    row.querySelector('[data-save-set]').click();
  };
  const database = await window.__a2.loadExerciseDatabase();
  const aliasSearch = await window.__a2.searchExercises('db bench press');
  const canonicalDbOk = database.length === 250 && database.some(item => item.id === 'bench-press');
  const aliasSearchOk = aliasSearch.some(item => item.id === 'db-bench-press');
  const sourceReference = { page: null, sheet: null, cellRange: null, text: null };
  const importPreview = {
    schemaVersion: '1.1', importId: 'smoke-import-1', importedAt: new Date().toISOString(), source: { fileName: 'test.xlsx', fileType: 'xlsx', language: null, documentTitle: null }, warnings: [], unparsedContent: [],
    program: { id: null, name: 'İçe Aktarılan', description: null, sourceType: 'xlsx-import', notes: null, days: [{ name: 'Gün 1', order: 1, notes: null, sourceReference, sections: [{ title: 'Ana Antrenman', sectionType: 'strength', order: 1, notes: null, sourceReference, items: [{ itemType: 'exercise', order: 1, sourceExerciseName: 'DB Bench Press', normalizedExerciseName: 'DB Bench Press', resolutionStatus: 'accepted-canonical', exerciseMatch: { status: 'matched', exerciseId: 'db-bench-press', matchedName: 'Dumbbell Bench Press', score: 1, candidates: [] }, notes: null, sourceReference, prescription: { sets: 3, setsText: null, repsMin: null, repsMax: null, repsText: '8-10', weight: null, weightUnit: 'kg', weightText: null, rir: null, rirText: null, rpe: null, rpeText: null, restSeconds: null, restText: null, tempo: null, tempoText: null, durationSeconds: null, durationText: null, distance: null, distanceUnit: null, distanceText: null, individualSets: [{ setNumber: 1, setType: 'working', reps: null, repsText: '8', weight: 20, weightUnit: 'kg', weightText: null, rir: null, rirText: null, rpe: 8, rpeText: null, restSeconds: null, restText: null, notes: null }] } }] }] }] }
  };
  const finalProgram = window.__a2.finalizeImport(importPreview, new Set(database.map(item => item.id)));
  const importFinalizationOk = finalProgram.days[0].sections[0].items[0].individualSets[0].rpe === 8 && finalProgram.days[0].sections[0].items[0].individualSets[0].weightUnit === 'kg';
  const unresolvedOk = window.__a2.validateImportPreview({ ...importPreview, program: { ...importPreview.program, days: [{ ...importPreview.program.days[0], sections: [{ ...importPreview.program.days[0].sections[0], items: [{ ...importPreview.program.days[0].sections[0].items[0], resolutionStatus: 'unresolved' }] }] }] } }, new Set(database.map(item => item.id))).includes('UNRESOLVED_EXERCISE');
  const youtubeNoKey = (await window.__a2.youtube.search(database[0])).status === 'search';
  const pdfFile = new File(['%PDF-1.4\nstream\nBT (Upper Day) Tj ET\nendstream\n%%EOF'], 'sample-workout.pdf', { type: 'application/pdf' });
  const pdfExtraction = await window.__a2.documentExtractor.extract(pdfFile);
  const pdfExtractionOk = pdfExtraction.blocks.some(block => block.text.includes('Upper Day'));
  const parsedFixture = await window.__a2.localImportParser.parse({ fileName: 'sample-workout.xlsx', fileType: 'xlsx', extractedAt: new Date().toISOString(), language: null, blocks: [{ type: 'paragraph', text: 'Upper Day', sourceReference }, { type: 'paragraph', text: 'Main Workout', sourceReference }, { type: 'table', rows: [['Machine Fly', '3', '12'], ['Incline Barbell Press', '2 warmup + 2', '8-10'], ['Lat Pulldown', '3', '10']], sourceReference }] });
  const parserOk = parsedFixture.schemaVersion === '1.1' && parsedFixture.program.days[0].sections[0].items.length === 3;
  const unsupportedOk = await window.__a2.documentExtractor.extract(new File(['x'], 'notes.txt', { type: 'text/plain' })).then(() => false, error => error.code === 'UNSUPPORTED_FILE');

  await window.__a2.repository.setActiveAccount('smoke-local-account');
  await window.__a2.repository.init();
  const smokeProgram = window.__a2.finalizeImport({
    ...importPreview,
    importId: 'smoke-program',
    program: {
      ...importPreview.program,
      name: 'Smoke Upper',
      days: [{
        name: 'Upper',
        order: 1,
        notes: null,
        sourceReference,
        sections: [{
          title: 'Ana Antrenman',
          sectionType: 'strength',
          order: 1,
          notes: null,
          sourceReference,
          items: [
            { itemType: 'exercise', order: 1, sourceExerciseName: 'Incline Barbell Press', normalizedExerciseName: 'Incline Barbell Press', resolutionStatus: 'accepted-canonical', exerciseMatch: { status: 'matched', exerciseId: 'incline-bench-press', matchedName: 'Incline Barbell Bench Press', score: 1, candidates: [] }, notes: null, sourceReference, prescription: { sets: 2, setsText: '2', repsMin: null, repsMax: null, repsText: '8-10', weight: null, weightUnit: 'kg', weightText: null, rir: null, rirText: null, rpe: null, rpeText: null, restSeconds: null, restText: null, tempo: null, tempoText: null, durationSeconds: null, durationText: null, distance: null, distanceUnit: null, distanceText: null, individualSets: [] } },
            { itemType: 'exercise', order: 2, sourceExerciseName: 'Lat Pulldown', normalizedExerciseName: 'Lat Pulldown', resolutionStatus: 'accepted-canonical', exerciseMatch: { status: 'matched', exerciseId: 'lat-pulldown', matchedName: 'Lat Pulldown', score: 1, candidates: [] }, notes: null, sourceReference, prescription: { sets: 1, setsText: '1', repsMin: null, repsMax: null, repsText: '10', weight: null, weightUnit: 'kg', weightText: null, rir: null, rirText: null, rpe: null, rpeText: null, restSeconds: null, restText: null, tempo: null, tempoText: null, durationSeconds: null, durationText: null, distance: null, distanceUnit: null, distanceText: null, individualSets: [] } }
          ]
        }]
      }]
    }
  }, new Set(database.map(item => item.id)));
  await window.__a2.repository.saveProgram(smokeProgram);
  click('[data-nav="programs"]');
  await sleep(150);
  click('[data-action="my-routines"]');
  await sleep(150);
  click('[data-open-program]');
  await sleep(150);
  click('[data-start-program-day]');
  await sleep(150);

  saveSetByCard('Incline Barbell', 1, '60', '10', '2');
  await sleep(100);
  saveSetByCard('Incline Barbell', 2, '60', '9', '1');
  await sleep(100);
  saveSetByCard('Lat Pulldown', 1, '55', '10', '2');
  await sleep(100);

  const timerVisible = Boolean(document.querySelector('#timerText'));
  click('[data-action="finish"]');
  await sleep(50);
  const warningVisible = !text().includes('Eksik hareket var');
  if (document.querySelector('[data-action="force-finish"]')) click('[data-action="force-finish"]');
  await sleep(250);
  const summaryVisible = text().includes('Antrenman Kaydedildi') && text().includes('1690');
  click('[data-action="history"]');
  await sleep(250);
  const historyVisible = text().includes('Incline Barbell') && text().includes('Lat Pulldown');

  click('[data-nav="programs"]');
  await sleep(150);
  click('[data-action="my-routines"]');
  await sleep(150);
  click('[data-open-program]');
  await sleep(150);
  click('[data-start-program-day]');
  await sleep(250);
  const previousVisible = Boolean(exerciseCardByName('Incline Barbell')?.innerText.includes('60 kg × 10 @ RIR 2'));

  saveSetByCard('Incline Barbell', 1, '62', '9', '2');
  await sleep(100);
  saveSetByCard('Incline Barbell', 2, '62', '8', '1');
  await sleep(100);
  exerciseCardByName('Incline Barbell').querySelectorAll('[data-delete-set]')[1].click();
  await sleep(150);
  const inclineRows = exerciseCardByName('Incline Barbell').querySelectorAll('.set-row');
  const editDeletePersist = inclineRows[0].querySelectorAll('input')[1].value === '9'
    && !inclineRows[1].classList.contains('saved')
    && exerciseCardByName('Incline Barbell').querySelectorAll('.set-row.saved').length === 1;

  const backup = await window.__a2.repository.exportBackup();
  await window.__a2.repository.replaceData({ schemaVersion: 2, sessions: [], settings: { rest: 90 } });
  const emptyAfterClear = (await window.__a2.repository.getSessions()).length === 0;
  await window.__a2.repository.replaceData(backup);
  const restoredSessions = await window.__a2.repository.getSessions();
  const restoreOk = emptyAfterClear && restoredSessions.length === backup.sessions.length
    && restoredSessions[0].sets.length === backup.sessions[0].sets.length;
  const csv = window.__a2.buildCsv(await window.__a2.repository.getData());
  const csvOk = csv.includes('"SessionId","ProgramId","WorkoutDayId"')
    && csv.includes('"incline-bench-press"')
    && csv.includes('"working"')
    && csv.includes('"60"');
  const serviceWorkerRegistered = 'serviceWorker' in navigator;
  const manifestOk = Boolean(document.querySelector('link[rel="manifest"]'));
  const noHorizontalOverflow = document.documentElement.scrollWidth <= window.innerWidth;

  return {
    ok: canonicalDbOk && aliasSearchOk && importFinalizationOk && unresolvedOk && youtubeNoKey && pdfExtractionOk && parserOk && unsupportedOk && timerVisible && warningVisible && summaryVisible && historyVisible && previousVisible && editDeletePersist && restoreOk && csvOk && backup.schemaVersion === window.__a2.schemaVersion && manifestOk && serviceWorkerRegistered && noHorizontalOverflow,
    canonicalDbOk, aliasSearchOk, importFinalizationOk, unresolvedOk, youtubeNoKey, pdfExtractionOk, parserOk, unsupportedOk,
    timerVisible,
    warningVisible,
    summaryVisible,
    historyVisible,
    previousVisible,
    editDeletePersist,
    backupSchemaVersion: backup.schemaVersion,
    backupSessionCount: backup.sessions.length,
    restoreOk,
    csvOk,
    manifestOk,
    serviceWorkerRegistered,
    noHorizontalOverflow,
    viewportWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth
  };
}

async function waitForWsUrl() {
  for (let i = 0; i < 50; i += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
      const targets = await response.json();
      const page = targets.find(target => target.type === 'page' && target.url.startsWith(`http://localhost:${port}`));
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      await wait(100);
    }
  }
  throw new Error('Chrome CDP endpoint did not start');
}

function connect(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      message.error ? reject(new Error(message.error.message)) : resolve(message.result);
    }
  });
  return new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve({
      send(method, params = {}) {
        const callId = ++id;
        ws.send(JSON.stringify({ id: callId, method, params }));
        return new Promise((resolveCall, rejectCall) => pending.set(callId, { resolve: resolveCall, reject: rejectCall }));
      }
    }));
    ws.addEventListener('error', reject);
  });
}

async function evalInPage(cdp, expression, returnByValue = false) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
