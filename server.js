const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

const dataset = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'models.json'), 'utf8'));

function estimateFob(model, year) {
  const yearsFromReference = dataset.referenceYear - year;
  const factor = Math.pow(1 - dataset.depreciationRatePerYear, yearsFromReference);
  const price = model.basePriceUsd * factor;
  return Math.max(Math.round(price / 50) * 50, dataset.minFobUsd);
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/meta', (req, res) => {
  res.json({ minYear: dataset.minYear, maxYear: dataset.maxYear });
});

app.get('/api/makes', (req, res) => {
  const makes = [...new Set(dataset.models.map((m) => m.make))].sort();
  res.json({ makes });
});

app.get('/api/models', (req, res) => {
  const { make } = req.query;
  if (!make) return res.status(400).json({ error: 'make query param is required' });
  const models = dataset.models
    .filter((m) => m.make.toLowerCase() === make.toLowerCase())
    .map((m) => m.model)
    .sort();
  res.json({ models });
});

app.get('/api/fob', (req, res) => {
  const { make, model, year } = req.query;
  if (!make || !model || !year) {
    return res.status(400).json({ error: 'make, model and year query params are required' });
  }
  const yearNum = parseInt(year, 10);
  if (Number.isNaN(yearNum) || yearNum < dataset.minYear || yearNum > dataset.maxYear) {
    return res.status(400).json({ error: `year must be between ${dataset.minYear} and ${dataset.maxYear}` });
  }

  const entry = dataset.models.find(
    (m) => m.make.toLowerCase() === make.toLowerCase() && m.model.toLowerCase() === model.toLowerCase()
  );

  if (!entry) {
    return res.status(404).json({ error: 'No pricing data found for that make/model' });
  }

  const fobUsd = estimateFob(entry, yearNum);

  res.json({
    make: entry.make,
    model: entry.model,
    year: yearNum,
    bodyType: entry.bodyType,
    engineCC: entry.engineCC,
    fobUsd,
    note: 'Estimated FOB based on typical Japanese export auction pricing trends, not a live listing.'
  });
});

let rateCache = { rate: null, updatedAt: null };
const RATE_CACHE_MS = 60 * 60 * 1000; // 1 hour

const SUPPORTED_CURRENCIES = ['NGN', 'GBP', 'EUR', 'CAD', 'ZAR', 'GHS'];
let ratesCache = { rates: null, updatedAt: null, source: null };

// OANDA Exchange Rates API - opt-in via OANDA_API_KEY. OANDA's API is sales-gated (no
// self-service signup, no published free tier), so this integration is written from
// indirect documentation signals only and has not been exercised against a real key -
// verify it against your own OANDA account docs and treat errors here as expected
// until confirmed working, at which point the fallback below won't be needed.
async function fetchRatesFromOanda(base, quotes) {
  const apiKey = process.env.OANDA_API_KEY;
  if (!apiKey) return null;

  const results = {};
  for (const quote of quotes) {
    const url = `https://exchange-rates-api.oanda.com/v2/rates/spot.json?base=${base}&quote=${quote}`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!response.ok) throw new Error(`OANDA API responded with ${response.status} for ${base}/${quote}`);
    const data = await response.json();
    const rate = data && data.quotes && data.quotes[0] && parseFloat(data.quotes[0].ask ?? data.quotes[0].bid);
    if (!rate) throw new Error(`OANDA API returned no usable rate for ${base}/${quote}`);
    results[quote] = rate;
  }
  return results;
}

async function fetchRatesFromOpenErApi(base, quotes) {
  const response = await fetch(`https://open.er-api.com/v6/latest/${base}`);
  if (!response.ok) throw new Error(`Exchange rate API responded with ${response.status}`);
  const data = await response.json();
  if (!data || !data.rates) throw new Error('No rates in exchange rate response');

  const results = {};
  for (const quote of quotes) {
    if (!data.rates[quote]) throw new Error(`${quote} rate not present in exchange rate response`);
    results[quote] = data.rates[quote];
  }
  return results;
}

async function getUsdRates() {
  const now = Date.now();
  if (ratesCache.rates && ratesCache.updatedAt && now - ratesCache.updatedAt < RATE_CACHE_MS) {
    return ratesCache;
  }

  let rates;
  let source;
  try {
    rates = await fetchRatesFromOanda('USD', SUPPORTED_CURRENCIES);
    source = 'oanda';
  } catch (err) {
    console.warn(`OANDA rate fetch failed, falling back to open.er-api.com: ${err.message}`);
    rates = null;
  }

  if (!rates) {
    rates = await fetchRatesFromOpenErApi('USD', SUPPORTED_CURRENCIES);
    source = 'open.er-api.com';
  }

  ratesCache = { rates, updatedAt: now, source };
  return ratesCache;
}

app.get('/api/exchange-rate', async (req, res) => {
  try {
    const { rates, updatedAt, source } = await getUsdRates();
    res.json({ base: 'USD', rates, updatedAt, source, cached: true });
  } catch (err) {
    if (ratesCache.rates) {
      return res.json({
        base: 'USD',
        rates: ratesCache.rates,
        updatedAt: ratesCache.updatedAt,
        source: ratesCache.source,
        cached: true,
        stale: true,
        warning: 'Live fetch failed, returning last known rates.'
      });
    }
    res.status(502).json({ error: 'Unable to fetch live exchange rates', details: err.message });
  }
});

// ---------- Car image lookup (Wikipedia/Wikimedia, no API key required) ----------
const carImageCache = new Map(); // key: "make|model" -> { data, cachedAt }
const CAR_IMAGE_CACHE_MS = 24 * 60 * 60 * 1000; // 24 hours
const WIKI_USER_AGENT = 'ICEstimator/1.0 (local dev tool; https://github.com/)';

function spacedModel(model) {
  // "GLE350" -> "GLE 350" — improves Wikipedia search matches for trim-suffixed model codes.
  return model.replace(/([A-Za-z])(\d)/g, '$1 $2');
}

async function searchWikipediaImage(query) {
  const url =
    'https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrlimit=5' +
    `&gsrsearch=${encodeURIComponent(query)}&prop=pageimages|info&piprop=original&inprop=url&format=json`;

  const response = await fetch(url, { headers: { 'User-Agent': WIKI_USER_AGENT } });
  if (!response.ok) throw new Error(`Wikipedia API responded with ${response.status}`);

  const data = await response.json();
  const pages = data && data.query && data.query.pages;
  if (!pages) return null;

  const sorted = Object.values(pages).sort((a, b) => (a.index || 99) - (b.index || 99));
  const withImage = sorted.find((p) => p.original);
  if (!withImage) return null;

  return {
    imageUrl: withImage.original.source,
    width: withImage.original.width,
    height: withImage.original.height,
    title: withImage.title,
    pageUrl: withImage.fullurl
  };
}

async function fetchCarImage(make, model) {
  const key = `${make}|${model}`.toLowerCase();
  const cached = carImageCache.get(key);
  if (cached && Date.now() - cached.cachedAt < CAR_IMAGE_CACHE_MS) {
    return cached.data;
  }

  const plainQuery = `${make} ${model}`;
  let result = await searchWikipediaImage(plainQuery);

  if (!result) {
    const spacedQuery = `${make} ${spacedModel(model)}`;
    if (spacedQuery !== plainQuery) {
      result = await searchWikipediaImage(spacedQuery);
    }
  }

  if (!result) return null;

  carImageCache.set(key, { data: result, cachedAt: Date.now() });
  return result;
}

app.get('/api/car-image', async (req, res) => {
  const { make, model } = req.query;
  if (!make || !model) {
    return res.status(400).json({ error: 'make and model query params are required' });
  }

  try {
    const image = await fetchCarImage(make, model);
    if (!image) {
      return res.status(404).json({ error: 'No image found for that make/model.' });
    }
    res.json(image);
  } catch (err) {
    res.status(502).json({ error: 'Unable to fetch a car image right now.', details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`ICEstimator running at http://localhost:${PORT}`);
});
