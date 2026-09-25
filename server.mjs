// server.mjs — NoteCraft AI Express Server
import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

import { runSystemCheck, getHealthStatus, getCachedSystemCheck } from './backend/system-check.mjs';
import { createJob, getJob, getJobEmitter, cancelJob, createDemoJob } from './backend/jobs.mjs';
import { loadHistory, loadNotes, deleteHistoryEntry, initStorage } from './backend/notes.mjs';
import { cleanupAbandonedJobs, ensureDir } from './backend/utils.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize
initStorage();
if (!process.env.VERCEL) {
  ensureDir(path.resolve('temp'));
  ensureDir(path.resolve('logs'));
}
cleanupAbandonedJobs();

// ============================================================
// API ROUTES
// ============================================================

/**
 * GET /api/health — Quick health check
 */
app.get('/api/health', async (req, res) => {
  try {
    const status = await getHealthStatus();
    res.json(status);
  } catch (e) {
    res.json({ server: true, error: e.message });
  }
});

/**
 * GET /api/system-check — Detailed system check
 */
app.get('/api/system-check', async (req, res) => {
  try {
    const check = await runSystemCheck();
    res.json(check);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/jobs — Create a new processing job
 * Body: { url, language, noteStyle, examMode }
 */
app.post('/api/jobs', (req, res) => {
  const { url, language, noteStyle, examMode, demo } = req.body;

  if (demo) {
    const job = createDemoJob({ language, noteStyle, examMode });
    return res.json(job);
  }

  if (!url) {
    return res.status(400).json({ error: 'YouTube URL is required' });
  }

  const job = createJob(url, { language, noteStyle, examMode });
  res.json(job);
});

/**
 * GET /api/jobs/:id — Get job status
 */
app.get('/api/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

/**
 * GET /api/jobs/:id/events — SSE stream for job updates
 */
app.get('/api/jobs/:id/events', (req, res) => {
  const emitter = getJobEmitter(req.params.id);
  if (!emitter) return res.status(404).json({ error: 'Job not found' });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // Send initial status
  const job = getJob(req.params.id);
  if (job) {
    res.write(`data: ${JSON.stringify({
      stage: job.state.toLowerCase(),
      progress: job.progress,
      message: job.message,
      videoInfo: job.videoInfo,
      notes: job.notes,
      error: job.error,
    })}\n\n`);
  }

  const onUpdate = (event) => {
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch (e) {
      // Connection closed
    }
  };

  emitter.on('update', onUpdate);

  // Heartbeat to keep connection alive
  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch {
      clearInterval(heartbeat);
    }
  }, 15000);

  req.on('close', () => {
    emitter.off('update', onUpdate);
    clearInterval(heartbeat);
  });
});

/**
 * POST /api/jobs/:id/cancel — Cancel a job
 */
app.post('/api/jobs/:id/cancel', (req, res) => {
  const result = cancelJob(req.params.id);
  if (!result) return res.status(404).json({ error: 'Job not found' });
  res.json({ success: true, message: 'Job cancelled' });
});

/**
 * GET /api/notes/:id — Get saved notes
 */
app.get('/api/notes/:id', (req, res) => {
  const notes = loadNotes(req.params.id);
  if (!notes) return res.status(404).json({ error: 'Notes not found' });
  res.json(notes);
});

/**
 * GET /api/history — Get note history
 */
app.get('/api/history', (req, res) => {
  const history = loadHistory();
  res.json(history);
});

/**
 * DELETE /api/history/:id — Delete history entry
 */
app.delete('/api/history/:id', (req, res) => {
  deleteHistoryEntry(req.params.id);
  res.json({ success: true });
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================================
// START SERVER
// ============================================================
function startServer(port) {
  const server = app.listen(port, HOST, () => {
    console.log(`
╔══════════════════════════════════════════════╗
║          ✍️  NoteCraft AI Server             ║
║                                              ║
║   http://localhost:${port}                      ║
║                                              ║
║   Turn any lecture into handwritten notes!   ║
╚══════════════════════════════════════════════╝
  `);
  });

  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.warn(`Port ${port} is busy. Trying ${port + 1}...`);
      startServer(port + 1);
      return;
    }
    throw error;
  });
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (!process.env.VERCEL && isMainModule) startServer(PORT);

export default app;
