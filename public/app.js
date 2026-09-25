// app.js — NoteCraft AI Frontend Application
// Handles URL validation, job management, SSE, note rendering, history, export

(function () {
  'use strict';

  // ============================================================
  // DOM REFERENCES
  // ============================================================
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const views = {
    landing: $('#viewLanding'),
    processing: $('#viewProcessing'),
    notes: $('#viewNotes'),
    history: $('#viewHistory'),
    system: $('#viewSystem'),
  };

  const els = {
    urlInput: $('#urlInput'),
    urlStatus: $('#urlStatus'),
    langSelect: $('#langSelect'),
    styleSelect: $('#styleSelect'),
    examToggle: $('#examToggle'),
    btnGenerate: $('#btnGenerate'),
    btnDemo: $('#btnDemo'),
    btnCancel: $('#btnCancel'),
    btnHistory: $('#btnHistory'),
    btnSystemStatus: $('#btnSystemStatus'),
    btnThemeToggle: $('#btnThemeToggle'),
    themeIcon: $('#themeIcon'),
    btnBackToHome: $('#btnBackToHome'),
    btnHistoryBack: $('#btnHistoryBack'),
    btnSystemBack: $('#btnSystemBack'),
    logo: $('#logo'),
    videoPreview: $('#videoPreview'),
    videoThumb: $('#videoThumb'),
    videoTitle: $('#videoTitle'),
    videoChannel: $('#videoChannel'),
    videoDuration: $('#videoDuration'),
    progressBar: $('#progressBar'),
    progressPercent: $('#progressPercent'),
    progressMessage: $('#progressMessage'),
    stageLog: $('#stageLog'),
    processingTimeout: $('#processingTimeout'),
    btnTimeoutCancel: $('#btnTimeoutCancel'),
    btnTimeoutContinue: $('#btnTimeoutContinue'),
    notesTitle: $('#notesTitle'),
    notebookContainer: $('#notebookContainer'),
    exportSelect: $('#exportSelect'),
    historyList: $('#historyList'),
    systemChecks: $('#systemChecks'),
  };

  // ============================================================
  // STATE
  // ============================================================
  let currentJobId = null;
  let eventSource = null;
  let pollInterval = null;
  let timeoutTimer = null;
  let lastEventTime = 0;

  // ============================================================
  // INITIALIZATION
  // ============================================================
  function init() {
    initTheme();
    bindEvents();
    showView('landing');
  }

  // ============================================================
  // THEME
  // ============================================================
  function initTheme() {
    const saved = localStorage.getItem('notecraft-theme') || 'dark';
    setTheme(saved);
  }

  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('notecraft-theme', theme);
    els.themeIcon.textContent = theme === 'dark' ? '🌙' : '☀️';
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    setTheme(current === 'dark' ? 'light' : 'dark');
  }

  // ============================================================
  // VIEW MANAGEMENT
  // ============================================================
  function showView(name) {
    Object.values(views).forEach(v => v.classList.remove('active'));
    if (views[name]) views[name].classList.add('active');
  }

  // ============================================================
  // EVENT BINDING
  // ============================================================
  function bindEvents() {
    // URL input
    els.urlInput.addEventListener('input', onUrlInput);
    els.urlInput.addEventListener('paste', () => setTimeout(onUrlInput, 50));

    // Buttons
    els.btnGenerate.addEventListener('click', startGeneration);
    els.btnDemo.addEventListener('click', startDemo);
    els.btnCancel.addEventListener('click', cancelCurrentJob);
    els.btnHistory.addEventListener('click', () => { loadHistory(); showView('history'); });
    els.btnSystemStatus.addEventListener('click', () => { loadSystemStatus(); showView('system'); });
    els.btnThemeToggle.addEventListener('click', toggleTheme);
    els.btnBackToHome.addEventListener('click', () => showView('landing'));
    els.btnHistoryBack.addEventListener('click', () => showView('landing'));
    els.btnSystemBack.addEventListener('click', () => showView('landing'));
    els.logo.addEventListener('click', () => showView('landing'));
    els.logo.addEventListener('keydown', (e) => { if (e.key === 'Enter') showView('landing'); });

    // Export
    els.exportSelect.addEventListener('change', handleExport);

    // Timeout actions
    els.btnTimeoutCancel.addEventListener('click', cancelCurrentJob);
    els.btnTimeoutContinue.addEventListener('click', () => {
      els.processingTimeout.classList.add('hidden');
      resetTimeoutTimer();
    });
  }

  // ============================================================
  // URL VALIDATION
  // ============================================================
  function onUrlInput() {
    const url = els.urlInput.value.trim();
    if (!url) {
      els.urlStatus.textContent = '';
      els.btnGenerate.disabled = true;
      return;
    }

    const videoId = extractVideoId(url);
    if (videoId) {
      els.urlStatus.textContent = '✓';
      els.urlStatus.style.color = '#34d399';
      els.btnGenerate.disabled = false;
    } else {
      els.urlStatus.textContent = '✗';
      els.urlStatus.style.color = '#f87171';
      els.btnGenerate.disabled = true;
    }
  }

  function extractVideoId(url) {
    if (!url) return null;
    const patterns = [
      /(?:youtube\.com\/watch\?.*v=)([a-zA-Z0-9_-]{11})/,
      /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
      /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
      /(?:youtube\.com\/live\/)([a-zA-Z0-9_-]{11})/,
      /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    ];
    for (const p of patterns) {
      const m = url.match(p);
      if (m) return m[1];
    }
    return null;
  }

  // ============================================================
  // JOB MANAGEMENT
  // ============================================================
  async function startGeneration() {
    const url = els.urlInput.value.trim();
    if (!url) return;

    try {
      els.btnGenerate.disabled = true;
      const resp = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          language: els.langSelect.value,
          noteStyle: els.styleSelect.value,
          examMode: els.examToggle.checked,
        }),
      });

      const data = await resp.json();
      if (data.error) {
        alert(data.error);
        els.btnGenerate.disabled = false;
        return;
      }

      currentJobId = data.jobId;
      startProcessingView();
      subscribeToJob(data.jobId);
    } catch (e) {
      alert('Failed to start processing: ' + e.message);
      els.btnGenerate.disabled = false;
    }
  }

  async function startDemo() {
    try {
      els.btnDemo.disabled = true;
      const resp = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          demo: true,
          language: els.langSelect.value,
          noteStyle: els.styleSelect.value,
          examMode: els.examToggle.checked,
        }),
      });

      const data = await resp.json();
      if (data.error) {
        alert(data.error);
        els.btnDemo.disabled = false;
        return;
      }

      currentJobId = data.jobId;
      startProcessingView();
      subscribeToJob(data.jobId);
    } catch (e) {
      alert('Failed to start demo: ' + e.message);
      els.btnDemo.disabled = false;
    }
  }

  function startProcessingView() {
    showView('processing');
    els.videoPreview.classList.add('hidden');
    els.processingTimeout.classList.add('hidden');
    els.stageLog.innerHTML = '';
    updateProgress(0, 'Starting...');
    resetTimeoutTimer();
  }

  function subscribeToJob(jobId) {
    // Try SSE first
    try {
      eventSource = new EventSource(`/api/jobs/${jobId}/events`);

      eventSource.onmessage = (e) => {
        lastEventTime = Date.now();
        resetTimeoutTimer();
        try {
          const data = JSON.parse(e.data);
          handleJobEvent(data);
        } catch {}
      };

      eventSource.onerror = () => {
        // SSE failed — fall back to polling
        if (eventSource) {
          eventSource.close();
          eventSource = null;
        }
        startPolling(jobId);
      };
    } catch {
      startPolling(jobId);
    }
  }

  function startPolling(jobId) {
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(async () => {
      try {
        const resp = await fetch(`/api/jobs/${jobId}`);
        const data = await resp.json();
        lastEventTime = Date.now();
        handleJobEvent({
          stage: data.state?.toLowerCase(),
          progress: data.progress,
          message: data.message,
          videoInfo: data.videoInfo,
          notes: data.notes,
          error: data.error,
        });

        // Stop polling if terminal state
        if (['ready', 'error', 'cancelled'].includes(data.state?.toLowerCase())) {
          clearInterval(pollInterval);
          pollInterval = null;
        }
      } catch {}
    }, 1000);
  }

  function handleJobEvent(event) {
    const { stage, progress, message, videoInfo, notes, error } = event;

    // Update progress
    if (progress !== undefined) {
      updateProgress(progress, message);
    }

    // Add log entry
    if (message) {
      addLogEntry(message, stage === 'error' ? 'error' : stage === 'ready' ? 'success' : '');
    }

    // Show video info
    if (videoInfo && videoInfo.title) {
      showVideoPreview(videoInfo);
    }

    // Handle terminal states
    if (stage === 'ready' && notes) {
      cleanup();
      renderNotes(notes);
      showView('notes');
      els.btnGenerate.disabled = false;
      els.btnDemo.disabled = false;
    } else if (stage === 'error') {
      cleanup();
      addLogEntry(`Error: ${message || error}`, 'error');
      setTimeout(() => {
        els.btnGenerate.disabled = false;
        els.btnDemo.disabled = false;
      }, 1000);
    } else if (stage === 'cancelled') {
      cleanup();
      addLogEntry('Processing cancelled.', 'warn');
      setTimeout(() => {
        showView('landing');
        els.btnGenerate.disabled = false;
        els.btnDemo.disabled = false;
      }, 1500);
    }
  }

  function updateProgress(pct, msg) {
    const fill = els.progressBar.querySelector('.progress-fill');
    fill.style.width = `${pct}%`;
    els.progressBar.setAttribute('aria-valuenow', pct);
    els.progressPercent.textContent = `${Math.round(pct)}%`;
    if (msg) els.progressMessage.textContent = msg;
  }

  function addLogEntry(text, type = '') {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    const time = new Date().toLocaleTimeString();
    entry.textContent = `[${time}] ${text}`;
    els.stageLog.appendChild(entry);
    els.stageLog.scrollTop = els.stageLog.scrollHeight;
  }

  function showVideoPreview(info) {
    els.videoPreview.classList.remove('hidden');
    els.videoTitle.textContent = info.title;
    els.videoChannel.textContent = info.channel || '';
    els.videoDuration.textContent = info.durationStr || '';
    if (info.thumbnail) {
      els.videoThumb.src = info.thumbnail;
      els.videoThumb.alt = info.title;
    }
  }

  async function cancelCurrentJob() {
    if (!currentJobId) return;
    try {
      await fetch(`/api/jobs/${currentJobId}/cancel`, { method: 'POST' });
    } catch {}
  }

  function cleanup() {
    if (eventSource) { eventSource.close(); eventSource = null; }
    if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
    if (timeoutTimer) { clearTimeout(timeoutTimer); timeoutTimer = null; }
    currentJobId = null;
  }

  function resetTimeoutTimer() {
    if (timeoutTimer) clearTimeout(timeoutTimer);
    timeoutTimer = setTimeout(() => {
      els.processingTimeout.classList.remove('hidden');
    }, 60000); // 60 seconds
  }

  // ============================================================
  // NOTE RENDERER — Handwritten Notebook Style
  // ============================================================
  function renderNotes(notes) {
    const container = els.notebookContainer;
    container.innerHTML = '';
    els.notesTitle.textContent = notes.title || 'Lecture Notes';

    const style = els.styleSelect.value || 'bluePen';
    const penClass = {
      bluePen: 'pen-blue',
      blackPen: 'pen-black',
      colorful: 'pen-colorful',
      minimal: 'pen-minimal',
    }[style] || 'pen-blue';

    // Build sections
    const sections = buildSections(notes);

    // Split into pages (target ~5-6 sections per page)
    const pages = paginateSections(sections);

    pages.forEach((pageSections, pageIdx) => {
      const page = document.createElement('div');
      page.className = `notebook-page ${penClass}`;

      pageSections.forEach(section => {
        page.appendChild(section);
      });

      container.appendChild(page);
    });
  }

  function buildSections(notes) {
    const sections = [];

    // Title
    if (notes.title) {
      const el = createElement('div', 'hw-section');
      const engineLabel = notes.engine === 'ollama' ? 'AI synthesis' : 'Lecture-grounded notes';
      const categoryLabel = notes.category ? notes.category.replace(/_/g, ' ').toLowerCase() : 'lecture';
      el.innerHTML = `
        <div class="hw-title"><span class="hw-title-underline">${esc(notes.title)}</span></div>
        <div class="hw-note-meta"><span>${esc(categoryLabel)}</span><span class="hw-meta-dot">•</span><span>${esc(engineLabel)}</span></div>
      `;
      sections.push(el);
    }

    // Lecture overview
    if (notes.overview) {
      sections.push(createTextSection('🎯', 'What This Lecture Covers', notes.overview));
    }

    // Key Points
    if (notes.keyPoints && notes.keyPoints.length > 0) {
      const el = createElement('div', 'hw-section');
      el.innerHTML = `
        <div class="hw-section-heading"><span class="hw-section-icon">🧠</span> Important Concepts</div>
        <div class="hw-numbered-notes">
          ${notes.keyPoints.map((kp, conceptIndex) => {
            const text = typeof kp === 'string' ? kp : kp.point || kp.text || '';
            return `<div class="hw-numbered-note">
              <span class="hw-note-number">${conceptIndex + 1}</span>
              <span class="hw-note-content">${esc(text)}</span>
            </div>`;
          }).join('')}
        </div>
      `;
      sections.push(el);
    }

    // Compact visual summary tied to the detected lecture category
    if (notes.diagram && notes.diagram.content) {
      const el = createElement('div', 'hw-section hw-visual-section');
      el.innerHTML = `
        <div class="hw-section-heading"><span class="hw-section-icon">✦</span> Quick Visual</div>
        <div class="hw-diagram-box">
          <div class="hw-diagram-title">${esc(notes.diagram.title || 'Lecture map')}</div>
          <pre class="hw-diagram-content">${esc(notes.diagram.content)}</pre>
          ${(notes.diagram.labels || []).filter(Boolean).slice(0, 2).map(label =>
            `<div class="hw-diagram-label">${esc(label)}</div>`
          ).join('')}
        </div>
      `;
      sections.push(el);
    }

    // Definitions
    if (notes.definitions && notes.definitions.length > 0) {
      const el = createElement('div', 'hw-section');
      let html = `<div class="hw-section-heading"><span class="hw-section-icon">📌</span> Important Definitions</div>`;
      notes.definitions.forEach(d => {
        html += `
          <div class="hw-def-box">
            <div class="hw-def-term">${esc(d.term || '')}</div>
            <div class="hw-def-text">${esc(d.definition || '')}</div>
          </div>
        `;
      });
      el.innerHTML = html;
      sections.push(el);
    }

    // Examples
    if (notes.examples && notes.examples.length > 0) {
      notes.examples.forEach(ex => {
        const el = createElement('div', 'hw-section');
        let html = `<div class="hw-section-heading"><span class="hw-section-icon">📝</span> Important Examples</div>`;
        if (ex.title) html += `<div class="hw-example-title">${esc(ex.title)}</div>`;
        if (ex.code) html += `<div class="hw-code-box">${esc(ex.code)}</div>`;
        if (ex.explanation) html += `<div class="hw-example-explanation">${esc(ex.explanation)}</div>`;
        el.innerHTML = html;
        sections.push(el);
      });
    }

    // Formulas
    if (notes.formulas && notes.formulas.length > 0) {
      const el = createElement('div', 'hw-section');
      let html = `<div class="hw-section-heading"><span class="hw-section-icon">📐</span> Formulas</div>`;
      notes.formulas.forEach(f => {
        html += `
          <div class="hw-formula-box">
            <div class="hw-formula">${esc(f.formula || '')}</div>
            ${f.meaning ? `<div class="hw-formula-meaning">${esc(f.meaning)}</div>` : ''}
            ${f.example ? `<div class="hw-formula-meaning">Example: ${esc(f.example)}</div>` : ''}
          </div>
        `;
      });
      el.innerHTML = html;
      sections.push(el);
    }

    // Steps
    if (notes.steps && notes.steps.length > 0) {
      const el = createElement('div', 'hw-section');
      el.innerHTML = `
        <div class="hw-section-heading"><span class="hw-section-icon">🔄</span> Process / Steps</div>
        <ol class="hw-bullet-list" style="list-style:none">
          ${notes.steps.map((s, i) => {
            const text = typeof s === 'string' ? s : s.step || s.text || '';
            return `<li style="padding-left:28px"><span style="position:absolute;left:0;font-weight:700">${i + 1}.</span> ${esc(text)}</li>`;
          }).join('')}
        </ol>
      `;
      sections.push(el);
    }

    // Comparisons
    if (notes.comparisons && notes.comparisons.length > 0) {
      notes.comparisons.forEach(comp => {
        const el = createElement('div', 'hw-section');
        let html = `<div class="hw-section-heading"><span class="hw-section-icon">⚖️</span> Important Comparison</div>`;
        html += `<table class="hw-comparison-table">
          <tr><th>${esc(comp.itemA || 'A')}</th><th>${esc(comp.itemB || 'B')}</th></tr>`;
        if (comp.differences) {
          comp.differences.forEach(d => {
            html += `<tr><td>${esc(d.a || '')}</td><td>${esc(d.b || '')}</td></tr>`;
          });
        }
        html += '</table>';
        el.innerHTML = html;
        sections.push(el);
      });
    }

    // Advantages / Disadvantages
    if (notes.advantages && notes.advantages.length > 0) {
      const el = createElement('div', 'hw-section');
      el.innerHTML = `
        <div class="hw-section-heading"><span class="hw-section-icon">✅</span> Advantages</div>
        <ul class="hw-bullet-list">
          ${notes.advantages.map(a => `<li>${esc(a)}</li>`).join('')}
        </ul>
      `;
      sections.push(el);
    }

    if (notes.disadvantages && notes.disadvantages.length > 0) {
      const el = createElement('div', 'hw-section');
      el.innerHTML = `
        <div class="hw-section-heading"><span class="hw-section-icon">❌</span> Disadvantages</div>
        <ul class="hw-bullet-list">
          ${notes.disadvantages.map(d => `<li>${esc(d)}</li>`).join('')}
        </ul>
      `;
      sections.push(el);
    }

    // Remember
    if (notes.remember) {
      const el = createElement('div', 'hw-section');
      el.innerHTML = `
        <div class="hw-section-heading"><span class="hw-section-icon">⭐</span> Must Remember</div>
        <div class="hw-remember-box">
          <div class="hw-text">${esc(notes.remember)}</div>
        </div>
      `;
      sections.push(el);
    }

    // Quick Revision
    if (notes.revision && notes.revision.length > 0) {
      const el = createElement('div', 'hw-section');
      el.innerHTML = `
        <div class="hw-section-heading"><span class="hw-section-icon">🎯</span> Quick Revision</div>
        <div class="hw-sticky blue">
          <ul class="hw-bullet-list">
            ${notes.revision.map(r => `<li>${esc(typeof r === 'string' ? r : r.text || '')}</li>`).join('')}
          </ul>
        </div>
      `;
      sections.push(el);
    }

    // Questions (Quiz)
    if (notes.questions && notes.questions.length > 0) {
      const el = createElement('div', 'hw-section hw-quiz-section');
      let html = `<div class="hw-section-heading"><span class="hw-section-icon">🎯</span> Exam / Viva Questions</div>`;
      notes.questions.forEach((q, idx) => {
        const qId = `quiz-${idx}`;
        html += `
          <div class="hw-question">
            <div class="hw-question-type">${esc(q.type || 'SHORT')}</div>
            <div class="hw-question-text">Q${idx + 1}: ${esc(q.question || '')}</div>
            ${q.options ? `<div class="hw-text" style="margin-top:4px">${q.options.map((o, oi) =>
              `<br>${String.fromCharCode(65 + oi)}) ${esc(o)}`
            ).join('')}</div>` : ''}
            <button class="hw-show-answer" onclick="document.getElementById('${qId}').classList.toggle('visible')">
              Reveal Answer
            </button>
            <div class="hw-answer" id="${qId}">${esc(q.answer || '')}</div>
          </div>
        `;
      });
      el.innerHTML = html;
      sections.push(el);
    }

    return sections;
  }

  function paginateSections(sections) {
    if (sections.length === 0) return [[]];

    const pages = [];
    const SECTIONS_PER_PAGE = 5;
    let current = [];

    sections.forEach((section, idx) => {
      current.push(section);
      if (current.length >= SECTIONS_PER_PAGE && idx < sections.length - 1) {
        pages.push(current);
        current = [];
      }
    });

    if (current.length > 0) pages.push(current);
    return pages;
  }

  function createElement(tag, className) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    return el;
  }

  function createTextSection(icon, heading, text) {
    const el = createElement('div', 'hw-section');
    el.innerHTML = `
      <div class="hw-section-heading"><span class="hw-section-icon">${icon}</span> ${esc(heading)}</div>
      <div class="hw-text">${esc(text)}</div>
    `;
    return el;
  }

  function esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ============================================================
  // EXPORT
  // ============================================================
  function handleExport() {
    const format = els.exportSelect.value;
    if (!format) return;
    els.exportSelect.value = ''; // Reset

    switch (format) {
      case 'print': window.print(); break;
      case 'html': exportHTML(); break;
      case 'markdown': exportMarkdown(); break;
      case 'text': exportText(); break;
    }
  }

  function exportHTML() {
    const html = els.notebookContainer.innerHTML;
    const fullHTML = `<!DOCTYPE html><html><head>
      <meta charset="UTF-8">
      <title>${esc(els.notesTitle.textContent)}</title>
      <link href="https://fonts.googleapis.com/css2?family=Kalam:wght@300;400;700&family=Patrick+Hand&family=Caveat:wght@400;500;600;700&family=Permanent+Marker&display=swap" rel="stylesheet">
      <style>${getNotebookCSS()}</style>
    </head><body>${html}</body></html>`;
    downloadFile(`${els.notesTitle.textContent || 'notes'}.html`, fullHTML, 'text/html');
  }

  function exportMarkdown() {
    const pages = els.notebookContainer.querySelectorAll('.notebook-page');
    let md = `# ${els.notesTitle.textContent}\n\n`;

    pages.forEach(page => {
      const sections = page.querySelectorAll('.hw-section');
      sections.forEach(sec => {
        const heading = sec.querySelector('.hw-section-heading');
        if (heading) md += `## ${heading.textContent.trim()}\n\n`;

        const text = sec.querySelector('.hw-text');
        if (text) md += `${text.textContent.trim()}\n\n`;

        const list = sec.querySelector('.hw-bullet-list');
        if (list) {
          list.querySelectorAll('li').forEach(li => {
            md += `- ${li.textContent.trim()}\n`;
          });
          md += '\n';
        }

        const defs = sec.querySelectorAll('.hw-def-box');
        defs.forEach(d => {
          const term = d.querySelector('.hw-def-term');
          const defText = d.querySelector('.hw-def-text');
          if (term && defText) md += `**${term.textContent.trim()}**: ${defText.textContent.trim()}\n\n`;
        });

        const diagram = sec.querySelector('.hw-diagram-content');
        if (diagram) md += `\`\`\`\n${diagram.textContent}\n\`\`\`\n\n`;

        const code = sec.querySelector('.hw-code-box');
        if (code) md += `\`\`\`\n${code.textContent}\n\`\`\`\n\n`;
      });
      md += '---\n\n';
    });

    downloadFile(`${els.notesTitle.textContent || 'notes'}.md`, md, 'text/markdown');
  }

  function exportText() {
    const pages = els.notebookContainer.querySelectorAll('.notebook-page');
    let txt = `${els.notesTitle.textContent}\n${'='.repeat(40)}\n\n`;

    pages.forEach(page => {
      txt += page.textContent.replace(/\s+/g, ' ').replace(/Reveal Answer/g, '\n[Answer hidden]\n') + '\n\n---\n\n';
    });

    downloadFile(`${els.notesTitle.textContent || 'notes'}.txt`, txt, 'text/plain');
  }

  function downloadFile(filename, content, type) {
    const blob = new Blob([content], { type: `${type};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename.replace(/[<>:"/\\|?*]/g, '_');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function getNotebookCSS() {
    // Return essential notebook CSS for standalone HTML export
    return `
      body { margin: 20px; background: #f0f0f0; }
      .notebook-page {
        max-width: 800px; margin: 20px auto; padding: 50px 50px 50px 85px;
        background: #fdf8f0; font-family: 'Kalam', cursive; font-size: 18px;
        line-height: 32px; color: #1a3a8a; box-shadow: 2px 4px 20px rgba(0,0,0,0.15);
        background-image: linear-gradient(#c8d8e8 1px, transparent 1px);
        background-size: 100% 32px; background-position: 0 49px; position: relative;
      }
      .notebook-page::before {
        content: ''; position: absolute; top: 0; left: 72px; width: 2px; height: 100%;
        background: #f0a0a0;
      }
      .hw-title { font-family: 'Permanent Marker', cursive; font-size: 28px; }
      .hw-section { margin-bottom: 20px; }
      .hw-section-heading { font-family: 'Permanent Marker', cursive; font-size: 20px; }
      .hw-bullet-list { list-style: none; padding: 0; }
      .hw-bullet-list li { padding-left: 24px; position: relative; }
      .hw-bullet-list li::before { content: '→'; position: absolute; left: 0; }
      .hw-def-box { border: 2px solid currentColor; border-radius: 6px; padding: 10px 14px; margin: 8px 0; }
      .hw-def-term { font-family: 'Permanent Marker', cursive; font-size: 17px; }
      .hw-diagram-box { border: 2px solid currentColor; border-radius: 8px; padding: 16px; margin: 12px 0; text-align: center; }
      .hw-diagram-content { font-family: monospace; font-size: 14px; white-space: pre; }
      .hw-formula-box { border: 2px dashed currentColor; border-radius: 8px; padding: 12px; margin: 8px 0; text-align: center; }
      .hw-remember-box { background: rgba(255,255,100,0.15); border-left: 4px solid #d35400; padding: 12px; margin: 12px 0; }
      .hw-highlight { background: rgba(255,255,100,0.35); padding: 1px 4px; border-radius: 3px; }
      .hw-sticky { background: #bbdefb; padding: 14px 18px; margin: 12px 0; box-shadow: 2px 3px 8px rgba(0,0,0,0.1); }
      .hw-question { border: 1px solid currentColor; border-radius: 6px; padding: 10px 14px; margin: 12px 0; }
      .hw-code-box { background: rgba(0,0,0,0.04); border: 1px solid rgba(0,0,0,0.12); border-radius: 6px; padding: 12px; font-family: monospace; font-size: 14px; white-space: pre-wrap; }
      .hw-comparison-table { width: 100%; border-collapse: collapse; margin: 10px 0; }
      .hw-comparison-table th, .hw-comparison-table td { border: 2px solid currentColor; padding: 8px 12px; }
      .page-number { text-align: right; font-size: 14px; color: #aaa; margin-top: 20px; }
    `;
  }

  // ============================================================
  // HISTORY
  // ============================================================
  async function loadHistory() {
    try {
      const resp = await fetch('/api/history');
      const history = await resp.json();
      renderHistory(history);
    } catch (e) {
      els.historyList.innerHTML = '<p class="empty-state">Failed to load history.</p>';
    }
  }

  function renderHistory(history) {
    if (!history || history.length === 0) {
      els.historyList.innerHTML = '<p class="empty-state">No notes yet. Generate your first notes!</p>';
      return;
    }

    els.historyList.innerHTML = history.map(item => `
      <div class="history-card" data-id="${esc(item.id)}">
        ${item.thumbnail ? `<img class="history-thumb" src="${esc(item.thumbnail)}" alt="" loading="lazy">` : '<div class="history-thumb"></div>'}
        <div class="history-info">
          <div class="history-title">${esc(item.title)}</div>
          <div class="history-meta">
            ${item.channel ? esc(item.channel) + ' · ' : ''}
            ${item.durationStr || ''}
            ${item.createdAt ? ' · ' + new Date(item.createdAt).toLocaleDateString() : ''}
          </div>
          <div class="history-actions">
            <button class="btn btn-secondary btn-small history-open" data-id="${esc(item.id)}">Open</button>
            <button class="btn btn-danger btn-small history-delete" data-id="${esc(item.id)}">Delete</button>
          </div>
        </div>
      </div>
    `).join('');

    // Bind history actions
    els.historyList.querySelectorAll('.history-open').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openHistoryNote(btn.dataset.id);
      });
    });

    els.historyList.querySelectorAll('.history-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteHistoryNote(btn.dataset.id);
      });
    });

    els.historyList.querySelectorAll('.history-card').forEach(card => {
      card.addEventListener('click', () => {
        openHistoryNote(card.dataset.id);
      });
    });
  }

  async function openHistoryNote(id) {
    try {
      const resp = await fetch(`/api/notes/${id}`);
      if (!resp.ok) { alert('Notes not found'); return; }
      const notes = await resp.json();
      renderNotes(notes);
      showView('notes');
    } catch (e) {
      alert('Failed to load notes: ' + e.message);
    }
  }

  async function deleteHistoryNote(id) {
    if (!confirm('Delete these notes?')) return;
    try {
      await fetch(`/api/history/${id}`, { method: 'DELETE' });
      loadHistory();
    } catch {}
  }

  // ============================================================
  // SYSTEM STATUS
  // ============================================================
  async function loadSystemStatus() {
    els.systemChecks.innerHTML = '<div class="system-loading">Checking system...</div>';
    try {
      const resp = await fetch('/api/system-check');
      const check = await resp.json();
      renderSystemStatus(check);
    } catch (e) {
      els.systemChecks.innerHTML = '<p class="empty-state">Failed to check system status.</p>';
    }
  }

  function renderSystemStatus(check) {
    const items = [
      { name: 'Node.js', data: check.node, required: true },
      { name: 'Python', data: check.python, required: true },
      { name: 'yt-dlp', data: check.ytDlp, required: true },
      { name: 'FFmpeg', data: check.ffmpeg, required: true },
      { name: 'Whisper', data: check.whisper, required: true },
      { name: 'Ollama', data: check.ollama, required: false },
    ];

    els.systemChecks.innerHTML = items.map(item => {
      const ok = item.data?.available;
      const statusClass = ok ? 'ok' : (item.required ? 'fail' : 'optional');
      const icon = ok ? '✓' : (item.required ? '✗' : '○');
      const detail = item.data?.version || (ok ? 'Available' : (item.required ? 'Not found' : 'Optional'));

      return `
        <div class="system-check-item">
          <div class="check-status ${statusClass}">${icon}</div>
          <div>
            <div class="check-name">${item.name}</div>
            <div class="check-detail">${detail}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  // ============================================================
  // INIT
  // ============================================================
  document.addEventListener('DOMContentLoaded', init);

})();
