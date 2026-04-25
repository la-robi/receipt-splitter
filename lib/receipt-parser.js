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

const PRICE_AT_END_REGEX = /(-?\d{1,3}(?:[\.\s]\d{3})*[,\.\s]\d{2}|-?\d+[,\.\s]\d{2}|-?\d+)\s*(?:€|eur)?\s*$/i;

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

function cleanupItemName(rawName) {
  if (!rawName) return '';
  return rawName
    .replace(/^\d+\s*[xX]\s*/g, '')
    .replace(/[xX]\s*\d+[.,]?\d*\s*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function parseReceiptText(text) {
  const lines = String(text || '')
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

    const priceOnly = line.match(/^(-?\d+(?:[\.,]\d{2})?)\s*(?:€|eur)?$/i);
    if (priceOnly && pendingName) {
      const price = parsePrice(priceOnly[1]);
      const name = cleanupItemName(pendingName);
      if (price !== null && isLikelyTextLine(name) && !hasStopword(name)) {
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

    const lineWithPrice = line.match(PRICE_AT_END_REGEX);
    if (lineWithPrice) {
      const price = parsePrice(lineWithPrice[1]);
      if (price === null) {
        pendingName = null;
        continue;
      }

      const namePart = line.slice(0, lineWithPrice.index);
      const fallbackName = pendingName && pendingName.length > namePart.length ? pendingName : namePart;
      const name = cleanupItemName(fallbackName);

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

module.exports = {
  parsePrice,
  parseReceiptText
};
