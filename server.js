/**
 * PalermoOggi — Backend Server
 * Scarica automaticamente notizie da RSS ogni ora
 * Serve il frontend e le API per le notizie
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { XMLParser } = require('fast-xml-parser');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'articles.json');
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'palermo2024';

// ─── MIDDLEWARE ───────────────────────────────
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── DATA INIT ───────────────────────────────
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
}
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify([], null, 2));
}

function loadArticles() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch (e) { return []; }
}
function saveArticles(articles) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(articles, null, 2));
}

// ─── RSS SOURCES ─────────────────────────────
const RSS_SOURCES = [
  {
    name: 'BlogSicilia',
    url: 'https://www.blogsicilia.it/palermo/feed/',
    source_label: 'BlogSicilia.it',
    source_url: 'https://www.blogsicilia.it/palermo/',
    default_cat: 'Cronaca'
  },
  {
    name: 'PalermoToday',
    url: 'https://www.palermotoday.it/rss/',
    source_label: 'PalermoToday.it',
    source_url: 'https://www.palermotoday.it/',
    default_cat: 'Cronaca'
  },
  {
    name: 'PalermoToday Cronaca',
    url: 'https://www.palermotoday.it/rss/section/cronaca/',
    source_label: 'PalermoToday.it',
    source_url: 'https://www.palermotoday.it/',
    default_cat: 'Cronaca'
  },
  {
    name: 'PalermoToday Sport',
    url: 'https://www.palermotoday.it/rss/section/sport/',
    source_label: 'PalermoToday.it',
    source_url: 'https://www.palermotoday.it/',
    default_cat: 'Sport'
  },
  {
    name: 'PalermoToday Politica',
    url: 'https://www.palermotoday.it/rss/section/politica/',
    source_label: 'PalermoToday.it',
    source_url: 'https://www.palermotoday.it/',
    default_cat: 'Politica'
  }
];

// ─── HTTP FETCH HELPER ────────────────────────
function fetchUrl(url, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error('Too many redirects'));
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PalermoOggi RSS Reader/1.0)',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*'
      },
      timeout: 15000
    }, (res) => {
      // Segui redirect
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        const redirectUrl = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, url).href;
        res.resume();
        return resolve(fetchUrl(redirectUrl, redirectCount + 1));
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// ─── PARSE RSS ────────────────────────────────
function parseRSS(xml, source) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    allowBooleanAttributes: true,
    parseTagValue: true,
    parseAttributeValue: false,
    trimValues: true,
    cdataPropName: '__cdata',
    isArray: (name) => name === 'item'
  });

  let parsed;
  try { parsed = parser.parse(xml); }
  catch (e) { throw new Error('XML parse error: ' + e.message); }

  const channel = parsed?.rss?.channel || parsed?.feed;
  if (!channel) throw new Error('Invalid RSS structure');

  const items = channel.item || channel.entry || [];
  const results = [];

  for (const item of items.slice(0, 15)) {
    // Titolo
    const title = (item.title?.__cdata || item.title || '').toString().trim();
    if (!title) continue;

    // Link originale
    const link = (item.link?.__cdata || item.link || item.guid || '').toString().trim();

    // Data
    const pubDate = item.pubDate || item['dc:date'] || item.published || item.updated || '';
    const date = pubDate ? new Date(pubDate).toISOString() : new Date().toISOString();

    // Descrizione / excerpt
    let desc = (item.description?.__cdata || item.description ||
                item['content:encoded']?.__cdata || item.summary || '').toString();
    // Rimuovi HTML tags
    desc = desc.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (desc.length > 400) desc = desc.slice(0, 400) + '…';

    // Immagine: prova varie posizioni RSS standard
    let img = '';
    // 1. enclosure
    if (item.enclosure?.['@_url']) img = item.enclosure['@_url'];
    // 2. media:content
    else if (item['media:content']?.['@_url']) img = item['media:content']['@_url'];
    // 3. media:thumbnail
    else if (item['media:thumbnail']?.['@_url']) img = item['media:thumbnail']['@_url'];
    // 4. cerca <img> nella description HTML originale
    else {
      const rawDesc = (item.description?.__cdata || item.description || '').toString();
      const imgMatch = rawDesc.match(/<img[^>]+src=["']([^"']+)["']/i);
      if (imgMatch) img = imgMatch[1];
    }

    // Categoria
    let cat = source.default_cat;
    const rawCat = (item.category?.__cdata || item.category || '').toString().trim();
    if (rawCat) {
      const catMap = {
        'cronaca': 'Cronaca', 'sport': 'Sport', 'calcio': 'Palermo Calcio',
        'politica': 'Politica', 'cultura': 'Cultura & Spettacoli',
        'economia': 'Economia', 'salute': 'Salute',
        'ambiente': 'Ambiente & Mare', 'sicilia': 'Sicilia',
        'società': 'Società', 'universit': 'Università'
      };
      const lower = rawCat.toLowerCase();
      for (const [key, val] of Object.entries(catMap)) {
        if (lower.includes(key)) { cat = val; break; }
      }
    }

    results.push({ title, link, date, desc, img, cat });
  }

  return results;
}

// ─── MAIN RSS FETCH ───────────────────────────
async function fetchAllRSS(verbose = false) {
  const existing = loadArticles();
  const existingLinks = new Set(existing.map(a => a.source_link).filter(Boolean));
  const newArticles = [];
  let fetchErrors = [];

  for (const source of RSS_SOURCES) {
    try {
      if (verbose) console.log(`[RSS] Fetching ${source.name}...`);
      const xml = await fetchUrl(source.url);
      const items = parseRSS(xml, source);

      for (const item of items) {
        if (existingLinks.has(item.link)) continue; // già presente

        const article = {
          id: 'rss_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
          title: item.title,
          subtitle: item.desc,
          body: item.desc + '\n\nPer leggere l\'articolo completo visita la fonte originale.',
          cat: item.cat,
          author: source.name + ' — Redazione',
          img: item.img || '',
          date: item.date,
          source_label: source.source_label,
          source_url: source.source_url,
          source_link: item.link,
          is_rss: true
        };

        newArticles.push(article);
        existingLinks.add(item.link);
      }

      if (verbose) console.log(`[RSS] ${source.name}: ${items.length} items, ${newArticles.length} nuovi finora`);
    } catch (err) {
      const msg = `[RSS] ERRORE ${source.name}: ${err.message}`;
      console.error(msg);
      fetchErrors.push({ source: source.name, error: err.message });
    }
  }

  if (newArticles.length > 0) {
    // Ordina per data decrescente e metti i nuovi in cima
    newArticles.sort((a, b) => new Date(b.date) - new Date(a.date));
    const updated = [...newArticles, ...existing];
    // Mantieni max 500 articoli
    const trimmed = updated.slice(0, 500);
    saveArticles(trimmed);
    console.log(`[RSS] Salvati ${newArticles.length} nuovi articoli. Totale: ${trimmed.length}`);
  } else {
    console.log('[RSS] Nessun nuovo articolo trovato.');
  }

  return { added: newArticles.length, errors: fetchErrors };
}

// ─── AUTO FETCH ogni ora ──────────────────────
let fetchInterval = null;
function startAutoFetch() {
  console.log('[SCHEDULER] Avvio fetch automatico ogni 60 minuti...');
  // Prima esecuzione immediata
  fetchAllRSS(true).catch(console.error);
  // Poi ogni ora
  fetchInterval = setInterval(() => {
    console.log('[SCHEDULER] Fetch automatico RSS...');
    fetchAllRSS(true).catch(console.error);
  }, 60 * 60 * 1000); // ogni ora
}

// ─── API ROUTES ───────────────────────────────

// GET articoli pubblici
app.get('/api/articles', (req, res) => {
  const articles = loadArticles();
  const cat = req.query.cat;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const filtered = cat && cat !== 'Tutte'
    ? articles.filter(a => a.cat === cat)
    : articles;
  const start = (page - 1) * limit;
  res.json({
    articles: filtered.slice(start, start + limit),
    total: filtered.length,
    page,
    pages: Math.ceil(filtered.length / limit)
  });
});

// GET singolo articolo
app.get('/api/articles/:id', (req, res) => {
  const articles = loadArticles();
  const article = articles.find(a => a.id === req.params.id);
  if (!article) return res.status(404).json({ error: 'Articolo non trovato' });
  res.json(article);
});

// POST login admin
app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    res.json({ ok: true, token: Buffer.from(`${ADMIN_USER}:${ADMIN_PASS}`).toString('base64') });
  } else {
    res.status(401).json({ ok: false, error: 'Credenziali errate' });
  }
});

// Middleware auth
function authRequired(req, res, next) {
  const auth = req.headers.authorization || '';
  const expected = 'Basic ' + Buffer.from(`${ADMIN_USER}:${ADMIN_PASS}`).toString('base64');
  if (auth !== expected) return res.status(401).json({ error: 'Non autorizzato' });
  next();
}

// POST nuovo articolo (admin)
app.post('/api/admin/articles', authRequired, (req, res) => {
  const { title, subtitle, body, cat, author, img } = req.body;
  if (!title || !cat || !body) return res.status(400).json({ error: 'Campi obbligatori mancanti' });
  const articles = loadArticles();
  const article = {
    id: 'man_' + Date.now(),
    title, subtitle: subtitle || '', body, cat,
    author: author || 'Redazione PalermoOggi',
    img: img || '',
    date: new Date().toISOString(),
    source_label: null,
    source_url: null,
    source_link: null,
    is_rss: false
  };
  articles.unshift(article);
  saveArticles(articles);
  res.json({ ok: true, article });
});

// PUT modifica articolo (admin)
app.put('/api/admin/articles/:id', authRequired, (req, res) => {
  const articles = loadArticles();
  const idx = articles.findIndex(a => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Non trovato' });
  const { title, subtitle, body, cat, author, img } = req.body;
  articles[idx] = { ...articles[idx], title, subtitle, body, cat, author, img };
  saveArticles(articles);
  res.json({ ok: true });
});

// DELETE articolo (admin)
app.delete('/api/admin/articles/:id', authRequired, (req, res) => {
  let articles = loadArticles();
  articles = articles.filter(a => a.id !== req.params.id);
  saveArticles(articles);
  res.json({ ok: true });
});

// DELETE tutti (admin)
app.delete('/api/admin/articles', authRequired, (req, res) => {
  saveArticles([]);
  res.json({ ok: true });
});

// POST forza fetch RSS manuale (admin)
app.post('/api/admin/fetch-rss', authRequired, async (req, res) => {
  try {
    const result = await fetchAllRSS(true);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET stato sistema (admin)
app.get('/api/admin/status', authRequired, (req, res) => {
  const articles = loadArticles();
  const rss = articles.filter(a => a.is_rss);
  const manual = articles.filter(a => !a.is_rss);
  res.json({
    total: articles.length,
    rss: rss.length,
    manual: manual.length,
    last_update: articles.length > 0 ? articles[0].date : null,
    sources: RSS_SOURCES.map(s => s.name)
  });
});

// Fallback → frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── START ───────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🗞  PalermoOggi Server avviato su porta ${PORT}`);
  console.log(`📡 RSS automatico ogni ora da ${RSS_SOURCES.length} fonti`);
  startAutoFetch();
});
