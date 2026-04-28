# Readme Viewer

A lightweight, browser-based viewer for browsing and reading markdown files from any folder on your computer. Pick a directory, and the app recursively scans it for `.md` files and renders them with full GitHub-flavored styling.

Files never leave your machine — everything runs locally in the browser using the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API).

## Features

- **Folder picker** — choose any folder; recursive scan finds all `.md` files (skips `node_modules`, `.git`, build dirs, etc.)
- **Persistent across reloads** — picked folder is remembered via IndexedDB
- **Markdown rendering** — full CommonMark + GFM via [marked](https://github.com/markedjs/marked)
- **Mermaid diagrams** — `mermaid` code blocks render as live diagrams
- **Dark mode** with system theme detection
- **Accent colors** — five themes (Teal, Slate Blue, Forest Green, Neutral, Purple)
- **Search**
  - File-name fuzzy search
  - Full-text content search across all files
- **Sidebar tree** — collapsible folders, file counts, persisted collapse state
- **Recents** — last 6 opened files
- **Table of contents** — auto-generated `On this page` from headings, with scroll-spy
- **Breadcrumbs** — folder path trail for the current file
- **Reading progress bar** at the top of the page
- **Resizable sidebar** with collapse toggle
- **GitHub-style heading anchors** + deep-link URL routing
- **Keyboard-friendly** scroll-to-top / scroll-to-bottom buttons

## Browser support

This app uses the **File System Access API**, which requires a Chromium-based desktop browser:

| Browser | Supported |
|---|---|
| Chrome (desktop) | ✅ |
| Edge (desktop) | ✅ |
| Opera | ✅ |
| Brave | ⚠️ Disabled by default — enable in `brave://settings/privacy` |
| Safari | ❌ |
| Firefox | ❌ |
| Mobile browsers | ❌ |

The page must be served from a **secure context** — `localhost`, `127.0.0.1`, or HTTPS. Custom hostnames mapped via `/etc/hosts` (e.g. `http://myapp:3000`) won't work unless whitelisted in `chrome://flags/#unsafely-treat-insecure-origin-as-secure`.

## Quick start

Requires Node.js 18+.

```bash
git clone https://github.com/abhishek09md-hub/rmviewer.git
cd rmviewer
npm install
npm start
```

Then open <http://localhost:3000>, click **Choose Folder**, and pick a directory containing markdown files.

## How it works

The app is a single-page client-side application. The Express server is just a thin wrapper that serves static assets — it has no API and never reads your files.

```
Browser
  ├── window.showDirectoryPicker()  ── user grants read access to a folder
  ├── Recursive scan via FileSystemDirectoryHandle.values()
  ├── FileSystemFileHandle.getFile().text()  ── reads each .md on demand
  └── marked + mermaid  ── renders to HTML

Server (Node + Express)
  └── Serves /public as static files (and SPA fallback for deep links)
```

The directory handle is stored in IndexedDB so reloads don't require re-picking. The browser may re-prompt for permission once per session.

## Project structure

```
.
├── public/              # Static frontend (everything the user sees)
│   ├── index.html
│   ├── app.js           # All client logic (single file, no framework)
│   ├── style.css
│   └── lib/
│       └── mermaid.min.js
├── server.js            # Minimal static + SPA-fallback server
├── package.json
└── README.md
```

## Tech stack

- **Vanilla JS** — no framework, no build step
- **[marked](https://github.com/markedjs/marked)** — markdown → HTML
- **[mermaid](https://mermaid.js.org/)** — diagram rendering
- **Express** — minimal static file server (replaceable with any static host)

## Deployment

Because the app is fully client-side, it can be hosted on any static host: GitHub Pages, Vercel, Netlify, Cloudflare Pages, Render Static, etc. The only requirement is HTTPS so the File System Access API will work.

To deploy as static:

1. Vendor `node_modules/marked/marked.min.js` into `public/lib/` (currently served via Express).
2. Publish the `public/` directory.

## Privacy

No telemetry, no network calls beyond fetching the static assets. Your files are read entirely in the browser; nothing is uploaded anywhere.

## License

MIT
