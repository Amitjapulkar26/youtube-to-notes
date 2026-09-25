// tests/jobs.test.mjs
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { generateJobId, withTimeout, sanitizeFilename, escapeHtml } from '../backend/utils.mjs';
import { findExecutable } from '../backend/system-check.mjs';
import { generateExtractiveNotes } from '../backend/summarizer.mjs';

describe('generateJobId', () => {
  it('generates unique IDs', () => {
    const id1 = generateJobId();
    const id2 = generateJobId();
    expect(id1).not.toBe(id2);
  });

  it('starts with job_ prefix', () => {
    const id = generateJobId();
    expect(id.startsWith('job_')).toBe(true);
  });

  it('contains timestamp', () => {
    const id = generateJobId();
    const parts = id.split('_');
    const ts = parseInt(parts[1]);
    expect(ts).toBeGreaterThan(1000000000000);
  });
});

describe('withTimeout', () => {
  it('resolves fast promises', async () => {
    const result = await withTimeout(
      Promise.resolve('ok'),
      1000,
      'test'
    );
    expect(result).toBe('ok');
  });

  it('rejects on timeout', async () => {
    await expect(
      withTimeout(
        new Promise(() => {}), // never resolves
        100,
        'test'
      )
    ).rejects.toThrow('timed out');
  });

  it('propagates errors', async () => {
    await expect(
      withTimeout(
        Promise.reject(new Error('original error')),
        1000,
        'test'
      )
    ).rejects.toThrow('original error');
  });
});

describe('sanitizeFilename', () => {
  it('removes unsafe characters', () => {
    expect(sanitizeFilename('file<>:"/\\|?*name')).toBe('file_name');
  });

  it('collapses spaces', () => {
    expect(sanitizeFilename('hello   world')).toBe('hello_world');
  });

  it('truncates long names', () => {
    const long = 'a'.repeat(200);
    expect(sanitizeFilename(long).length).toBeLessThanOrEqual(100);
  });
});

describe('escapeHtml', () => {
  it('escapes HTML entities', () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
    );
  });

  it('handles empty string', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('handles null', () => {
    expect(escapeHtml(null)).toBe('');
  });
});

describe('findExecutable', () => {
  it('finds an executable in a custom Windows-style install directory', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notecraft-'));
    const ffmpegDir = path.join(tempDir, 'ffmpeg', 'bin');
    const ffmpegPath = path.join(ffmpegDir, 'ffmpeg.exe');
    fs.mkdirSync(ffmpegDir, { recursive: true });
    fs.writeFileSync(ffmpegPath, '');

    expect(findExecutable('ffmpeg', [ffmpegDir])).toBe(ffmpegPath);
  });
});

describe('generateExtractiveNotes', () => {
  it('keeps only important concepts and strips filler wording', () => {
    const transcript = {
      text: 'Okay now, align this with the main idea. The operating system is software that manages computer hardware and software resources. The OS handles process scheduling, memory management, and file systems. This is very important. We also need to remember that it helps users run programs. Okay, align this again. The CPU scheduling algorithm is a core topic.'
    };

    const notes = generateExtractiveNotes(transcript, { language: 'English' });

    expect(notes.keyPoints.length).toBeGreaterThan(0);
    expect(notes.keyPoints.some(item => /operating system/i.test(item))).toBe(true);
    expect(notes.keyPoints.some(item => /align|okay now/i.test(item))).toBe(false);
      expect(notes.importantTerms).toEqual([]);
    expect(notes.advantages).toEqual([]);
    expect(notes.questions.some(item => /unrelated/i.test(item.answer))).toBe(false);
    expect(notes.title).toMatch(/^Lecture 1 — /);
    expect(JSON.stringify(notes)).not.toMatch(/align|position:\s*\d+%|-->|Show Answer/i);
  });

  it('keeps broader coverage for a longer lecture', () => {
    const topics = Array.from({ length: 10 }, (_, index) =>
      `Concept ${index + 1} explains an important principle of the lecture and its practical application.`
    ).join(' ');
    const notes = generateExtractiveNotes({ text: topics }, { videoInfo: { title: 'Complete Lecture' } });

    expect(notes.keyPoints.length).toBeGreaterThan(6);
    expect(notes.title).toBe('Lecture 1 — Complete Lecture');
  });
});
