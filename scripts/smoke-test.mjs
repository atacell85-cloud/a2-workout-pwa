import http from 'node:http';
import { createReadStream, existsSync, mkdirSync, rmSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const root = resolve('.');
const port = 8090;
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const userDataDir = join(root, '.tmp-smoke-chrome');

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
  '--remote-debugging-port=9224',
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
  await wait(1000);

  await evalInPage(cdp, `
    localStorage.clear();
    indexedDB.deleteDatabase('a2-workout-db');
  `);
  await cdp.send('Page.reload', { ignoreCache: true });
  await wait(1000);

  const report = await evalInPage(cdp, `(${scenario.toString()})()`, true);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
} finally {
  chrome.kill();
  server.close();
}

async function scenario() {
  const click = selector => document.querySelector(selector).click();
  const fill = (selector, value) => { document.querySelector(selector).value = value; };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  click('[data-start-day="upper"]');
  await sleep(100);

  fill('#kg-incline-smith-press-work-1', '60');
  fill('#rp-incline-smith-press-work-1', '10');
  fill('#ri-incline-smith-press-work-1', '2');
  click('[data-save-set="incline-smith-press-work:1"]');
  await sleep(100);

  fill('#kg-incline-smith-press-work-2', '60');
  fill('#rp-incline-smith-press-work-2', '9');
  fill('#ri-incline-smith-press-work-2', '1');
  click('[data-save-set="incline-smith-press-work:2"]');
  await sleep(100);

  fill('#kg-lat-pulldown-1', '55');
  fill('#rp-lat-pulldown-1', '10');
  fill('#ri-lat-pulldown-1', '2');
  click('[data-save-set="lat-pulldown:1"]');
  await sleep(100);

  const timerVisible = Boolean(document.querySelector('#timerText'));
  click('[data-action="finish"]');
  await sleep(50);
  const warningVisible = document.body.innerText.includes('Eksik hareket var');
  click('[data-action="force-finish"]');
  await sleep(250);
  const summaryVisible = document.body.innerText.includes('Antrenman Kaydedildi') && document.body.innerText.includes('1690');
  click('[data-action="history"]');
  await sleep(250);
  const historyVisible = document.body.innerText.includes('Incline Smith Press – Work') && document.body.innerText.includes('Lat Pulldown');

  click('[data-nav="home"]');
  await sleep(100);
  click('[data-start-day="upper"]');
  await sleep(250);
  const previousVisible = document.querySelector('#ex-incline-smith-press-work').innerText.includes('60 kg × 10 @ RIR 2');

  fill('#kg-incline-smith-press-work-1', '62');
  fill('#rp-incline-smith-press-work-1', '9');
  fill('#ri-incline-smith-press-work-1', '2');
  click('[data-save-set="incline-smith-press-work:1"]');
  await sleep(100);
  fill('#kg-incline-smith-press-work-2', '62');
  fill('#rp-incline-smith-press-work-2', '8');
  fill('#ri-incline-smith-press-work-2', '1');
  click('[data-save-set="incline-smith-press-work:2"]');
  await sleep(100);
  click('[data-delete-set="incline-smith-press-work:2"]');
  await sleep(150);
  const editDeletePersist = document.querySelector('#rp-incline-smith-press-work-1').value === '9'
    && document.querySelector('#rp-incline-smith-press-work-2').value === ''
    && document.querySelectorAll('#ex-incline-smith-press-work .set-row.saved').length === 1;

  const backup = await window.__a2.repository.exportBackup();
  await window.__a2.repository.replaceData({ schemaVersion: 2, sessions: [], settings: { rest: 90 } });
  const emptyAfterClear = (await window.__a2.repository.getSessions()).length === 0;
  await window.__a2.repository.replaceData(backup);
  const restoredSessions = await window.__a2.repository.getSessions();
  const restoreOk = emptyAfterClear && restoredSessions.length === backup.sessions.length
    && restoredSessions[0].sets.length === backup.sessions[0].sets.length;
  const csv = window.__a2.buildCsv(await window.__a2.repository.getData());
  const csvOk = csv.includes('"SessionId","ProgramId","WorkoutDayId"')
    && csv.includes('"incline-smith-press-work"')
    && csv.includes('"working"')
    && csv.includes('"60"');
  const serviceWorkerRegistered = 'serviceWorker' in navigator;
  const manifestOk = Boolean(document.querySelector('link[rel="manifest"]'));
  const noHorizontalOverflow = document.documentElement.scrollWidth <= window.innerWidth;

  return {
    ok: timerVisible && warningVisible && summaryVisible && historyVisible && previousVisible && editDeletePersist && restoreOk && csvOk && backup.schemaVersion === 2 && manifestOk && serviceWorkerRegistered && noHorizontalOverflow,
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
      const response = await fetch('http://127.0.0.1:9224/json/list');
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
