const express = require('express');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const app = express();
const PORT = 3000;
const DOCS_DIR = path.join(__dirname, 'docs');

app.use(express.static(path.join(__dirname, 'public')));

// Serve marked.js from node_modules
app.get('/lib/marked.min.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'node_modules', 'marked', 'marked.min.js'));
});

// Recursively find all .md files in docs/
function findMarkdownFiles(dir, base = '') {
  let results = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const relative = path.join(base, entry.name);
    if (entry.isDirectory() && entry.name !== '.translated') {
      results = results.concat(findMarkdownFiles(path.join(dir, entry.name), relative));
    } else if (entry.name.endsWith('.md')) {
      results.push(relative);
    }
  }
  return results.sort();
}

// GET /api/files — list all markdown files
app.get('/api/files', (req, res) => {
  const files = findMarkdownFiles(DOCS_DIR);
  res.json(files);
});

// GET /api/file?path=<relative-path> — return raw markdown
app.get('/api/file', (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'Missing path parameter' });

  // Prevent directory traversal
  const resolved = path.resolve(DOCS_DIR, filePath);
  if (!resolved.startsWith(DOCS_DIR + path.sep) && resolved !== DOCS_DIR) {
    return res.status(403).json({ error: 'Access denied' });
  }

  if (!fs.existsSync(resolved) || !resolved.endsWith('.md')) {
    return res.status(404).json({ error: 'File not found' });
  }

  const content = fs.readFileSync(resolved, 'utf-8');
  res.type('text/plain').send(content);
});

// GET /api/search?q=<query> — full-text search across all markdown files
app.get('/api/search', (req, res) => {
  const query = (req.query.q || '').toLowerCase().trim();
  if (!query || query.length < 2) return res.json([]);

  const files = findMarkdownFiles(DOCS_DIR);
  const results = [];

  for (const file of files) {
    const resolved = path.join(DOCS_DIR, file);
    const content = fs.readFileSync(resolved, 'utf-8');
    const lines = content.split('\n');
    const matches = [];

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(query)) {
        matches.push({ line: i + 1, text: lines[i].trim().substring(0, 120) });
        if (matches.length >= 3) break;
      }
    }

    if (matches.length > 0) {
      results.push({ path: file, matches });
      if (results.length >= 20) break;
    }
  }

  res.json(results);
});

// Translation cache directory
const TRANSLATED_DIR = path.join(__dirname, 'docs', '.translated');

// GET /api/translation?path=<relative-path> — return cached translation if exists
app.get('/api/translation', (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'Missing path' });

  const resolved = path.resolve(TRANSLATED_DIR, filePath);
  if (!resolved.startsWith(TRANSLATED_DIR + path.sep) && resolved !== TRANSLATED_DIR) {
    return res.status(403).json({ error: 'Access denied' });
  }

  if (!fs.existsSync(resolved)) {
    return res.json({ cached: false });
  }

  const translated = fs.readFileSync(resolved, 'utf-8');
  res.json({ cached: true, translated });
});

// POST /api/translate — translate via Claude CLI, cache to disk
app.use(express.json({ limit: '1mb' }));

app.post('/api/translate', (req, res) => {
  const filePath = req.body.path;
  if (!filePath) return res.status(400).json({ error: 'Missing path' });

  // Validate path
  const sourceFile = path.resolve(DOCS_DIR, filePath);
  if (!sourceFile.startsWith(DOCS_DIR + path.sep) || !sourceFile.endsWith('.md')) {
    return res.status(403).json({ error: 'Access denied' });
  }
  if (!fs.existsSync(sourceFile)) {
    return res.status(404).json({ error: 'File not found' });
  }

  // Check for cached translation on disk
  const cachedFile = path.join(TRANSLATED_DIR, filePath);
  if (fs.existsSync(cachedFile)) {
    const translated = fs.readFileSync(cachedFile, 'utf-8');
    return res.json({ translated });
  }

  const markdown = fs.readFileSync(sourceFile, 'utf-8');

  const prompt = `Translate the following markdown document to English. Rules:
- Preserve ALL markdown formatting exactly (headings, code blocks, tables, links, bold, italic, lists, etc.)
- Do NOT translate text inside code blocks or inline code
- Do NOT add any explanation, commentary, or wrapping — output ONLY the translated markdown
- If the content is already in English, return it unchanged

${markdown}`;

  execFile('claude', ['-p', '--output-format', 'text'], {
    timeout: 120000,
    maxBuffer: 5 * 1024 * 1024,
    env: { ...process.env, PATH: process.env.PATH + ':/opt/homebrew/bin:/usr/local/bin' }
  }, (err, stdout, stderr) => {
    if (err) {
      console.error('Claude CLI error:', stderr || err.message);
      return res.status(500).json({ error: 'Translation failed: ' + (stderr || err.message) });
    }

    const translated = stdout.trim();

    // Cache to disk
    const cachedDir = path.dirname(cachedFile);
    fs.mkdirSync(cachedDir, { recursive: true });
    fs.writeFileSync(cachedFile, translated, 'utf-8');

    res.json({ translated });
  }).stdin.end(prompt);
});

// Catch-all: serve index.html for any non-API path so the SPA can handle deep links
// (e.g. /Zoom_vs_Botim_Metrics_Comparison.md)
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api/') && !req.path.startsWith('/lib/')) {
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
  next();
});

app.listen(PORT, () => {
  console.log(`Readme Viewer running at http://localhost:${PORT}`);
});
