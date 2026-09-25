// tests/url-parser.test.mjs
import { describe, it, expect } from 'vitest';
import { extractVideoId, isValidVideoId, formatDuration } from '../backend/youtube.mjs';

describe('extractVideoId', () => {
  it('extracts from standard watch URL', () => {
    expect(extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts from short URL', () => {
    expect(extractVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts from shorts URL', () => {
    expect(extractVideoId('https://youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts from live URL', () => {
    expect(extractVideoId('https://youtube.com/live/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts from embed URL', () => {
    expect(extractVideoId('https://youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts from URL with extra params', () => {
    expect(extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=120')).toBe('dQw4w9WgXcQ');
  });

  it('returns null for invalid URL', () => {
    expect(extractVideoId('https://example.com')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractVideoId('')).toBeNull();
  });

  it('returns null for null', () => {
    expect(extractVideoId(null)).toBeNull();
  });
});

describe('isValidVideoId', () => {
  it('validates correct ID', () => {
    expect(isValidVideoId('dQw4w9WgXcQ')).toBe(true);
  });

  it('rejects too short', () => {
    expect(isValidVideoId('abc')).toBe(false);
  });

  it('rejects too long', () => {
    expect(isValidVideoId('dQw4w9WgXcQx')).toBe(false);
  });

  it('rejects special chars', () => {
    expect(isValidVideoId('dQw4w9WgXc!')).toBe(false);
  });
});

describe('formatDuration', () => {
  it('formats seconds only', () => {
    expect(formatDuration(45)).toBe('0:45');
  });

  it('formats minutes', () => {
    expect(formatDuration(185)).toBe('3:05');
  });

  it('formats hours', () => {
    expect(formatDuration(3661)).toBe('1:01:01');
  });

  it('handles zero', () => {
    expect(formatDuration(0)).toBe('0:00');
  });
});
