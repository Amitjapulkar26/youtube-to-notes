// backend/utils.mjs — Shared utilities for NoteCraft AI
import { randomBytes } from 'crypto';
import path from 'path';
import fs from 'fs';
import os from 'os';

const RUNTIME_ROOT = process.env.VERCEL
  ? path.join(os.tmpdir(), 'notecraft-ai')
  : path.resolve('.');

/**
 * Wraps a promise with a timeout. Rejects if the promise doesn't resolve within `ms`.
 */
export function withTimeout(promise, ms, label = 'Operation') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Generate a unique job ID
 */
export function generateJobId() {
  const ts = Date.now();
  const rand = randomBytes(4).toString('hex');
  return `job_${ts}_${rand}`;
}

/**
 * Sanitize a filename — remove unsafe characters
 */
export function sanitizeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .substring(0, 100);
}

/**
 * Ensure a directory exists
 */
export function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
}

/**
 * Remove a directory recursively (safe)
 */
export function removeDir(dirPath) {
  try {
    if (fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true });
    }
  } catch (e) {
    console.error(`[cleanup] Failed to remove ${dirPath}: ${e.message}`);
  }
}

/**
 * Get temp directory for a job
 */
export function getJobTempDir(jobId) {
  return path.join(RUNTIME_ROOT, 'temp', 'jobs', jobId);
}

/**
 * Get logs directory for a job
 */
export function getJobLogPath(jobId) {
  const logsDir = path.join(RUNTIME_ROOT, 'logs');
  ensureDir(logsDir);
  return path.join(logsDir, `${jobId}.log`);
}

/**
 * Append to job log
 */
export function logJob(jobId, level, message) {
  const logPath = getJobLogPath(jobId);
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level.toUpperCase()}] ${message}\n`;
  try {
    fs.appendFileSync(logPath, line);
  } catch (e) {
    // logging should never crash the app
  }
}

/**
 * Escape HTML to prevent XSS
 */
export function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Sleep helper
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Clean up abandoned jobs in temp directory on startup
 */
export function cleanupAbandonedJobs() {
  const tempDir = path.join(RUNTIME_ROOT, 'temp', 'jobs');
  if (!fs.existsSync(tempDir)) return;
  try {
    const dirs = fs.readdirSync(tempDir);
    for (const dir of dirs) {
      const fullPath = path.join(tempDir, dir);
      const stat = fs.statSync(fullPath);
      // Remove jobs older than 24 hours
      if (Date.now() - stat.mtimeMs > 24 * 60 * 60 * 1000) {
        removeDir(fullPath);
        console.log(`[cleanup] Removed abandoned job dir: ${dir}`);
      }
    }
  } catch (e) {
    console.error(`[cleanup] Error cleaning abandoned jobs: ${e.message}`);
  }
}
