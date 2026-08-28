import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { platform } from 'node:os';

const envCandidates = [
  process.env.CHROME_PATH,
  process.env.CHROME_BIN,
  process.env.GOOGLE_CHROME_BIN,
  process.env.PUPPETEER_EXECUTABLE_PATH
].filter(Boolean);

const windowsCandidates = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  `${process.env.LOCALAPPDATA || ''}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env.PROGRAMFILES || ''}\\Google\\Chrome\\Application\\chrome.exe`,
  `${process.env['PROGRAMFILES(X86)'] || ''}\\Google\\Chrome\\Application\\chrome.exe`
];

const macCandidates = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium'
];

const linuxCommands = [
  'google-chrome',
  'google-chrome-stable',
  'chromium',
  'chromium-browser'
];

export function getChromePath() {
  for (const candidate of [...envCandidates, ...platformCandidates()]) {
    if (candidate && existsSync(candidate)) return candidate;
  }

  if (platform() !== 'win32') {
    for (const command of linuxCommands) {
      try {
        const resolved = execFileSync('which', [command], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        if (resolved) return resolved;
      } catch {}
    }
  }

  throw new Error('Chrome/Chromium executable could not be found. Set CHROME_PATH or CHROME_BIN.');
}

function platformCandidates() {
  if (platform() === 'win32') return windowsCandidates;
  if (platform() === 'darwin') return macCandidates;
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
}
