const state = {
  items: [],
  loading: false
};

const els = {
  receiptImage: document.getElementById('receiptImage'),
  extractBtn: document.getElementById('extractBtn'),
  status: document.getElementById('status'),
  appVersion: document.getElementById('appVersion'),
  ocrDebugDetails: document.getElementById('ocrDebugDetails'),
  ocrDebugOutput: document.getElementById('ocrDebugOutput'),
  itemsList: document.getElementById('itemsList'),
  itemTemplate: document.getElementById('itemTemplate'),
  addItemBtn: document.getElementById('addItemBtn'),
  mealVouchers: document.getElementById('mealVouchers'),
  paidBy: document.getElementById('paidBy'),
  summary: document.getElementById('summary'),
  saveBtn: document.getElementById('saveBtn'),
  saveMessage: document.getElementById('saveMessage')
};

function euro(value) {
  return Number(value || 0).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
}

function updateSummary() {
  const totals = state.items.reduce(
    (acc, item) => {
      const price = Number(item.price) || 0;
      if (item.owner === 'r') acc.personalR += price;
      else if (item.owner === 't') acc.personalT += price;
      else acc.common += price;
      return acc;
    },
    { personalR: 0, personalT: 0, common: 0 }
  );

  const dueR = totals.personalR + totals.common / 2;
  const dueT = totals.personalT + totals.common / 2;

  const mealVouchers = Math.max(0, Number(els.mealVouchers.value) || 0);
  const total = totals.personalR + totals.personalT + totals.common;
  const paidAtCashier = Math.max(total - mealVouchers, 0);
  const paidBy = els.paidBy.value;
  const paidByT = paidBy === 't' ? paidAtCashier : 0;

  const finalR = dueR - mealVouchers;
  const finalT = dueT - paidByT;

  els.summary.innerHTML = `
    <div class="summary-line"><span>Item personali R</span><strong>${euro(totals.personalR)}</strong></div>
    <div class="summary-line"><span>Item personali T</span><strong>${euro(totals.personalT)}</strong></div>
    <div class="summary-line"><span>Spesa comune</span><strong>${euro(totals.common)}</strong></div>
    <div class="summary-line"><span>Quota dovuta R (personali + comune/2)</span><strong>${euro(dueR)}</strong></div>
    <div class="summary-line"><span>Quota dovuta T (personali + comune/2)</span><strong>${euro(dueT)}</strong></div>
    <div class="summary-line"><span>Buoni pasto R</span><strong>${euro(mealVouchers)}</strong></div>
    <div class="summary-line"><span>Pagato alla cassa da T</span><strong>${euro(paidByT)}</strong></div>
    <div class="summary-line"><span><strong>Finale R = dovuto R - buoni</strong></span><strong>${euro(finalR)}</strong></div>
    <div class="summary-line"><span><strong>Finale T = dovuto T - cassa T</strong></span><strong>${euro(finalT)}</strong></div>
  `;

  return {
    ...totals,
    dueR,
    dueT,
    mealVouchers,
    paidBy,
    paidByT,
    paidAtCashier,
    finalR,
    finalT,
    total
  };
}

function setStatus(message) {
  els.status.textContent = message;
}

function setOcrDebug(debugPayload) {
  if (!debugPayload) {
    els.ocrDebugOutput.textContent = '';
    els.ocrDebugDetails.open = false;
    return;
  }

  els.ocrDebugOutput.textContent = JSON.stringify(debugPayload, null, 2);
  els.ocrDebugDetails.open = true;
}

async function loadAppMeta() {
  try {
    const response = await fetch('/api/meta');
    const data = await response.json();
    if (!response.ok) {
      throw new Error('meta endpoint non disponibile');
    }
    els.appVersion.textContent = `v${data.appVersion} · build ${data.buildId}`;
  } catch (_error) {
    els.appVersion.textContent = 'versione non disponibile';
  }
}

function renderItems() {
  els.itemsList.innerHTML = '';

  state.items.forEach((item) => {
    const node = els.itemTemplate.content.firstElementChild.cloneNode(true);

    const nameInput = node.querySelector('.name-input');
    const priceInput = node.querySelector('.price-input');
    const ownerButtons = node.querySelectorAll('.owner-group button');
    const deleteBtn = node.querySelector('.delete-btn');

    nameInput.value = item.name || '';
    priceInput.value = item.price ?? 0;

    ownerButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.owner === item.owner);
      btn.addEventListener('click', () => {
        item.owner = btn.dataset.owner;
        renderItems();
      });
    });

    nameInput.addEventListener('input', (event) => {
      item.name = event.target.value;
    });

    priceInput.addEventListener('input', (event) => {
      item.price = Number(event.target.value) || 0;
      updateSummary();
    });

    deleteBtn.addEventListener('click', () => {
      state.items = state.items.filter((it) => it.id !== item.id);
      renderItems();
    });

    els.itemsList.appendChild(node);
  });

  updateSummary();
}

function addEmptyItem() {
  state.items.push({
    id: crypto.randomUUID(),
    name: '',
    price: 0,
    owner: 'both'
  });
  renderItems();
}

async function extractReceipt() {
  const file = els.receiptImage.files?.[0];
  if (!file) {
    setStatus('Seleziona prima una foto dello scontrino.');
    return;
  }

  const form = new FormData();
  form.append('receipt', file);

  setStatus('OCR in corso...');
  setOcrDebug(null);

  try {
    const response = await fetch('/api/ocr', {
      method: 'POST',
      body: form
    });
    const data = await response.json();

    if (!response.ok) {
      const message = data.error || 'OCR non riuscito.';
      const debugPayload = {
        requestId: data.requestId || null,
        details: data.details || null,
        debug: data.debug || null
      };
      const error = new Error(message);
      error.debugPayload = debugPayload;
      throw error;
    }

    state.items = data.items.length
      ? data.items.map((it) => ({ ...it, id: crypto.randomUUID() }))
      : [{ id: crypto.randomUUID(), name: '', price: 0, owner: 'both' }];

    const extra = data.warning ? ` (${data.warning})` : '';
    const hint = data.items.length === 0 ? ' Prova a rifare la foto più dritta e vicina agli item.' : '';
    setStatus(`Righe estratte: ${data.items.length}. Correggi se necessario.${extra}${hint}`);
    renderItems();
  } catch (error) {
    setOcrDebug(error.debugPayload || { message: error.message });
    setStatus(`${error.message} Aggiungi le righe manualmente.`);
    console.error('Errore OCR:', error);
  }
}

async function saveSession() {
  const summary = updateSummary();

  const payload = {
    items: state.items,
    mealVouchers: Number(els.mealVouchers.value) || 0,
    paidBy: els.paidBy.value,
    summary
  };

  const response = await fetch('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    els.saveMessage.textContent = 'Salvataggio non riuscito.';
    return;
  }

  els.saveMessage.textContent = 'Conto accettato e salvato in archivio locale ✅';
}

els.extractBtn.addEventListener('click', extractReceipt);
els.addItemBtn.addEventListener('click', addEmptyItem);
els.mealVouchers.addEventListener('input', updateSummary);
els.paidBy.addEventListener('change', updateSummary);
els.saveBtn.addEventListener('click', saveSession);

addEmptyItem();
loadAppMeta();
