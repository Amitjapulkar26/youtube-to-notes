// backend/system-check.mjs — Detect system tools availability
import { execFile, spawn } from 'child_process';
import { withTimeout } from './utils.mjs';
import path from 'path';
import fs from 'fs';
import os from 'os';

const TIMEOUT = 10000; // 10s for each check

/**
 * Try to run a command and return version/success
 */
function tryCommand(cmd, args = ['--version'], commonPaths = []) {
  return new Promise((resolve) => {
    try {
      const executable = findExecutable(cmd, commonPaths) || cmd;
      const proc = execFile(executable, args, { timeout: TIMEOUT, windowsHide: true }, (err, stdout, stderr) => {
        if (err) {
          resolve({ available: false, error: err.message });
        } else {
          const output = (stdout || stderr || '').trim().split('\n')[0];
          resolve({ available: true, version: output, command: executable });
        }
      });
    } catch (e) {
      resolve({ available: false, error: e.message });
    }
  });
}

/**
 * Search common paths for an executable.
 * This is especially important on Windows where apps like FFmpeg are often
 * installed outside PATH (for example under Program Files or WinGet).
 */
export function findExecutable(name, commonPaths = []) {
  if (!name) return null;

  // Direct path supplied by env or caller
  if (fs.existsSync(name)) return name;

  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  const defaultWindowsLocations = [
    path.join('C:', 'ffmpeg', 'bin'),
    path.join('C:', 'Program Files', 'ffmpeg', 'bin'),
    path.join('C:', 'Program Files', 'FFmpeg', 'bin'),
    path.join('C:', 'Program Files', 'Gyan', 'FFmpeg', 'bin'),
    path.join('C:', 'Program Files', 'Softdeluxe', 'Free Download Manager'),
    path.join(os.homedir(), 'AppData', 'Local', 'Python', 'pythoncore-3.14-64', 'Scripts'),
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Python', 'Python313', 'Scripts'),
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Python', 'Python312', 'Scripts'),
    path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Python', 'Python311', 'Scripts'),
    path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'WinGet', 'Packages'),
  ];

  const searchPaths = [...commonPaths, ...defaultWindowsLocations];

  for (const dir of searchPaths) {
    const normalized = dir.replace(/%([^%]+)%/g, (_, key) => process.env[key] || '');
    for (const ext of exts) {
      const full = path.join(normalized, name + ext);
      if (fs.existsSync(full)) return full;
    }

    if (fs.existsSync(normalized) && fs.statSync(normalized).isDirectory()) {
      const entries = fs.readdirSync(normalized, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const nested = path.join(normalized, entry.name);
        for (const ext of exts) {
          const full = path.join(nested, name + ext);
          if (fs.existsSync(full)) return full;
        }
      }
    }
  }

  const explicitPath = process.env[`${name.toUpperCase()}_PATH`]
    || process.env[`${name.toUpperCase()}_BIN`];
  if (explicitPath && fs.existsSync(explicitPath)) return explicitPath;

  const pathDirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of pathDirs) {
    for (const ext of exts) {
      const full = path.join(dir, name + ext);
      if (fs.existsSync(full)) return full;
    }
  }

  return null;
}

/**
 * Check Python availability — searches common Windows locations
 */
async function checkPython() {
  const candidates = ['python', 'python3', 'py'];
  const home = os.homedir();
  const commonPaths = [
    path.join(home, 'AppData', 'Local', 'Programs', 'Python', 'Python313', 'python.exe'),
    path.join(home, 'AppData', 'Local', 'Programs', 'Python', 'Python312', 'python.exe'),
    path.join(home, 'AppData', 'Local', 'Programs', 'Python', 'Python311', 'python.exe'),
    path.join(home, 'AppData', 'Local', 'Programs', 'Python', 'Python310', 'python.exe'),
    'C:\\Python313\\python.exe',
    'C:\\Python312\\python.exe',
    'C:\\Python311\\python.exe',
    'C:\\Python310\\python.exe',
  ];

  for (const cmd of candidates) {
    const result = await tryCommand(cmd, ['--version']);
    if (result.available) return { ...result, command: cmd };
  }

  // Try common paths
  for (const p of commonPaths) {
    if (fs.existsSync(p)) {
      const result = await tryCommand(p, ['--version']);
      if (result.available) return { ...result, command: p };
    }
  }

  return { available: false, command: null };
}

/**
 * Check if a Python package is installed
 */
async function checkPythonPackage(pythonCmd, packageName) {
  return new Promise((resolve) => {
    try {
      execFile(pythonCmd, ['-c', `import ${packageName}; print('ok')`],
        { timeout: TIMEOUT, windowsHide: true },
        (err, stdout) => {
          resolve({ available: !err && stdout.trim() === 'ok' });
        }
      );
    } catch (e) {
      resolve({ available: false });
    }
  });
}

/**
 * Check Ollama availability
 */
async function checkOllama(url = 'http://127.0.0.1:11434') {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(`${url}/api/tags`, { signal: controller.signal });
    clearTimeout(timer);
    if (resp.ok) {
      const data = await resp.json();
      const models = (data.models || []).map(m => m.name);
      return { available: true, models };
    }
    return { available: false };
  } catch (e) {
    return { available: false };
  }
}

/**
 * Run full system check
 */
export async function runSystemCheck() {
  const results = {};

  // Node.js — always available since we're running it
  results.node = { available: true, version: process.version };

  // Python
  results.python = await checkPython();

  // yt-dlp
  results.ytDlp = await tryCommand('yt-dlp', ['--version']);

  // FFmpeg
  const ffmpegPaths = [
    path.join('C:', 'ffmpeg', 'bin'),
    path.join('C:', 'Program Files', 'ffmpeg', 'bin'),
    path.join('C:', 'Program Files', 'FFmpeg', 'bin'),
    path.join('C:', 'Program Files', 'Gyan', 'FFmpeg', 'bin'),
    path.join('C:', 'Program Files', 'Softdeluxe', 'Free Download Manager'),
    path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'WinGet', 'Packages')
  ];
  results.ffmpeg = await tryCommand('ffmpeg', ['-version'], ffmpegPaths);

  // Whisper (faster-whisper python package)
  if (results.python.available) {
    results.whisper = await checkPythonPackage(results.python.command || 'python', 'faster_whisper');
    results.whisper.model = process.env.WHISPER_MODEL || 'base';
  } else {
    results.whisper = { available: false, reason: 'Python not found' };
  }

  // Ollama
  const ollamaUrl = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
  results.ollama = await checkOllama(ollamaUrl);
  results.ollama.required = false; // Ollama is optional

  return results;
}

/**
 * Get simplified health status
 */
export async function getHealthStatus() {
  const check = await runSystemCheck();
  return {
    server: true,
    node: check.node.available,
    python: check.python.available,
    pythonCommand: check.python.command || null,
    ytDlp: check.ytDlp.available,
    ffmpeg: check.ffmpeg.available,
    whisper: check.whisper.available,
    whisperModel: check.whisper.model || 'base',
    ollama: check.ollama.available,
    ollamaModels: check.ollama.models || []
  };
}

// Cache system check results for 60 seconds
let cachedCheck = null;
let cacheTime = 0;
const CACHE_TTL = 60000;

export async function getCachedSystemCheck() {
  if (cachedCheck && (Date.now() - cacheTime < CACHE_TTL)) {
    return cachedCheck;
  }
  cachedCheck = await runSystemCheck();
  cacheTime = Date.now();
  return cachedCheck;
}

export function invalidateSystemCheckCache() {
  cachedCheck = null;
  cacheTime = 0;
}
