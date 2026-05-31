const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = Number(process.env.OCR_TEST_PORT || 3130);
const DEFAULT_FIXTURE_CANDIDATES = [
  path.join(__dirname, '..', 'data', 'scontrino.jpg'),
  '/tmp/user_uploaded_attachments/image_1.jpg'
];

async function fileExistsWithContent(filePath) {
  try {
    const stats = await fs.promises.stat(filePath);
    return stats.isFile() && stats.size > 1024;
  } catch {
    return false;
  }
}

async function findFixturePath() {
  const candidates = [
    process.env.OCR_FIXTURE_PATH,
    ...DEFAULT_FIXTURE_CANDIDATES
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (await fileExistsWithContent(candidate)) return candidate;
  }

  return null;
}

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server OCR non avviato entro 10s')), 10000);

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      if (text.includes(`http://localhost:${PORT}`)) {
        clearTimeout(timeout);
        resolve();
      }
    });

    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.once('exit', (code) => {
      clearTimeout(timeout);
      if (code !== null && code !== 0) {
        reject(new Error(`Server OCR terminato prematuramente con codice ${code}`));
      }
    });
  });
}

(async () => {
  const fixturePath = await findFixturePath();
  if (!fixturePath) {
    console.warn('⚠️ OCR fixture scontrino saltato: imposta OCR_FIXTURE_PATH con il percorso della foto reale dello scontrino.');
    return;
  }

  const server = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      APP_BUILD_ID: 'test-ocr-scontrino',
      OCR_REQUEST_TIMEOUT_MS: '30000',
      OCR_PRIMARY_TIMEOUT_MS: '12000',
      PORT: String(PORT)
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stderr = '';
  server.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  try {
    await waitForServer(server);

    const body = new FormData();
    const image = await fs.promises.readFile(fixturePath);
    body.append('receipt', new Blob([image], { type: 'image/jpeg' }), path.basename(fixturePath));

    const startedAt = Date.now();
    const response = await fetch(`http://localhost:${PORT}/api/ocr`, {
      method: 'POST',
      body
    });
    const elapsedMs = Date.now() - startedAt;
    const payload = await response.json();

    assert.strictEqual(response.status, 200, JSON.stringify(payload, null, 2));
    assert.ok(Array.isArray(payload.items), 'La risposta OCR deve includere items[]');
    assert.ok(payload.items.length >= 10, `Attesi almeno 10 item, ricevuti ${payload.items.length}`);
    assert.strictEqual(payload.items[1]?.name, '4 TORTILLAS');
    assert.strictEqual(payload.items[1]?.price, 1.25);
    assert.ok(
      payload.timeline.some((event) => event.step === 'rotation:early-accepted'),
      'Lo scontrino dritto deve essere accettato senza OCR sulle rotazioni lente'
    );
    assert.ok(elapsedMs < 15000, `OCR troppo lento per il fixture (${elapsedMs}ms)`);

    console.log(`✅ OCR fixture scontrino: seconda riga "${payload.items[1].name}" prezzo ${payload.items[1].price.toFixed(2)} (${payload.items.length} item, ${elapsedMs}ms).`);
  } finally {
    server.kill('SIGTERM');
    if (stderr.trim()) {
      process.stderr.write(stderr);
    }
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
