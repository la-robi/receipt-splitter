const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs/promises');
const Tesseract = require('tesseract.js');
const { version: appVersion } = require('./package.json');

const app = express();
const PORT = process.env.PORT || 3000;
const upload = multer({ storage: multer.memoryStorage() });
const buildId = process.env.APP_BUILD_ID || new Date().toISOString();

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
  'qta',
  'ticket',
  'elettronico',
  'documento commerciale'
];

function parsePrice(raw) {
  if (!raw) return null;
  const normalized = raw
    .replace(/\s+/g, '')
    .replace(/\.(?=\d{3}(\D|$))/g, '')
    .replace(',', '.')
    .replace(/[^0-9.-]/g, '');

  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) ? Number(value.toFixed(2)) : null;
}

function isLikelyTextLine(line) {
  const cleaned = line.replace(/[^a-zàèéìòù ]/gi, '').trim();
  return cleaned.length >= 2;
}

function hasStopword(line) {
  const low = line.toLowerCase();
  return STOPWORDS.some((stopword) => low.includes(stopword));
}

function parseReceiptText(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const items = [];
  let pendingName = null;

  for (const line of lines) {
    if (hasStopword(line)) {
      pendingName = null;
      continue;
    }

    const priceOnly = line.match(/^(-?\d+(?:[\.,]\d{2})?)$/);
    if (priceOnly && pendingName) {
      const price = parsePrice(priceOnly[1]);
      if (price !== null) {
        items.push({
          id: `${Date.now()}-${items.length}`,
          name: pendingName,
          price,
          owner: 'both'
        });
      }
      pendingName = null;
      continue;
    }

    const lineWithPrice = line.match(/(-?\d{1,3}(?:[\.\s]\d{3})*[\.,]\s?\d{2}|-?\d+[\.,]\s?\d{2})\s*$/);
    if (lineWithPrice) {
      const price = parsePrice(lineWithPrice[1]);
      if (price === null) {
        pendingName = null;
        continue;
      }

      const name = line
        .slice(0, lineWithPrice.index)
        .replace(/[xX]\s*\d+[\.,]?\d*\s*$/, '')
        .trim();

      if (isLikelyTextLine(name) && !hasStopword(name)) {
        items.push({
          id: `${Date.now()}-${items.length}`,
          name,
          price,
          owner: 'both'
        });
      }

      pendingName = null;
      continue;
    }

    if (isLikelyTextLine(line)) {
      pendingName = line;
    }
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

async function runOcrWithFallback(imageBuffer) {
  const attempts = [
    { lang: 'ita+eng', reason: 'primary' },
    { lang: 'ita', reason: 'italian fallback' },
    { lang: 'eng', reason: 'english fallback' }
  ];

  let lastError = null;
  const failures = [];
  const timeoutMs = Number(process.env.OCR_TIMEOUT_MS || 45000);

  for (const attempt of attempts) {
    try {
      const result = await Promise.race([
        Tesseract.recognize(imageBuffer, attempt.lang, {
          logger: () => {},
          tessedit_pageseg_mode: '6',
          preserve_interword_spaces: '1',
          load_system_dawg: '0',
          load_freq_dawg: '0'
        }),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error(`OCR timeout (${timeoutMs}ms) on ${attempt.lang}`)), timeoutMs);
        })
      ]);

      return {
        text: result.data.text,
        usedLanguage: attempt.lang,
        usedFallback: attempt.reason !== 'primary'
      };
    } catch (error) {
      lastError = error;
      failures.push({
        lang: attempt.lang,
        reason: attempt.reason,
        message: error?.message || 'Errore OCR non specificato'
      });

      const message = String(error?.message || '').toLowerCase();
      const isNetworkLanguageLoadIssue =
        message.includes('fetch') ||
        message.includes('network') ||
        message.includes('failed to load') ||
        message.includes('traineddata');

      if (isNetworkLanguageLoadIssue) {
        break;
      }
    }
  }

  if (lastError) {
    lastError.ocrFailures = failures;
  }

  throw lastError || new Error('OCR fallito senza dettagli aggiuntivi.');
}

app.get('/api/meta', (_req, res) => {
  return res.json({
    appVersion,
    buildId
  });
});

app.post('/api/ocr', upload.single('receipt'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Carica una foto dello scontrino.' });
  }

  try {
    const ocrResult = await runOcrWithFallback(req.file.buffer);
    const parsed = parseReceiptText(ocrResult.text);
    const memory = await readJson(MEMORY_FILE, {});

    const withSuggestions = parsed.map((item) => ({
      ...item,
      owner: inferOwnerFromMemory(item.name, memory)
    }));

    return res.json({
      text: ocrResult.text,
      items: withSuggestions,
      usedLanguage: ocrResult.usedLanguage,
      warning: ocrResult.usedFallback
        ? `OCR in fallback con lingua ${ocrResult.usedLanguage}.`
        : null
    });
  } catch (error) {
    const requestId = `ocr-${Date.now()}`;
    console.error(`[${requestId}] OCR error`, error);

    return res.status(500).json({
      error: 'OCR non riuscito. Puoi inserire/modificare gli item manualmente.',
      requestId,
      details: error.message,
      debug: {
        name: error?.name || 'Error',
        message: error?.message || 'Errore OCR non specificato',
        stack: error?.stack || null,
        failures: error?.ocrFailures || []
      }
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
  console.log(`Scoppia v${appVersion} attiva su http://localhost:${PORT} (build ${buildId})`);
});
