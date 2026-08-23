import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const base = process.env.A2_PILOT_BASE_URL || 'https://a2-workout.antrenmankocu.workers.dev';
const root = resolve('.');
const profile = join(root, `.tmp-account-pilot-${Date.now()}`);
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const cdpPort = 9231;
const stamp = Date.now();
const password = 'PilotTest!2026';
const emailA = `ui-a-${stamp}@example.test`;
const emailB = `ui-b-${stamp}@example.test`;

mkdirSync(profile, { recursive: true });
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });

let cdp;
let stage = 'startup';
try {
  stage = 'launch';
  cdp = await connect(await waitForWs());
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { mobile: true, width: 375, height: 812, deviceScaleFactor: 1 });
  await cdp.send('Page.navigate', { url: base });
  await waitFor(() => text().then(value => value.includes("AKS'ye hoş geldin")), 'fresh welcome screen');
  if ((await text()).includes('A2 Antrenman')) throw new Error('bundled personal program visible to fresh user');

  stage = 'register user A'; await beginOnboarding(); await auth('register', emailA);
  await waitFor(() => evaluate(`Boolean(document.querySelector('[data-action="programs"]'))`), 'first program handoff');
  await evaluate(`document.querySelector('[data-action="programs"]').click()`);
  await waitFor(() => text().then(value => value.includes('Henüz programınız yok.')), 'fresh user empty programs');
  stage = 'open builder'; await evaluate(`document.querySelector('[data-action="new-program"]').click()`);
  await waitFor(() => evaluate(`Boolean(document.querySelector('#builderName'))`), 'program builder');
  await evaluate(`document.querySelector('[data-action="add-day"]').click()`);
  await waitFor(() => evaluate(`Boolean(document.querySelector('[data-exercise-search]'))`), 'builder section');
  await evaluate(`(() => { const input = document.querySelector('[data-exercise-search]'); input.value = 'Pilot Custom'; input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await waitFor(() => evaluate(`Boolean(document.querySelector('[data-custom-exercise]'))`), 'custom exercise choice');
  await evaluate(`document.querySelector('[data-custom-exercise]').click()`);
  await waitFor(() => evaluate(`Boolean(document.querySelector('[data-action="save-program"]'))`), 'program save');
  await evaluate(`document.querySelector('#builderName').value = 'Pilot UI Program'`);
  stage = 'save user A program'; await evaluate(`document.querySelector('[data-action="save-program"]').click()`);
  await waitFor(() => text().then(value => value.includes('Pilot UI Program')), 'program saved');
  await wait(1200);
  await evaluate(`document.querySelector('[data-nav="account"]').click()`);
  await waitFor(() => evaluate(`Boolean(document.querySelector('[data-action="logout"]'))`), 'account screen');
  await evaluate(`document.querySelector('[data-action="logout"]').click()`);
  await waitFor(async () => (await text()).includes("AKS'ye hoş geldin") || await evaluate(`Boolean(document.querySelector('#authEmail'))`), 'logout');

  stage = 'register user B';
  await cdp.send('Page.reload', { ignoreCache: true });
  await waitFor(() => text().then(value => value.includes("AKS'ye hoş geldin")), 'user B welcome');
  await beginOnboarding();
  await auth('register', emailB);
  await waitFor(() => text().then(value => value.includes('İlk programını oluştur') || value.includes('Henüz programınız yok.')), 'user B post-register landing');
  if ((await text()).includes('İlk programını oluştur')) {
    await waitFor(() => evaluate(`Boolean(document.querySelector('[data-action="programs"]'))`), 'user B first program handoff');
    await evaluate(`document.querySelector('[data-action="programs"]').click()`);
  }
  await waitFor(() => text().then(value => value.includes('Henüz programınız yok.')), 'user B empty programs');
  if ((await text()).includes('Pilot UI Program')) throw new Error('user B can see user A program');
  await evaluate(`document.querySelector('[data-nav="account"]').click()`);
  await waitFor(() => evaluate(`Boolean(document.querySelector('[data-action="logout"]'))`), 'user B account');
  await evaluate(`document.querySelector('[data-action="logout"]').click()`);
  await waitFor(async () => (await text()).includes("AKS'ye hoş geldin") || await evaluate(`Boolean(document.querySelector('#authEmail'))`), 'user B logout');

  stage = 'login user A';
  await cdp.send('Page.reload', { ignoreCache: true });
  await waitFor(async () => (await text()).includes("AKS'ye hoş geldin") || await evaluate(`Boolean(document.querySelector('#authEmail'))`), 'login landing');
  await auth('login', emailA);
  await waitFor(() => text().then(value => value.includes('Pilot UI Program')), 'user A cloud restore');
  const overflow = await evaluate(`document.documentElement.scrollWidth <= window.innerWidth`);
  if (!overflow) throw new Error('375px horizontal overflow');
  console.log(JSON.stringify({ ok: true, freshUserEmpty: true, accountIsolation: true, cloudRestore: true, mobileOverflow: true }));
} catch (error) {
  if (cdp) { try { writeFileSync(join(root, 'tests', 'artifacts', 'account-pilot-failure.png'), Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64')); } catch {} }
  console.error(`ACCOUNT_PILOT_FAILED [${stage}]: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (cdp) {
    try {
      await evaluate(`Promise.race([fetch('/api/auth/delete', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: 'DELETE', password: ${JSON.stringify(password)} }) }), new Promise(resolve => setTimeout(resolve, 3000))])`);
    } catch {}
  }
  chrome.kill();
}

async function auth(mode, email) {
  if (!(await evaluate(`Boolean(document.querySelector('#authEmail'))`))) await evaluate(`document.querySelector('[data-action="returning-login"]').click()`);
  await evaluate(`(() => { document.querySelector('#authEmail').value = ${JSON.stringify(email)}; document.querySelector('#authPassword').value = ${JSON.stringify(password)}; document.querySelector('[data-action="${mode}"]').click(); })()`);
}
async function beginOnboarding() {
  await evaluate(`document.querySelector('[data-action="onboarding-start"]').click()`);
  await waitFor(() => evaluate(`Boolean(document.querySelector('[data-onboarding-value="goal:fitness"]'))`), 'goal step');
  await evaluate(`document.querySelector('[data-onboarding-value="goal:fitness"]').click()`);
  await wait(250);
  await evaluate(`document.querySelector('[data-action="onboarding-next"]').click()`);
  await wait(250);
  await waitFor(() => evaluate(`Boolean(document.querySelector('[data-onboarding-value="experience:beginner"]'))`), 'experience step');
  await evaluate(`document.querySelector('[data-onboarding-value="experience:beginner"]').click()`);
  await wait(250);
  await evaluate(`document.querySelector('[data-action="onboarding-next"]').click()`);
  await wait(250);
  for (let i = 0; i < 5; i += 1) await evaluate(`document.querySelector('[data-action="onboarding-skip"]')?.click() || document.querySelector('[data-action="onboarding-next"]')?.click()`);
  await waitFor(() => evaluate(`Boolean(document.querySelector('[data-action="register"]'))`), 'registration screen');
}
async function text() { return evaluate('document.body ? document.body.innerText : ""'); }
async function waitFor(check, label, timeout = 20000) { const deadline = Date.now() + timeout; while (Date.now() < deadline) { if (await check()) return; await wait(150); } throw new Error(`${label} timed out`); }
function wait(ms) { return new Promise(resolveWait => setTimeout(resolveWait, ms)); }
async function waitForWs() { for (let attempt = 0; attempt < 100; attempt += 1) { try { const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json(); const page = targets.find(item => item.type === 'page'); if (page) return page.webSocketDebuggerUrl; } catch {} await wait(100); } throw new Error('Chrome CDP unavailable'); }
function connect(url) { const socket = new WebSocket(url); let id = 0; const pending = new Map(); socket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { const call = pending.get(message.id); pending.delete(message.id); message.error ? call.reject(new Error(message.error.message)) : call.resolve(message.result); } }); return new Promise((resolveConnection, reject) => { socket.addEventListener('open', () => resolveConnection({ send(method, params = {}) { const callId = ++id; socket.send(JSON.stringify({ id: callId, method, params })); return new Promise((resolveCall, rejectCall) => pending.set(callId, { resolve: resolveCall, reject: rejectCall })); } })); socket.addEventListener('error', reject); }); }
async function evaluate(expression) { const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; }
