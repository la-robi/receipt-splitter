const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeElement(id) {
  return {
    id,
    textContent: '',
    innerHTML: '',
    value: id === 'paidBy' ? 't' : '',
    open: false,
    files: [],
    children: [],
    classList: {
      toggle() {}
    },
    dataset: {},
    addEventListener() {},
    appendChild(node) {
      this.children.push(node);
    },
    querySelector() {
      return makeElement('child');
    },
    querySelectorAll() {
      return [
        { dataset: { owner: 'both' }, classList: { toggle() {} }, addEventListener() {} },
        { dataset: { owner: 'r' }, classList: { toggle() {} }, addEventListener() {} },
        { dataset: { owner: 't' }, classList: { toggle() {} }, addEventListener() {} }
      ];
    },
    cloneNode() {
      return makeElement('row');
    }
  };
}

const elements = new Map();
function getElement(id) {
  if (!elements.has(id)) {
    elements.set(id, makeElement(id));
  }
  return elements.get(id);
}

getElement('itemTemplate').content = {
  firstElementChild: makeElement('template-row')
};

const appCode = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const sandbox = {
  console: {
    error() {},
    log() {},
    warn() {}
  },
  document: {
    title: '',
    getElementById: getElement
  },
  fetch: async (url) => {
    if (url === '/api/meta') {
      return {
        ok: true,
        json: async () => ({ appVersion: 'test', buildId: 'test-build' })
      };
    }

    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () => JSON.stringify({
        items: [
          { name: 'PANE', price: 1.25, owner: 'both' },
          { name: 'LATTE', price: 1.5, owner: 'both' }
        ],
        timeline: []
      })
    };
  },
  FormData: class FormData {
    append() {}
  },
  Date,
  Math,
  Number,
  String,
  JSON,
  Error,
  Array,
  globalThis: null,
  crypto: {}
};
sandbox.globalThis = sandbox;

vm.createContext(sandbox);
assert.doesNotThrow(() => {
  vm.runInContext(`${appCode}\nglobalThis.__testApi = { createItemId, extractReceipt };`, sandbox, {
    filename: 'public/app.js'
  });
}, 'l\'app non deve dipendere da crypto.randomUUID durante l\'avvio');

const firstId = sandbox.__testApi.createItemId();
const secondId = sandbox.__testApi.createItemId();
assert.match(firstId, /^item-[a-z0-9]+-[a-z0-9]+-[a-z0-9]+$/);
assert.match(secondId, /^item-[a-z0-9]+-[a-z0-9]+-[a-z0-9]+$/);
assert.notStrictEqual(firstId, secondId, 'gli ID fallback devono restare univoci nella sessione');

getElement('receiptImage').files = [{ name: 'receipt.jpg', size: 1234, type: 'image/jpeg' }];

(async () => {
  await sandbox.__testApi.extractReceipt();
  assert.match(getElement('status').textContent, /Righe estratte: 2/);
  assert.doesNotMatch(getElement('ocrLiveLog').textContent, /crypto\.randomUUID is not a function/);
  console.log('✅ Fallback ID client: test superato senza crypto.randomUUID.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
