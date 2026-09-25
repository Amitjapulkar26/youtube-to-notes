// tests/transcript.test.mjs
import { describe, it, expect } from 'vitest';
import { normalizeTranscript, chunkTranscript } from '../backend/transcript.mjs';

describe('normalizeTranscript', () => {
  it('removes HTML tags', () => {
    const result = normalizeTranscript({
      text: 'Hello <b>world</b> <i>test</i>',
      segments: []
    });
    expect(result.text).toBe('Hello world test');
  });

  it('removes duplicate consecutive words', () => {
    const result = normalizeTranscript({
      text: 'the the cat sat sat on mat',
      segments: []
    });
    expect(result.text).toBe('the cat sat on mat');
  });

  it('removes filler words', () => {
    const result = normalizeTranscript({
      text: 'so um the algorithm uh works like this you know',
      segments: []
    });
    expect(result.text).not.toContain(' um ');
    expect(result.text).not.toContain(' uh ');
    expect(result.text).toContain('algorithm');
  });

  it('preserves source info', () => {
    const result = normalizeTranscript({
      source: 'whisper',
      language: 'en',
      duration: 120,
      text: 'test',
      segments: []
    });
    expect(result.source).toBe('whisper');
    expect(result.language).toBe('en');
    expect(result.duration).toBe(120);
  });

  it('cleans segment text', () => {
    const result = normalizeTranscript({
      text: 'test',
      segments: [
        { start: 0, end: 5, text: '<b>Hello</b> {\\an8}world' }
      ]
    });
    expect(result.segments[0].text).toBe('Hello world');
  });

  it('removes subtitle metadata and media markers', () => {
    const result = normalizeTranscript({
      text: 'align:start position:0% [music] The algorithm computes a result. The the result.',
      segments: []
    });
    expect(result.text).toBe('The algorithm computes a result. The result.');
    expect(result.text).not.toContain('align:start');
    expect(result.text).not.toContain('[music]');
  });

  it('removes arrows and subtitle metadata embedded in a sentence', () => {
    const result = normalizeTranscript({
      text: 'The definition of data is mainly in the --> align:start position:0% definition of data.',
      segments: []
    });
    expect(result.text).not.toMatch(/align|position:0%|-->/i);
  });
});

describe('chunkTranscript', () => {
  it('returns single chunk for short transcript', () => {
    const chunks = chunkTranscript({
      text: 'Short text',
      segments: [{ start: 0, end: 10, text: 'Short text' }],
      duration: 10
    });
    expect(chunks.length).toBe(1);
    expect(chunks[0].text).toContain('Short');
  });

  it('chunks long transcript by duration', () => {
    const segments = [];
    for (let i = 0; i < 100; i++) {
      segments.push({
        start: i * 60,
        end: (i + 1) * 60,
        text: `Segment ${i} content here`
      });
    }
    const chunks = chunkTranscript({
      text: segments.map(s => s.text).join(' '),
      segments,
      duration: 6000
    }, 300); // 5 min chunks

    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach(c => {
      expect(c.text.length).toBeGreaterThan(0);
    });
  });

  it('handles missing segments by chunking text', () => {
    const longText = Array(50).fill('This is a sentence about algorithms.').join(' ');
    const chunks = chunkTranscript({
      text: longText,
      segments: [],
      duration: 300
    });
    expect(chunks.length).toBeGreaterThanOrEqual(1);
  });
});
