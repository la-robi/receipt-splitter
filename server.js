const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs/promises');
const Tesseract = require('tesseract.js');

const app = express();
const PORT = process.env.PORT || 3000;
const upload = multer({ storage: multer.memoryStorage() });

const DATA_DIR = path.join(__dirname, 'data');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const MEMORY_FILE = path.join(DATA_DIR, 'item-memory.json');

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const STOPWORDS = [
  'totale',
  'subtotale',
  'pagamento',
  'contanti',
  'bancomat',
  'carta',
  'resto',
  'iva',
  'scontrino',
  'numero',
  'p.iva',
  'codice',
  'descrizione',
  'qta'
];

function parsePrice(raw) {
  if (!raw) return null;
  const normalized = raw.replace(/[^0-9,.-]/g, '').replace(',', '.');
  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) ? Number(value.toFixed(2)) : null;
}

function parseReceiptText(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const items = [];

  for (const line of lines) {
    const low = line.toLowerCase();
    if (STOPWORDS.some((stopword) => low.includes(stopword))) {
      continue;
    }

    const priceMatch = line.match(/(-?\d+[\.,]\d{2})\s*$/);
    if (!priceMatch) {
      continue;
    }

    const price = parsePrice(priceMatch[1]);
    if (price === null) {
      continue;
    }

    const name = line.slice(0, priceMatch.index).replace(/[xX]\s*\d+[\.,]?\d*\s*$/, '').trim();
    if (!name || name.length < 2) {
      continue;
    }

    items.push({
      id: `${Date.now()}-${items.length}`,
      name,
      price,
      owner: 'both'
    });
  }

  return items;
}

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2));
}

function normalizeItemName(name) {
  return name.toLowerCase().replace(/[^a-zàèéìòù0-9 ]/gi, '').replace(/\s+/g, ' ').trim();
}

function inferOwnerFromMemory(name, memory) {
  const key = normalizeItemName(name);
  const entry = memory[key];
  if (!entry) return 'both';

  const r = entry.r || 0;
  const t = entry.t || 0;
  const b = entry.both || 0;

  const top = Math.max(r, t, b);
  if (top < 2) return 'both';

  if (top === r && r > t && r > b) return 'r';
  if (top === t && t > r && t > b) return 't';
  return 'both';
}

app.post('/api/ocr', upload.single('receipt'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Carica una foto dello scontrino.' });
  }

  try {
    const result = await Tesseract.recognize(req.file.buffer, 'ita+eng', {
      logger: () => {}
    });

    const parsed = parseReceiptText(result.data.text);
    const memory = await readJson(MEMORY_FILE, {});

    const withSuggestions = parsed.map((item) => ({
      ...item,
      owner: inferOwnerFromMemory(item.name, memory)
    }));

    return res.json({
      text: result.data.text,
      items: withSuggestions
    });
  } catch (error) {
    return res.status(500).json({
      error: 'OCR non riuscito. Puoi inserire/modificare gli item manualmente.',
      details: error.message
    });
  }
});

app.get('/api/sessions', async (_req, res) => {
  const sessions = await readJson(SESSIONS_FILE, []);
  return res.json({ sessions });
});

app.post('/api/sessions', async (req, res) => {
  const { items, mealVouchers, paidBy, summary } = req.body;

  if (!Array.isArray(items)) {
    return res.status(400).json({ error: 'Items non validi.' });
  }

  const sessions = await readJson(SESSIONS_FILE, []);
  const memory = await readJson(MEMORY_FILE, {});

  for (const item of items) {
    const key = normalizeItemName(item.name || '');
    if (!key) continue;

    if (!memory[key]) {
      memory[key] = { r: 0, t: 0, both: 0 };
    }

    if (item.owner === 'r') memory[key].r += 1;
    else if (item.owner === 't') memory[key].t += 1;
    else memory[key].both += 1;
  }

  const payload = {
    id: `session-${Date.now()}`,
    createdAt: new Date().toISOString(),
    items,
    mealVouchers: Number(mealVouchers || 0),
    paidBy: paidBy === 'r' ? 'r' : 't',
    summary: summary || null
  };

  sessions.unshift(payload);

  await writeJson(SESSIONS_FILE, sessions.slice(0, 200));
  await writeJson(MEMORY_FILE, memory);

  return res.status(201).json({ ok: true, session: payload });
});

app.listen(PORT, () => {
  console.log(`Scoppia v1 attiva su http://localhost:${PORT}`);
});
