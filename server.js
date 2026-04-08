/**
 * PalermoOggi — Backend Server
 * Scarica automaticamente notizie da RSS ogni 5 minuti
 * Serve il frontend e le API per le notizie
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { XMLParser } = require('fast-xml-parser');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'articles.json');
const SUBSCRIBERS_FILE = path.join(__dirname, 'data', 'subscribers.json');
const ADMIN_USER = process.env.ADMIN_USER || 'palermoooggi@admin.com';
const ADMIN_PASS = process.env.ADMIN_PASS || 'palermo2024';
const GMAIL_USER = process.env.GMAIL_USER || 'palermoooggi@gmail.com';
const GMAIL_PASS = process.env.GMAIL_PASS || ''; // App Password Gmail

// ─── MAILER ──────────────────────────────────
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: GMAIL_USER, pass: GMAIL_PASS }
});

function loadSubscribers() {
  try { return JSON.parse(fs.readFileSync(SUBSCRIBERS_FILE, 'utf8')); }
  catch (e) { return []; }
}
function saveSubscribers(list) {
  fs.writeFileSync(SUBSCRIBERS_FILE, JSON.stringify(list, null, 2));
}

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
if (!fs.existsSync(SUBSCRIBERS_FILE)) {
  fs.writeFileSync(SUBSCRIBERS_FILE, JSON.stringify([], null, 2));
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
  // ── PALERMO / SICILIA ──
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
  },

  // ── NOTIZIE NAZIONALI ──
  {
    name: 'TGCom24',
    url: 'https://www.tgcom24.mediaset.it/rss/home.xml',
    source_label: 'TGCom24',
    source_url: 'https://www.tgcom24.mediaset.it/',
    default_cat: 'Notizie Italia'
  },
  {
    name: 'TGCom24 Cronaca',
    url: 'https://www.tgcom24.mediaset.it/rss/cronaca.xml',
    source_label: 'TGCom24',
    source_url: 'https://www.tgcom24.mediaset.it/',
    default_cat: 'Cronaca'
  },
  {
    name: 'Sky TG24',
    url: 'https://tg24.sky.it/feed/rss/home',
    source_label: 'Sky TG24',
    source_url: 'https://tg24.sky.it/',
    default_cat: 'Notizie Italia'
  },
  {
    name: 'Sky TG24 Cronaca',
    url: 'https://tg24.sky.it/feed/rss/cronaca',
    source_label: 'Sky TG24',
    source_url: 'https://tg24.sky.it/',
    default_cat: 'Cronaca'
  },
  {
    name: 'RaiNews',
    url: 'https://www.rainews.it/dl/rainews/media/feed/rss/rainews.xml',
    source_label: 'RaiNews',
    source_url: 'https://www.rainews.it/',
    default_cat: 'Notizie Italia'
  },
  {
    name: 'RaiNews Cronaca',
    url: 'https://www.rainews.it/dl/rainews/media/feed/rss/cronaca.xml',
    source_label: 'RaiNews',
    source_url: 'https://www.rainews.it/',
    default_cat: 'Cronaca'
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

// ─── DECODE HTML ENTITIES ────────────────────
function decodeHtmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#8216;/g, '\u2018')
    .replace(/&#8217;/g, '\u2019')
    .replace(/&#8220;/g, '\u201C')
    .replace(/&#8221;/g, '\u201D')
    .replace(/&#8211;/g, '\u2013')
    .replace(/&#8212;/g, '\u2014')
    .replace(/&#8230;/g, '\u2026')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&rsquo;/g, '\u2019')
    .replace(/&lsquo;/g, '\u2018')
    .replace(/&rdquo;/g, '\u201D')
    .replace(/&ldquo;/g, '\u201C')
    .replace(/&ndash;/g, '\u2013')
    .replace(/&mdash;/g, '\u2014')
    .replace(/&hellip;/g, '\u2026');
}

// ─── NORMALIZZA TITOLO per deduplicazione ────
function normalizeTitle(title) {
  if (!title) return '';
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\u00e0-\u00fc ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── PARSE RSS ───────────────────────────────
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

  for (const item of items.slice(0, 20)) {
    const title = decodeHtmlEntities((item.title?.__cdata || item.title || '').toString().trim());
    if (!title) continue;

    const link = (item.link?.__cdata || item.link || item.guid || '').toString().trim();
    const pubDate = item.pubDate || item['dc:date'] || item.published || item.updated || '';
    const date = pubDate ? new Date(pubDate).toISOString() : new Date().toISOString();

    let desc = (
      item['content:encoded']?.__cdata ||
      item['content:encoded'] ||
      item.description?.__cdata ||
      item.description ||
      item.summary ||
      ''
    ).toString();
    desc = desc.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    desc = decodeHtmlEntities(desc);

    const subtitle = desc.length > 250 ? desc.slice(0, 250) + '…' : desc;
    const body = desc.length > 900 ? desc.slice(0, 900) + '…' : desc;

    let img = '';
    if (item.enclosure?.['@_url']) img = item.enclosure['@_url'];
    else if (item['media:content']?.['@_url']) img = item['media:content']['@_url'];
    else if (item['media:thumbnail']?.['@_url']) img = item['media:thumbnail']['@_url'];
    else {
      const rawDesc = (
        item['content:encoded']?.__cdata ||
        item['content:encoded'] ||
        item.description?.__cdata ||
        item.description || ''
      ).toString();
      const imgMatch = rawDesc.match(/<img[^>]+src=["']([^"']+)["']/i);
      if (imgMatch) img = imgMatch[1];
    }

    let cat = source.default_cat;
    const rawCat = (item.category?.__cdata || item.category || '').toString().trim();
    if (rawCat) {
      const catMap = {
        'cronaca': 'Cronaca',
        'sport': 'Sport',
        'calcio': 'Palermo Calcio',
        'palermo': 'Cronaca',
        'sicilia': 'Sicilia',
        'politica': 'Politica',
        'cultura': 'Cultura & Spettacoli',
        'spettacol': 'Cultura & Spettacoli',
        'intrattenimento': 'Cultura & Spettacoli',
        'economia': 'Economia',
        'salute': 'Salute',
        'ambiente': 'Ambiente & Mare',
        'universit': 'Università'
      };
      const lower = rawCat.toLowerCase();
      for (const [key, val] of Object.entries(catMap)) {
        if (lower.includes(key)) { cat = val; break; }
      }
    }

    results.push({ title, link, date, subtitle, body, img, cat });
  }

  return results;
}

// ─── MAIN RSS FETCH ───────────────────────────
async function fetchAllRSS(verbose = false) {
  const existing = loadArticles();
  const existingLinks = new Set(existing.map(a => a.source_link).filter(Boolean));
  const existingTitles = new Set(existing.map(a => normalizeTitle(a.title)));

  const newArticles = [];
  const seenTitlesThisRun = new Set();
  let fetchErrors = [];

  for (const source of RSS_SOURCES) {
    try {
      if (verbose) console.log(`[RSS] Fetching ${source.name}...`);
      const xml = await fetchUrl(source.url);
      const items = parseRSS(xml, source);
      let addedFromSource = 0;

      for (const item of items) {
        if (item.link && existingLinks.has(item.link)) continue;
        const normTitle = normalizeTitle(item.title);
        if (existingTitles.has(normTitle)) continue;
        if (seenTitlesThisRun.has(normTitle)) continue;

        const article = {
          id: 'rss_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
          title: item.title,
          subtitle: item.subtitle,
          body: item.body,
          cat: item.cat,
          author: source.source_label + ' — Redazione',
          img: item.img || '',
          date: item.date,
          source_label: source.source_label,
          source_url: source.source_url,
          source_link: item.link,
          is_rss: true
        };

        newArticles.push(article);
        if (item.link) existingLinks.add(item.link);
        existingTitles.add(normTitle);
        seenTitlesThisRun.add(normTitle);
        addedFromSource++;
      }

      if (verbose) console.log(`[RSS] ${source.name}: ${items.length} items, +${addedFromSource} nuovi`);
    } catch (err) {
      const msg = `[RSS] ERRORE ${source.name}: ${err.message}`;
      console.error(msg);
      fetchErrors.push({ source: source.name, error: err.message });
    }
  }

  if (newArticles.length > 0) {
    newArticles.sort((a, b) => new Date(b.date) - new Date(a.date));
    const updated = [...newArticles, ...existing];
    const trimmed = updated.slice(0, 600);
    saveArticles(trimmed);
    console.log(`[RSS] Salvati ${newArticles.length} nuovi articoli. Totale: ${trimmed.length}`);
  } else {
    if (verbose) console.log('[RSS] Nessun nuovo articolo trovato.');
  }

  return { added: newArticles.length, errors: fetchErrors };
}

// ─── AUTO FETCH ogni 5 minuti ─────────────────
const FETCH_INTERVAL_MS = 5 * 60 * 1000; // 5 minuti

let fetchInterval = null;
function startAutoFetch() {
  console.log('[SCHEDULER] Avvio fetch automatico ogni 5 minuti...');
  // Prima esecuzione immediata
  fetchAllRSS(true).catch(console.error);
  // Poi ogni 5 minuti
  fetchInterval = setInterval(() => {
    console.log('[SCHEDULER] Fetch automatico RSS (ogni 5 min)...');
    fetchAllRSS(true).catch(console.error);
  }, FETCH_INTERVAL_MS);
}

// ─── NEWSLETTER HTML BUILDER ─────────────────
function buildNewsletterHtml(articles, isWelcome = false) {
  const siteUrl = 'https://palermooggi.onrender.com';
  const today = new Date().toLocaleDateString('it-IT', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });

  const articlesHtml = articles.map(a => {
    const imgBlock = a.img
      ? `<img src="${a.img}" alt="${(a.title || '').replace(/"/g, '&quot;')}"
             style="width:100%;max-height:300px;object-fit:cover;display:block;border-radius:4px;margin-bottom:16px;">`
      : '';

    const bodyText = (a.body || a.subtitle || '')
      .replace(/\n/g, '<br>')
      .replace(/Per leggere l'articolo completo visita la fonte originale\./g, '');

    const linkBlock = (a.source_label && a.source_link)
      ? `<div style="margin-top:14px;padding:12px 16px;background:#f5f4f1;border-left:3px solid #C0392B;border-radius:0 4px 4px 0;">
           <p style="font-family:sans-serif;font-size:11px;color:#888;margin:0 0 6px;">
             📰 Fonte: <strong style="color:#C0392B;">${a.source_label}</strong>
           </p>
           <a href="${a.source_link}" style="display:inline-block;font-family:sans-serif;font-size:12px;font-weight:700;color:#fff;background:#C0392B;text-decoration:none;padding:7px 16px;border-radius:3px;">
             Leggi l'articolo completo →
           </a>
         </div>`
      : `<div style="margin-top:14px;">
           <a href="${siteUrl}" style="display:inline-block;font-family:sans-serif;font-size:12px;font-weight:700;color:#fff;background:#C0392B;text-decoration:none;padding:7px 16px;border-radius:3px;">
             Leggi su PalermoOggi →
           </a>
         </div>`;

    return `
      <div style="border-top:2px solid #e8e6e1;padding:28px 0 12px;">
        <div style="margin-bottom:12px;">
          <span style="font-family:sans-serif;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;background:#C0392B;color:#fff;padding:3px 10px;border-radius:2px;">
            ${a.cat || 'Notizie'}
          </span>
        </div>
        ${imgBlock}
        <h2 style="font-family:Georgia,serif;font-size:22px;font-weight:700;line-height:1.3;margin:0 0 12px;color:#0f0f0f;">
          ${a.title}
        </h2>
        <p style="font-family:Georgia,serif;font-size:15px;line-height:1.8;color:#2a2a2a;margin:0 0 8px;">
          ${bodyText}
        </p>
        <div style="font-family:sans-serif;font-size:11px;color:#aaa;margin-bottom:4px;">
          ${new Date(a.date).toLocaleDateString('it-IT', { day:'numeric',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit' })} · ${a.author || 'Redazione'}
        </div>
        ${linkBlock}
      </div>`;
  }).join('');

  return `<!DOCTYPE html><html lang="it"><head><meta charset="UTF-8"><title>PalermoOggi Newsletter</title></head>
<body style="margin:0;padding:20px 0;background:#ece9e3;font-family:Georgia,serif;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.1);">
    <div style="background:#0f0f0f;padding:28px 36px;text-align:center;">
      <div style="font-family:Georgia,serif;font-size:36px;font-weight:900;color:#fff;letter-spacing:-1.5px;line-height:1;">
        Palermo<span style="color:#C0392B;">Oggi</span>
      </div>
      <div style="font-family:sans-serif;font-size:10px;letter-spacing:3px;text-transform:uppercase;color:rgba(255,255,255,0.3);margin-top:8px;">
        Notizie da Palermo e dalla Sicilia
      </div>
      <div style="font-family:sans-serif;font-size:12px;color:rgba(255,255,255,0.4);margin-top:8px;">${today}</div>
    </div>
    <div style="background:#C0392B;padding:16px 36px;text-align:center;">
      <p style="font-family:sans-serif;font-size:14px;color:#fff;margin:0;font-weight:500;">
        ${isWelcome ? '🎉 Benvenuto! Ecco le ultime notizie per iniziare.' : '📰 Le notizie del giorno, con tutti i dettagli.'}
      </p>
    </div>
    <div style="padding:12px 36px 28px;">${articlesHtml}</div>
    <div style="padding:28px 36px;text-align:center;background:#f5f4f1;border-top:2px solid #e8e6e1;">
      <a href="${siteUrl}" style="display:inline-block;background:#0f0f0f;color:#fff;text-decoration:none;padding:13px 30px;border-radius:4px;font-family:sans-serif;font-size:13px;font-weight:700;">
        Visita PalermoOggi →
      </a>
    </div>
    <div style="background:#0f0f0f;padding:18px 36px;text-align:center;">
      <p style="font-family:sans-serif;font-size:11px;color:rgba(255,255,255,0.3);margin:0;line-height:1.7;">
        © ${new Date().getFullYear()} PalermoOggi — Tutti i diritti riservati<br>
        Per disiscriverti rispondi con oggetto <strong style="color:rgba(255,255,255,0.5);">Disiscrivi</strong>
      </p>
    </div>
  </div>
</body></html>`;
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

// GET timestamp ultimo aggiornamento (usato dal frontend per polling)
app.get('/api/last-update', (req, res) => {
  const articles = loadArticles();
  res.json({
    last_update: articles.length > 0 ? articles[0].date : null,
    total: articles.length
  });
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

// POST iscrizione newsletter
app.post('/api/newsletter/subscribe', async (req, res) => {
  const { email } = req.body;
  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Email non valida' });

  const subscribers = loadSubscribers();
  if (subscribers.find(s => s.email === email)) {
    return res.json({ ok: true, message: 'Già iscritto' });
  }

  subscribers.push({ email, date: new Date().toISOString() });
  saveSubscribers(subscribers);

  try {
    const articles = loadArticles().slice(0, 4);
    const html = buildNewsletterHtml(articles, true);
    await transporter.sendMail({
      from: `"Palermo Oggi" <${GMAIL_USER}>`,
      to: email,
      subject: '✅ Benvenuto su Palermo Oggi — Le ultime notizie per te',
      html
    });
  } catch (err) {
    console.error('[MAIL] Errore email benvenuto:', err.message);
  }

  try {
    await transporter.sendMail({
      from: `"Palermo Oggi" <${GMAIL_USER}>`,
      to: GMAIL_USER,
      subject: `📬 Nuova iscrizione newsletter: ${email}`,
      text: `Nuovo iscritto: ${email}\nData: ${new Date().toLocaleString('it-IT')}\nTotale iscritti: ${subscribers.length}`
    });
  } catch (err) {
    console.error('[MAIL] Errore notifica admin:', err.message);
  }

  res.json({ ok: true, message: 'Iscritto con successo' });
});

// POST invia newsletter manuale (admin)
app.post('/api/admin/send-newsletter', authRequired, async (req, res) => {
  const subscribers = loadSubscribers();
  if (!subscribers.length) return res.json({ ok: false, message: 'Nessun iscritto' });

  const articles = loadArticles().slice(0, 10);
  if (!articles.length) return res.json({ ok: false, message: 'Nessun articolo da inviare' });

  const html = buildNewsletterHtml(articles, false);
  const subject = `📰 Le notizie di oggi da Palermo — ${new Date().toLocaleDateString('it-IT', {
    day: 'numeric', month: 'long', year: 'numeric'
  })}`;

  let sent = 0, errors = 0;
  for (const sub of subscribers) {
    try {
      await transporter.sendMail({
        from: `"Palermo Oggi" <${GMAIL_USER}>`,
        to: sub.email,
        subject,
        html
      });
      sent++;
    } catch (err) {
      console.error(`[MAIL] Errore invio a ${sub.email}:`, err.message);
      errors++;
    }
  }

  res.json({ ok: true, sent, errors, total: subscribers.length });
});

// GET lista iscritti (admin)
app.get('/api/admin/subscribers', authRequired, (req, res) => {
  const subscribers = loadSubscribers();
  res.json({ count: subscribers.length, subscribers });
});

// DELETE disiscrizione
app.delete('/api/newsletter/unsubscribe', (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email mancante' });
  let subs = loadSubscribers();
  subs = subs.filter(s => s.email !== email);
  saveSubscribers(subs);
  res.json({ ok: true });
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
  console.log(`📡 RSS automatico ogni 5 minuti da ${RSS_SOURCES.length} fonti`);
  startAutoFetch();
});
