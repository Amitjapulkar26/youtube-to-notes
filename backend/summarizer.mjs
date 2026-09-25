// backend/summarizer.mjs — AI-powered and extractive note generation
import { withTimeout, logJob } from './utils.mjs';
import { chunkTranscript } from './transcript.mjs';
import { detectCategory, generateDiagram } from './diagrams.mjs';

const OLLAMA_TIMEOUT = 10 * 60 * 1000; // 10 minutes per chunk
const NOTE_SCHEMA_KEYS = [
  'title', 'overview', 'simpleExplanation', 'definitions', 'keyPoints',
  'importantTerms', 'steps', 'examples', 'formulas', 'comparisons',
  'advantages', 'disadvantages', 'diagram', 'remember', 'revision', 'questions'
];

/**
 * Generate structured notes from transcript
 * Tries Ollama first, falls back to extractive mode
 */
export async function generateNotes(transcript, options = {}, onProgress) {
  const { language = 'English', examMode = false, videoInfo = {} } = options;

  // Try Ollama first
  const ollamaUrl = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
  const ollamaModel = process.env.OLLAMA_MODEL || 'qwen2.5';

  if (onProgress) onProgress('Checking AI engine availability...');

  const ollamaAvailable = await isOllamaAvailable(ollamaUrl);

  if (ollamaAvailable) {
    if (onProgress) onProgress(`Using AI engine: ${ollamaModel}`);
    try {
      const notes = await generateWithOllama(transcript, { language, examMode, videoInfo }, ollamaUrl, ollamaModel, onProgress);
      if (notes && notes.title) {
        return { ...notes, engine: 'ollama', model: ollamaModel };
      }
    } catch (e) {
      if (onProgress) onProgress(`AI engine failed: ${e.message}. Switching to built-in mode.`);
    }
  } else {
    if (onProgress) onProgress('Local AI unavailable. Using built-in note generation.');
  }

  // Extractive fallback
  if (onProgress) onProgress('Generating notes with built-in engine...');
  const notes = generateExtractiveNotes(transcript, { language, examMode, videoInfo });
  return { ...notes, engine: 'extractive' };
}

/**
 * Check if Ollama is available
 */
async function isOllamaAvailable(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(`${url}/api/tags`, { signal: controller.signal });
    clearTimeout(timer);
    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * Generate notes using Ollama — chunks long transcripts
 */
async function generateWithOllama(transcript, options, ollamaUrl, model, onProgress) {
  const chunks = chunkTranscript(transcript);
  const chunkSummaries = [];

  for (let i = 0; i < chunks.length; i++) {
    if (onProgress) onProgress(`Processing chunk ${i + 1}/${chunks.length}...`);

    const prompt = buildChunkPrompt(chunks[i].text, options, i === 0);
    const result = await ollamaGenerate(ollamaUrl, model, prompt);

    if (result) {
      chunkSummaries.push(result);
    }
  }

  if (chunkSummaries.length === 0) {
    throw new Error('Ollama produced no valid summaries');
  }

  // If only one chunk, use it directly
  if (chunkSummaries.length === 1) {
    const notes = parseNotesJSON(chunkSummaries[0]);
    if (notes) return finalizeNotes(notes, transcript, options);
  }

  // Multiple chunks — synthesize
  if (onProgress) onProgress('Synthesizing final notes...');
  const synthesisPrompt = buildSynthesisPrompt(chunkSummaries, options);
  const finalResult = await ollamaGenerate(ollamaUrl, model, synthesisPrompt);
  const finalNotes = parseNotesJSON(finalResult);

  if (finalNotes) return finalizeNotes(finalNotes, transcript, options);

  // If synthesis fails, merge chunk summaries manually
  return mergeChunkSummaries(chunkSummaries, transcript, options);
}

/**
 * Call Ollama generate API with timeout
 */
async function ollamaGenerate(url, model, prompt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT);

  try {
    const resp = await fetch(`${url}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: {
          temperature: 0.3,
          num_predict: 8192
        }
      })
    });
    clearTimeout(timer);

    if (!resp.ok) {
      throw new Error(`Ollama returned ${resp.status}`);
    }

    const data = await resp.json();
    return data.response || '';
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

/**
 * Build prompt for a transcript chunk
 */
function buildChunkPrompt(text, options, isFirst) {
  const langInstruction = options.language === 'Hindi'
    ? 'Write the notes in Hindi. Keep technical terms in English.'
    : options.language === 'Hinglish'
    ? 'Write the notes in Hinglish (mix of Hindi and English). Keep technical terms in English.'
    : 'Write the notes in English.';

  const examInstruction = options.examMode
    ? 'Focus on exam-relevant content: definitions, formulas, key points, and likely exam questions.'
    : '';

  return `You are a university lecture note writer.

Transform this lecture transcript into concise student-friendly notes.

OUTPUT STANDARD:
- Write like a smart student who watched this specific lecture, not like a transcript.
- Understand the lecture before organizing the notes; do not copy caption wording.
- Include only content that helps understand this topic or answer an exam/viva question.
- Omit a section entirely when this lecture does not contain that kind of content.
- Produce 5-10 meaningful exam/viva questions only when the transcript supports them.

RULES:
- Keep only the important learning points, definitions, formulas, and exam-relevant facts
- Ignore transcript filler, repetition, off-topic discussion, and narration like "align this...", "okay now", or other low-value statements
- Do NOT copy the transcript verbatim
- Remove repetition and filler words
- Never output subtitle metadata, timestamps, arrows, HTML/XML, speaker labels, or media markers.
- If a sentence is corrupted, reconstruct it only when its meaning is certain; otherwise discard it.
- Explain difficult ideas in simple, clear language
- Preserve technical accuracy
- Keep paragraphs short (1-2 sentences max)
- Prefer bullet points
- Limit output to the core understanding, not a full transcript dump
- ${langInstruction}
${examInstruction}

Return ONLY valid JSON matching this exact schema (omit empty arrays/strings):
{
  "title": "short descriptive title",
  "overview": "2-3 sentence overview",
  "simpleExplanation": "explain the main concept simply, as if to a beginner",
  "definitions": [{"term": "...", "definition": "..."}],
  "keyPoints": ["point 1", "point 2"],
  "importantTerms": ["term1", "term2"],
  "steps": ["step 1", "step 2"],
  "examples": [{"title": "...", "code": "...", "explanation": "..."}],
  "formulas": [{"formula": "...", "meaning": "...", "example": "..."}],
  "comparisons": [{"itemA": "...", "itemB": "...", "differences": [{"aspect": "...", "a": "...", "b": "..."}]}],
  "advantages": ["..."],
  "disadvantages": ["..."],
  "remember": "key takeaway in 1-2 sentences",
  "revision": ["quick revision point 1", "point 2"],
  "questions": [{"question": "...", "answer": "...", "type": "MCQ|SHORT|DEFINITION|CONCEPTUAL"}]
}

Do NOT invent facts not supported by the transcript.

TRANSCRIPT:
${text.substring(0, 16000)}`;
}

/**
 * Build synthesis prompt for combining chunk summaries
 */
function buildSynthesisPrompt(summaries, options) {
  const combined = summaries.map((s, i) => `--- Chunk ${i + 1} ---\n${s}`).join('\n\n');

  return `You are synthesizing lecture notes from multiple chunks into one cohesive set of notes.

Combine and deduplicate the following chunk summaries into a single concise note.
Remove redundancy. Organize logically. Keep only the most important concepts, definitions, steps, formulas, and exam-relevant details.
Ignore transcript-like filler, repeated points, and low-signal narration. Keep the final note brief and useful for revision.

Return ONLY valid JSON matching this schema:
{
  "title": "...",
  "overview": "...",
  "simpleExplanation": "...",
  "definitions": [{"term": "...", "definition": "..."}],
  "keyPoints": ["..."],
  "importantTerms": ["..."],
  "steps": ["..."],
  "examples": [{"title": "...", "code": "...", "explanation": "..."}],
  "formulas": [{"formula": "...", "meaning": "...", "example": "..."}],
  "comparisons": [],
  "advantages": [],
  "disadvantages": [],
  "remember": "...",
  "revision": ["..."],
  "questions": [{"question": "...", "answer": "...", "type": "MCQ|SHORT|DEFINITION|CONCEPTUAL"}]
}

CHUNK SUMMARIES:
${combined.substring(0, 30000)}`;
}

/**
 * Parse JSON from AI response (handles common AI formatting issues)
 */
function parseNotesJSON(text) {
  if (!text) return null;

  // Try direct parse
  try {
    const parsed = JSON.parse(text);
    if (validateNoteSchema(parsed)) return parsed;
  } catch {}

  // Try extracting JSON block
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      if (validateNoteSchema(parsed)) return parsed;
    } catch {}
  }

  // Try finding JSON object
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      const parsed = JSON.parse(objMatch[0]);
      if (validateNoteSchema(parsed)) return parsed;
    } catch {}
  }

  return null;
}

/**
 * Validate note schema
 */
function validateNoteSchema(obj) {
  if (!obj || typeof obj !== 'object') return false;
  // Must have at least a title or overview or keyPoints
  return !!(obj.title || obj.overview || (obj.keyPoints && obj.keyPoints.length > 0));
}

/**
 * Finalize notes — add diagram, fill missing fields
 */
function finalizeNotes(notes, transcript, options) {
  const category = detectCategory(transcript.text || '');
  const diagram = generateDiagram(category, notes);
  const rawTitle = notes.title || options.videoInfo?.title || 'Lecture Notes';
  const title = /^Lecture\s+\d+\s+[—-]\s+/i.test(rawTitle)
    ? rawTitle
    : `Lecture ${options.lectureNumber || 1} — ${rawTitle}`;

  const finalized = {
    title,
    overview: notes.overview || '',
    simpleExplanation: notes.simpleExplanation || '',
    definitions: Array.isArray(notes.definitions) ? notes.definitions : [],
    keyPoints: Array.isArray(notes.keyPoints) ? notes.keyPoints : [],
    importantTerms: Array.isArray(notes.importantTerms) ? notes.importantTerms : [],
    steps: Array.isArray(notes.steps) ? notes.steps : [],
    examples: Array.isArray(notes.examples) ? notes.examples : [],
    formulas: Array.isArray(notes.formulas) ? notes.formulas : [],
    comparisons: Array.isArray(notes.comparisons) ? notes.comparisons : [],
    advantages: Array.isArray(notes.advantages) ? notes.advantages : [],
    disadvantages: Array.isArray(notes.disadvantages) ? notes.disadvantages : [],
    diagram: diagram || {},
    remember: notes.remember || '',
    revision: Array.isArray(notes.revision) ? notes.revision : [],
    questions: Array.isArray(notes.questions) ? notes.questions : [],
    category,
    language: options.language || 'English',
    examMode: options.examMode || false,
  };

  return keepImportantOnly(finalized);
}

/**
 * Merge chunk summaries when synthesis fails
 */
function mergeChunkSummaries(summaries, transcript, options) {
  const merged = {
    title: options.videoInfo?.title || 'Lecture Notes',
    overview: '',
    simpleExplanation: '',
    definitions: [],
    keyPoints: [],
    importantTerms: [],
    steps: [],
    examples: [],
    formulas: [],
    comparisons: [],
    advantages: [],
    disadvantages: [],
    remember: '',
    revision: [],
    questions: []
  };

  for (const summary of summaries) {
    const parsed = parseNotesJSON(summary);
    if (!parsed) continue;

    if (parsed.overview && !merged.overview) merged.overview = parsed.overview;
    if (parsed.simpleExplanation && !merged.simpleExplanation) merged.simpleExplanation = parsed.simpleExplanation;
    if (parsed.remember) merged.remember = parsed.remember;

    for (const key of ['definitions', 'keyPoints', 'importantTerms', 'steps', 'examples', 'formulas', 'comparisons', 'advantages', 'disadvantages', 'revision', 'questions']) {
      if (Array.isArray(parsed[key])) {
        merged[key] = merged[key].concat(parsed[key]);
      }
    }
  }

  return finalizeNotes(merged, transcript, options);
}

function keepImportantOnly(notes) {
  const normalizeText = (value, maxLength = 220) => {
    if (!value || typeof value !== 'string') return '';
    return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
  };

  const keepStringList = (items, limit = 6) => {
    if (!Array.isArray(items)) return [];
    const unique = [];
    const seen = new Set();

    for (const item of items) {
      const text = typeof item === 'string' ? item.trim() : String(item || '').trim();
      if (!text || text.length < 8) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(text.replace(/^[\-•*\d.\s]+/, ''));
      if (unique.length >= limit) break;
    }

    return unique;
  };

  const keepDefinitions = (items, limit = 5) => {
    if (!Array.isArray(items)) return [];
    return items
      .filter(def => def && def.term && def.definition)
      .map(def => ({
        term: String(def.term).trim(),
        definition: normalizeText(String(def.definition), 180)
      }))
      .filter(def => def.term.length > 2 && def.definition.length > 10)
      .slice(0, limit);
  };

  const keepQuestions = (items, limit = 8) => {
    if (!Array.isArray(items)) return [];
    return items
      .filter(q => q && q.question)
      .map(q => ({
        question: normalizeText(String(q.question), 160),
        answer: normalizeText(String(q.answer || ''), 180),
        type: q.type || 'SHORT'
      }))
      .filter(q => q.question.length > 12)
      .slice(0, limit);
  };

  const filterLowSignalText = (value) => {
    if (typeof value !== 'string') return value;
    if (/align(?::(?:start|end))?|position:\s*\d+%|-->|->|<\/?[a-z][^>]*>|\[(?:music|applause|noise|laughter|inaudible)\]|(?:show answer|key takeaway:)|(?:^|\s)(?:hello|hi everyone|welcome to|subscribe|like and share)(?:\s|$)/i.test(value)) {
      return '';
    }
    const cleaned = value.replace(/\b(?:align|aligned|alignment|okay now|okay|uh|um|you know|basically|literally|like\s+(?:this|that)|so\s+we|so,?\s+like|now\s+what\s+I\s+mean)\b/gi, ' ');
    return cleaned.replace(/\s+/g, ' ').replace(/^[,.;:!?\s]+|[,.;:!?\s]+$/g, '').trim();
  };

  const filtered = {
    ...notes,
    overview: normalizeText(filterLowSignalText(notes.overview), 650),
    simpleExplanation: normalizeText(filterLowSignalText(notes.simpleExplanation), 220),
    keyPoints: keepStringList((notes.keyPoints || []).map(item => filterLowSignalText(item)), 12),
    importantTerms: keepStringList((notes.importantTerms || []).map(item => filterLowSignalText(item)), 8),
    definitions: keepDefinitions((notes.definitions || []).map(def => ({
      ...def,
      term: filterLowSignalText(def.term),
      definition: filterLowSignalText(def.definition)
    })), 10),
    steps: keepStringList((notes.steps || []).map(item => filterLowSignalText(item)), 10),
    examples: (Array.isArray(notes.examples) ? notes.examples : []).slice(0, 5).map(example => ({
      ...example,
      title: filterLowSignalText(example.title === 'Example' ? '' : example.title),
      code: filterLowSignalText(example.code),
      explanation: filterLowSignalText(example.explanation)
    })),
    formulas: (Array.isArray(notes.formulas) ? notes.formulas : []).slice(0, 8).map(formula => ({
      ...formula,
      formula: filterLowSignalText(formula.formula),
      meaning: filterLowSignalText(formula.meaning),
      example: filterLowSignalText(formula.example)
    })),
    comparisons: (Array.isArray(notes.comparisons) ? notes.comparisons : []).slice(0, 5).map(comp => ({
      ...comp,
      itemA: filterLowSignalText(comp.itemA),
      itemB: filterLowSignalText(comp.itemB),
      differences: (comp.differences || []).map(diff => ({
        ...diff,
        aspect: filterLowSignalText(diff.aspect),
        a: filterLowSignalText(diff.a),
        b: filterLowSignalText(diff.b)
      }))
    })),
    advantages: keepStringList((notes.advantages || []).map(item => filterLowSignalText(item)), 6),
    disadvantages: keepStringList((notes.disadvantages || []).map(item => filterLowSignalText(item)), 6),
    remember: normalizeText(filterLowSignalText(notes.remember), 180),
    revision: keepStringList((notes.revision || []).map(item => filterLowSignalText(item)), 10),
    questions: keepQuestions((notes.questions || []).map(q => ({
      ...q,
      question: filterLowSignalText(q.question),
      answer: filterLowSignalText(q.answer)
    })), 4),
  };

  return removeInvalidNoteContent(filtered);
}

function removeInvalidNoteContent(notes) {
  const invalid = value => typeof value === 'string' && (
    /align(?::(?:start|end))?|position:\s*\d+%|-->|->|<\/?[a-z][^>]*>|\[(?:music|applause|noise|laughter|inaudible)\]|(?:show answer|key takeaway:)/i.test(value) ||
    /^\s*(?:example|definition|quick revision|\d+\s*\/\s*\d+)\s*$/i.test(value)
  );

  const containsInvalid = value => {
    if (invalid(value)) return true;
    if (Array.isArray(value)) return value.some(containsInvalid);
    if (value && typeof value === 'object') return Object.values(value).some(containsInvalid);
    return false;
  };

  const cleanList = items => (Array.isArray(items) ? items : []).filter(item => {
    if (typeof item === 'string') return item.length > 7 && !containsInvalid(item);
    return item && !containsInvalid(item);
  });

  return {
    ...notes,
    overview: invalid(notes.overview) ? '' : notes.overview,
    simpleExplanation: invalid(notes.simpleExplanation) ? '' : notes.simpleExplanation,
    importantTerms: [],
    diagram: notes.diagram && !containsInvalid(notes.diagram) ? notes.diagram : {},
    keyPoints: cleanList(notes.keyPoints),
    definitions: cleanList(notes.definitions),
    steps: cleanList(notes.steps),
    examples: cleanList(notes.examples),
    formulas: cleanList(notes.formulas),
    comparisons: cleanList(notes.comparisons),
    advantages: cleanList(notes.advantages),
    disadvantages: cleanList(notes.disadvantages),
    revision: cleanList(notes.revision),
    questions: cleanList(notes.questions),
    remember: invalid(notes.remember) ? '' : notes.remember,
  };
}

// ===========================================================================
// EXTRACTIVE FALLBACK — works without any AI
// ===========================================================================

/**
 * Generate notes using pure text extraction and heuristics
 */
export function generateExtractiveNotes(transcript, options = {}) {
  const text = transcript.text || '';
  const { language = 'English', examMode = false, videoInfo = {} } = options;

  const sentences = splitSentences(text)
    .map(cleanLectureSentence)
    .filter(Boolean);
  const keywords = extractKeywords(text);
  const definitions = detectDefinitions(sentences);
  const formulas = detectFormulas(sentences);
  const steps = detectSteps(sentences);
  const comparisons = detectComparisons(sentences);
  const examples = detectExamples(sentences);
  const keyPoints = extractKeyPoints(sentences, keywords);
  const questions = generateQuestions(definitions, keyPoints, keywords);
  const category = detectCategory(text);

  const lectureTitle = videoInfo.title || extractTitle(sentences, keywords);
  const title = `Lecture ${videoInfo.lectureNumber || 1} — ${lectureTitle}`;
  const overview = selectOverview(sentences, definitions, keyPoints);

  const notes = {
    title,
    overview,
    simpleExplanation: generateSimpleExplanation(sentences, keywords),
    definitions,
    keyPoints,
    importantTerms: keywords.slice(0, 15).map(k => k.word),
    steps,
    examples,
    formulas,
    comparisons,
    advantages: detectListPattern(sentences, ['advantage', 'benefit', 'pro', 'strength']),
    disadvantages: detectListPattern(sentences, ['disadvantage', 'drawback', 'con', 'weakness', 'limitation']),
    remember: keyPoints.length > 0 ? keyPoints[0] : '',
    revision: keyPoints.slice(0, 7),
    questions,
    category,
    language,
    examMode,
  };

  const diagram = generateDiagram(category, notes);
  notes.diagram = diagram;

  return keepImportantOnly(notes);
}

function cleanLectureSentence(sentence) {
  const hadSubtitleArtifact = /align(?::(?:start|end))?|position:\s*\d+%|-->|->|<\/?[a-z][^>]*>|\[(?:music|applause|noise|laughter|inaudible)\]/i.test(sentence);
  const cleaned = collapseRepeatedPhrases(sentence)
    .replace(/<[^>]*>|\{[^}]*\}/g, ' ')
    .replace(/(?:align:(?:start|end)|position:\s*\d+%|line:\s*\S+)/gi, ' ')
    .replace(/-->|->/g, ' ')
    .replace(/\[(?:music|applause|noise|laughter|inaudible)\]/gi, ' ')
    .replace(/\b(?:okay now|okay|um|uh|you know|basically)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned || /^(?:hello|hi everyone|welcome|subscribe|like and share)\b/i.test(cleaned)) return '';
  if (/^(?:today|in this lecture|in this video)\s+(?:we|i)\s+(?:will|are going to|study|learn|discuss)\b/i.test(cleaned)) return '';
  if (!/[a-zA-Z]{3,}/.test(cleaned) || cleaned.length < 20) return '';
  const result = cleaned.replace(/^[,.;:!?\s]+|[,.;:!?\s]+$/g, '').replace(/^(?:so|well)\s+/i, '');
  if (hadSubtitleArtifact && result.split(/\s+/).length < 6) return '';
  return result;
}

function collapseRepeatedPhrases(sentence) {
  const words = sentence.split(/\s+/);
  for (let size = Math.min(8, Math.floor(words.length / 3)); size >= 3; size--) {
    for (let start = 0; start + size < words.length; start++) {
      const phrase = words.slice(start, start + size).join(' ').toLowerCase();
      const later = words.findIndex((_, index) => index > start + size &&
        words.slice(index, index + size).join(' ').toLowerCase() === phrase);
      if (later !== -1) {
        words.splice(later, size);
        return words.join(' ');
      }
    }
  }
  return sentence;
}

function selectOverview(sentences, definitions, keyPoints) {
  const source = [
    ...definitions.slice(0, 2).map(def => `${def.term}: ${def.definition}`),
    ...keyPoints.slice(0, 2),
    ...sentences
  ];
  return [...new Set(source.map(item => item.trim()).filter(Boolean))]
    .join(' ')
    .substring(0, 650);
}

/**
 * Split text into sentences
 */
function splitSentences(text) {
  return text
    .replace(/([.!?])\s+/g, '$1\n')
    .split('\n')
    .map(s => s.trim())
    .filter(s => s.length > 10);
}

/**
 * Extract keywords by frequency
 */
function extractKeywords(text) {
  const words = text.toLowerCase().match(/\b[a-z]{3,}\b/g) || [];
  const stopWords = new Set([
    'the', 'and', 'that', 'this', 'with', 'from', 'have', 'has', 'had', 'not',
    'are', 'was', 'were', 'been', 'being', 'would', 'could', 'should', 'will',
    'can', 'may', 'might', 'shall', 'does', 'did', 'doing', 'done', 'going',
    'also', 'just', 'like', 'know', 'think', 'make', 'want', 'come', 'take',
    'get', 'got', 'very', 'much', 'more', 'most', 'some', 'any', 'all', 'each',
    'every', 'both', 'few', 'many', 'such', 'than', 'then', 'them', 'they',
    'their', 'there', 'here', 'where', 'when', 'what', 'which', 'who', 'whom',
    'how', 'why', 'because', 'about', 'into', 'through', 'during', 'before',
    'after', 'above', 'below', 'between', 'same', 'other', 'only', 'need',
    'say', 'said', 'says', 'well', 'way', 'use', 'used', 'using', 'right',
    'look', 'see', 'now', 'let', 'thing', 'things', 'called', 'call',
    'actually', 'really', 'basically', 'something', 'going', 'okay',
    'everyone', 'today', 'lecture', 'video', 'study', 'learn', 'discuss',
    'for', 'but', 'yet', 'nor', 'its', 'our', 'his', 'her', 'your',
  ]);

  const freq = {};
  for (const w of words) {
    if (!stopWords.has(w)) {
      freq[w] = (freq[w] || 0) + 1;
    }
  }

  return Object.entries(freq)
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 30);
}

/**
 * Detect definitions in sentences
 */
function detectDefinitions(sentences) {
  const defs = [];
  const patterns = [
    /^(.{2,60}?)\s+(?:is|are|means|refers to|defined as)\s+(.+)/i,
    /(?:definition|meaning)\s*(?:of|:)\s*([\w\s]+)\s*(?:is|:)\s*(.+)/i,
    /([\w\s]+)\s*(?:—|–|-|:)\s*(.{20,})/,
  ];

  for (const sentence of sentences) {
    for (const pattern of patterns) {
      const match = sentence.match(pattern);
      if (match && match[1].trim().length < 50 && match[2].trim().length > 15) {
        defs.push({
          term: match[1].trim().replace(/^(a|an|the)\s+/i, ''),
          definition: match[2].trim().substring(0, 200)
        });
        break;
      }
    }
  }

  // Deduplicate by term
  const seen = new Set();
  return defs.filter(d => {
    const key = d.term.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 10);
}

/**
 * Detect formulas/equations
 */
function detectFormulas(sentences) {
  const formulas = [];
  for (const s of sentences) {
    // Match patterns like: x = y, f(x) = ..., O(n), etc.
    if (/[=<>≤≥]+/.test(s) && /[a-z]\s*[=(<]/.test(s.toLowerCase()) && s.length < 200) {
      formulas.push({ formula: s.trim(), meaning: '', example: '' });
    }
    // Match Big O notation
    const bigO = s.match(/O\([^)]+\)/g);
    if (bigO) {
      bigO.forEach(f => formulas.push({ formula: f, meaning: 'Time/Space complexity', example: '' }));
    }
  }

  // Deduplicate
  const seen = new Set();
  return formulas.filter(f => {
    if (seen.has(f.formula)) return false;
    seen.add(f.formula);
    return true;
  }).slice(0, 8);
}

/**
 * Detect step-by-step instructions
 */
function detectSteps(sentences) {
  const steps = [];
  const stepPatterns = [
    /^(?:step\s*\d+|first|second|third|fourth|fifth|then|next|finally|lastly)\s*[:.,-]/i,
    /^\d+[.)]\s+/,
  ];

  for (const s of sentences) {
    for (const p of stepPatterns) {
      if (p.test(s)) {
        steps.push(s.trim().substring(0, 150));
        break;
      }
    }

    if (!stepPatterns.some(pattern => pattern.test(s)) &&
        /\b(start|begin|first)\b.+\b(then|next|after|until|finally)\b/i.test(s)) {
      const parts = s.split(/,\s*(?:then|next)\s+|\bthen\s+/i)
        .map(part => part.trim())
        .filter(part => part.length > 12);
      steps.push(...parts);
    }
  }

  return steps.slice(0, 10);
}

/**
 * Detect comparisons between concepts
 */
function detectComparisons(sentences) {
  const comps = [];
  const vsPattern = /(.+?)\s+(?:vs\.?|versus|compared to|whereas|unlike)\s+(.+)/i;

  for (const s of sentences) {
    const match = s.match(vsPattern);
    if (match && match[1].length < 100 && match[2].length < 100) {
      comps.push({
        itemA: match[1].trim(),
        itemB: match[2].trim(),
        differences: [{ aspect: 'Key difference', a: match[1].trim(), b: match[2].trim() }]
      });
    }
  }

  return comps.slice(0, 5);
}

/**
 * Detect examples
 */
function detectExamples(sentences) {
  const examples = [];
  for (const s of sentences) {
    if (/(?:for example|e\.g\.|such as|consider|suppose|let's say|imagine)/i.test(s)) {
      examples.push({ title: 'Example', code: '', explanation: s.trim().substring(0, 300) });
    }
  }
  return examples.slice(0, 5);
}

/**
 * Extract key points using keyword scoring
 */
function extractKeyPoints(sentences, keywords) {
  const topKeywords = new Set(keywords.slice(0, 15).map(k => k.word));

  const scored = sentences.map(s => {
    let score = 0;
    const lower = s.toLowerCase();
    for (const kw of topKeywords) {
      if (lower.includes(kw)) score += 2;
    }
    // Definitions, processes, formulas, and examples are high-value note content.
    if (/\b(is|are|means|refers to|defined as)\b/i.test(s)) score += 4;
    if (/\b(first|then|next|finally|start|begin|until)\b/i.test(s)) score += 3;
    if (/[=<>]|\bO\([^)]+\)/.test(s)) score += 3;
    if (/(?:for example|e\.g\.|such as|consider|suppose)/i.test(s)) score += 2;

    // Bonus for important indicator words
    if (/\b(important|key|crucial|essential|main|primary|significant|fundamental)\b/i.test(s)) score += 3;
    if (/\b(remember|note that|keep in mind)\b/i.test(s)) score += 2;
    // Penalty for questions and very short sentences
    if (s.endsWith('?')) score -= 2;
    if (s.length < 20) score -= 1;
    // Penalty for too long
    if (s.length > 200) score -= 1;
    return { text: s, score };
  });

  const selected = scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(s => s.text.substring(0, 180));

  return [...new Set(selected)].slice(0, 10);
}

/**
 * Extract or generate title
 */
function extractTitle(sentences, keywords) {
  const usableKeywords = keywords.filter(k => !/align|position|timestamp|subtitle|metadata|okay|everyone/i.test(k.word));
  if (usableKeywords.length >= 2) {
    return usableKeywords.slice(0, 3).map(k => k.word.charAt(0).toUpperCase() + k.word.slice(1)).join(' & ');
  }
  if (sentences.length > 0) {
    return sentences[0].substring(0, 60);
  }
  return 'Lecture Notes';
}

/**
 * Generate simple explanation from key sentences
 */
function generateSimpleExplanation(sentences, keywords) {
  const topKW = keywords.slice(0, 5).map(k => k.word);
  const relevant = sentences.filter(s => {
    const lower = s.toLowerCase();
    return topKW.some(kw => lower.includes(kw));
  });

  if (relevant.length > 0) {
    return relevant.slice(0, 2).join(' ').substring(0, 300);
  }
  return sentences.slice(0, 2).join(' ').substring(0, 300);
}

/**
 * Detect list patterns (advantages, disadvantages, etc.)
 */
function detectListPattern(sentences, keywords) {
  const items = [];
  let capturing = false;

  for (const s of sentences) {
    const lower = s.toLowerCase();
    if (keywords.some(k => new RegExp(`\\b${k}\\b`, 'i').test(lower))) {
      capturing = true;
      // Check if the sentence itself is an item
      if (s.length < 150) items.push(s);
      continue;
    }
    if (capturing && (s.startsWith('-') || s.startsWith('•') || /^\d+[.)]\s/.test(s))) {
      items.push(s.replace(/^[-•\d.)]+\s*/, '').trim());
    } else if (capturing && items.length > 0) {
      capturing = false;
    }
  }

  return items.slice(0, 8);
}

/**
 * Generate quiz questions from extracted content
 */
function generateQuestions(definitions, keyPoints, keywords) {
  const questions = [];

  // Definition questions
  for (const def of definitions.slice(0, 3)) {
    questions.push({
      question: `What is ${def.term}?`,
      answer: def.definition,
      type: 'DEFINITION'
    });
  }

  // Key point questions
  for (const kp of keyPoints.slice(0, 3)) {
    questions.push({
      question: `Explain: ${kp.substring(0, 80)}`,
      answer: kp,
      type: 'SHORT'
    });
  }

  return questions
    .filter((question, index, all) => all.findIndex(item => item.question === question.question) === index)
    .slice(0, 8);
}
