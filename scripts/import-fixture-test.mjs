import http from 'node:http';
import { createReadStream, existsSync, mkdirSync, rmSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { getChromePath } from './chrome-path.mjs';

const root = resolve('.'); const port = 8091; const chromePath = getChromePath(); const userDataDir = join(root, '.tmp-fixture-chrome');
if (existsSync(userDataDir)) rmSync(userDataDir, { recursive: true, force: true }); mkdirSync(userDataDir, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const server = http.createServer((request, response) => { const path = join(root, new URL(request.url, `http://localhost:${port}`).pathname === '/' ? 'index.html' : new URL(request.url, `http://localhost:${port}`).pathname); if (!path.startsWith(root) || !existsSync(path)) return response.writeHead(404).end(); response.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream' }); createReadStream(path).pipe(response); });
await new Promise(resolveServer => server.listen(port, resolveServer));
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run', '--remote-debugging-port=9225', `--user-data-dir=${userDataDir}`, `http://localhost:${port}`], { stdio: 'ignore' });
try { const cdp = await connect(await waitForWs()); await cdp.send('Runtime.enable'); for (let i = 0; i < 30 && !await evaluate(cdp, 'Boolean(window.__a2)'); i += 1) await wait(200); const report = await evaluate(cdp, `(${scenario.toString()})()`); console.log(JSON.stringify(report, null, 2)); if (!report.ok) process.exitCode = 1; } finally { chrome.kill(); server.close(); }

async function scenario() {
  const load = async name => { const response = await fetch(`./tests/fixtures/${name}`); return new File([await response.blob()], name, { type: name.endsWith('.pdf') ? 'application/pdf' : name.endsWith('.docx') ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }); };
  const extract = async name => window.__a2.documentExtractor.extract(await load(name));
  const pdf = await extract('sample-workout.pdf'); const docx = await extract('sample-workout.docx'); const xlsx = await extract('sample-workout.xlsx');
  const text = blocks => blocks.flatMap(block => block.rows?.flat() || [block.text || '']).join(' | ');
  const pdfOk = ['Upper Day','Machine Fly','Incline Smith Press','Lat Pulldown','Cable Crunch'].every(value => text(pdf.blocks).includes(value));
  const docxOk = docx.blocks.some(block => block.type === 'table' && text([block]).includes('Wall Slide')) && text(docx.blocks).includes('Keep controlled tempo.');
  const sheets = xlsx.blocks.filter(block => block.type === 'sheet'); const xlsxOk = sheets.map(sheet => sheet.name).includes('Program') && sheets.map(sheet => sheet.name).includes('Upper') && sheets.find(sheet => sheet.name === 'Upper').usedRange === 'A1:D10' && text(sheets).includes('RIR 2; Rest 120 sec');
  const parser = window.__a2.localImportParser; const database = await window.__a2.loadExerciseDatabase(); const ids = new Set(database.map(item => item.id));
  const parsed = await Promise.all([pdf, docx, xlsx].map(parser.parse));
  parsed.forEach(preview => { preview.unparsedContent.forEach(item => item.resolutionStatus = 'dismissed'); preview.program.days.forEach(day => day.sections.forEach(section => section.items.forEach(item => { if (item.itemType === 'exercise' && item.resolutionStatus !== 'accepted-canonical') { item.resolutionStatus = 'accepted-custom'; item.userEditedExerciseName = item.sourceExerciseName; } }))); });
  const programs = parsed.map(preview => window.__a2.finalizeImport(preview, ids));
  const semantic = program => program.days.map(day => ({ name: day.name, sections: day.sections.map(section => ({ title: section.title, items: section.items.filter(item => item.itemType === 'exercise').map(item => [item.exerciseId || item.customExerciseName, item.setsText || item.sets, item.repsText]) })) }));
  const semantics = programs.map(semantic); const consistent = semantics.every(value => JSON.stringify(value) === JSON.stringify(semantics[0]));
  const roundTripOk = programs.every(program => program.name === 'sample-workout' && program.days.some(day => day.name === 'Upper Day')) && programs.every(program => program.days.flatMap(day => day.sections).some(section => section.title === 'Main Workout')) && consistent;
  const negative = async name => extract(name).then(() => 'OK', error => error.code);
  const negativeCodes = Object.fromEntries(await Promise.all(['empty.pdf','empty.docx','empty.xlsx','corrupt.docx','corrupt.xlsx','sample-scan-only.pdf'].map(async name => [name, await negative(name)])));
  const negativeOk = negativeCodes['empty.pdf'] === 'SCAN_ONLY_PDF' && negativeCodes['empty.docx'] === 'EMPTY_DOCUMENT' && negativeCodes['empty.xlsx'] === 'EMPTY_DOCUMENT' && negativeCodes['corrupt.docx'] === 'CORRUPT_DOCX' && negativeCodes['corrupt.xlsx'] === 'CORRUPT_XLSX' && negativeCodes['sample-scan-only.pdf'] === 'SCAN_ONLY_PDF';
  return { ok: pdfOk && docxOk && xlsxOk && roundTripOk && negativeOk, pdfOk, docxOk, xlsxOk, roundTripOk, negativeOk, crossFormatConsistent: consistent, semantics, negativeCodes, parsedDays: parsed.map(item => item.program.days.length), programNames: programs.map(item => item.name) };
}

async function waitForWs() { for (let i = 0; i < 150; i += 1) { try { const targets = await (await fetch('http://127.0.0.1:9225/json/list')).json(); const page = targets.find(target => target.type === 'page' && target.url.startsWith(`http://localhost:${port}`)); if (page) return page.webSocketDebuggerUrl; } catch {} await wait(100); } throw new Error('Chrome CDP unavailable'); }
function connect(url) { const socket = new WebSocket(url); let id = 0; const pending = new Map(); socket.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { const item = pending.get(message.id); pending.delete(message.id); message.error ? item.reject(new Error(message.error.message)) : item.resolve(message.result); } }); return new Promise((resolve, reject) => { socket.addEventListener('open', () => resolve({ send(method, params = {}) { const callId = ++id; socket.send(JSON.stringify({ id: callId, method, params })); return new Promise((resolveCall, rejectCall) => pending.set(callId, { resolve: resolveCall, reject: rejectCall })); } })); socket.addEventListener('error', reject); }); }
async function evaluate(cdp, expression) { const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.text); return result.result.value; }
function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
