import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const base = process.env.A2_PILOT_BASE_URL || 'https://a2-workout.antrenmankocu.workers.dev';
const root = resolve('.');
const profile = join(root, '.tmp-workout-e2e');
const artifacts = join(root, 'tests', 'artifacts');
const port = 9234;
const password = 'WorkoutE2E!2026';
const email = `workout-${Date.now()}@example.test`;
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

if (existsSync(profile)) rmSync(profile, { recursive: true, force: true });
mkdirSync(profile, { recursive: true });
mkdirSync(artifacts, { recursive: true });

const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
let cdp;
let step = 'start';

try {
  cdp = await connect(await ws());
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Network.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { mobile: true, width: 375, height: 812, deviceScaleFactor: 1 });
  await cdp.send('Page.navigate', { url: base });
  await until(async () => (await text()).includes("AKS'ye hoş geldin") || await ev("Boolean(document.querySelector('#authEmail'))"), 'welcome or auth');
  if (!await ev("Boolean(document.querySelector('#authEmail'))")) await beginOnboarding();
  await until(() => ev("Boolean(document.querySelector('#authEmail'))"), 'auth');

  step = 'register';
  await fill('#authEmail', email);
  await fill('#authPassword', password);
  await ev("document.querySelector('[data-action=register]').click()");
  await until(() => ev("Boolean(document.querySelector('[data-action=new-program]'))"), 'programs');

  step = 'build';
  await ev("document.querySelector('[data-action=new-program]').click()");
  await until(() => ev("Boolean(document.querySelector('[data-action=add-day]'))"), 'builder');
  await ev("document.querySelector('[data-action=add-day]').click()");
  await until(() => ev("Boolean(document.querySelector('[data-exercise-search]'))"), 'section');
  await searchAndSelect('Machine Fly');
  await searchAndSelect('Lat Pulldown');
  await fill('#builderName', 'Test Workout');
  await fill('[data-builder-day-name]', 'Upper');
  await fillPrescriptions();
  await ev("document.querySelector('[data-action=save-program]').click()");
  await until(() => text().then(value => value.includes('Test Workout')), 'saved');
  await wait(1200);

  step = 'workout';
  await openFirstProgramWorkout();
  await until(() => text().then(value => value.includes('Machine Fly') && value.includes('Lat Pulldown')), 'workout');

  step = 'sets';
  await save('Machine Fly', '20', '10');
  if (!await ev("Boolean(document.querySelector('#timerText'))")) throw new Error('timer missing');
  const timerA = await ev("document.querySelector('#timerText').textContent");
  await wait(1200);
  const timerB = await ev("document.querySelector('#timerText').textContent");
  if (timerA === timerB) throw new Error('timer not running');
  await save('Lat Pulldown', '50', '10');
  await ev("document.querySelector('[data-action=finish]').click()");
  await until(() => text().then(value => value.includes('Antrenman Kaydedildi')), 'summary');

  step = 'history';
  await ev("document.querySelector('[data-action=history]').click()");
  await until(() => text().then(value => value.includes('Machine Fly') && value.includes('Lat Pulldown')), 'history');

  step = 'previous performance';
  await ev("document.querySelector('[data-nav=programs]').click()");
  await openFirstProgramWorkout();
  await until(() => text().then(value => value.includes('Machine Fly')), 'second workout');
  await until(() => text().then(value => value.includes('20 kg') && value.includes('10 @ RIR')), 'previous performance');

  step = 'cloud restore';
  await ev("document.querySelector('[data-nav=account]').click()");
  await until(() => ev("Boolean(document.querySelector('[data-action=logout]'))"), 'account');
  await ev("document.querySelector('[data-action=logout]').click()");
  await until(async () => (await text()).includes("AKS'ye hoş geldin") || await ev("Boolean(document.querySelector('#authEmail'))"), 'logout');
  await cdp.send('Page.reload', { ignoreCache: true });
  await until(async () => (await text()).includes("AKS'ye hoş geldin") || await ev("Boolean(document.querySelector('#authEmail'))"), 'post-logout reload');
  if (!await ev("Boolean(document.querySelector('#authEmail'))")) await ev("document.querySelector('[data-action=returning-login]').click()");
  await fill('#authEmail', email);
  await fill('#authPassword', password);
  await ev("document.querySelector('[data-action=login]').click()");
  await until(() => text().then(value => value.includes('Test Workout')), 'restore');

  step = 'offline persistence';
  await ev("window.confirm=()=>true");
  await openFirstProgramDetail();
  await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await ev("document.querySelector('[data-start-program-day]').click()");
  await until(() => text().then(value => value.includes('Machine Fly')), 'offline workout');
  await saveFirstExercise('22.5', '8');
  const offlineSaved = await ev("window.__a2.repository.getDraft().then(d=>Object.values(d.sets||{}).flatMap(Object.values).some(s=>String(s.weight)==='22.5'&&String(s.reps)==='8'))");
  if (!offlineSaved) throw new Error('offline set missing');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await ev("window.dispatchEvent(new Event('online'))");
  await wait(1800);
  await cdp.send('Page.reload', { ignoreCache: true });
  await until(() => ev('Boolean(window.__a2)'), 'offline reload');
  const persisted = await ev("window.__a2.repository.getDraft().then(d=>Object.values(d?.sets||{}).flatMap(Object.values).some(s=>String(s.weight)==='22.5'&&String(s.reps)==='8'))");
  if (!persisted) throw new Error('offline persistence missing');

  const overflow = await ev('document.documentElement.scrollWidth <= window.innerWidth');
  if (!overflow) throw new Error('overflow');
  console.log(JSON.stringify({ ok: true, workout: true, sets: true, timer: true, summary: true, history: true, previous: true, restore: true, offlinePersistence: true, overflow: true }));
} catch (error) {
  if (cdp) {
    try { writeFileSync(join(artifacts, 'authenticated-workout-failure.png'), Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64')); } catch {}
  }
  console.error(`WORKOUT_E2E_FAILED [${step}]: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (cdp) {
    try {
      await ev(`fetch('/api/auth/delete',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirm:'DELETE',password:${JSON.stringify(password)}})})`);
    } catch {}
  }
  chrome.kill();
}

async function beginOnboarding() {
  await ev("document.querySelector('[data-action=onboarding-start]').click()");
  await until(() => ev("Boolean(document.querySelector('[data-onboarding-value=\"goal:fitness\"]'))"), 'goal step');
  await ev("document.querySelector('[data-onboarding-value=\"goal:fitness\"]').click()");
  await wait(150);
  await ev("document.querySelector('[data-action=onboarding-next]').click()");
  await until(() => ev("Boolean(document.querySelector('[data-onboarding-value=\"experience:beginner\"]'))"), 'experience step');
  await ev("document.querySelector('[data-onboarding-value=\"experience:beginner\"]').click()");
  await wait(150);
  await ev("document.querySelector('[data-action=onboarding-next]').click()");
  for (let i = 0; i < 5; i += 1) {
    await wait(100);
    await ev("document.querySelector('[data-action=onboarding-skip]')?.click() || document.querySelector('[data-action=onboarding-next]')?.click()");
  }
}

async function searchAndSelect(query) {
  await fill('[data-exercise-search]', query);
  await until(() => ev("Boolean(document.querySelector('[data-select-exercise]'))"), `${query} result`);
  await ev("document.querySelector('[data-select-exercise]').click()");
  await wait(250);
}

async function openFirstProgramWorkout() {
  await openFirstProgramDetail();
  await ev("document.querySelector('[data-start-program-day]').click()");
}

async function openFirstProgramDetail() {
  await until(() => ev("Boolean(document.querySelector('[data-open-program]'))"), 'program list');
  await ev("document.querySelector('[data-open-program]').click()");
  await until(() => ev("Boolean(document.querySelector('[data-start-program-day]'))"), 'program detail');
}

async function save(name, kg, reps) {
  await ev(`(() => {
    const words = ${JSON.stringify(name)}.toLowerCase().split(/\\s+/);
    const card = [...document.querySelectorAll('.exercise-card')].find(item => words.every(word => item.innerText.toLowerCase().includes(word)));
    if (!card) throw new Error('missing card');
    card.querySelector('input[placeholder="kg"]').value = ${JSON.stringify(kg)};
    card.querySelector('input[placeholder="tekrar"]').value = ${JSON.stringify(reps)};
    card.querySelector('[data-save-set]').click();
  })()`);
  await wait(350);
}

async function saveFirstExercise(kg, reps) {
  await ev(`(() => {
    const card = document.querySelector('.exercise-card');
    if (!card) throw new Error('missing first card');
    card.querySelector('input[placeholder="kg"]').value = ${JSON.stringify(kg)};
    card.querySelector('input[placeholder="tekrar"]').value = ${JSON.stringify(reps)};
    card.querySelector('[data-save-set]').click();
  })()`);
  await wait(350);
}

async function fillPrescriptions() {
  await ev(`(() => {
    const fields = [...document.querySelectorAll('[data-field]')];
    const setFields = fields.filter(input => input.dataset.field.endsWith(':setsText'));
    const repFields = fields.filter(input => input.dataset.field.endsWith(':repsText'));
    setFields.forEach(input => {
      input.value = '1';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    repFields.forEach(input => {
      input.value = '10';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  })()`);
  await wait(300);
}

async function fill(selector, value) {
  await ev(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!input) throw new Error('missing input: ${selector}');
    input.value = ${JSON.stringify(value)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
}

async function text() { return ev('document.body ? document.body.innerText : ""'); }
async function until(check, label, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await wait(150);
  }
  throw new Error(`${label} timeout`);
}
function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function ws() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = targets.find(item => item.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await wait(100);
  }
  throw new Error('Chrome CDP unavailable');
}
function connect(url) {
  const socket = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const call = pending.get(message.id);
    if (!call) return;
    pending.delete(message.id);
    message.error ? call.reject(new Error(message.error.message)) : call.resolve(message.result);
  });
  return new Promise((resolveConnection, reject) => {
    socket.addEventListener('open', () => resolveConnection({
      send(method, params = {}) {
        const callId = ++id;
        socket.send(JSON.stringify({ id: callId, method, params }));
        return new Promise((resolve, rejectCall) => pending.set(callId, { resolve, reject: rejectCall }));
      }
    }));
    socket.addEventListener('error', reject);
  });
}
async function ev(expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
