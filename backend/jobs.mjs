// backend/jobs.mjs — Job state machine, SSE broadcasting, async processing pipeline
import { EventEmitter } from 'events';
import { extractVideoId, isValidVideoId, fetchVideoInfo } from './youtube.mjs';
import { getCaptions, normalizeTranscript, chunkTranscript } from './transcript.mjs';
import { getWebCaptions } from './web-captions.mjs';
import { downloadAudio, convertToWav, validateAudio } from './audio.mjs';
import { transcribeWithWhisper, killWhisperProcess } from './whisper.mjs';
import { generateNotes } from './summarizer.mjs';
import { saveNotes, validateNotes } from './notes.mjs';
import { getCachedSystemCheck } from './system-check.mjs';
import { generateJobId, getJobTempDir, ensureDir, removeDir, logJob } from './utils.mjs';

// Active jobs store
const jobs = new Map();

/**
 * Job states
 */
const STATES = {
  IDLE: 'IDLE',
  VALIDATING_URL: 'VALIDATING_URL',
  FETCHING_VIDEO_INFO: 'FETCHING_VIDEO_INFO',
  TRYING_CAPTIONS: 'TRYING_CAPTIONS',
  CAPTION_RESULT: 'CAPTION_RESULT',
  CHECK_AUDIO_TOOLS: 'CHECK_AUDIO_TOOLS',
  DOWNLOAD_AUDIO: 'DOWNLOAD_AUDIO',
  VERIFY_AUDIO: 'VERIFY_AUDIO',
  CONVERT_AUDIO: 'CONVERT_AUDIO',
  TRANSCRIBE_WHISPER: 'TRANSCRIBE_WHISPER',
  VERIFY_TRANSCRIPT: 'VERIFY_TRANSCRIPT',
  NORMALIZE_TRANSCRIPT: 'NORMALIZE_TRANSCRIPT',
  CLEAN_TRANSCRIPT: 'CLEAN_TRANSCRIPT',
  CHUNK_TRANSCRIPT: 'CHUNK_TRANSCRIPT',
  GENERATE_NOTES: 'GENERATE_NOTES',
  GENERATE_VISUALS: 'GENERATE_VISUALS',
  SAVE_HISTORY: 'SAVE_HISTORY',
  READY: 'READY',
  ERROR: 'ERROR',
  CANCELLED: 'CANCELLED',
};

/**
 * Create a new job and start processing
 */
export function createJob(url, options = {}) {
  const jobId = generateJobId();
  const job = {
    id: jobId,
    url,
    options,
    state: STATES.IDLE,
    progress: 0,
    message: 'Queued',
    videoInfo: null,
    notes: null,
    error: null,
    createdAt: Date.now(),
    emitter: new EventEmitter(),
    cancelled: false,
    childProcesses: [],
  };

  jobs.set(jobId, job);

  // Start processing in background — never block
  processJob(jobId).catch(err => {
    console.error(`[job:${jobId}] Unhandled error:`, err.message);
    updateJob(jobId, STATES.ERROR, 100, `Unexpected error: ${err.message}`);
  });

  return { jobId, status: 'queued' };
}

/**
 * Get job status
 */
export function getJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return null;
  return {
    id: job.id,
    state: job.state,
    progress: job.progress,
    message: job.message,
    videoInfo: job.videoInfo,
    notes: job.notes,
    error: job.error,
    createdAt: job.createdAt,
  };
}

/**
 * Get job event emitter for SSE
 */
export function getJobEmitter(jobId) {
  const job = jobs.get(jobId);
  return job ? job.emitter : null;
}

/**
 * Cancel a job
 */
export function cancelJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return false;

  job.cancelled = true;
  killWhisperProcess();

  // Kill child processes
  for (const proc of job.childProcesses) {
    try { proc.kill('SIGTERM'); } catch {}
  }

  updateJob(jobId, STATES.CANCELLED, 0, 'Processing cancelled by user');

  // Cleanup temp files
  const tempDir = getJobTempDir(jobId);
  removeDir(tempDir);

  return true;
}

/**
 * Update job state and emit SSE event
 */
function updateJob(jobId, state, progress, message, extra = {}) {
  const job = jobs.get(jobId);
  if (!job) return;

  job.state = state;
  job.progress = progress;
  job.message = message;

  if (extra.videoInfo) job.videoInfo = extra.videoInfo;
  if (extra.notes) job.notes = extra.notes;
  if (extra.error) job.error = extra.error;

  logJob(jobId, 'info', `[${state}] ${message}`);

  // Emit SSE event
  job.emitter.emit('update', {
    stage: state.toLowerCase(),
    progress,
    message,
    videoInfo: extra.videoInfo || null,
    notes: extra.notes || null,
    error: extra.error || null,
  });
}

/**
 * Check if job is cancelled
 */
function isCancelled(jobId) {
  const job = jobs.get(jobId);
  return job ? job.cancelled : true;
}

/**
 * Main processing pipeline
 */
async function processJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return;

  const { url, options } = job;
  const jobDir = getJobTempDir(jobId);
  ensureDir(jobDir);

  try {
    // ===== VALIDATE URL =====
    if (isCancelled(jobId)) return;
    updateJob(jobId, STATES.VALIDATING_URL, 5, 'Validating YouTube URL...');

    const videoId = extractVideoId(url);
    if (!videoId || !isValidVideoId(videoId)) {
      updateJob(jobId, STATES.ERROR, 0, 'Invalid YouTube URL. Please check and try again.', { error: 'INVALID_URL' });
      return;
    }

    logJob(jobId, 'info', `Video ID: ${videoId}`);

    // ===== FETCH VIDEO INFO =====
    if (isCancelled(jobId)) return;
    updateJob(jobId, STATES.FETCHING_VIDEO_INFO, 10, 'Fetching lecture information...');

    let videoInfo;
    try {
      videoInfo = await fetchVideoInfo(videoId);
      updateJob(jobId, STATES.FETCHING_VIDEO_INFO, 15, `Found: ${videoInfo.title}`, { videoInfo });
    } catch (e) {
      logJob(jobId, 'warn', `Video info fetch failed: ${e.message}`);
      // Continue with minimal info
      videoInfo = {
        id: videoId,
        title: 'YouTube Lecture',
        channel: 'Unknown',
        duration: 0,
        durationStr: '',
        thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      };
      updateJob(jobId, STATES.FETCHING_VIDEO_INFO, 15, 'Could not fetch video details. Continuing...', { videoInfo });
    }

    // ===== TRY CAPTIONS =====
    if (isCancelled(jobId)) return;
    updateJob(jobId, STATES.TRYING_CAPTIONS, 20, 'Checking for captions...');

    let transcript = null;

    try {
      const captionResult = process.env.VERCEL
        ? await getWebCaptions(videoId, (msg) => {
          if (!isCancelled(jobId)) updateJob(jobId, STATES.TRYING_CAPTIONS, 25, msg);
        })
        : await getCaptions(videoId, jobDir, (msg) => {
        if (!isCancelled(jobId)) {
          updateJob(jobId, STATES.TRYING_CAPTIONS, 25, msg);
        }
      });

      if (captionResult.success) {
        updateJob(jobId, STATES.CAPTION_RESULT, 35, `✓ Captions found (${captionResult.source})`);
        transcript = normalizeTranscript(captionResult);
        logJob(jobId, 'info', `Captions success: ${transcript.text.length} chars`);
      } else {
        logJob(jobId, 'info', `Captions unavailable: ${captionResult.reason}`);
      }
    } catch (e) {
      logJob(jobId, 'warn', `Caption retrieval error: ${e.message}`);
    }

    // ===== WHISPER FALLBACK =====
    if (!transcript && !isCancelled(jobId)) {
      updateJob(jobId, STATES.CHECK_AUDIO_TOOLS, 30, 'Captions unavailable. Checking audio tools...');

      if (process.env.VERCEL) {
        updateJob(jobId, STATES.ERROR, 0, 'This Vercel deployment can process lectures with available captions only. Deploy the Docker version to enable audio transcription.', { error: 'AUDIO_UNAVAILABLE_ON_VERCEL' });
        return;
      }

      // Check if whisper is available
      const sysCheck = await getCachedSystemCheck();

      if (!sysCheck.ffmpeg?.available) {
        updateJob(jobId, STATES.ERROR, 0, 'FFmpeg is not installed. Cannot process audio. Please install FFmpeg.', { error: 'NO_FFMPEG' });
        return;
      }

      if (!sysCheck.python?.available || !sysCheck.whisper?.available) {
        updateJob(jobId, STATES.ERROR, 0, 'Whisper is not available. Cannot transcribe. Please install Python + faster-whisper.', { error: 'NO_WHISPER' });
        return;
      }

      const pythonCmd = sysCheck.python.command || 'python';

      // Download audio
      if (isCancelled(jobId)) return;
      updateJob(jobId, STATES.DOWNLOAD_AUDIO, 35, 'Downloading lecture audio...');

      let audioPath;
      try {
        audioPath = await downloadAudio(videoId, jobDir, (msg) => {
          if (!isCancelled(jobId)) updateJob(jobId, STATES.DOWNLOAD_AUDIO, 40, msg);
        });
      } catch (e) {
        updateJob(jobId, STATES.ERROR, 0, `Audio download failed: ${e.message}`, { error: 'DOWNLOAD_FAILED' });
        return;
      }

      // Validate audio
      if (isCancelled(jobId)) return;
      updateJob(jobId, STATES.VERIFY_AUDIO, 45, 'Verifying audio file...');

      const validation = await validateAudio(audioPath);
      if (!validation.valid) {
        updateJob(jobId, STATES.ERROR, 0, `Audio invalid: ${validation.reason}`, { error: 'INVALID_AUDIO' });
        return;
      }

      // Convert to WAV
      if (isCancelled(jobId)) return;
      updateJob(jobId, STATES.CONVERT_AUDIO, 48, 'Converting audio format...');

      let wavPath;
      try {
        wavPath = await convertToWav(audioPath, jobDir, (msg) => {
          if (!isCancelled(jobId)) updateJob(jobId, STATES.CONVERT_AUDIO, 50, msg);
        });
      } catch (e) {
        updateJob(jobId, STATES.ERROR, 0, `Audio conversion failed: ${e.message}`, { error: 'CONVERT_FAILED' });
        return;
      }

      // Transcribe with Whisper
      if (isCancelled(jobId)) return;
      updateJob(jobId, STATES.TRANSCRIBE_WHISPER, 52, 'Starting speech-to-text (this may take a while)...');

      try {
        const whisperResult = await transcribeWithWhisper(wavPath, jobId, pythonCmd, (msg, pct) => {
          if (!isCancelled(jobId)) {
            const progress = pct ? 52 + Math.round(pct * 0.23) : 55;
            updateJob(jobId, STATES.TRANSCRIBE_WHISPER, progress, msg);
          }
        });

        transcript = normalizeTranscript({
          source: 'whisper',
          language: whisperResult.language,
          duration: whisperResult.duration,
          text: whisperResult.text,
          segments: whisperResult.segments,
        });

        updateJob(jobId, STATES.VERIFY_TRANSCRIPT, 76, `✓ Transcription complete (${transcript.text.length} chars)`);
      } catch (e) {
        updateJob(jobId, STATES.ERROR, 0, `Transcription failed: ${e.message}`, { error: 'WHISPER_FAILED' });
        return;
      }
    }

    if (!transcript) {
      if (isCancelled(jobId)) return;
      updateJob(jobId, STATES.ERROR, 0, 'Could not obtain transcript from any source.', { error: 'NO_TRANSCRIPT' });
      return;
    }

    // ===== GENERATE NOTES =====
    if (isCancelled(jobId)) return;
    updateJob(jobId, STATES.GENERATE_NOTES, 78, 'Generating structured notes...');

    let notes;
    try {
      notes = await generateNotes(transcript, {
        language: options.language || 'English',
        examMode: options.examMode || false,
        videoInfo,
      }, (msg) => {
        if (!isCancelled(jobId)) updateJob(jobId, STATES.GENERATE_NOTES, 85, msg);
      });
    } catch (e) {
      updateJob(jobId, STATES.ERROR, 0, `Note generation failed: ${e.message}`, { error: 'NOTES_FAILED' });
      return;
    }

    if (!validateNotes(notes)) {
      updateJob(jobId, STATES.ERROR, 0, 'Generated notes were invalid.', { error: 'INVALID_NOTES' });
      return;
    }

    // ===== SAVE =====
    if (isCancelled(jobId)) return;
    updateJob(jobId, STATES.SAVE_HISTORY, 95, 'Saving notes...');

    try {
      saveNotes(jobId, notes, {
        url,
        videoId,
        channel: videoInfo.channel,
        duration: videoInfo.duration,
        durationStr: videoInfo.durationStr,
        thumbnail: videoInfo.thumbnail,
        noteStyle: options.noteStyle || 'bluePen',
      });
    } catch (e) {
      logJob(jobId, 'error', `Save failed: ${e.message}`);
      // Non-fatal — still show notes
    }

    // ===== READY =====
    updateJob(jobId, STATES.READY, 100, 'Notes ready!', { notes });

    // Cleanup temp files (keep notes)
    removeDir(jobDir);

  } catch (err) {
    if (!isCancelled(jobId)) {
      logJob(jobId, 'error', `Pipeline error: ${err.message}\n${err.stack}`);
      updateJob(jobId, STATES.ERROR, 0, `Processing failed: ${err.message}`, { error: err.message });
    }
  }
}

// ===========================================================================
// DEMO MODE — works without YouTube, Whisper, Ollama, or internet
// ===========================================================================

const DEMO_TRANSCRIPT = `Today we're going to learn about Binary Trees, one of the most important data structures in computer science. A Binary Tree is a hierarchical data structure where each node has at most two children, called the left child and the right child. The topmost node is called the root node. Binary Trees are used in many applications including file systems, databases, and expression parsing.

Let's start with the basic terminology. A node is the fundamental unit of a tree. The root is the topmost node. A leaf node is a node with no children. The height of a tree is the number of edges on the longest path from root to a leaf. The depth of a node is the number of edges from the root to that node.

There are several types of binary trees. A Full Binary Tree is one where every node has either 0 or 2 children. A Complete Binary Tree has all levels completely filled except possibly the last level, which is filled from left to right. A Perfect Binary Tree has all internal nodes with exactly 2 children and all leaves at the same level. A Balanced Binary Tree has the height difference between left and right subtrees of any node as at most 1.

Binary Tree traversal means visiting all nodes in a specific order. There are three main traversal methods. Inorder traversal visits left subtree, then root, then right subtree. This gives nodes in sorted order for BST. Preorder traversal visits root first, then left subtree, then right subtree. This is useful for creating a copy of the tree. Postorder traversal visits left subtree, then right subtree, then root. This is useful for deleting the tree.

A Binary Search Tree or BST is a special type of binary tree where the left child contains values less than the parent, and the right child contains values greater than the parent. This property makes searching very efficient. The time complexity for search, insert, and delete operations is O(log n) for a balanced BST, but can degrade to O(n) for a skewed tree.

The insertion algorithm for BST works as follows. Step 1: Start from the root. Step 2: Compare the value to insert with the current node. Step 3: If smaller, go to left child. Step 4: If larger, go to right child. Step 5: If the position is empty, insert the new node there.

Common applications of Binary Trees include expression evaluation, Huffman coding for data compression, priority queues using heaps, and database indexing using B-trees and B+ trees.

Remember: Binary Trees are the foundation of many advanced data structures. Understanding them well is crucial for coding interviews and competitive programming.`;

export function createDemoJob(options = {}) {
  const jobId = generateJobId();
  const job = {
    id: jobId,
    url: 'demo',
    options,
    state: STATES.IDLE,
    progress: 0,
    message: 'Queued',
    videoInfo: null,
    notes: null,
    error: null,
    createdAt: Date.now(),
    emitter: new EventEmitter(),
    cancelled: false,
    childProcesses: [],
  };

  jobs.set(jobId, job);

  // Process demo in background
  processDemoJob(jobId, options).catch(err => {
    updateJob(jobId, STATES.ERROR, 100, `Demo error: ${err.message}`);
  });

  return { jobId, status: 'queued' };
}

async function processDemoJob(jobId, options) {
  // Simulate processing stages with delays
  const delay = (ms) => new Promise(r => setTimeout(r, ms));

  updateJob(jobId, STATES.VALIDATING_URL, 5, 'Demo mode: Using built-in Binary Tree lecture');
  await delay(500);

  const videoInfo = {
    id: 'demo',
    title: 'Binary Trees — Complete Guide',
    channel: 'NoteCraft AI Demo',
    duration: 1200,
    durationStr: '20:00',
    thumbnail: '',
  };

  updateJob(jobId, STATES.FETCHING_VIDEO_INFO, 15, `Demo: ${videoInfo.title}`, { videoInfo });
  await delay(500);

  updateJob(jobId, STATES.NORMALIZE_TRANSCRIPT, 40, 'Processing transcript...');
  await delay(500);

  const transcript = normalizeTranscript({
    source: 'demo',
    language: 'en',
    duration: 1200,
    text: DEMO_TRANSCRIPT,
    segments: [],
  });

  updateJob(jobId, STATES.GENERATE_NOTES, 60, 'Generating notes...');
  await delay(800);

  if (isCancelled(jobId)) return;

  const notes = await generateNotes(transcript, {
    language: options.language || 'English',
    examMode: options.examMode || false,
    videoInfo,
  }, (msg) => {
    if (!isCancelled(jobId)) updateJob(jobId, STATES.GENERATE_NOTES, 75, msg);
  });

  updateJob(jobId, STATES.SAVE_HISTORY, 90, 'Saving notes...');
  await delay(300);

  try {
    saveNotes(jobId, notes, {
      url: 'demo',
      videoId: 'demo',
      channel: videoInfo.channel,
      duration: videoInfo.duration,
      durationStr: videoInfo.durationStr,
      thumbnail: '',
      noteStyle: options.noteStyle || 'bluePen',
    });
  } catch {}

  updateJob(jobId, STATES.READY, 100, 'Demo notes ready!', { notes });
}
