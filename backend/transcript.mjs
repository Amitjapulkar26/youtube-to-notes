// backend/transcript.mjs — Multi-strategy caption retrieval and transcript normalization
import { execFile } from 'child_process';
import { withTimeout, ensureDir, logJob } from './utils.mjs';
import path from 'path';
import fs from 'fs';
import { findExecutable } from './system-check.mjs';

const CAPTION_TIMEOUT = 30000; // 30 seconds per method
const MIN_TRANSCRIPT_CHARS = 100;

/**
 * Try to get captions using yt-dlp with multiple strategies
 * Returns { success, source, text, segments, language } or { success: false, reason }
 */
export async function getCaptions(videoId, jobDir, onProgress) {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const strategies = [
    { name: 'manual_en', args: ['--write-subs', '--sub-langs', 'en', '--skip-download'] },
    { name: 'auto_en', args: ['--write-auto-subs', '--sub-langs', 'en', '--skip-download'] },
    { name: 'manual_hi', args: ['--write-subs', '--sub-langs', 'hi', '--skip-download'] },
    { name: 'auto_hi', args: ['--write-auto-subs', '--sub-langs', 'hi', '--skip-download'] },
    { name: 'manual_any', args: ['--write-subs', '--sub-langs', 'all', '--skip-download'] },
    { name: 'auto_any', args: ['--write-auto-subs', '--sub-langs', 'all', '--skip-download'] },
  ];

  ensureDir(jobDir);

  for (let i = 0; i < strategies.length; i++) {
    const strategy = strategies[i];
    if (onProgress) {
      onProgress(`Trying caption method: ${strategy.name} (${i + 1}/${strategies.length})`);
    }

    try {
      const result = await withTimeout(
        tryCaptionStrategy(url, strategy.args, jobDir),
        CAPTION_TIMEOUT,
        `Caption strategy ${strategy.name}`
      );

      if (result.success && result.text && result.text.length >= MIN_TRANSCRIPT_CHARS) {
        return {
          success: true,
          source: `captions_${strategy.name}`,
          text: result.text,
          segments: result.segments || [],
          language: result.language || 'en',
        };
      }
    } catch (e) {
      // Timeout or error — continue to next strategy
      if (onProgress) {
        onProgress(`Caption method ${strategy.name} failed: ${e.message}`);
      }
    }
  }

  return { success: false, reason: 'No captions available from any method' };
}

/**
 * Try a single caption retrieval strategy
 */
function tryCaptionStrategy(url, extraArgs, jobDir) {
  return new Promise((resolve) => {
    const args = [
      ...extraArgs,
      '--sub-format', 'vtt/srt/best',
      '-o', path.join(jobDir, 'subs'),
      url
    ];

    try {
      const ytDlpBinary = findExecutable('yt-dlp') || 'yt-dlp';
      execFile(ytDlpBinary, args, {
        timeout: CAPTION_TIMEOUT,
        windowsHide: true,
        cwd: jobDir
      }, (err, stdout, stderr) => {
        if (err) {
          resolve({ success: false, reason: err.message });
          return;
        }

        // Look for downloaded subtitle files
        const subFiles = findSubtitleFiles(jobDir);
        if (subFiles.length === 0) {
          resolve({ success: false, reason: 'No subtitle files downloaded' });
          return;
        }

        // Parse the first valid subtitle file
        for (const subFile of subFiles) {
          try {
            const content = fs.readFileSync(subFile, 'utf-8');
            const parsed = parseSubtitleFile(content, subFile);
            if (parsed.text.length >= MIN_TRANSCRIPT_CHARS) {
              resolve({
                success: true,
                text: parsed.text,
                segments: parsed.segments,
                language: detectLanguageFromFilename(subFile),
              });
              return;
            }
          } catch (e) {
            // Try next file
          }
        }

        resolve({ success: false, reason: 'Subtitle files were empty or too short' });
      });
    } catch (e) {
      resolve({ success: false, reason: e.message });
    }
  });
}

/**
 * Find subtitle files in directory
 */
function findSubtitleFiles(dir) {
  try {
    const files = fs.readdirSync(dir);
    return files
      .filter(f => /\.(vtt|srt|ass|ssa|sub|txt)$/i.test(f))
      .map(f => path.join(dir, f))
      .sort((a, b) => {
        // Prefer .vtt and .srt
        const aScore = /\.vtt$/i.test(a) ? 0 : /\.srt$/i.test(a) ? 1 : 2;
        const bScore = /\.vtt$/i.test(b) ? 0 : /\.srt$/i.test(b) ? 1 : 2;
        return aScore - bScore;
      });
  } catch {
    return [];
  }
}

/**
 * Detect language from subtitle filename
 */
function detectLanguageFromFilename(filepath) {
  const base = path.basename(filepath);
  if (/\.en\./i.test(base)) return 'en';
  if (/\.hi\./i.test(base)) return 'hi';
  if (/\.es\./i.test(base)) return 'es';
  if (/\.fr\./i.test(base)) return 'fr';
  return 'en';
}

/**
 * Parse a VTT or SRT subtitle file into text and segments
 */
function parseSubtitleFile(content, filepath) {
  const isVtt = /\.vtt$/i.test(filepath) || content.startsWith('WEBVTT');
  if (isVtt) return parseVTT(content);
  return parseSRT(content);
}

/**
 * Parse VTT subtitle content
 */
function parseVTT(content) {
  const segments = [];
  const lines = content.split('\n');
  let currentText = '';
  let currentStart = 0;
  let currentEnd = 0;

  for (const line of lines) {
    const timeMatch = line.match(/(\d{2}:\d{2}[:.]\d{3})\s*-->\s*(\d{2}:\d{2}[:.]\d{3})/);
    if (timeMatch) {
      if (currentText.trim()) {
        segments.push({ start: currentStart, end: currentEnd, text: currentText.trim() });
      }
      currentStart = parseTimestamp(timeMatch[1]);
      currentEnd = parseTimestamp(timeMatch[2]);
      currentText = '';
    } else if (line.trim() && !line.startsWith('WEBVTT') && !line.startsWith('Kind:') &&
               !line.startsWith('Language:') && !line.match(/^\d+$/) &&
               !line.startsWith('NOTE')) {
      // Remove HTML tags and VTT formatting
      const cleaned = line
        .replace(/<[^>]*>/g, '')
        .replace(/\{[^}]*\}/g, '')
        .trim();
      if (cleaned) currentText += (currentText ? ' ' : '') + cleaned;
    }
  }
  if (currentText.trim()) {
    segments.push({ start: currentStart, end: currentEnd, text: currentText.trim() });
  }

  const text = deduplicateSegmentText(segments);
  return { text, segments };
}

/**
 * Parse SRT subtitle content
 */
function parseSRT(content) {
  const segments = [];
  const blocks = content.split(/\n\s*\n/);

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 2) continue;

    let timeLineIdx = lines.findIndex(l =>
      l.match(/\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[,.]\d{3}/)
    );
    if (timeLineIdx === -1) continue;

    const timeMatch = lines[timeLineIdx].match(
      /(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})/
    );
    if (!timeMatch) continue;

    const start = parseTimestamp(timeMatch[1]);
    const end = parseTimestamp(timeMatch[2]);
    const text = lines.slice(timeLineIdx + 1)
      .map(l => l.replace(/<[^>]*>/g, '').replace(/\{[^}]*\}/g, '').trim())
      .filter(Boolean)
      .join(' ');

    if (text) segments.push({ start, end, text });
  }

  const text = deduplicateSegmentText(segments);
  return { text, segments };
}

/**
 * Parse timestamp string to seconds
 */
function parseTimestamp(ts) {
  ts = ts.replace(',', '.');
  const parts = ts.split(':');
  if (parts.length === 3) {
    return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
  }
  if (parts.length === 2) {
    return parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
  }
  return 0;
}

/**
 * Remove duplicate/overlapping text from segments (common in auto-captions)
 */
function deduplicateSegmentText(segments) {
  if (segments.length === 0) return '';

  const seen = new Set();
  const uniqueTexts = [];

  for (const seg of segments) {
    const normalized = seg.text.toLowerCase().trim();
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      uniqueTexts.push(seg.text);
    }
  }

  return uniqueTexts.join(' ');
}

/**
 * Normalize a transcript from any source into standard format
 */
export function normalizeTranscript(raw) {
  let text = raw.text || '';
  let segments = raw.segments || [];

  text = cleanTranscriptText(text);

  // Clean segments similarly
  segments = segments.map(seg => ({
    start: seg.start,
    end: seg.end,
    text: cleanTranscriptText(seg.text)
  })).filter(seg => seg.text.length > 0);

  return {
    source: raw.source || 'unknown',
    language: raw.language || 'en',
    duration: raw.duration || (segments.length > 0 ? segments[segments.length - 1].end : 0),
    text,
    segments,
  };
}

/** Remove subtitle metadata, speech markers, and obvious caption artifacts. */
function cleanTranscriptText(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\{[^}]*\}/g, ' ')
      .replace(/(?:align:(?:start|end)|position:\s*\d+%|line:\s*\S+|size:\s*\d+)/gi, ' ')
      .replace(/-->|->/g, ' ')
    .replace(/\b(?:WEBVTT|Kind:\s*[^\n]+|Language:\s*[^\n]+)\b/gi, ' ')
    .replace(/\[(?:music|applause|noise|laughter|inaudible)\]/gi, ' ')
    .replace(/\b\d{2}:\d{2}(?::\d{2})?[.,]\d{3}\b/g, ' ')
    .replace(/\[\d{2}:\d{2}(?::\d{2})?\]/g, ' ')
    .replace(/\b(\w+)(?:\s+\1\b)+/gi, '$1')
    .replace(/\b(um|uh|hmm|uhh|umm|you know)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Chunk a transcript into manageable pieces for AI processing
 * Target: 5-10 minute chunks
 */
export function chunkTranscript(transcript, chunkDurationSec = 420) {
  // 7 minutes default
  const { text, segments } = transcript;

  if (!segments || segments.length === 0) {
    // No segments — chunk by character count
    return chunkByCharCount(text, 3000);
  }

  const chunks = [];
  let currentChunk = { start: 0, end: 0, text: '', segments: [] };

  for (const seg of segments) {
    currentChunk.segments.push(seg);
    currentChunk.text += (currentChunk.text ? ' ' : '') + seg.text;
    currentChunk.end = seg.end;

    if (currentChunk.end - currentChunk.start >= chunkDurationSec) {
      chunks.push({ ...currentChunk });
      currentChunk = { start: seg.end, end: seg.end, text: '', segments: [] };
    }
  }

  if (currentChunk.text.trim()) {
    chunks.push(currentChunk);
  }

  return chunks.length > 0 ? chunks : [{ start: 0, end: transcript.duration || 0, text, segments }];
}

/**
 * Chunk text by character count when no timestamps available
 */
function chunkByCharCount(text, maxChars = 3000) {
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  const chunks = [];
  let current = '';

  for (const sentence of sentences) {
    if (current.length + sentence.length > maxChars && current.length > 0) {
      chunks.push({ start: 0, end: 0, text: current.trim(), segments: [] });
      current = '';
    }
    current += sentence;
  }

  if (current.trim()) {
    chunks.push({ start: 0, end: 0, text: current.trim(), segments: [] });
  }

  return chunks.length > 0 ? chunks : [{ start: 0, end: 0, text, segments: [] }];
}
