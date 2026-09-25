// backend/web-captions.mjs — Fetch YouTube captions via HTTP (no external tools needed)
// This is the PRIMARY caption method — works without yt-dlp, FFmpeg, or Whisper
import { withTimeout } from './utils.mjs';
import ytdlp from 'yt-dlp-exec';
import fs from 'fs';
import os from 'os';
import path from 'path';

const FETCH_TIMEOUT = 15000; // 15 seconds

/**
 * Fetch video info using YouTube's oEmbed API (no tools needed)
 */
export async function fetchVideoInfoWeb(videoId) {
  const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    const resp = await fetch(oembedUrl, { signal: controller.signal });
    clearTimeout(timer);

    if (!resp.ok) {
      if (resp.status === 401) throw new Error('Video is private or unavailable');
      throw new Error(`oEmbed returned ${resp.status}`);
    }

    const data = await resp.json();
    return {
      id: videoId,
      title: data.title || 'YouTube Lecture',
      channel: data.author_name || 'Unknown',
      duration: 0,
      durationStr: '',
      thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
    };
  } catch (e) {
    return {
      id: videoId,
      title: 'YouTube Lecture',
      channel: 'Unknown',
      duration: 0,
      durationStr: '',
      thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
    };
  }
}

/**
 * Fetch captions directly from YouTube via web scraping (no yt-dlp needed)
 * Scrapes the watch page → extracts playerResponse → finds caption tracks → downloads
 */
export async function getWebCaptions(videoId, onProgress) {
  const url = `https://www.youtube.com/watch?v=${videoId}`;

  if (onProgress) onProgress('Fetching captions from YouTube (web method)...');

  try {
    // Step 1: Fetch the watch page
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    clearTimeout(timer);

    if (!resp.ok) {
      return { success: false, reason: `YouTube returned ${resp.status}` };
    }

    const html = await resp.text();

    // Step 2: Extract ytInitialPlayerResponse
    const playerResponse = extractPlayerResponse(html);
    if (!playerResponse) {
      return { success: false, reason: 'Could not extract player response from page' };
    }

    // Extract video info from player response
    const videoDetails = playerResponse.videoDetails;
    const videoTitle = videoDetails?.title || '';
    const videoDuration = parseInt(videoDetails?.lengthSeconds || '0', 10);
    const videoChannel = videoDetails?.author || '';

    // Step 3: Find caption tracks
    const captions = playerResponse.captions;
    if (!captions || !captions.playerCaptionsTracklistRenderer) {
      return { success: false, reason: 'No caption tracks found on this video' };
    }

    const tracks = captions.playerCaptionsTracklistRenderer.captionTracks;
    if (!tracks || tracks.length === 0) {
      return { success: false, reason: 'No caption tracks available' };
    }

    if (onProgress) onProgress(`Found ${tracks.length} caption track(s). Downloading...`);

    // Step 4: Try tracks in priority order: en manual, en auto, any
    const prioritized = prioritizeTracks(tracks);

    for (const track of prioritized) {
      try {
        const captionText = await downloadCaptionTrack(track.baseUrl);
        if (captionText && captionText.fullText.length >= 100) {
          if (onProgress) onProgress(`✓ Captions downloaded (${track.languageCode}, ${captionText.fullText.length} chars)`);
          return {
            success: true,
            source: `web_${track.languageCode}${track.kind === 'asr' ? '_auto' : '_manual'}`,
            text: captionText.fullText,
            segments: captionText.segments,
            language: track.languageCode,
            videoInfo: {
              title: videoTitle,
              channel: videoChannel,
              duration: videoDuration,
            },
          };
        }
      } catch (e) {
        // Try next track
      }
    }

    if (process.env.VERCEL) {
      return await getBundledYtDlpCaptions(videoId, onProgress);
    }

    return { success: false, reason: 'Caption tracks were empty or too short' };
  } catch (e) {
    if (process.env.VERCEL) {
      return await getBundledYtDlpCaptions(videoId, onProgress);
    }
    return { success: false, reason: `Web caption fetch failed: ${e.message}` };
  }
}

async function getBundledYtDlpCaptions(videoId, onProgress) {
  const jobDir = path.join(os.tmpdir(), 'notecraft-ai', 'captions', `${videoId}-${Date.now()}`);
  fs.mkdirSync(jobDir, { recursive: true });
  const outputBase = path.join(jobDir, 'lecture');

  try {
    if (onProgress) onProgress('Using bundled caption downloader...');
    await ytdlp.exec(`https://www.youtube.com/watch?v=${videoId}`, {
      writeAutoSubs: true,
      writeSubs: true,
      subLangs: 'en,en-orig',
      subFormat: 'vtt',
      skipDownload: true,
      noPlaylist: true,
      noWarnings: true,
      output: outputBase,
    }, { timeout: FETCH_TIMEOUT * 2, windowsHide: true });

    const subtitleFile = fs.readdirSync(jobDir)
      .find(file => /\.(vtt|srt)$/i.test(file));
    if (!subtitleFile) return { success: false, reason: 'Bundled caption downloader found no subtitle file' };

    const content = fs.readFileSync(path.join(jobDir, subtitleFile), 'utf8');
    const parsed = parseDownloadedVtt(content);
    if (!parsed || parsed.fullText.length < 100) {
      return { success: false, reason: 'Bundled caption file was empty or too short' };
    }

    return {
      success: true,
      source: 'bundled_yt_dlp',
      text: parsed.fullText,
      segments: parsed.segments,
      language: 'en',
    };
  } catch (error) {
    return { success: false, reason: `Bundled caption downloader failed: ${error.message}` };
  } finally {
    try { fs.rmSync(jobDir, { recursive: true, force: true }); } catch {}
  }
}

function parseDownloadedVtt(content) {
  const segments = [];
  const blocks = content.split(/\n\s*\n/);

  for (const block of blocks) {
    const lines = block.trim().split(/\r?\n/);
    const timingIndex = lines.findIndex(line => /\d{2}:\d{2}(?::\d{2})?[.:]\d{3}\s*-->/.test(line));
    if (timingIndex === -1) continue;

    const timing = lines[timingIndex].match(/(\d{2}:\d{2}(?::\d{2})?[.:]\d{3})\s*-->\s*(\d{2}:\d{2}(?::\d{2})?[.:]\d{3})/);
    if (!timing) continue;

    const text = lines.slice(timingIndex + 1)
      .join(' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\{[^}]*\}/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) segments.push({ start: parseVttTime(timing[1]), end: parseVttTime(timing[2]), text });
  }

  const fullText = segments.map(segment => segment.text).join(' ').replace(/\s+/g, ' ').trim();
  return { segments, fullText };
}

function parseVttTime(value) {
  const parts = value.replace('.', ':').split(':').map(Number);
  if (parts.length === 4) return parts[0] * 3600 + parts[1] * 60 + parts[2] + parts[3] / 1000;
  return parts[0] * 60 + parts[1] + parts[2] / 1000;
}

/**
 * Extract ytInitialPlayerResponse from YouTube HTML
 */
function extractPlayerResponse(html) {
  // Try ytInitialPlayerResponse
  const patterns = [
    /ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;\s*(?:var\s|<\/script)/s,
    /ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;/s,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      try {
        return JSON.parse(match[1]);
      } catch {
        // Try trimming — sometimes there's trailing garbage
        const jsonStr = match[1];
        // Find matching closing brace
        let depth = 0;
        let end = 0;
        for (let i = 0; i < jsonStr.length; i++) {
          if (jsonStr[i] === '{') depth++;
          if (jsonStr[i] === '}') depth--;
          if (depth === 0) { end = i + 1; break; }
        }
        if (end > 0) {
          try { return JSON.parse(jsonStr.substring(0, end)); } catch {}
        }
      }
    }
  }

  // Try extracting from ytcfg or other embedded data
  const innertubeMatch = html.match(/var\s+ytInitialPlayerResponse\s*=\s*(\{[\s\S]*?\});\s*var\s/);
  if (innertubeMatch) {
    try { return JSON.parse(innertubeMatch[1]); } catch {}
  }

  return null;
}

/**
 * Prioritize caption tracks: English manual > English auto > Hindi > any
 */
function prioritizeTracks(tracks) {
  const sorted = [...tracks];
  sorted.sort((a, b) => {
    const aScore = getTrackPriority(a);
    const bScore = getTrackPriority(b);
    return aScore - bScore;
  });
  return sorted;
}

function getTrackPriority(track) {
  const lang = (track.languageCode || '').toLowerCase();
  const isAuto = track.kind === 'asr';

  if (lang === 'en' && !isAuto) return 0;  // English manual — best
  if (lang === 'en' && isAuto) return 1;    // English auto
  if (lang === 'hi' && !isAuto) return 2;   // Hindi manual
  if (lang === 'hi' && isAuto) return 3;    // Hindi auto
  if (!isAuto) return 4;                     // Any manual
  return 5;                                  // Any auto
}

/**
 * Download and parse a caption track from its baseUrl
 */
async function downloadCaptionTrack(baseUrl) {
  // Request JSON3 format for easy parsing
  const url = baseUrl + '&fmt=json3';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    clearTimeout(timer);

    if (!resp.ok) {
      // Try XML format as fallback
      return await downloadCaptionTrackXML(baseUrl);
    }

    const data = await resp.json();
    return parseJSON3Captions(data);
  } catch {
    clearTimeout(timer);
    // Fallback to XML
    return await downloadCaptionTrackXML(baseUrl);
  }
}

/**
 * Download caption track in XML format (fallback)
 */
async function downloadCaptionTrackXML(baseUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    const resp = await fetch(baseUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });
    clearTimeout(timer);

    if (!resp.ok) return null;

    const xml = await resp.text();
    return parseXMLCaptions(xml);
  } catch {
    clearTimeout(timer);
    return null;
  }
}

/**
 * Parse JSON3 caption format
 */
function parseJSON3Captions(data) {
  if (!data || !data.events) return null;

  const segments = [];
  const textParts = [];

  for (const event of data.events) {
    if (!event.segs) continue;

    const start = (event.tStartMs || 0) / 1000;
    const duration = (event.dDurationMs || 0) / 1000;
    const end = start + duration;

    let text = '';
    for (const seg of event.segs) {
      text += seg.utf8 || '';
    }
    text = text.replace(/\n/g, ' ').trim();

    if (text && text !== '\n') {
      segments.push({ start: Math.round(start * 100) / 100, end: Math.round(end * 100) / 100, text });
      textParts.push(text);
    }
  }

  return {
    segments,
    fullText: deduplicateText(textParts.join(' ')),
  };
}

/**
 * Parse XML caption format (<transcript><text start="0" dur="5.2">Hello</text>...</transcript>)
 */
function parseXMLCaptions(xml) {
  const segments = [];
  const textParts = [];

  // Simple XML parser for YouTube caption format
  const regex = /<text\s+start="([^"]*)"(?:\s+dur="([^"]*)")?[^>]*>([\s\S]*?)<\/text>/gi;
  let match;

  while ((match = regex.exec(xml)) !== null) {
    const start = parseFloat(match[1]) || 0;
    const dur = parseFloat(match[2]) || 0;
    const end = start + dur;
    // Decode HTML entities
    let text = match[3]
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/<[^>]*>/g, '')
      .replace(/\n/g, ' ')
      .trim();

    if (text) {
      segments.push({ start: Math.round(start * 100) / 100, end: Math.round(end * 100) / 100, text });
      textParts.push(text);
    }
  }

  if (segments.length === 0) return null;

  return {
    segments,
    fullText: deduplicateText(textParts.join(' ')),
  };
}

/**
 * Remove duplicate/overlapping text fragments
 */
function deduplicateText(text) {
  // Remove exact duplicate consecutive phrases
  const words = text.split(/\s+/);
  const result = [];
  let prev = '';

  for (const word of words) {
    if (word !== prev || word.length > 3) {
      result.push(word);
    }
    prev = word;
  }

  return result.join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
