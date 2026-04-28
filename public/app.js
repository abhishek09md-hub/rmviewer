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
let translationCache = {};
let showingTranslation = false;

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
  initTranslate();
  initProgress();

  const res = await fetch('/api/files');
  allFiles = await res.json();

  if (allFiles.length === 0) {
    document.getElementById('markdown-body').innerHTML =
      '<div class="empty-state"><p>No markdown files found in ./docs</p></div>';
    return;
  }

  document.getElementById('file-count').textContent = allFiles.length + ' file' + (allFiles.length !== 1 ? 's' : '');
  buildSidebar(allFiles);
  renderRecents();

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

  initScrollButtons();
  initSidebarResize();
  initSidebarToggle();
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
  var html = '<span>docs</span>';
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

async function textSearch(query) {
  var container = document.getElementById('text-search-results');

  try {
    var res = await fetch('/api/search?q=' + encodeURIComponent(query));
    var results = await res.json();

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

    // Click to open file
    container.querySelectorAll('.search-result-item').forEach(el => {
      el.addEventListener('click', () => {
        loadFile(el.dataset.path);
      });
    });
  } catch (err) {
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
    var newUrl = '/' + encodeURIComponent(filePath.split('/').pop());
    if (window.location.pathname !== newUrl) {
      history.pushState({ file: filePath }, '', newUrl);
    }
  }

  const res = await fetch('/api/file?path=' + encodeURIComponent(filePath));
  if (!res.ok) {
    document.getElementById('markdown-body').innerHTML =
      '<div class="empty-state"><p>Error loading file</p></div>';
    return;
  }

  const markdown = await res.text();
  currentMarkdown = markdown;
  currentFilePath = filePath;
  showingTranslation = false;

  localStorage.setItem('lastFile', filePath);
  addToRecents(filePath);
  updateBreadcrumb(filePath);

  const body = document.getElementById('markdown-body');
  const contentEl = document.querySelector('.content');

  // Check if non-English and a cached translation exists on disk
  var lang = detectNonEnglish(markdown);
  if (lang) {
    var cacheRes = await fetch('/api/translation?path=' + encodeURIComponent(filePath));
    var cacheData = await cacheRes.json();
    if (cacheData.cached) {
      translationCache[filePath] = cacheData.translated;
      await renderMarkdown(body, cacheData.translated);
      showingTranslation = true;
      updateTranslateBar(markdown, true);
      body.style.animation = 'none';
      body.offsetHeight;
      body.style.animation = '';
      contentEl.scrollTop = 0;
      return;
    }
  }

  await renderMarkdown(body, markdown);

  body.style.animation = 'none';
  body.offsetHeight;
  body.style.animation = '';

  contentEl.scrollTop = 0;
  updateTranslateBar(markdown, false);
}

// ── Language detection & translation ──

function detectNonEnglish(text) {
  var clean = text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]*`/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/[#*_|>\-=~`\[\](){}!\\\/\d\s.,;:'"?]+/g, ' ')
    .trim();

  if (clean.length < 20) return null;

  var cjk = (clean.match(/[\u3000-\u9fff\uf900-\ufaff]/g) || []).length;
  var cyrillic = (clean.match(/[\u0400-\u04ff]/g) || []).length;
  var arabic = (clean.match(/[\u0600-\u06ff]/g) || []).length;
  var devanagari = (clean.match(/[\u0900-\u097f]/g) || []).length;
  var korean = (clean.match(/[\uac00-\ud7af\u1100-\u11ff]/g) || []).length;
  var thai = (clean.match(/[\u0e00-\u0e7f]/g) || []).length;
  var japanese = (clean.match(/[\u3040-\u309f\u30a0-\u30ff]/g) || []).length;

  var total = clean.replace(/\s/g, '').length;
  if (total === 0) return null;

  if ((cjk + japanese) / total > 0.15) return japanese > cjk ? 'ja' : 'zh';
  if (korean / total > 0.15) return 'ko';
  if (cyrillic / total > 0.15) return 'ru';
  if (arabic / total > 0.15) return 'ar';
  if (devanagari / total > 0.15) return 'hi';
  if (thai / total > 0.15) return 'th';

  var accented = (clean.match(/[\u00c0-\u024f]/g) || []).length;
  if (accented / total > 0.05) return 'autodetect';

  return null;
}

var LANG_NAMES = {
  'zh': 'Chinese', 'ja': 'Japanese', 'ko': 'Korean',
  'ru': 'Russian', 'ar': 'Arabic', 'hi': 'Hindi',
  'th': 'Thai', 'autodetect': 'Non-English'
};

function initTranslate() {
  document.getElementById('translate-btn').addEventListener('click', handleTranslate);
}

function updateTranslateBar(markdown, showingCached) {
  var bar = document.getElementById('translate-bar');
  var btn = document.getElementById('translate-btn');
  var langLabel = document.getElementById('detected-lang');

  var lang = detectNonEnglish(markdown);
  if (!lang) {
    bar.classList.add('hidden');
    return;
  }

  var langName = LANG_NAMES[lang] || 'Non-English';
  langLabel.textContent = langName + ' content detected';

  if (showingCached) {
    btn.textContent = 'Show Original';
    btn.disabled = false;
  } else if (pendingTranslations[currentFilePath]) {
    btn.textContent = 'Translating via Claude...';
    btn.disabled = true;
  } else if (translationCache[currentFilePath]) {
    btn.textContent = 'Show English';
    btn.disabled = false;
  } else {
    btn.textContent = 'Translate to English';
    btn.disabled = false;
  }

  bar.classList.remove('hidden');
}

// Track in-flight translations: filePath -> Promise
var pendingTranslations = {};

async function handleTranslate() {
  var btn = document.getElementById('translate-btn');
  var body = document.getElementById('markdown-body');

  // Toggle back to original
  if (showingTranslation) {
    await renderMarkdown(body, currentMarkdown);
    btn.textContent = translationCache[currentFilePath] ? 'Show English' : 'Translate to English';
    showingTranslation = false;
    document.querySelector('.content').scrollTop = 0;
    return;
  }

  // Show from cache
  if (translationCache[currentFilePath]) {
    await renderMarkdown(body, translationCache[currentFilePath]);
    btn.textContent = 'Show Original';
    showingTranslation = true;
    document.querySelector('.content').scrollTop = 0;
    return;
  }

  // Already translating this file in background
  if (pendingTranslations[currentFilePath]) {
    showToast('Translation already in progress...', 'info');
    return;
  }

  // Start background translation
  var translatingPath = currentFilePath;
  btn.disabled = true;
  btn.textContent = 'Translating via Claude...';

  var fetchPromise = fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: translatingPath })
  }).then(r => r.json());

  pendingTranslations[translatingPath] = fetchPromise;

  try {
    var data = await fetchPromise;
    delete pendingTranslations[translatingPath];

    if (data.error) throw new Error(data.error);

    translationCache[translatingPath] = data.translated;

    // If user is still on the same file, render the translation
    if (currentFilePath === translatingPath) {
      await renderMarkdown(body, data.translated);
      btn.textContent = 'Show Original';
      btn.disabled = false;
      showingTranslation = true;
      document.querySelector('.content').scrollTop = 0;
    } else {
      // User navigated away — show a toast so they know it's done
      var fileName = translatingPath.split('/').pop();
      showToast('Translation ready: ' + fileName, 'success', () => {
        loadFile(translatingPath);
      });
    }
  } catch (err) {
    delete pendingTranslations[translatingPath];
    if (currentFilePath === translatingPath) {
      btn.textContent = 'Translation failed — retry';
      btn.disabled = false;
    } else {
      var fileName = translatingPath.split('/').pop();
      showToast('Translation failed: ' + fileName, 'error');
    }
  }
}

// ── Toast notifications ──

function showToast(message, type, onClick) {
  var container = document.getElementById('toast-container');
  var toast = document.createElement('div');
  toast.className = 'toast ' + (type || 'info');

  var icon = '';
  if (type === 'success') icon = '<span class="toast-icon">&#10003;</span>';
  else if (type === 'error') icon = '<span class="toast-icon">&#10007;</span>';
  else icon = '<span class="toast-icon">&#8987;</span>';

  toast.innerHTML = icon + '<span>' + message + '</span>';

  if (onClick) {
    toast.style.cursor = 'pointer';
    toast.addEventListener('click', () => {
      onClick();
      toast.remove();
    });
  }

  container.appendChild(toast);

  // Auto-dismiss after 5s
  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 300);
  }, 5000);
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
