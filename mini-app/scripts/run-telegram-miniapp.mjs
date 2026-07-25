#!/usr/bin/env node
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const appRoot = path.resolve(path.dirname(__filename), '..');
const workspaceRoot = path.resolve(appRoot, '..');
const rootEnvPath = path.join(workspaceRoot, '.env');
const appEnvPath = path.join(appRoot, '.env');
const appEnvLocalPath = path.join(appRoot, '.env.local');
const isWindows = process.platform === 'win32';
const args = new Set(process.argv.slice(2));
const force = args.has('--force') || !args.has('--no-force');
const skipBuild = args.has('--skip-build');
const strictVerify = args.has('--strict-verify');

function printHelp() {
  console.log(`Usage: npm run telegram -- [--force|--no-force] [--skip-build] [--strict-verify]`);
  console.log('');
  console.log('Starts the production EdgeGuard server, creates a Cloudflare quick tunnel,');
  console.log('updates the Telegram bot Mini App menu, and keeps both processes running.');
}

if (args.has('--help') || args.has('-h')) {
  printHelp();
  process.exit(0);
}

const port = Number(process.env.PORT || readEnvFiles().PORT || 4000);
const cloudflaredPath = process.env.CLOUDFLARED_PATH
  || (isWindows ? 'C:\\tmp\\edgeguard-cloudflared.exe' : 'cloudflared');

const children = new Set();
let shuttingDown = false;

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const values = {};
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([^=]+)=(.*)$/);
    if (!match) continue;
    const key = match[1].trim();
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function readEnvFiles() {
  return {
    ...readEnvFile(rootEnvPath),
    ...readEnvFile(appEnvPath),
    ...readEnvFile(appEnvLocalPath),
    ...process.env,
  };
}

function log(message) {
  console.log(`[EdgeGuard MiniApp] ${message}`);
}

function buildCommand() {
  return isWindows
    ? { command: 'cmd.exe', args: ['/d', '/s', '/c', 'npm run build'] }
    : { command: 'npm', args: ['run', 'build'] };
}
function run(command, commandArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd: options.cwd || appRoot,
      env: options.env || process.env,
      stdio: options.stdio || 'inherit',
      shell: options.shell ?? false,
    });
    child.on('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${commandArgs.join(' ')} failed with ${signal || code}`));
    });
    child.on('error', reject);
  });
}

function execSpawn(command, commandArgs, options) {
  const { spawn } = globalThis.__edgeguardSpawn || {};
  if (spawn) return spawn(command, commandArgs, options);
  throw new Error('spawn is not initialized');
}

async function initSpawn() {
  const childProcess = await import('node:child_process');
  globalThis.__edgeguardSpawn = { spawn: childProcess.spawn };
}

async function pidsListeningOnPort(targetPort) {
  if (isWindows) {
    const { stdout } = await execFileAsync('netstat', ['-ano'], { windowsHide: true });
    return [...new Set(stdout.split(/\r?\n/)
      .filter((line) => line.includes(`:${targetPort}`) && /LISTENING/i.test(line))
      .map((line) => line.trim().split(/\s+/).pop())
      .filter((pid) => /^\d+$/.test(pid))
      .map(Number))];
  }

  try {
    const { stdout } = await execFileAsync('lsof', ['-ti', `tcp:${targetPort}`]);
    return stdout.split(/\s+/).filter(Boolean).map(Number);
  } catch {
    return [];
  }
}

async function stopPid(pid) {
  if (pid === process.pid) return;
  try {
    process.kill(pid, isWindows ? undefined : 'SIGTERM');
    await wait(1000);
  } catch {}
  try {
    process.kill(pid, isWindows ? undefined : 'SIGKILL');
  } catch {}
}

async function stopExistingServer() {
  const pids = await pidsListeningOnPort(port);
  if (!pids.length) return;
  if (!force) {
    throw new Error(`Port ${port} is busy (PID ${pids.join(', ')}). Stop it first or run with --force.`);
  }
  log(`Stopping existing process on port ${port}: PID ${pids.join(', ')}`);
  for (const pid of pids) await stopPid(pid);
}

async function stopExistingEdgeguardTunnels() {
  if (!force || !isWindows) return;
  const command = 'Get-Process -Name edgeguard-cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force';
  await execFileAsync('powershell.exe', ['-NoProfile', '-Command', command], { windowsHide: true }).catch(() => {});
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForLocalServer(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const status = await httpStatus(`http://127.0.0.1:${port}/health`, 5000);
      if (status >= 200 && status < 500) return;
      lastError = `HTTP ${status}`;
    } catch (error) {
      lastError = error.message;
    }
    await wait(1000);
  }
  throw new Error(`Server did not become ready on port ${port}: ${lastError}`);
}

function httpStatus(url, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { timeout: timeoutMs }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode || 0));
    });
    request.on('timeout', () => {
      request.destroy(new Error('request timed out'));
    });
    request.on('error', reject);
  });
}

function spawnManaged(command, commandArgs, options = {}) {
  const child = spawn(command, commandArgs, {
    cwd: options.cwd || appRoot,
    env: options.env || process.env,
    stdio: options.stdio || ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    shell: false,
  });
  children.add(child);
  child.once('exit', () => children.delete(child));
  return child;
}

function pipePrefixed(stream, prefix, onLine) {
  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (line.trim()) {
        if (onLine) onLine(line);
        console.log(`${prefix} ${line}`);
      }
    }
  });
}

function waitForTunnelUrl(child, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(new Error('Cloudflare tunnel URL was not printed in time.')), timeoutMs);
    const findUrl = (line) => {
      const match = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
      if (match) {
        clearTimeout(deadline);
        resolve(match[0]);
      }
    };
    pipePrefixed(child.stdout, '[cloudflared]', findUrl);
    pipePrefixed(child.stderr, '[cloudflared]', findUrl);
    child.once('exit', (code) => {
      clearTimeout(deadline);
      reject(new Error(`cloudflared exited before URL was ready (${code}).`));
    });
  });
}

async function updateEnvWebappUrl(url) {
  const values = fs.existsSync(rootEnvPath)
    ? fs.readFileSync(rootEnvPath, 'utf8').split(/\r?\n/)
    : [];
  let found = false;
  const nextLines = values.map((line) => {
    if (/^TELEGRAM_WEBAPP_URL=/.test(line)) {
      found = true;
      return `TELEGRAM_WEBAPP_URL=${url}`;
    }
    return line;
  });
  if (!found) nextLines.push(`TELEGRAM_WEBAPP_URL=${url}`);
  fs.writeFileSync(rootEnvPath, nextLines.join('\n').replace(/\n*$/, '\n'));
}

async function setTelegramMenuButton(botToken, url) {
  const endpoint = `https://api.telegram.org/bot${botToken}/setChatMenuButton`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      menu_button: {
        type: 'web_app',
        text: 'Mo EdgeGuard',
        web_app: { url },
      },
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.description || `Telegram setChatMenuButton failed with HTTP ${response.status}`);
  }
}

async function verifyPublicUrl(url) {
  let lastError = '';
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      const response = await fetch(url);
      const html = await response.text();
      if (!response.ok) throw new Error(`Public URL returned HTTP ${response.status}`);
      if (html.includes('webpack-hmr')) throw new Error('Public URL is serving a development build with webpack-hmr.');
      log('Public URL responded successfully.');
      return true;
    } catch (error) {
      lastError = error.message;
      if (attempt === 1 || attempt % 10 === 0) {
        log(`Waiting for public URL to become reachable (${attempt}/30): ${lastError}`);
      }
      await wait(2000);
    }
  }

  const message = `Public URL could not be verified from this terminal: ${lastError}`;
  if (strictVerify) throw new Error(message);
  log(`Warning: ${message}`);
  log('Continuing anyway because Cloudflare quick tunnels can be reachable from Telegram before local Node fetch can verify them.');
  return false;
}

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  log('Stopping server and tunnel...');
  for (const child of [...children].reverse()) {
    try { child.kill(); } catch {}
  }
  await wait(500);
  process.exit(0);
}

async function main() {
  await initSpawn();
  const envValues = readEnvFiles();
  if (!envValues.TELEGRAM_BOT_TOKEN) throw new Error('Missing TELEGRAM_BOT_TOKEN in ../.env');
  if (!envValues.ADMIN_TELEGRAM_IDS) log('Warning: ADMIN_TELEGRAM_IDS is empty, admin bootstrap will not work.');
  if (isWindows && cloudflaredPath.includes('\\') && !fs.existsSync(cloudflaredPath)) {
    throw new Error(`cloudflared not found at ${cloudflaredPath}. Set CLOUDFLARED_PATH or download it first.`);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  log(`Using port ${port}.`);
  await stopExistingServer();
  await stopExistingEdgeguardTunnels();

  if (!skipBuild) {
    log('Building Next.js production bundle...');
    const build = buildCommand();
    await run(build.command, build.args, { cwd: appRoot });
  }

  log('Starting production server...');
  const server = spawnManaged(process.execPath, ['server.js'], {
    cwd: appRoot,
    env: {
      ...process.env,
      ...envValues,
      NODE_ENV: 'production',
      PORT: String(port),
    },
  });
  pipePrefixed(server.stdout, '[server]');
  pipePrefixed(server.stderr, '[server]');
  await waitForLocalServer();

  log('Starting Cloudflare tunnel...');
  const tunnel = spawnManaged(cloudflaredPath, ['tunnel', '--url', `http://127.0.0.1:${port}`, '--no-autoupdate']);
  const tunnelUrl = await waitForTunnelUrl(tunnel);
  const webappUrl = `${tunnelUrl}/?v=${Math.floor(Date.now() / 1000)}`;

  await updateEnvWebappUrl(webappUrl);
  await setTelegramMenuButton(envValues.TELEGRAM_BOT_TOKEN, webappUrl);
  await verifyPublicUrl(webappUrl);

  console.log('');
  log('READY. Keep this terminal open. Ctrl+C stops everything.');
  log(`Mini App URL: ${webappUrl}`);
  log('Open Telegram bot @IoT_23CLC06_bot, close old Mini App windows, then press Mo EdgeGuard.');
  console.log('');
}

main().catch((error) => {
  console.error(`[EdgeGuard MiniApp] ERROR: ${error.message}`);
  process.exitCode = 1;
});

