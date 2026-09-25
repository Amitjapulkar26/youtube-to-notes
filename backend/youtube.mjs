// backend/youtube.mjs — YouTube URL parsing, validation, and metadata fetching
import { execFile } from 'child_process';
import { withTimeout } from './utils.mjs';
import { findExecutable } from './system-check.mjs';

/**
 * Extract video ID from various YouTube URL formats
 */
export function extractVideoId(url) {
  if (!url || typeof url !== 'string') return null;
  url = url.trim();

  const patterns = [
    // Standard watch URL
    /(?:youtube\.com\/watch\?.*v=)([a-zA-Z0-9_-]{11})/,
    // Short URL
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    // Shorts
    /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    // Live
    /(?:youtube\.com\/live\/)([a-zA-Z0-9_-]{11})/,
    // Embed
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    // Just a video ID
    /^([a-zA-Z0-9_-]{11})$/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }

  return null;
}

/**
 * Validate a video ID format
 */
export function isValidVideoId(videoId) {
  return /^[a-zA-Z0-9_-]{11}$/.test(videoId);
}

/**
 * Fetch video metadata — tries yt-dlp first, falls back to web fetch
 */
export async function fetchVideoInfo(videoId) {
  // Try yt-dlp first
  try {
    return await fetchVideoInfoYtdlp(videoId);
  } catch (e) {
    // Fall back to web fetch
    return await fetchVideoInfoWeb(videoId);
  }
}

/**
 * Fetch video info using yt-dlp (30s timeout)
 */
async function fetchVideoInfoYtdlp(videoId) {
  const url = `https://www.youtube.com/watch?v=${videoId}`;

  const promise = new Promise((resolve, reject) => {
    const args = [
      '--dump-json',
      '--no-download',
      '--no-playlist',
      '--no-warnings',
      url
    ];

    try {
      const ytDlpBinary = findExecutable('yt-dlp') || 'yt-dlp';
      const proc = execFile(ytDlpBinary, args, {
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true
      }, (err, stdout, stderr) => {
        if (err) {
          const errMsg = (stderr || err.message || '').toLowerCase();
          if (errMsg.includes('private video') || errMsg.includes('sign in')) {
            reject(new Error('This video is private or requires sign-in.'));
          } else if (errMsg.includes('unavailable') || errMsg.includes('removed')) {
            reject(new Error('This video is unavailable or has been removed.'));
          } else if (errMsg.includes('age') || errMsg.includes('confirm your age')) {
            reject(new Error('This video is age-restricted.'));
          } else if (errMsg.includes('not available in your country')) {
            reject(new Error('This video is not available in your region.'));
          } else {
            reject(new Error(`yt-dlp: ${err.message}`));
          }
          return;
        }

        try {
          const data = JSON.parse(stdout);
          resolve({
            id: data.id || videoId,
            title: data.title || 'Unknown Title',
            channel: data.channel || data.uploader || 'Unknown Channel',
            duration: data.duration || 0,
            durationStr: formatDuration(data.duration || 0),
            thumbnail: data.thumbnail || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
            description: (data.description || '').substring(0, 500),
            language: data.language || null,
            subtitles: data.subtitles ? Object.keys(data.subtitles) : [],
            automaticCaptions: data.automatic_captions ? Object.keys(data.automatic_captions) : [],
            isLive: data.is_live || false,
          });
        } catch (parseErr) {
          reject(new Error('Failed to parse video metadata'));
        }
      });
    } catch (e) {
      reject(new Error(`yt-dlp not found: ${e.message}`));
    }
  });

  return withTimeout(promise, 30000, 'Video info fetch');
}

/**
 * Fetch video info using YouTube oEmbed API (no tools needed)
 */
async function fetchVideoInfoWeb(videoId) {
  const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const resp = await fetch(oembedUrl, { signal: controller.signal });
    clearTimeout(timer);

    if (!resp.ok) {
      if (resp.status === 401 || resp.status === 403) {
        throw new Error('Video is private or unavailable');
      }
      throw new Error(`YouTube returned ${resp.status}`);
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
    // Even if oEmbed fails, return minimal info so processing continues
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
 * Format seconds to HH:MM:SS or MM:SS
 */
export function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Get thumbnail URL for a video
 */
export function getThumbnailUrl(videoId) {
  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
}
