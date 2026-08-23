import { spawn } from 'node:child_process';

try { process.loadEnvFile('.env'); } catch {}
if (!process.env.OPENAI_API_KEY) { console.log('SKIPPED: OPENAI_API_KEY missing'); process.exit(0); }

const port = 8788;
const baseUrl = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev', '--local', '--port', String(port)], { stdio: 'ignore', windowsHide: true });

try {
  await waitForReady();
  const [health, home, workerScript] = await Promise.all([
    fetch(`${baseUrl}/api/health`).then(response => response.json()),
    fetch(`${baseUrl}/`).then(response => response.text()),
    fetch(`${baseUrl}/sw.js`).then(response => response.text())
  ]);
  if (!health.ok || !health.aiImportConfigured || !home.includes('A2 Antrenman') || !workerScript.includes('CACHE_VERSION')) throw new Error('Cloudflare static or health check failed');
  const result = await run(process.execPath, ['scripts/import-ui-e2e-test.mjs'], { ...process.env, A2_E2E_BASE_URL: baseUrl });
  if (result !== 0) process.exitCode = result;
} catch (error) {
  console.error(`CLOUDFLARE_LOCAL_E2E_FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  server.kill();
}

async function waitForReady() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${baseUrl}/api/health`)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('wrangler dev did not become ready');
}

function run(command, args, env) {
  return new Promise(resolve => {
    const child = spawn(command, args, { env, stdio: 'inherit', windowsHide: true });
    child.on('exit', code => resolve(code || 0));
    child.on('error', () => resolve(1));
  });
}
