const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/lib/marked.min.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'node_modules', 'marked', 'marked.min.js'));
});

// SPA fallback so deep links like /Foo.md serve index.html
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/lib/')) {
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
  next();
});

app.listen(PORT, () => {
  console.log(`Readme Viewer running at http://localhost:${PORT}`);
});
