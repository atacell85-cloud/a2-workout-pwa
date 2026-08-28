import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { getChromePath } from './chrome-path.mjs';

const base = process.env.A2_PILOT_BASE_URL || 'https://a2-workout.antrenmankocu.workers.dev';
const root = resolve('.');
const profile = join(root, '.tmp-sprint1-builder');
const port = 9241;
const email = `sprint1-${Date.now()}@example.test`;
const password = 'Sprint1Test!2026';
const chromePath = getChromePath();

if (existsSync(profile)) rmSync(profile, { recursive: true, force: true });
mkdirSync(profile, { recursive: true });
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
let cdp; let stage = 'launch';
try {
  cdp = await connect(await ws());
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { mobile: true, width: 375, height: 812, deviceScaleFactor: 1 });
  await cdp.send('Page.navigate', { url: base });
  await until(async () => (await text()).includes("Reptrio'ya hoş geldin") || await ev("Boolean(document.querySelector('#authEmail'))"), 'welcome or auth');
  if (!(await ev("Boolean(document.querySelector('#authEmail'))"))) await beginOnboarding();
  await until(() => ev("Boolean(document.querySelector('#authEmail'))"), 'auth');
  stage = 'register'; await ev(`fill('#authEmail', ${JSON.stringify(email)}); fill('#authPassword', ${JSON.stringify(password)}); document.querySelector('[data-action=register]').click()`);
  await until(() => ev("Boolean(document.querySelector('[data-action=new-program]'))"), 'program list');
  stage = 'manual builder'; await ev("document.querySelector('[data-action=new-program]').click()");
  await until(() => ev("Boolean(document.querySelector('#builderName'))"), 'builder');
  await ev("fill('#builderName','Test Upper'); document.querySelector('[data-action=add-day]').click()");
  await until(() => ev("Boolean(document.querySelector('[data-builder-day-name]'))"), 'day');
  await ev("fill('[data-builder-day-name]','Upper')");
  await until(() => ev("Boolean(document.querySelector('[data-exercise-search]'))"), 'section');
  await ev("fill('[data-exercise-search]','lat')");
  await until(() => ev("Boolean(document.querySelector('[data-select-exercise$=\":lat-pulldown\"]'))"), 'Lat Pulldown search result');
  stage = 'canonical selection'; await ev("document.querySelector('[data-select-exercise$=\":lat-pulldown\"]').click()");
  await until(() => ev("Boolean(document.querySelector(\"[data-field$=':setsText']\"))"), 'exercise card');
  stage = 'prescription'; await ev("fill(\"[data-field$=':setsText']\",'3'); fill(\"[data-field$=':repsText']\",'10')");
  await until(() => ev("document.querySelector(\"[data-field$=':setsText']\").value === '3' && document.querySelector(\"[data-field$=':repsText']\").value === '10'"), 'input values');
  await wait(350);
  await ev("fill('#builderName','Test Upper')");
  stage = 'save'; await ev("document.querySelector('[data-action=save-program]').click()");
  await until(() => text().then(value => value.includes('Test Upper')), 'saved program');
  stage = 'reopen'; await ev("document.querySelector('[data-open-program]').click()");
  await until(() => text().then(value => value.includes('Upper') && value.includes('Lat Pulldown') && value.includes('3 × 10')), 'reopened program and prescription');
  stage = 'workout'; await ev("document.querySelector('[data-start-program-day]').click()");
  await until(() => text().then(value => value.includes('Lat Pulldown') && value.includes('Plan: 3 × 10')), 'workout prescription');
  const overflow = await ev('document.documentElement.scrollWidth <= window.innerWidth'); if (!overflow) throw new Error('375px horizontal overflow');
  console.log(JSON.stringify({ ok: true, programCreation: true, canonicalSearch: true, exerciseId: 'lat-pulldown', prescription: '3 × 10', reopen: true, workout: true, mobile375: true }));
} catch (error) {
  if (cdp) try { writeFileSync(join(root, 'tests', 'artifacts', 'sprint1-builder-failure.png'), Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64')); } catch {}
  console.error(`SPRINT1_BUILDER_FAILED [${stage}]: ${error.message}`); process.exitCode = 1;
} finally {
  if (cdp) try { await ev(`Promise.race([fetch('/api/auth/delete',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirm:'DELETE',password:${JSON.stringify(password)}})}),new Promise(resolve=>setTimeout(resolve,2500))])`); } catch {}
  cdp?.close();
  chrome.kill();
}

async function until(check, label, timeout = 20000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await check()) return; await wait(150); } throw new Error(`${label} timed out`); }
function wait(ms) { return new Promise(resolveWait => setTimeout(resolveWait, ms)); }
async function text() { return ev('document.body?.innerText || ""'); }
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
async function ws() { for (let i = 0; i < 100; i += 1) { try { const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const page = pages.find(value => value.type === 'page'); if (page) return page.webSocketDebuggerUrl; } catch {} await wait(100); } throw new Error('Chrome CDP unavailable'); }
function connect(url) { const socket = new WebSocket(url); let id = 0; const pending = new Map(); socket.addEventListener('message', event => { const message = JSON.parse(event.data); if (!message.id || !pending.has(message.id)) return; const call = pending.get(message.id); pending.delete(message.id); message.error ? call.reject(new Error(message.error.message)) : call.resolve(message.result); }); return new Promise((resolveConnection, reject) => { socket.addEventListener('open', () => resolveConnection({ send(method, params = {}) { const callId = ++id; socket.send(JSON.stringify({ id: callId, method, params })); return new Promise((resolveCall, rejectCall) => pending.set(callId, { resolve: resolveCall, reject: rejectCall })); }, close() { socket.close(); } })); socket.addEventListener('error', reject); }); }
async function ev(expression) { const result = await cdp.send('Runtime.evaluate', { expression: `(() => { const fill = (selector, value) => { const input = document.querySelector(selector); input.focus(); input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); input.blur(); }; return eval(${JSON.stringify(expression)}); })()`, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; }
