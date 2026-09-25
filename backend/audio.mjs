// backend/audio.mjs — Audio download via yt-dlp and conversion via FFmpeg
import { spawn } from 'child_process';
import { withTimeout, ensureDir, logJob } from './utils.mjs';
import { execFile } from 'child_process';
import { findExecutable } from './system-check.mjs';
import path from 'path';
import fs from 'fs';

const DOWNLOAD_TIMEOUT = 10 * 60 * 1000;  // 10 minutes
const CONVERT_TIMEOUT = 5 * 60 * 1000;     // 5 minutes
const PROBE_TIMEOUT = 30000;               // 30 seconds

/**
 * Download audio from YouTube using yt-dlp (spawn with argument arrays — safe)
 */
export async function downloadAudio(videoId, jobDir, onProgress) {
  ensureDir(jobDir);
  const outputPath = path.join(jobDir, 'audio.%(ext)s');
  const url = `https://www.youtube.com/watch?v=${videoId}`;

  const promise = new Promise((resolve, reject) => {
    const args = [
      '-f', 'bestaudio/best',
      '-o', outputPath,
      '--no-playlist',
      '--no-warnings',
      '--newline',
      url
    ];

    const ytDlpBinary = findExecutable('yt-dlp') || 'yt-dlp';
    const proc = spawn(ytDlpBinary, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stderr = '';
    let lastProgress = 0;

    proc.stdout.on('data', (data) => {
      const line = data.toString();
      // Parse yt-dlp download progress
      const match = line.match(/(\d+\.?\d*)%/);
      if (match) {
        const pct = parseFloat(match[1]);
        if (pct - lastProgress >= 5) {
          lastProgress = pct;
          if (onProgress) onProgress(`Downloading audio: ${Math.round(pct)}%`);
        }
      }
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('error', (err) => {
      reject(new Error(`yt-dlp failed to start: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`yt-dlp exited with code ${code}: ${stderr.substring(0, 500)}`));
        return;
      }
      // Find downloaded audio file
      const audioFile = findAudioFile(jobDir);
      if (audioFile) {
        resolve(audioFile);
      } else {
        reject(new Error('Audio download completed but no audio file found'));
      }
    });

    // Store process reference for cancellation
    resolve._proc = proc;
  });

  return withTimeout(promise, DOWNLOAD_TIMEOUT, 'Audio download');
}

/**
 * Find the downloaded audio file in the job directory
 */
function findAudioFile(dir) {
  try {
    const files = fs.readdirSync(dir);
    const audioExts = ['.webm', '.m4a', '.mp3', '.mp4', '.ogg', '.opus', '.wav', '.aac', '.flac'];
    for (const ext of audioExts) {
      const match = files.find(f => f.startsWith('audio') && f.endsWith(ext));
      if (match) return path.join(dir, match);
    }
    // Try any audio file
    for (const f of files) {
      for (const ext of audioExts) {
        if (f.endsWith(ext)) return path.join(dir, f);
      }
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Convert audio to WAV 16kHz mono using FFmpeg
 */
export async function convertToWav(inputPath, jobDir, onProgress) {
  const outputPath = path.join(jobDir, 'audio.wav');
  const ffmpegBinary = findExecutable('ffmpeg', [
    path.join('C:', 'ffmpeg', 'bin'),
    path.join('C:', 'Program Files', 'ffmpeg', 'bin'),
    path.join('C:', 'Program Files', 'FFmpeg', 'bin'),
    path.join('C:', 'Program Files', 'Gyan', 'FFmpeg', 'bin'),
    path.join('C:', 'Program Files', 'Softdeluxe', 'Free Download Manager')
  ]) || 'ffmpeg';

  const promise = new Promise((resolve, reject) => {
    if (onProgress) onProgress('Converting audio to WAV format...');

    const args = [
      '-i', inputPath,
      '-ar', '16000',
      '-ac', '1',
      '-f', 'wav',
      '-y',
      outputPath
    ];

    const proc = spawn(ffmpegBinary, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stderr = '';

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
      // Parse FFmpeg progress
      const timeMatch = data.toString().match(/time=(\d{2}):(\d{2}):(\d{2})/);
      if (timeMatch) {
        const secs = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseInt(timeMatch[3]);
        if (onProgress) onProgress(`Converting audio: ${secs}s processed`);
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`FFmpeg failed to start: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`FFmpeg exited with code ${code}: ${stderr.substring(0, 500)}`));
        return;
      }
      if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
        reject(new Error('FFmpeg produced an empty or missing output file'));
        return;
      }
      resolve(outputPath);
    });
  });

  return withTimeout(promise, CONVERT_TIMEOUT, 'Audio conversion');
}

/**
 * Validate an audio file using FFmpeg probe
 */
export async function validateAudio(audioPath) {
  if (!fs.existsSync(audioPath)) {
    return { valid: false, reason: 'File does not exist' };
  }

  const stat = fs.statSync(audioPath);
  if (stat.size === 0) {
    return { valid: false, reason: 'File is empty' };
  }

  const ffmpegBinary = findExecutable('ffmpeg', [
    path.join('C:', 'ffmpeg', 'bin'),
    path.join('C:', 'Program Files', 'ffmpeg', 'bin'),
    path.join('C:', 'Program Files', 'FFmpeg', 'bin'),
    path.join('C:', 'Program Files', 'Gyan', 'FFmpeg', 'bin'),
    path.join('C:', 'Program Files', 'Softdeluxe', 'Free Download Manager')
  ]) || 'ffmpeg';

  // Probe with FFmpeg
  const promise = new Promise((resolve) => {
    execFile(ffmpegBinary, [
      '-i', audioPath,
      '-f', 'null',
      '-t', '1',
      '-'
    ], { timeout: PROBE_TIMEOUT, windowsHide: true }, (err, stdout, stderr) => {
      // FFmpeg always outputs info to stderr
      const output = stderr || '';
      const durationMatch = output.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2})/);
      if (durationMatch) {
        const duration = parseInt(durationMatch[1]) * 3600 + parseInt(durationMatch[2]) * 60 + parseInt(durationMatch[3]);
        resolve({ valid: true, duration, size: stat.size });
      } else if (err && !output.includes('Duration')) {
        resolve({ valid: false, reason: 'FFmpeg could not read the audio file' });
      } else {
        resolve({ valid: true, duration: 0, size: stat.size });
      }
    });
  });

  return withTimeout(promise, PROBE_TIMEOUT, 'Audio validation');
}
