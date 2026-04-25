const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs/promises');
const { execFile } = require('child_process');
const { promisify } = require('util');
const Jimp = require('jimp');
const Tesseract = require('tesseract.js');
const sharp = require('sharp');
const { version: appVersion } = require('./package.json');
const { parseReceiptText } = require('./lib/receipt-parser');
Tesseract.setLogging(false);

const app = express();
const PORT = process.env.PORT || 3000;
const upload = multer({ storage: multer.memoryStorage() });
const buildId = process.env.APP_BUILD_ID || new Date().toISOString();

const DATA_DIR = path.join(__dirname, 'data');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const MEMORY_FILE = path.join(DATA_DIR, 'item-memory.json');
const TESSDATA_DIR = path.join(DATA_DIR, 'tessdata');
const TESSDATA_BASE_URL = process.env.TESSDATA_BASE_URL || 'https://tessdata.projectnaptha.com/4.0.0';
const execFileAsync = promisify(execFile);

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

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

async function ensureLanguageData(lang) {
  const target = path.join(TESSDATA_DIR, `${lang}.traineddata.gz`);

  try {
    await fs.access(target);
    return target;
  } catch {
    await fs.mkdir(TESSDATA_DIR, { recursive: true });
  }

  const url = `${TESSDATA_BASE_URL}/${lang}.traineddata.gz`;
  const tmpTarget = `${target}.tmp`;
  await execFileAsync('curl', ['-fL', url, '-o', tmpTarget], { timeout: 30000 });
  await fs.rename(tmpTarget, target);
  return target;
}

async function hasLanguageData(lang) {
  try {
    await fs.access(path.join(TESSDATA_DIR, `${lang}.traineddata.gz`));
    return true;
  } catch {
    return false;
  }
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

async function runOcrWithFallback(imageBuffer, trace = () => {}) {
  const attempts = [
    { lang: 'ita+eng', reason: 'primary' },
    { lang: 'ita', reason: 'italian fallback' },
    { lang: 'eng', reason: 'english fallback' }
  ];

  let lastError = null;
  const failures = [];
  const timeoutMs = Number(process.env.OCR_TIMEOUT_MS || 45000);
  const allLangs = new Set(attempts.flatMap((attempt) => attempt.lang.split('+')));

  for (const lang of allLangs) {
    trace('ensure-language-data:start', { lang });
    try {
      await ensureLanguageData(lang);
      trace('ensure-language-data:ok', { lang });
    } catch (error) {
      trace('ensure-language-data:error', { lang, message: error?.message || 'Download lingua OCR fallito' });
      failures.push({
        lang,
        reason: 'download-language-data',
        message: error?.message || 'Download lingua OCR fallito'
      });
    }
  }

  for (const attempt of attempts) {
    trace('ocr-attempt:start', { lang: attempt.lang, reason: attempt.reason });
    const attemptLangs = attempt.lang.split('+');
    const missingLangs = [];
    for (const lang of attemptLangs) {
      const available = await hasLanguageData(lang);
      if (!available) missingLangs.push(lang);
    }

    if (missingLangs.length > 0) {
      trace('ocr-attempt:skip-missing-language', { lang: attempt.lang, missingLangs });
      failures.push({
        lang: attempt.lang,
        reason: attempt.reason,
        message: `Lingue non disponibili in cache locale: ${missingLangs.join(', ')}`
      });
      continue;
    }

    try {
      const result = await Promise.race([
        Tesseract.recognize(imageBuffer, attempt.lang, {
          logger: () => {},
          tessedit_pageseg_mode: '6',
          preserve_interword_spaces: '1',
          load_system_dawg: '0',
          load_freq_dawg: '0',
          langPath: TESSDATA_DIR,
          cachePath: TESSDATA_DIR
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
      trace('ocr-attempt:error', { lang: attempt.lang, reason: attempt.reason, message: error?.message || 'Errore OCR non specificato' });
      lastError = error;
      failures.push({
        lang: attempt.lang,
        reason: attempt.reason,
        message: error?.message || 'Errore OCR non specificato'
      });

    }
  }

  if (lastError) {
    lastError.ocrFailures = failures;
  }

  throw lastError || new Error('OCR fallito senza dettagli aggiuntivi.');
}

async function rotateImage90Counterclockwise(imageBuffer, steps = 1) {
  const normalizedSteps = ((steps % 4) + 4) % 4;
  if (normalizedSteps === 0) return imageBuffer;

  const image = await Jimp.read(imageBuffer);
  const degrees = normalizedSteps * -90;
  image.rotate(degrees);
  return image.getBufferAsync(Jimp.MIME_PNG);
}

async function sanitizeImageForOcr(imageBuffer) {
  const image = await Jimp.read(imageBuffer);
  return image.getBufferAsync(Jimp.MIME_PNG);
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

  const timeline = [];
  const trace = (step, details = {}) => {
    timeline.push({
      at: new Date().toISOString(),
      step,
      ...details
    });
  };

  try {
    trace('request:received', {
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
      byteLength: req.file.buffer.length
    });

    trace('image:sanitize:start');
    const sanitizedImage = await sanitizeImageForOcr(req.file.buffer);
    trace('image:sanitize:ok', { byteLength: sanitizedImage.length });
    const rotationAttempts = [
      { steps: 0, label: 'originale' },
      { steps: 1, label: 'rotata 90° antiorario' },
      { steps: 2, label: 'rotata 180°' },
      { steps: 3, label: 'rotata 270° antiorario' }
    ];
    const orientationFailures = [];

    let ocrResult = null;
    let parsed = [];
    let usedRotation = rotationAttempts[0];

    for (const rotation of rotationAttempts) {
      trace('rotation:start', { rotation: rotation.label });
      try {
        const candidateImage = await rotateImage90Counterclockwise(sanitizedImage, rotation.steps);
        trace('rotation:prepared', { rotation: rotation.label, byteLength: candidateImage.length });
        const candidateOcr = await runOcrWithFallback(candidateImage, trace);
        const candidateParsed = parseReceiptText(candidateOcr.text);
        trace('parse:done', { rotation: rotation.label, parsedItems: candidateParsed.length });

        if (candidateParsed.length > 0) {
          ocrResult = candidateOcr;
          parsed = candidateParsed;
          usedRotation = rotation;
          trace('rotation:accepted', { rotation: rotation.label, parsedItems: candidateParsed.length });
          break;
        }

        orientationFailures.push({
          rotation: rotation.label,
          message: 'Nessuna riga articolo+prezzo riconosciuta'
        });
        trace('rotation:empty-items', { rotation: rotation.label });
      } catch (error) {
        orientationFailures.push({
          rotation: rotation.label,
          message: error?.message || 'Errore OCR non specificato',
          failures: error?.ocrFailures || []
        });
        trace('rotation:error', { rotation: rotation.label, message: error?.message || 'Errore OCR non specificato' });
      }
    }

    if (!ocrResult) {
      const error = new Error('Nessuna riga riconosciuta dopo 4 orientamenti (0°, 90°, 180°, 270°).');
      error.orientationFailures = orientationFailures;
      error.timeline = timeline;
      throw error;
    }

    const memory = await readJson(MEMORY_FILE, {});

    const withSuggestions = parsed.map((item) => ({
      ...item,
      owner: inferOwnerFromMemory(item.name, memory)
    }));

    return res.json({
      text: ocrResult.text,
      items: withSuggestions,
      usedLanguage: ocrResult.usedLanguage,
      usedRotation: usedRotation.label,
      warning: ocrResult.usedFallback
        ? `OCR in fallback con lingua ${ocrResult.usedLanguage}.`
        : null,
      info: usedRotation.steps > 0 ? `OCR riuscito con immagine ${usedRotation.label}.` : null,
      timeline,
      debug: {
        parsedItems: withSuggestions.length,
        usedRotation: usedRotation.label,
        usedLanguage: ocrResult.usedLanguage,
        textPreview: ocrResult.text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 20)
      }
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
        failures: error?.ocrFailures || [],
        orientationFailures: error?.orientationFailures || [],
        timeline: error?.timeline || timeline
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
