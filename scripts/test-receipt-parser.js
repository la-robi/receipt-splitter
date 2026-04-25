const assert = require('assert');
const { parseReceiptText } = require('../lib/receipt-parser');

function runCase(name, text, expected) {
  const actual = parseReceiptText(text).map((item) => ({
    name: item.name,
    price: item.price
  }));

  assert.deepStrictEqual(actual, expected, `Caso fallito: ${name}\nAtteso: ${JSON.stringify(expected)}\nRicevuto: ${JSON.stringify(actual)}`);
}

runCase(
  'linea articolo + prezzo sulla stessa riga',
  `
    PASTA FRESCA 2,39
    ACQUA NATURALE 0,49
    TOTALE 2,88
  `,
  [
    { name: 'PASTA FRESCA', price: 2.39 },
    { name: 'ACQUA NATURALE', price: 0.49 }
  ]
);

runCase(
  'articolo e prezzo su righe separate',
  `
    MELA GOLDEN
    1,99
    PANE
    2.10
    TOTALE
    4,09
  `,
  [
    { name: 'MELA GOLDEN', price: 1.99 },
    { name: 'PANE', price: 2.1 }
  ]
);

runCase(
  'ignora righe di totali e tiene prezzo negativo',
  `
    SCONTO FEDELTA -0,50
    LATTE INTERO 1,39
    SUBTOTALE 0,89
  `,
  [
    { name: 'SCONTO FEDELTA', price: -0.5 },
    { name: 'LATTE INTERO', price: 1.39 }
  ]
);

console.log('✅ Parser scontrino: tutti i test superati.');
