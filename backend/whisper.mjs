// backend/whisper.mjs — Faster-Whisper transcription via Python subprocess
import { spawn } from 'child_process';
import { withTimeout, logJob } from './utils.mjs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WHISPER_TIMEOUT = 30 * 60 * 1000; // 30 minutes

/**
 * Transcribe audio using Faster-Whisper Python worker
 * @param {string} audioPath - path to WAV file
 * @param {string} jobId - for logging
 * @param {string} pythonCmd - python executable path
 * @param {function} onProgress - progress callback
 * @returns {object} { success, text, segments, language, duration }
 */
export async function transcribeWithWhisper(audioPath, jobId, pythonCmd = 'python', onProgress) {
  const workerPath = path.join(__dirname, 'whisper_worker.py');
  const model = process.env.WHISPER_MODEL || 'base';

  const promise = new Promise((resolve, reject) => {
    logJob(jobId, 'info', `Starting Whisper transcription: model=${model}, audio=${audioPath}`);
    if (onProgress) onProgress('Starting speech-to-text engine...');

    const proc = spawn(pythonCmd, [
      workerPath,
      '--audio', audioPath,
      '--model', model
    ], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let lastProgressTime = Date.now();

    // Store process reference for cancellation
    transcribeWithWhisper._currentProcess = proc;

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
      lastProgressTime = Date.now();
    });

    proc.stderr.on('data', (data) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (line.startsWith('PROGRESS|')) {
          const parts = line.split('|');
          if (parts.length >= 3) {
            const stage = parts[1];
            const pct = parseInt(parts[2], 10);
            if (onProgress) onProgress(`Transcribing: ${pct}%`, pct);
            lastProgressTime = Date.now();
          }
        } else if (line.startsWith('INFO|')) {
          const msg = line.substring(5);
          if (onProgress) onProgress(msg);
          logJob(jobId, 'info', `Whisper: ${msg}`);
        } else if (line.trim()) {
          stderr += line + '\n';
          logJob(jobId, 'debug', `Whisper stderr: ${line}`);
        }
      }
    });

    proc.on('error', (err) => {
      transcribeWithWhisper._currentProcess = null;
      reject(new Error(`Whisper process failed to start: ${err.message}`));
    });

    proc.on('close', (code) => {
      transcribeWithWhisper._currentProcess = null;

      if (code !== 0) {
        logJob(jobId, 'error', `Whisper exited with code ${code}: ${stderr.substring(0, 1000)}`);
        reject(new Error(`Whisper exited with code ${code}: ${stderr.substring(0, 500)}`));
        return;
      }

      // Parse JSON result from stdout
      try {
        // Find the JSON block in stdout (skip any non-JSON lines)
        const jsonMatch = stdout.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          reject(new Error('Whisper produced no JSON output'));
          return;
        }
        const result = JSON.parse(jsonMatch[0]);
        if (!result.success) {
          reject(new Error(result.error || 'Whisper transcription failed'));
          return;
        }
        if (!result.text || result.text.trim().length < 50) {
          reject(new Error('Whisper produced an empty or very short transcript'));
          return;
        }
        logJob(jobId, 'info', `Whisper completed: ${result.text.length} chars, lang=${result.language}`);
        resolve(result);
      } catch (parseErr) {
        logJob(jobId, 'error', `Failed to parse Whisper output: ${parseErr.message}`);
        logJob(jobId, 'debug', `Raw stdout: ${stdout.substring(0, 2000)}`);
        reject(new Error(`Failed to parse Whisper output: ${parseErr.message}`));
      }
    });
  });

  return withTimeout(promise, WHISPER_TIMEOUT, 'Whisper transcription');
}

/**
 * Kill the current Whisper process if running
 */
export function killWhisperProcess() {
  if (transcribeWithWhisper._currentProcess) {
    try {
      transcribeWithWhisper._currentProcess.kill('SIGTERM');
    } catch (e) {
      try { transcribeWithWhisper._currentProcess.kill('SIGKILL'); } catch {}
    }
    transcribeWithWhisper._currentProcess = null;
  }
}
