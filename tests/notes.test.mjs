// tests/notes.test.mjs
import { describe, it, expect } from 'vitest';
import { validateNotes } from '../backend/notes.mjs';
import { generateExtractiveNotes } from '../backend/summarizer.mjs';
import { detectCategory, generateDiagram } from '../backend/diagrams.mjs';

describe('validateNotes', () => {
  it('accepts valid notes with title', () => {
    expect(validateNotes({ title: 'Test', keyPoints: [] })).toBe(true);
  });

  it('accepts valid notes with keyPoints', () => {
    expect(validateNotes({ keyPoints: ['point 1'] })).toBe(true);
  });

  it('rejects null', () => {
    expect(validateNotes(null)).toBe(false);
  });

  it('rejects empty object', () => {
    expect(validateNotes({})).toBe(false);
  });

  it('rejects string', () => {
    expect(validateNotes('not an object')).toBe(false);
  });
});

describe('generateExtractiveNotes', () => {
  const sampleTranscript = {
    text: 'A Binary Tree is a data structure where each node has at most two children. The left child and right child. Binary Search Trees are special binary trees where left subtree values are smaller than root. The time complexity is O(log n) for search operations. Step 1: Start from root. Step 2: Compare values. Step 3: Go left or right. For example, consider a tree with values 5, 3, 7. Stack is a LIFO data structure while Queue is a FIFO data structure.',
    segments: [],
    duration: 600,
    source: 'test'
  };

  it('generates notes with title', () => {
    const notes = generateExtractiveNotes(sampleTranscript, { videoInfo: { title: 'Binary Tree Lecture' } });
    expect(notes.title).toBeTruthy();
  });

  it('detects definitions', () => {
    const notes = generateExtractiveNotes(sampleTranscript);
    expect(notes.definitions.length).toBeGreaterThan(0);
  });

  it('extracts key points', () => {
    const notes = generateExtractiveNotes(sampleTranscript);
    expect(notes.keyPoints.length).toBeGreaterThan(0);
  });

  it('detects steps', () => {
    const notes = generateExtractiveNotes(sampleTranscript);
    expect(notes.steps.length).toBeGreaterThan(0);
  });

  it('generates questions', () => {
    const notes = generateExtractiveNotes(sampleTranscript);
    expect(notes.questions.length).toBeGreaterThan(0);
  });

  it('generates revision points', () => {
    const notes = generateExtractiveNotes(sampleTranscript);
    expect(notes.revision.length).toBeGreaterThan(0);
  });

  it('includes diagram', () => {
    const notes = generateExtractiveNotes(sampleTranscript);
    expect(notes.diagram).toBeTruthy();
  });
});

describe('detectCategory', () => {
  it('detects data structure', () => {
    expect(detectCategory('binary tree linked list array stack queue')).toBe('DATA_STRUCTURE');
  });

  it('detects algorithm', () => {
    expect(detectCategory('sorting algorithm complexity big o recursion dynamic programming')).toBe('ALGORITHM');
  });

  it('detects machine learning', () => {
    expect(detectCategory('neural network deep learning training model classification regression')).toBe('MACHINE_LEARNING');
  });

  it('detects networking', () => {
    expect(detectCategory('tcp udp http protocol router switch dns packet')).toBe('NETWORKING');
  });

  it('returns GENERAL for unknown', () => {
    expect(detectCategory('random words without any pattern')).toBe('GENERAL');
  });
});

describe('generateDiagram', () => {
  it('generates tree diagram for DATA_STRUCTURE', () => {
    const diagram = generateDiagram('DATA_STRUCTURE', { title: 'Binary Tree', keyPoints: [] });
    expect(diagram).toBeTruthy();
    expect(diagram.content).toContain('Root');
  });

  it('generates flowchart for ALGORITHM', () => {
    const diagram = generateDiagram('ALGORITHM', {
      title: 'Sorting',
      keyPoints: [],
      steps: ['Compare', 'Swap', 'Repeat']
    });
    expect(diagram).toBeTruthy();
    expect(diagram.content).toBeTruthy();
  });

  it('generates ML pipeline', () => {
    const diagram = generateDiagram('MACHINE_LEARNING', { title: 'ML', keyPoints: [], steps: [] });
    expect(diagram.content).toContain('DATA');
    expect(diagram.content).toContain('TRAIN');
  });
});
