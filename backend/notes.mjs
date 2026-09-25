// backend/notes.mjs — Note schema validation and history storage (JSON file-based)
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ensureDir } from './utils.mjs';

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : process.env.VERCEL
  ? path.join(os.tmpdir(), 'notecraft-ai', 'data')
  : path.resolve('data');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const NOTES_DIR = path.join(DATA_DIR, 'notes');

/**
 * Initialize storage directories
 */
export function initStorage() {
  ensureDir(DATA_DIR);
  ensureDir(NOTES_DIR);
  if (!fs.existsSync(HISTORY_FILE)) {
    fs.writeFileSync(HISTORY_FILE, '[]', 'utf-8');
  }
}

/**
 * Save notes and add to history
 */
export function saveNotes(jobId, notes, metadata = {}) {
  initStorage();

  const noteFile = path.join(NOTES_DIR, `${jobId}.json`);
  fs.writeFileSync(noteFile, JSON.stringify(notes, null, 2), 'utf-8');

  const entry = {
    id: jobId,
    title: notes.title || 'Untitled',
    url: metadata.url || '',
    videoId: metadata.videoId || '',
    channel: metadata.channel || '',
    duration: metadata.duration || 0,
    durationStr: metadata.durationStr || '',
    thumbnail: metadata.thumbnail || '',
    language: notes.language || 'English',
    noteStyle: metadata.noteStyle || 'bluePen',
    examMode: notes.examMode || false,
    engine: notes.engine || 'extractive',
    createdAt: new Date().toISOString(),
    sectionsCount: countSections(notes),
  };

  const history = loadHistory();
  history.unshift(entry);

  // Keep only last 100 entries
  if (history.length > 100) history.length = 100;

  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8');

  return entry;
}

/**
 * Load history
 */
export function loadHistory() {
  initStorage();
  try {
    const data = fs.readFileSync(HISTORY_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

/**
 * Load notes by job ID
 */
export function loadNotes(jobId) {
  const noteFile = path.join(NOTES_DIR, `${jobId}.json`);
  if (!fs.existsSync(noteFile)) return null;
  try {
    return JSON.parse(fs.readFileSync(noteFile, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Delete history entry and notes
 */
export function deleteHistoryEntry(jobId) {
  const history = loadHistory();
  const filtered = history.filter(h => h.id !== jobId);
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(filtered, null, 2), 'utf-8');

  const noteFile = path.join(NOTES_DIR, `${jobId}.json`);
  try { if (fs.existsSync(noteFile)) fs.unlinkSync(noteFile); } catch {}
}

/**
 * Count non-empty sections in notes
 */
function countSections(notes) {
  let count = 0;
  if (notes.overview) count++;
  if (notes.simpleExplanation) count++;
  if (notes.definitions?.length) count++;
  if (notes.keyPoints?.length) count++;
  if (notes.importantTerms?.length) count++;
  if (notes.steps?.length) count++;
  if (notes.examples?.length) count++;
  if (notes.formulas?.length) count++;
  if (notes.comparisons?.length) count++;
  if (notes.diagram?.content) count++;
  if (notes.remember) count++;
  if (notes.revision?.length) count++;
  if (notes.questions?.length) count++;
  return count;
}

/**
 * Validate notes object against expected schema
 */
export function validateNotes(notes) {
  if (!notes || typeof notes !== 'object') return false;
  if (!notes.title && !notes.overview && (!notes.keyPoints || notes.keyPoints.length === 0)) return false;
  return true;
}
