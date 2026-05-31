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


runCase(
  'scontrino MD con colonna IVA e footer',
  `
    BUONA SPESA CARD
    FIOCCHI D'AVENA 10,00 1,35
    4 TORTILLAS 4,00 1,25
    SALAME MILANO 10,00 1,99
    FAGIOLI BORLOTTI BIO 2X140G 10,00 1,59
    SEMI DI SESAMO GR 250 10,00 1,79
    3 PZ x EURO 1,49/PZ
    TOFU BIO 10,00 4.47
    CIPOLLA DORATA KG 1 400 1,19
    CAFFE' NAPOLETANO 22,00 3,39
    FUSILLI 4,00 0,85
    *ALBICOCCHE CESTINO GR500 4,00 1,99
    TEMPEH BIOLOGICO 10,00 2,49
    ARANCE VALENCIA KG2 4,00 2,78
    WAFER FARC/RICOPERTO CIOCC 10,00 1,59
    RISO INTEG PARBOILED 8MIN 4,00 2,19
    Subtot 28,91
    IMPORTO PAGATO 28,91
  `,
  [
    { name: "FIOCCHI D'AVENA", price: 1.35 },
    { name: '4 TORTILLAS', price: 1.25 },
    { name: 'SALAME MILANO', price: 1.99 },
    { name: 'FAGIOLI BORLOTTI BIO 2X140G', price: 1.59 },
    { name: 'SEMI DI SESAMO GR 250', price: 1.79 },
    { name: 'TOFU BIO', price: 4.47 },
    { name: 'CIPOLLA DORATA KG 1', price: 1.19 },
    { name: "CAFFE' NAPOLETANO", price: 3.39 },
    { name: 'FUSILLI', price: 0.85 },
    { name: 'ALBICOCCHE CESTINO GR500', price: 1.99 },
    { name: 'TEMPEH BIOLOGICO', price: 2.49 },
    { name: 'ARANCE VALENCIA KG2', price: 2.78 },
    { name: 'WAFER FARC/RICOPERTO CIOCC', price: 1.59 },
    { name: 'RISO INTEG PARBOILED 8MIN', price: 2.19 }
  ]
);

console.log('✅ Parser scontrino: tutti i test superati.');
