document.addEventListener('DOMContentLoaded', init);

// ── Configure marked to generate heading IDs (GitHub-style slugs) ──

function githubSlug(html) {
  var text = html.replace(/<[^>]*>/g, '');
  var el = document.createElement('textarea');
  el.innerHTML = text;
  text = el.value;
  return text.toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s/g, '-');
}

var renderer = new marked.Renderer();
renderer.heading = function ({ text, depth }) {
  var html = marked.parseInline(text);
  var id = githubSlug(html);
  return '<h' + depth + ' id="' + id + '">' + html + '</h' + depth + '>';
};
var _defaultCode = renderer.code.bind(renderer);
renderer.code = function (token) {
  if (token.lang === 'mermaid') {
    return '<pre class="mermaid">' + token.text + '</pre>';
  }
  return _defaultCode(token);
};
marked.use({ renderer });

// Initialize mermaid
function getMermaidConfig() {
  var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  if (isDark) {
    return {
      startOnLoad: false,
      theme: 'base',
      themeVariables: {
        background: '#1e2028',
        primaryColor: '#2a2d37',
        primaryTextColor: '#e4e6eb',
        primaryBorderColor: '#3a3d47',
        secondaryColor: '#272a33',
        secondaryTextColor: '#e4e6eb',
        secondaryBorderColor: '#3a3d47',
        tertiaryColor: '#1e2028',
        tertiaryTextColor: '#e4e6eb',
        tertiaryBorderColor: '#3a3d47',
        lineColor: '#6b7280',
        textColor: '#e4e6eb',
        mainBkg: '#2a2d37',
        nodeBorder: '#3a3d47',
        clusterBkg: '#272a33',
        clusterBorder: '#3a3d47',
        titleColor: '#e4e6eb',
        edgeLabelBackground: '#272a33',
        nodeTextColor: '#e4e6eb',
        actorTextColor: '#e4e6eb',
        actorBkg: '#2a2d37',
        actorBorder: '#3a3d47',
        actorLineColor: '#6b7280',
        signalColor: '#e4e6eb',
        signalTextColor: '#e4e6eb',
        labelBoxBkgColor: '#272a33',
        labelBoxBorderColor: '#3a3d47',
        labelTextColor: '#e4e6eb',
        loopTextColor: '#e4e6eb',
        noteBkgColor: '#2a2d37',
        noteBorderColor: '#3a3d47',
        noteTextColor: '#e4e6eb',
        fontFamily: 'inherit'
      }
    };
  }
  return { startOnLoad: false, theme: 'default', themeVariables: { fontFamily: 'inherit' } };
}
mermaid.initialize(getMermaidConfig());

async function reRenderMermaid() {
  var contentEl = document.getElementById('content');
  if (!contentEl || !currentMarkdown) return;
  var mermaidEls = contentEl.querySelectorAll('pre.mermaid');
  if (mermaidEls.length === 0) return;
  // Re-render the full markdown to get fresh mermaid elements
  await renderMarkdown(contentEl, currentMarkdown);
}

async function renderMarkdown(targetEl, markdown) {
  targetEl.innerHTML = marked.parse(markdown);
  // Render any mermaid diagrams
  var mermaidEls = targetEl.querySelectorAll('pre.mermaid');
  if (mermaidEls.length > 0) {
    mermaid.initialize(getMermaidConfig());
    await mermaid.run({ nodes: mermaidEls });
  }
  buildToc(targetEl);
}

let allFiles = [];
let currentMarkdown = '';
let currentFilePath = '';

// File System Access API state
let rootDirHandle = null;
let fileHandles = new Map(); // relative path → FileSystemFileHandle
let folderName = '';

// Files opened via PWA file handler (kept for the current session)
let openedFiles = new Map(); // file name → { handle, content }
let pendingLaunchedFile = null;
let onFileLaunched = null;

// Register file-handler launch consumer as early as possible so we don't
// miss a launch that fires before init() is reached.
if ('launchQueue' in window) {
  window.launchQueue.setConsumer((launchParams) => {
    if (!launchParams || !launchParams.files || !launchParams.files.length) return;
    var handle = launchParams.files[0];
    if (onFileLaunched) {
      onFileLaunched(handle);
    } else {
      pendingLaunchedFile = handle;
    }
  });
}

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.cache', '.translated', '.next',
  'dist', 'build', '.idea', '.vscode', '.svelte-kit', 'out',
  '.turbo', 'coverage', '.nuxt', 'target'
]);

// ── IndexedDB persistence for directory handle ──

const IDB_NAME = 'readmeViewer';
const IDB_STORE = 'handles';

function idbOpen() {
  return new Promise((resolve, reject) => {
    var req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = function () {
      req.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(req.error); };
  });
}

async function idbSet(key, value) {
  var db = await idbOpen();
  return new Promise((resolve, reject) => {
    var tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = resolve;
    tx.onerror = function () { reject(tx.error); };
  });
}

async function idbGet(key) {
  var db = await idbOpen();
  return new Promise((resolve, reject) => {
    var tx = db.transaction(IDB_STORE, 'readonly');
    var req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(req.error); };
  });
}

async function idbDel(key) {
  var db = await idbOpen();
  return new Promise((resolve, reject) => {
    var tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(key);
    tx.oncomplete = resolve;
    tx.onerror = function () { reject(tx.error); };
  });
}

async function hasReadPermission(handle) {
  return (await handle.queryPermission({ mode: 'read' })) === 'granted';
}

async function requestReadPermission(handle) {
  // Must be called from a user-gesture handler (click, keypress).
  return (await handle.requestPermission({ mode: 'read' })) === 'granted';
}

async function scanDirectory(dirHandle, base, files, handles) {
  for await (const entry of dirHandle.values()) {
    if (entry.kind === 'directory') {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      await scanDirectory(entry, base ? base + '/' + entry.name : entry.name, files, handles);
    } else if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.md')) {
      var rel = base ? base + '/' + entry.name : entry.name;
      files.push(rel);
      handles.set(rel, entry);
    }
  }
}

async function readFileFromHandle(filePath) {
  var handle = fileHandles.get(filePath);
  if (!handle) throw new Error('File not in scanned set: ' + filePath);
  var file = await handle.getFile();
  return file.text();
}

// Resolve a .md filename from the URL path to a matching doc in allFiles
function resolveFileFromUrl() {
  var urlPath = decodeURIComponent(window.location.pathname).replace(/^\/+/, '');
  if (!urlPath || !urlPath.endsWith('.md')) return null;

  // Exact match (full relative path)
  if (allFiles.includes(urlPath)) return urlPath;

  // Match by filename only (e.g. "Botim_Call_Quality_Metrics_Inventory.md")
  var fileName = urlPath.split('/').pop();
  var match = allFiles.find(function (f) {
    return f.split('/').pop() === fileName;
  });
  return match || null;
}

// Handle browser back/forward
window.addEventListener('popstate', function () {
  var file = resolveFileFromUrl();
  if (file && file !== currentFilePath) {
    loadFile(file, true);
  }
});

async function init() {
  initTheme();
  initSearch();
  initProgress();
  initScrollButtons();
  initSidebarResize();
  initSidebarToggle();

  document.getElementById('change-folder-btn').addEventListener('click', pickAndLoadFolder);

  if (!('showDirectoryPicker' in window)) {
    showUnsupportedBrowser();
    return;
  }

  // From here on, additional file-handler launches go straight to handleLaunchedFile.
  onFileLaunched = handleLaunchedFile;

  // Try to restore previously picked folder.
  var saved = null;
  try { saved = await idbGet('rootHandle'); } catch (e) { /* ignore */ }

  var folderLoaded = false;
  if (saved && await hasReadPermission(saved)) {
    // If a file was launched too, suppress the folder's auto-open of lastFile —
    // the launched file should win.
    await loadFolder(saved, !!pendingLaunchedFile);
    folderLoaded = true;
  }

  if (pendingLaunchedFile) {
    var f = pendingLaunchedFile;
    pendingLaunchedFile = null;
    await handleLaunchedFile(f);
    return;
  }

  if (!folderLoaded) {
    if (saved) showReopenPrompt(saved);
    else showFolderPicker();
  }
}

function showReopenPrompt(handle) {
  var body = document.getElementById('markdown-body');
  var name = handle.name || 'previous folder';
  body.innerHTML =
    '<div class="empty-state folder-picker-state">' +
    '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>' +
    '</svg>' +
    '<p>Reopen <strong>' + escapeHtml(name) + '</strong>?</p>' +
    '<span>Browsers require a click to re-grant access to a previously picked folder.</span>' +
    '<button id="reopen-folder-btn" class="primary-btn">Reopen Folder</button>' +
    '<button id="pick-different-btn" class="primary-btn" style="margin-top:8px;background:transparent;color:inherit;border:1px solid currentColor;">Choose Different Folder</button>' +
    '</div>';
  document.getElementById('reopen-folder-btn').addEventListener('click', async function () {
    try {
      if (await requestReadPermission(handle)) {
        await loadFolder(handle);
      } else {
        showFolderPicker('Permission denied. Pick a folder to continue.');
      }
    } catch (e) {
      console.error(e);
      showFolderPicker('Could not reopen folder: ' + (e && e.message || 'unknown error'));
    }
  });
  document.getElementById('pick-different-btn').addEventListener('click', pickAndLoadFolder);
}

function showUnsupportedBrowser() {
  var body = document.getElementById('markdown-body');
  body.innerHTML =
    '<div class="empty-state folder-picker-state">' +
    '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">' +
      '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>' +
    '</svg>' +
    '<p>Browser not supported</p>' +
    '<span>This app needs the File System Access API. Please use Chrome, Edge, or Opera.</span>' +
    '</div>';
}

function showFolderPicker(message) {
  var body = document.getElementById('markdown-body');
  body.innerHTML =
    '<div class="empty-state folder-picker-state">' +
    '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>' +
    '</svg>' +
    '<p>Choose a folder to browse</p>' +
    '<span>' + (message || 'Pick any folder containing markdown files. Files stay on your device.') + '</span>' +
    '<button id="pick-folder-btn" class="primary-btn">Choose Folder</button>' +
    '</div>';
  document.getElementById('pick-folder-btn').addEventListener('click', pickAndLoadFolder);
}

async function pickAndLoadFolder() {
  try {
    var handle = await window.showDirectoryPicker({ mode: 'read' });
    try { await idbSet('rootHandle', handle); } catch (e) { /* not fatal */ }
    // Reset per-folder UI state
    localStorage.removeItem('lastFile');
    localStorage.removeItem('recents');
    await loadFolder(handle);
  } catch (e) {
    if (e && e.name === 'AbortError') return; // user cancelled
    console.error(e);
    showFolderPicker('Could not open folder: ' + (e && e.message || 'unknown error'));
  }
}

async function loadFolder(handle, skipAutoLoad) {
  rootDirHandle = handle;
  folderName = handle.name || 'folder';

  var body = document.getElementById('markdown-body');
  body.innerHTML = '<div class="empty-state"><p>Scanning ' + escapeHtml(folderName) + '…</p></div>';

  var files = [];
  var handles = new Map();
  try {
    await scanDirectory(handle, '', files, handles);
  } catch (e) {
    console.error(e);
    showFolderPicker('Failed to scan folder: ' + (e && e.message || 'unknown'));
    return;
  }

  files.sort();
  allFiles = files;
  fileHandles = handles;

  var nav = document.getElementById('file-list');
  nav.innerHTML = '';

  if (allFiles.length === 0) {
    body.innerHTML =
      '<div class="empty-state folder-picker-state">' +
      '<p>No markdown files found in <strong>' + escapeHtml(folderName) + '</strong></p>' +
      '<button id="pick-folder-btn" class="primary-btn">Choose Different Folder</button>' +
      '</div>';
    document.getElementById('pick-folder-btn').addEventListener('click', pickAndLoadFolder);
    document.getElementById('file-count').textContent = '0 files';
    document.getElementById('change-folder-btn').classList.remove('hidden');
    return;
  }

  document.getElementById('file-count').textContent =
    allFiles.length + ' file' + (allFiles.length !== 1 ? 's' : '') + ' · ' + folderName;
  document.getElementById('change-folder-btn').classList.remove('hidden');

  buildSidebar(allFiles);
  renderRecents();
  renderOpenedFiles();

  if (skipAutoLoad) return;

  var fileFromUrl = resolveFileFromUrl();
  if (fileFromUrl) {
    loadFile(fileFromUrl);
  } else {
    var lastFile = localStorage.getItem('lastFile');
    if (lastFile && allFiles.includes(lastFile)) {
      loadFile(lastFile);
    } else {
      loadFile(allFiles[0]);
    }
  }
}

// ── PWA file-handler launches (.md double-clicked from OS) ──

async function handleLaunchedFile(fileHandle) {
  var file, markdown;
  try {
    file = await fileHandle.getFile();
    markdown = await file.text();
  } catch (e) {
    console.error('Could not read launched file', e);
    return;
  }

  var name = file.name;

  // If the loaded folder already contains a file with this name, navigate to it.
  if (allFiles.length > 0) {
    var match = allFiles.find(function (p) { return p.split('/').pop() === name; });
    if (match) {
      loadFile(match);
      return;
    }
  }

  // External file — track it in the "Opened" sidebar section.
  openedFiles.set(name, { handle: fileHandle, content: markdown });
  renderOpenedFiles();
  await loadOpenedFile(name, markdown);
}

function renderOpenedFiles() {
  var section = document.getElementById('opened-section');
  var container = document.getElementById('opened-list');
  if (!section || !container) return;

  if (openedFiles.size === 0) {
    section.style.display = 'none';
    container.innerHTML = '';
    return;
  }

  section.style.display = '';
  container.innerHTML = '';
  openedFiles.forEach(function (_entry, name) {
    var link = document.createElement('a');
    link.className = 'file-link opened-link';
    if (name === currentFilePath) link.classList.add('active');
    link.textContent = name;
    link.dataset.tooltip = name;
    link.dataset.path = name;
    link.addEventListener('click', function () { loadOpenedFile(name); });
    container.appendChild(link);
  });
}

async function loadOpenedFile(name, prefetchedContent) {
  var entry = openedFiles.get(name);
  if (!entry) return;

  var markdown = prefetchedContent;
  if (markdown == null) {
    try {
      var f = await entry.handle.getFile();
      markdown = await f.text();
      entry.content = markdown;
    } catch (e) {
      console.error('Could not read opened file', e);
      return;
    }
  }

  // Clear active state on folder tree + recents, then mark this opened link.
  document.querySelectorAll('#file-list .file-link').forEach(function (el) {
    el.classList.remove('active');
  });
  document.querySelectorAll('.recent-link').forEach(function (el) {
    el.classList.remove('active');
  });
  document.querySelectorAll('.opened-link').forEach(function (el) {
    el.classList.toggle('active', el.dataset.path === name);
  });

  currentMarkdown = markdown;
  currentFilePath = name;

  var bc = document.getElementById('breadcrumb');
  bc.innerHTML = '<span class="breadcrumb-current">' + escapeHtml(name) + '</span>';

  var body = document.getElementById('markdown-body');
  await renderMarkdown(body, markdown);

  body.style.animation = 'none';
  body.offsetHeight;
  body.style.animation = '';

  document.querySelector('.content').scrollTop = 0;
}

// ── Theme: dark mode toggle + accent picker ──

function initTheme() {
  // Theme & accent already applied by inline <head> script to prevent flash
  var savedAccent = localStorage.getItem('accent') || 'teal';
  updateAccentActive(savedAccent);

  // Dark mode toggle
  document.getElementById('theme-toggle').addEventListener('click', () => {
    // Disable transitions so all elements switch instantly together
    document.documentElement.classList.add('no-transition');

    var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    if (isDark) {
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('theme', 'light');
    } else {
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem('theme', 'dark');
    }

    // Force browser to apply all changes, then re-enable transitions
    document.documentElement.offsetHeight;
    document.documentElement.classList.remove('no-transition');

    // Re-render mermaid diagrams with updated theme
    reRenderMermaid();
  });

  // Accent picker toggle
  var pickerBtn = document.getElementById('accent-picker-btn');
  var dropdown = document.getElementById('accent-dropdown');

  pickerBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('open');
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', () => {
    dropdown.classList.remove('open');
  });

  dropdown.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  // Accent option clicks
  document.querySelectorAll('.accent-option').forEach(btn => {
    btn.addEventListener('click', () => {
      document.documentElement.classList.add('no-transition');

      var accent = btn.dataset.accent;
      document.documentElement.setAttribute('data-accent', accent);
      localStorage.setItem('accent', accent);
      updateAccentActive(accent);
      dropdown.classList.remove('open');

      document.documentElement.offsetHeight;
      document.documentElement.classList.remove('no-transition');
    });
  });
}

function updateAccentActive(accent) {
  document.querySelectorAll('.accent-option').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.accent === accent);
  });
}

// ── Reading progress bar ──

function initProgress() {
  var contentEl = document.querySelector('.content');
  var bar = document.getElementById('progress-bar');

  contentEl.addEventListener('scroll', () => {
    var scrollTop = contentEl.scrollTop;
    var scrollHeight = contentEl.scrollHeight - contentEl.clientHeight;
    var pct = scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0;
    bar.style.width = pct + '%';
  });
}

// ── Breadcrumb ──

function updateBreadcrumb(filePath) {
  var bc = document.getElementById('breadcrumb');
  if (!filePath) { bc.innerHTML = ''; return; }

  var parts = filePath.split('/');
  var html = '<span>' + escapeHtml(folderName || 'folder') + '</span>';
  for (var i = 0; i < parts.length; i++) {
    html += '<span class="breadcrumb-sep">/</span>';
    if (i === parts.length - 1) {
      html += '<span class="breadcrumb-current">' + parts[i] + '</span>';
    } else {
      html += '<span>' + parts[i] + '</span>';
    }
  }
  bc.innerHTML = html;
}

// ── Search / filter ──

var searchMode = 'file'; // 'file' or 'text'
var searchDebounce = null;

function initSearch() {
  var input = document.getElementById('search-input');
  var modeBtn = document.getElementById('search-mode-btn');
  var resultsContainer = document.getElementById('text-search-results');

  // Toggle search mode
  modeBtn.addEventListener('click', () => {
    searchMode = searchMode === 'file' ? 'text' : 'file';
    modeBtn.classList.toggle('active', searchMode === 'text');
    input.placeholder = searchMode === 'text' ? 'Search in content...' : 'Search files...';
    input.value = '';
    resultsContainer.classList.add('hidden');
    document.getElementById('file-list').style.display = '';
    if (fileSearchContainer) {
      fileSearchContainer.remove();
      fileSearchContainer = null;
    }
    resetFileFilter();
  });

  input.addEventListener('input', () => {
    var query = input.value.trim();
    var fileList = document.getElementById('file-list');

    if (searchMode === 'file') {
      resultsContainer.classList.add('hidden');
      fileList.style.display = '';
      filterFiles(query.toLowerCase());
    } else {
      var recentsSection = document.getElementById('recents-section');
      resetFileFilter();
      if (query.length < 2) {
        resultsContainer.classList.add('hidden');
        fileList.style.display = '';
        if (recentsSection) recentsSection.style.display = '';
        return;
      }
      fileList.style.display = 'none';
      if (recentsSection) recentsSection.style.display = 'none';
      clearTimeout(searchDebounce);
      resultsContainer.classList.remove('hidden');
      resultsContainer.innerHTML = '<div class="search-loading">Searching...</div>';
      searchDebounce = setTimeout(() => textSearch(query), 300);
    }
  });
}

var fileSearchContainer = null;

function filterFiles(query) {
  var fileList = document.getElementById('file-list');
  var recentsSection = document.getElementById('recents-section');

  if (!query) {
    // No query: show tree, remove search results
    fileList.style.display = '';
    if (fileSearchContainer) {
      fileSearchContainer.remove();
      fileSearchContainer = null;
    }
    if (recentsSection) recentsSection.style.display = '';
    return;
  }

  // Hide tree and recents
  fileList.style.display = 'none';
  if (recentsSection) recentsSection.style.display = 'none';

  // Build flat filtered list
  if (!fileSearchContainer) {
    fileSearchContainer = document.createElement('div');
    fileSearchContainer.className = 'file-search-results';
    fileList.parentNode.insertBefore(fileSearchContainer, fileList);
  }

  var matches = allFiles.filter(f => {
    var name = f.split('/').pop().toLowerCase();
    return name.includes(query);
  });

  if (matches.length === 0) {
    fileSearchContainer.innerHTML = '<div class="search-no-results">No files found</div>';
    return;
  }

  var regex = new RegExp('(' + escapeRegex(query) + ')', 'gi');
  var html = '';

  matches.forEach(filePath => {
    var parts = filePath.split('/');
    var name = parts.pop();
    var dir = parts.join('/');
    var highlighted = escapeHtml(name).replace(regex, '<mark>$1</mark>');
    var isActive = filePath === currentFilePath ? ' active' : '';

    html += '<div class="file-search-item' + isActive + '" data-path="' + filePath + '">';
    html += '<div class="file-search-name">' + highlighted + '</div>';
    if (dir) html += '<div class="file-search-dir">' + escapeHtml(dir) + '</div>';
    html += '</div>';
  });

  fileSearchContainer.innerHTML = html;

  fileSearchContainer.querySelectorAll('.file-search-item').forEach(el => {
    el.addEventListener('click', () => loadFile(el.dataset.path));
  });
}

function resetFileFilter() {
  document.querySelectorAll('#file-list .file-link').forEach(el => {
    el.classList.remove('hidden');
  });
  document.querySelectorAll('.folder-group').forEach(group => {
    group.style.display = '';
  });
  var recentsSection = document.getElementById('recents-section');
  if (recentsSection) recentsSection.style.display = '';
}

var searchToken = 0;

async function textSearch(query) {
  var container = document.getElementById('text-search-results');
  var lowered = query.toLowerCase();
  var token = ++searchToken;
  var results = [];

  try {
    for (var i = 0; i < allFiles.length; i++) {
      if (token !== searchToken) return; // newer search superseded this one
      var filePath = allFiles[i];
      var content;
      try {
        content = await readFileFromHandle(filePath);
      } catch (e) { continue; }

      var lines = content.split('\n');
      var matches = [];
      for (var j = 0; j < lines.length; j++) {
        if (lines[j].toLowerCase().indexOf(lowered) !== -1) {
          matches.push({ line: j + 1, text: lines[j].trim().substring(0, 120) });
          if (matches.length >= 3) break;
        }
      }
      if (matches.length > 0) {
        results.push({ path: filePath, matches: matches });
        if (results.length >= 20) break;
      }
    }

    if (token !== searchToken) return;

    if (results.length === 0) {
      container.innerHTML = '<div class="search-no-results">No matches found</div>';
      return;
    }

    var html = '';
    results.forEach(result => {
      var fileName = result.path.split('/').pop();
      html += '<div class="search-result-item" data-path="' + result.path + '">';
      html += '<div class="search-result-file">' + fileName + '</div>';
      result.matches.forEach(m => {
        var highlighted = escapeHtml(m.text).replace(
          new RegExp('(' + escapeRegex(query) + ')', 'gi'),
          '<mark>$1</mark>'
        );
        html += '<div class="search-result-match"><span class="search-result-line">L' + m.line + '</span>' + highlighted + '</div>';
      });
      html += '</div>';
    });

    container.innerHTML = html;

    container.querySelectorAll('.search-result-item').forEach(el => {
      el.addEventListener('click', () => {
        loadFile(el.dataset.path);
      });
    });
  } catch (err) {
    console.error(err);
    container.innerHTML = '<div class="search-no-results">Search failed</div>';
  }
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Recents ──

var MAX_RECENTS = 6;

function getRecents() {
  try {
    return JSON.parse(localStorage.getItem('recents') || '[]');
  } catch (e) { return []; }
}

function addToRecents(filePath) {
  var recents = getRecents().filter(f => f !== filePath);
  recents.unshift(filePath);
  if (recents.length > MAX_RECENTS) recents = recents.slice(0, MAX_RECENTS);
  localStorage.setItem('recents', JSON.stringify(recents));
  renderRecents();
}

function renderRecents() {
  var recents = getRecents().filter(f => allFiles.includes(f));
  var container = document.getElementById('recents-list');
  var section = document.getElementById('recents-section');

  if (recents.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = '';
  container.innerHTML = '';
  recents.forEach(filePath => {
    var parts = filePath.split('/');
    var name = parts[parts.length - 1];
    var link = document.createElement('a');
    link.className = 'file-link recent-link';
    if (filePath === currentFilePath) link.classList.add('active');
    link.textContent = name;
    link.dataset.tooltip = name;
    link.dataset.path = filePath;
    link.addEventListener('click', () => loadFile(filePath));
    container.appendChild(link);
  });
}

// ── Sidebar (collapsible tree) ──

// Build a nested tree structure from flat file paths
function buildTree(files) {
  var root = { children: {}, files: [] };
  files.forEach(filePath => {
    var parts = filePath.split('/');
    var node = root;
    for (var i = 0; i < parts.length - 1; i++) {
      if (!node.children[parts[i]]) {
        node.children[parts[i]] = { children: {}, files: [] };
      }
      node = node.children[parts[i]];
    }
    node.files.push({ name: parts[parts.length - 1], path: filePath });
  });
  return root;
}

function getCollapsedState() {
  try {
    return JSON.parse(localStorage.getItem('collapsed') || '{}');
  } catch (e) { return {}; }
}

function saveCollapsedState(state) {
  localStorage.setItem('collapsed', JSON.stringify(state));
}

function buildSidebar(files) {
  var nav = document.getElementById('file-list');
  var tree = buildTree(files);
  var collapsed = getCollapsedState();

  // Render root-level files
  tree.files.forEach(file => {
    nav.appendChild(createFileLink(file));
  });

  // Render directories sorted alphabetically
  var dirs = Object.keys(tree.children).sort();
  dirs.forEach(dirName => {
    nav.appendChild(createDirNode(dirName, tree.children[dirName], dirName, collapsed));
  });
}

function createDirNode(name, node, fullPath, collapsed) {
  // Compact empty intermediate folders: if a dir has 0 files and exactly 1 subdir, merge them
  var displayName = name;
  var compactPath = fullPath;
  var current = node;
  while (current.files.length === 0 && Object.keys(current.children).length === 1) {
    var onlyChild = Object.keys(current.children)[0];
    displayName += ' / ' + onlyChild;
    compactPath += '/' + onlyChild;
    current = current.children[onlyChild];
  }
  node = current;
  fullPath = compactPath;

  var group = document.createElement('div');
  group.className = 'folder-group';
  group.dataset.folder = fullPath;

  var isCollapsed = collapsed[fullPath] === true;

  // Folder header (clickable toggle)
  var header = document.createElement('div');
  header.className = 'folder-header';
  header.dataset.tooltip = displayName;
  if (isCollapsed) header.classList.add('collapsed');

  var chevron = document.createElement('span');
  chevron.className = 'folder-chevron';
  chevron.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';

  var folderIcon = document.createElement('span');
  folderIcon.className = 'folder-icon';
  folderIcon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';

  var label = document.createElement('span');
  label.className = 'folder-label';
  label.textContent = displayName;

  var count = document.createElement('span');
  count.className = 'folder-count';
  count.textContent = countFiles(node);

  header.appendChild(chevron);
  header.appendChild(folderIcon);
  header.appendChild(label);
  header.appendChild(count);

  header.addEventListener('click', () => {
    var state = getCollapsedState();
    var nowCollapsed = !header.classList.contains('collapsed');
    header.classList.toggle('collapsed');
    content.classList.toggle('collapsed');
    if (nowCollapsed) {
      state[fullPath] = true;
    } else {
      delete state[fullPath];
    }
    saveCollapsedState(state);
  });

  group.appendChild(header);

  // Content container
  var content = document.createElement('div');
  content.className = 'folder-content';
  if (isCollapsed) content.classList.add('collapsed');

  // Files in this directory
  node.files.forEach(file => {
    content.appendChild(createFileLink(file));
  });

  // Subdirectories
  var subDirs = Object.keys(node.children).sort();
  subDirs.forEach(subName => {
    content.appendChild(createDirNode(subName, node.children[subName], fullPath + '/' + subName, collapsed));
  });

  group.appendChild(content);
  return group;
}

function createFileLink(file) {
  var link = document.createElement('a');
  link.className = 'file-link';
  link.textContent = file.name;
  link.dataset.tooltip = file.name;
  link.dataset.path = file.path;
  link.addEventListener('click', () => loadFile(file.path));
  return link;
}

function countFiles(node) {
  var total = node.files.length;
  Object.keys(node.children).forEach(k => {
    total += countFiles(node.children[k]);
  });
  return total;
}

// ── Load & render markdown ──

async function loadFile(filePath, skipPush) {
  document.querySelectorAll('.file-link').forEach(el => {
    el.classList.toggle('active', el.dataset.path === filePath);
  });
  // Also update recents active state
  document.querySelectorAll('.recent-link').forEach(el => {
    el.classList.toggle('active', el.dataset.path === filePath);
  });

  // Update browser URL
  if (!skipPush) {
    var newName = encodeURIComponent(filePath.split('/').pop());
    var currentName = window.location.pathname.split('/').pop();
    if (currentName !== newName) {
      history.pushState({ file: filePath }, '', newName);
    }
  }

  let markdown;
  try {
    markdown = await readFileFromHandle(filePath);
  } catch (e) {
    document.getElementById('markdown-body').innerHTML =
      '<div class="empty-state"><p>Error loading file</p></div>';
    console.error(e);
    return;
  }

  currentMarkdown = markdown;
  currentFilePath = filePath;

  localStorage.setItem('lastFile', filePath);
  addToRecents(filePath);
  updateBreadcrumb(filePath);

  const body = document.getElementById('markdown-body');
  const contentEl = document.querySelector('.content');

  await renderMarkdown(body, markdown);

  body.style.animation = 'none';
  body.offsetHeight;
  body.style.animation = '';

  contentEl.scrollTop = 0;
}

// ── Handle link clicks inside rendered markdown ──

document.getElementById('markdown-body').addEventListener('click', (e) => {
  const anchor = e.target.closest('a');
  if (!anchor) return;

  const href = anchor.getAttribute('href');
  if (!href) return;

  if (href.startsWith('#')) {
    e.preventDefault();
    const id = decodeURIComponent(href.slice(1));
    history.pushState(null, '', href);
    const target = document.getElementById(id);
    if (target) {
      document.querySelector('.content').scrollTo({
        top: target.offsetTop - 20,
        behavior: 'smooth'
      });
    }
    return;
  }

  e.preventDefault();
  window.open(href, '_blank', 'noopener');
});

window.addEventListener('hashchange', () => {
  const id = decodeURIComponent(location.hash.slice(1));
  const target = document.getElementById(id);
  if (target) {
    document.querySelector('.content').scrollTo({
      top: target.offsetTop - 20,
      behavior: 'smooth'
    });
  }
});

// ── Scroll to top / bottom buttons ──

function initScrollButtons() {
  var contentEl = document.querySelector('.content');

  contentEl.addEventListener('scroll', () => {
    var scrollTop = contentEl.scrollTop;
    var scrollHeight = contentEl.scrollHeight - contentEl.clientHeight;
    var topBtn = document.getElementById('scroll-top-btn');
    var bottomBtn = document.getElementById('scroll-bottom-btn');

    topBtn.classList.toggle('visible', scrollTop > 200);
    bottomBtn.classList.toggle('visible', scrollTop < scrollHeight - 200);
  });

  document.getElementById('scroll-top-btn').addEventListener('click', () => {
    contentEl.scrollTo({ top: 0, behavior: 'smooth' });
  });

  document.getElementById('scroll-bottom-btn').addEventListener('click', () => {
    contentEl.scrollTo({ top: contentEl.scrollHeight, behavior: 'smooth' });
  });
}

// ── Resizable sidebar ──

function initSidebarResize() {
  var sidebar = document.getElementById('sidebar');
  var handle = document.getElementById('sidebar-resize');
  var isResizing = false;

  // Restore saved width
  var savedWidth = localStorage.getItem('sidebarWidth');
  if (savedWidth) {
    var w = parseInt(savedWidth, 10);
    if (w >= 180 && w <= 600) {
      sidebar.style.width = w + 'px';
      sidebar.style.minWidth = w + 'px';
      document.documentElement.style.setProperty('--sidebar-width', w + 'px');
    }
  }

  handle.addEventListener('mousedown', (e) => {
    isResizing = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    var newWidth = Math.min(600, Math.max(180, e.clientX));
    sidebar.style.width = newWidth + 'px';
    sidebar.style.minWidth = newWidth + 'px';
    document.documentElement.style.setProperty('--sidebar-width', newWidth + 'px');
  });

  document.addEventListener('mouseup', () => {
    if (!isResizing) return;
    isResizing = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    var w = parseInt(sidebar.style.width, 10);
    localStorage.setItem('sidebarWidth', w);
  });

  // Double-click to reset
  handle.addEventListener('dblclick', () => {
    sidebar.style.width = '';
    sidebar.style.minWidth = '';
    document.documentElement.style.setProperty('--sidebar-width', '280px');
    localStorage.removeItem('sidebarWidth');
  });
}

// ── Sidebar toggle ──

function initSidebarToggle() {
  var btn = document.getElementById('sidebar-toggle');
  var root = document.documentElement;

  // Already restored by inline <head> script

  btn.addEventListener('click', () => {
    root.classList.toggle('sidebar-collapsed');
    var collapsed = root.classList.contains('sidebar-collapsed');
    localStorage.setItem('sidebarCollapsed', collapsed);
  });
}

// ── Custom tooltip ──

(function() {
  var tip = document.createElement('div');
  tip.className = 'custom-tooltip';
  document.body.appendChild(tip);

  var showTimer = null;

  document.addEventListener('mouseover', function(e) {
    var el = e.target.closest('[data-tooltip]');
    if (!el) return;

    clearTimeout(showTimer);
    showTimer = setTimeout(function() {
      tip.textContent = el.dataset.tooltip;
      tip.classList.add('visible');

      // Position: to the right of the sidebar
      var rect = el.getBoundingClientRect();
      var sidebar = document.getElementById('sidebar');
      var sidebarRight = sidebar ? sidebar.getBoundingClientRect().right : 0;

      tip.style.left = (sidebarRight + 8) + 'px';
      tip.style.top = (rect.top + rect.height / 2) + 'px';
      tip.style.transform = 'translateY(-50%)';
    }, 400);
  });

  document.addEventListener('mouseout', function(e) {
    var el = e.target.closest('[data-tooltip]');
    if (!el) return;
    clearTimeout(showTimer);
    tip.classList.remove('visible');
  });
})();

// ── On this page (TOC) ──

function buildToc(articleEl) {
  var toc = document.getElementById('toc');
  var tocList = document.getElementById('toc-list');
  var headings = articleEl.querySelectorAll('h2, h3');

  tocList.innerHTML = '';

  if (headings.length < 2) {
    toc.classList.remove('visible');
    return;
  }

  headings.forEach(function (heading) {
    var li = document.createElement('li');
    var link = document.createElement('a');
    link.className = 'toc-link';
    link.textContent = heading.textContent;
    link.dataset.depth = heading.tagName === 'H3' ? '3' : '2';
    link.dataset.target = heading.id;
    link.addEventListener('click', function () {
      var contentEl = document.querySelector('.content');
      contentEl.scrollTo({
        top: heading.offsetTop - 20,
        behavior: 'smooth'
      });
    });
    li.appendChild(link);
    tocList.appendChild(li);
  });

  toc.classList.add('visible');
  initTocScrollSpy();
}

var tocSpyCleanup = null;

function initTocScrollSpy() {
  if (tocSpyCleanup) tocSpyCleanup();

  var contentEl = document.querySelector('.content');
  var tocLinks = document.querySelectorAll('.toc-link');
  if (tocLinks.length === 0) return;

  function onScroll() {
    var headings = document.getElementById('markdown-body').querySelectorAll('h2, h3');
    var scrollTop = contentEl.scrollTop + 60;
    var current = null;

    headings.forEach(function (h) {
      if (h.offsetTop <= scrollTop) {
        current = h.id;
      }
    });

    tocLinks.forEach(function (link) {
      link.classList.toggle('active', link.dataset.target === current);
    });
  }

  contentEl.addEventListener('scroll', onScroll);
  onScroll();

  tocSpyCleanup = function () {
    contentEl.removeEventListener('scroll', onScroll);
  };
}
