// backend/diagrams.mjs — Concept category detection and diagram generation
// Generates SVG/text diagrams based on detected lecture topic

/**
 * Detect the concept category from notes content
 */
export function detectCategory(text) {
  const lower = (text || '').toLowerCase();

  const categories = [
    { name: 'DATA_STRUCTURE', keywords: ['tree', 'binary tree', 'linked list', 'array', 'stack', 'queue', 'heap', 'graph', 'hash', 'trie', 'bst', 'avl', 'b-tree', 'red-black'] },
    { name: 'ALGORITHM', keywords: ['sorting', 'searching', 'algorithm', 'complexity', 'big o', 'recursion', 'dynamic programming', 'greedy', 'divide and conquer', 'backtracking', 'bfs', 'dfs', 'dijkstra'] },
    { name: 'MACHINE_LEARNING', keywords: ['machine learning', 'neural network', 'deep learning', 'training', 'model', 'classification', 'regression', 'clustering', 'supervised', 'unsupervised', 'gradient descent', 'epoch', 'loss function', 'cnn', 'rnn', 'transformer'] },
    { name: 'NETWORKING', keywords: ['tcp', 'udp', 'http', 'ip address', 'dns', 'osi model', 'router', 'switch', 'protocol', 'packet', 'firewall', 'subnet', 'bandwidth', 'latency'] },
    { name: 'DATABASE', keywords: ['database', 'sql', 'nosql', 'table', 'query', 'index', 'normalization', 'join', 'primary key', 'foreign key', 'acid', 'transaction', 'schema', 'er diagram'] },
    { name: 'PROGRAMMING', keywords: ['function', 'variable', 'loop', 'class', 'object', 'inheritance', 'polymorphism', 'encapsulation', 'method', 'constructor', 'interface', 'abstract'] },
    { name: 'MATHEMATICS', keywords: ['equation', 'formula', 'derivative', 'integral', 'matrix', 'vector', 'probability', 'statistics', 'theorem', 'proof', 'calculus', 'algebra', 'trigonometry'] },
    { name: 'PHYSICS', keywords: ['force', 'energy', 'velocity', 'acceleration', 'momentum', 'gravity', 'electro', 'magnetic', 'wave', 'thermodynamics', 'quantum', 'relativity'] },
    { name: 'CHEMISTRY', keywords: ['molecule', 'atom', 'reaction', 'bond', 'element', 'compound', 'acid', 'base', 'oxidation', 'organic', 'inorganic', 'periodic table'] },
    { name: 'OPERATING_SYSTEM', keywords: ['process', 'thread', 'deadlock', 'semaphore', 'mutex', 'scheduling', 'memory management', 'virtual memory', 'paging', 'segmentation', 'file system'] },
  ];

  let best = { name: 'GENERAL', score: 0 };
  for (const cat of categories) {
    let score = 0;
    for (const kw of cat.keywords) {
      const regex = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
      const matches = lower.match(regex);
      if (matches) score += matches.length;
    }
    if (score > best.score) {
      best = { name: cat.name, score };
    }
  }

  return best.name;
}

/**
 * Generate a text-based diagram for a given category and notes
 */
export function generateDiagram(category, notes) {
  const title = notes.title || '';
  const keyPoints = notes.keyPoints || [];
  const definitions = notes.definitions || [];
  const steps = notes.steps || [];

  switch (category) {
    case 'DATA_STRUCTURE':
      return generateDataStructureDiagram(title, keyPoints, definitions);
    case 'ALGORITHM':
      return generateAlgorithmDiagram(title, steps, keyPoints);
    case 'MACHINE_LEARNING':
      return generateMLDiagram(title, keyPoints, steps);
    case 'NETWORKING':
      return generateNetworkingDiagram(title, keyPoints);
    case 'DATABASE':
      return generateDatabaseDiagram(title, keyPoints, definitions);
    case 'PROGRAMMING':
      return generateProgrammingDiagram(title, keyPoints, definitions);
    case 'MATHEMATICS':
      return generateMathDiagram(title, keyPoints, notes.formulas || []);
    case 'PHYSICS':
      return generatePhysicsDiagram(title, keyPoints, notes.formulas || []);
    case 'OPERATING_SYSTEM':
      return generateOSDiagram(title, keyPoints, steps);
    default:
      return generateGeneralDiagram(title, keyPoints, steps);
  }
}

function generateDataStructureDiagram(title, keyPoints, definitions) {
  const lower = title.toLowerCase();
  if (lower.includes('binary tree') || lower.includes('bst')) {
    return {
      type: 'tree',
      title: 'Binary Tree Structure',
      content: `        [Root]\n       /      \\\n    [Left]   [Right]\n    /   \\     /   \\\n  [L1] [L2] [R1] [R2]`,
      labels: ['Each node has at most 2 children', 'Left subtree ≤ Root ≤ Right subtree (BST)']
    };
  }
  if (lower.includes('linked list')) {
    return {
      type: 'flow',
      title: 'Linked List',
      content: `[Head] → [Node 1] → [Node 2] → [Node 3] → NULL\n  │         │          │          │\n data     data       data       data\n next →   next →    next →    next → ∅`,
      labels: ['Each node contains data and a pointer to next node']
    };
  }
  if (lower.includes('stack')) {
    return {
      type: 'stack',
      title: 'Stack (LIFO)',
      content: `  ┌─────────┐\n  │  TOP →  │ ← Push / Pop\n  ├─────────┤\n  │ Item 3  │\n  ├─────────┤\n  │ Item 2  │\n  ├─────────┤\n  │ Item 1  │\n  └─────────┘`,
      labels: ['Last In, First Out (LIFO)', 'Operations: push(), pop(), peek()']
    };
  }
  if (lower.includes('queue')) {
    return {
      type: 'queue',
      title: 'Queue (FIFO)',
      content: `Enqueue →  ┌──┬──┬──┬──┐  → Dequeue\n           │A │B │C │D │\n           └──┴──┴──┴──┘\n         Rear          Front`,
      labels: ['First In, First Out (FIFO)', 'Operations: enqueue(), dequeue(), front()']
    };
  }
  // Default data structure diagram
  return {
    type: 'concept',
    title: title || 'Data Structure',
    content: `  ┌─────────────┐\n  │  Structure  │\n  └──────┬──────┘\n    ┌────┴────┐\n    ▼         ▼\n┌──────┐ ┌──────┐\n│ Data │ │ Ops  │\n└──────┘ └──────┘`,
    labels: keyPoints.slice(0, 3).map(k => typeof k === 'string' ? k : k.point || '')
  };
}

function generateAlgorithmDiagram(title, steps, keyPoints) {
  if (steps.length > 0) {
    const stepTexts = steps.slice(0, 5).map((s, i) =>
      typeof s === 'string' ? s : s.step || s.text || `Step ${i + 1}`
    );
    let diagram = '  ┌─ START ─┐\n       │\n';
    stepTexts.forEach((step, i) => {
      const short = step.substring(0, 30);
      diagram += `       ▼\n  ┌─────────────────────────────────┐\n  │ ${(i + 1)}. ${short.padEnd(29)}│\n  └─────────────────────────────────┘\n`;
    });
    diagram += '       ▼\n   ┌─ END ─┐';
    return { type: 'flowchart', title: title || 'Algorithm', content: diagram, labels: [] };
  }
  return {
    type: 'flowchart',
    title: title || 'Algorithm',
    content: `  ┌─ INPUT ─┐\n       │\n       ▼\n  ┌─────────┐\n  │ PROCESS │\n  └────┬────┘\n       │\n   ┌───┴───┐\n   │ CHECK │\n   └───┬───┘\n      / \\\n    YES  NO\n     │    │\n    OUT  RETRY`,
    labels: keyPoints.slice(0, 2).map(k => typeof k === 'string' ? k : k.point || '')
  };
}

function generateMLDiagram(title, keyPoints, steps) {
  return {
    type: 'pipeline',
    title: title || 'ML Pipeline',
    content: `  ┌──────┐   ┌───────┐   ┌───────┐   ┌───────┐   ┌─────────┐\n  │ DATA │ → │ CLEAN │ → │ TRAIN │ → │ MODEL │ → │ PREDICT │\n  └──────┘   └───────┘   └───────┘   └───────┘   └─────────┘\n                │                        │\n           ┌────┴────┐              ┌────┴────┐\n           │Features │              │Evaluate │\n           │Selection│              │ & Tune  │\n           └─────────┘              └─────────┘`,
    labels: keyPoints.slice(0, 3).map(k => typeof k === 'string' ? k : k.point || '')
  };
}

function generateNetworkingDiagram(title, keyPoints) {
  return {
    type: 'layers',
    title: title || 'Network Model',
    content: `  ┌───────────────────┐\n  │   Application     │  ← HTTP, DNS, FTP\n  ├───────────────────┤\n  │   Transport       │  ← TCP, UDP\n  ├───────────────────┤\n  │   Network         │  ← IP, Routing\n  ├───────────────────┤\n  │   Data Link       │  ← MAC, Ethernet\n  ├───────────────────┤\n  │   Physical        │  ← Cables, Signals\n  └───────────────────┘`,
    labels: keyPoints.slice(0, 2).map(k => typeof k === 'string' ? k : k.point || '')
  };
}

function generateDatabaseDiagram(title, keyPoints, definitions) {
  return {
    type: 'schema',
    title: title || 'Database',
    content: `  ┌─────────────┐     ┌─────────────┐\n  │   Table A   │     │   Table B   │\n  ├─────────────┤     ├─────────────┤\n  │ PK id       │──┐  │ PK id       │\n  │    name     │  └─→│ FK a_id     │\n  │    value    │     │    data     │\n  └─────────────┘     └─────────────┘`,
    labels: keyPoints.slice(0, 2).map(k => typeof k === 'string' ? k : k.point || '')
  };
}

function generateProgrammingDiagram(title, keyPoints, definitions) {
  return {
    type: 'concept',
    title: title || 'Programming Concept',
    content: `  ┌──────────────────┐\n  │     Concept      │\n  └────────┬─────────┘\n      ┌────┼────┐\n      ▼    ▼    ▼\n  ┌─────┐┌────┐┌──────┐\n  │Props││Meth││Events│\n  └─────┘└────┘└──────┘`,
    labels: keyPoints.slice(0, 3).map(k => typeof k === 'string' ? k : k.point || '')
  };
}

function generateMathDiagram(title, keyPoints, formulas) {
  const formulaTexts = formulas.slice(0, 3).map(f =>
    typeof f === 'string' ? f : f.formula || f.expression || ''
  );
  return {
    type: 'formula',
    title: title || 'Mathematical Concept',
    content: formulaTexts.length > 0
      ? formulaTexts.map(f => `  ▸ ${f}`).join('\n')
      : '  f(x) = ...\n  Apply → Simplify → Solve',
    labels: keyPoints.slice(0, 2).map(k => typeof k === 'string' ? k : k.point || '')
  };
}

function generatePhysicsDiagram(title, keyPoints, formulas) {
  return generateMathDiagram(title, keyPoints, formulas);
}

function generateOSDiagram(title, keyPoints, steps) {
  return {
    type: 'process',
    title: title || 'OS Concept',
    content: `  ┌─────────┐   ┌─────────┐   ┌──────────┐\n  │  NEW    │ → │  READY  │ → │ RUNNING  │\n  └─────────┘   └────┬────┘   └────┬─────┘\n                     │              │\n                     ▼              ▼\n                ┌─────────┐  ┌──────────┐\n                │ WAITING │  │TERMINATED│\n                └─────────┘  └──────────┘`,
    labels: keyPoints.slice(0, 2).map(k => typeof k === 'string' ? k : k.point || '')
  };
}

function generateGeneralDiagram(title, keyPoints, steps) {
  if (steps.length > 0) {
    return generateAlgorithmDiagram(title, steps, keyPoints);
  }
  if (keyPoints.length >= 3) {
    const items = keyPoints.slice(0, 4).map(k =>
      typeof k === 'string' ? k.substring(0, 20) : (k.point || '').substring(0, 20)
    );
    return {
      type: 'concept_map',
      title: title || 'Overview',
      content: `         ┌─────────────┐\n         │   ${(title || 'Topic').substring(0, 10).padEnd(10)}│\n         └──────┬──────┘\n           ┌────┼────┐\n           ▼    ▼    ▼\n        ${items.map(i => `[${i}]`).join(' ')}`,
      labels: []
    };
  }
  return {
    type: 'simple',
    title: title || 'Concept',
    content: `  ┌──────────┐\n  │ CONCEPT  │\n  └─────┬────┘\n        │\n    ┌───┴───┐\n    │ APPLY │\n    └───────┘`,
    labels: keyPoints.slice(0, 2).map(k => typeof k === 'string' ? k : k.point || '')
  };
}
