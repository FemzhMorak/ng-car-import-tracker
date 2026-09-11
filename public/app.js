const searchCard = document.getElementById('search-card');
const makeSelect = document.getElementById('make');
const modelSelect = document.getElementById('model');
const yearSelect = document.getElementById('year');
const searchForm = document.getElementById('search-form');
const searchBtn = document.getElementById('search-btn');
const searchHint = document.getElementById('search-hint');

const fobCard = document.getElementById('fob-card');
const fobSummary = document.getElementById('fob-summary');
const fobInput = document.getElementById('fob');
const engineCCInput = document.getElementById('engineCC');
const freightInput = document.getElementById('freight');
const insuranceInput = document.getElementById('insurance');
const calcBtn = document.getElementById('calc-btn');

const carPhoto = document.getElementById('car-photo');
const carPhotoImg = document.getElementById('car-photo-img');
const carPhotoSkeleton = document.getElementById('car-photo-skeleton');
const carPhotoCaption = document.getElementById('car-photo-caption');

const resultCard = document.getElementById('result-card');
const breakdownBody = document.querySelector('#breakdown-table tbody');
const rateNote = document.getElementById('rate-note');

const donutEl = document.getElementById('donut');
const heroTotal = document.getElementById('hero-total');
const heroUsd = document.getElementById('hero-usd');
const currencySelect = document.getElementById('currency-select');
const legendEls = {
  fob: document.getElementById('legend-fob'),
  shipping: document.getElementById('legend-shipping'),
  duties: document.getElementById('legend-duties'),
  vat: document.getElementById('legend-vat')
};

const CURRENCY_SYMBOLS = {
  NGN: '₦',
  USD: '$',
  GBP: '£',
  EUR: '€',
  CAD: 'CA$',
  ZAR: 'R',
  GHS: '₵'
};

const stepEls = document.querySelectorAll('#steps .step');
const fobBackBtn = document.getElementById('fob-back-btn');
const resultBackBtn = document.getElementById('result-back-btn');

const usd = (n) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

// Formats a USD amount into any supported currency using the cached rates table.
// Returns null if we don't have a rate for that currency (caller shows a fallback).
function fmtCurrency(amountUsd, code) {
  const rate = code === 'USD' ? 1 : ratesTable[code];
  if (!rate) return null;
  const symbol = CURRENCY_SYMBOLS[code] || `${code} `;
  const value = Math.round(amountUsd * rate);
  return `${symbol}${value.toLocaleString('en-US')}`;
}

let ratesTable = {}; // { NGN: 1326.0, GBP: 0.74, ... } — USD implicit at 1
let ratesMeta = { updatedAt: null, source: null, stale: false };
let selectedCurrency = 'NGN';
let lastBreakdown = null; // set once "Calculate" has run; re-used when the currency selector changes
let carPhotoRequestId = 0;
let currentStep = 1;

const panelForStep = { 1: searchCard, 2: fobCard, 3: resultCard };

function setStep(n) {
  currentStep = n;
  stepEls.forEach((el) => {
    const step = parseInt(el.dataset.step, 10);
    el.classList.remove('is-active', 'is-done');
    if (step < n) el.classList.add('is-done');
    else if (step === n) el.classList.add('is-active');
  });
}

function showPanel(el, direction) {
  el.classList.toggle('from-left', direction === 'backward');
  el.hidden = false;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => el.classList.add('is-visible'));
  });
}

function hidePanel(el) {
  el.classList.remove('is-visible');
  el.hidden = true;
}

function goToStep(n) {
  if (n === currentStep) return;
  const from = panelForStep[currentStep];
  const to = panelForStep[n];
  if (!from || !to) return;
  const direction = n < currentStep ? 'backward' : 'forward';
  hidePanel(from);
  showPanel(to, direction);
  setStep(n);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

stepEls.forEach((el) => {
  el.addEventListener('click', () => {
    const target = parseInt(el.dataset.step, 10);
    if (target > currentStep) return; // can't skip ahead to a step with no data yet
    goToStep(target);
  });
});

fobBackBtn.addEventListener('click', () => goToStep(1));
resultBackBtn.addEventListener('click', () => goToStep(2));

currencySelect.addEventListener('change', () => {
  selectedCurrency = currencySelect.value;
  updateRateNote();
  if (lastBreakdown) renderResults();
});

function animateValue(el, from, to, formatFn, duration = 700) {
  const start = performance.now();
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

  function tick(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const eased = easeOutCubic(progress);
    const value = from + (to - from) * eased;
    el.textContent = formatFn(value);
    if (progress < 1) requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}

async function init() {
  try {
    const [meta, makesRes] = await Promise.all([
      fetch('/api/meta').then((r) => r.json()),
      fetch('/api/makes').then((r) => r.json())
    ]);

    yearSelect.innerHTML = '';
    for (let y = meta.maxYear; y >= meta.minYear; y--) {
      const opt = document.createElement('option');
      opt.value = y;
      opt.textContent = y;
      yearSelect.appendChild(opt);
    }

    makeSelect.innerHTML = '<option value="" disabled selected>Select make</option>';
    makesRes.makes.forEach((make) => {
      const opt = document.createElement('option');
      opt.value = make;
      opt.textContent = make;
      makeSelect.appendChild(opt);
    });
  } catch (err) {
    searchHint.textContent = 'Could not load car data. Is the server running?';
    searchHint.classList.add('error');
  }

  fetchExchangeRate();
}

function updateRateNote() {
  const rate = ratesTable[selectedCurrency];
  if (selectedCurrency === 'USD') {
    rateNote.textContent = '';
    return;
  }
  if (!rate) {
    rateNote.textContent = `Live exchange rate unavailable for ${selectedCurrency} — figures may be incomplete.`;
    return;
  }
  const when = ratesMeta.updatedAt ? new Date(ratesMeta.updatedAt).toLocaleString() : 'unknown time';
  const sourceLabel = ratesMeta.source === 'oanda' ? 'OANDA' : 'open.er-api.com';
  rateNote.textContent = `Exchange rate: 1 USD = ${fmtCurrency(1, selectedCurrency)} ${selectedCurrency} (${sourceLabel}, fetched ${when}${ratesMeta.stale ? ', last known rate' : ''}).`;
}

async function fetchExchangeRate() {
  try {
    const res = await fetch('/api/exchange-rate');
    const data = await res.json();
    if (data.rates) {
      ratesTable = data.rates;
      ratesMeta = { updatedAt: data.updatedAt, source: data.source, stale: Boolean(data.stale) };
    }
  } catch (err) {
    rateNote.textContent = 'Live exchange rates unavailable — figures may be incomplete.';
    return;
  }
  updateRateNote();
  if (lastBreakdown) renderResults();
}

makeSelect.addEventListener('change', async () => {
  modelSelect.disabled = true;
  modelSelect.innerHTML = '<option value="" disabled selected>Loading…</option>';
  try {
    const res = await fetch(`/api/models?make=${encodeURIComponent(makeSelect.value)}`);
    const data = await res.json();
    modelSelect.innerHTML = '<option value="" disabled selected>Select model</option>';
    data.models.forEach((model) => {
      const opt = document.createElement('option');
      opt.value = model;
      opt.textContent = model;
      modelSelect.appendChild(opt);
    });
    modelSelect.disabled = false;
  } catch (err) {
    modelSelect.innerHTML = '<option value="" disabled selected>Failed to load models</option>';
  }
});

async function loadCarPhoto(make, model) {
  const requestId = ++carPhotoRequestId;

  carPhoto.hidden = false;
  carPhotoImg.classList.remove('is-loaded');
  carPhotoImg.src = '';
  carPhotoSkeleton.classList.remove('is-done');
  carPhotoCaption.textContent = '';

  try {
    const res = await fetch(`/api/car-image?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}`);
    const data = await res.json();
    if (requestId !== carPhotoRequestId) return; // a newer search superseded this one

    if (!res.ok) throw new Error(data.error || 'No image found.');

    carPhotoImg.src = data.imageUrl;
    carPhotoImg.alt = `${make} ${model}`;
    carPhotoImg.onload = () => carPhotoImg.classList.add('is-loaded');
    carPhotoSkeleton.classList.add('is-done');
    carPhotoCaption.innerHTML = `Photo: <a href="${data.pageUrl}" target="_blank" rel="noopener">${data.title}</a> · Wikipedia`;
  } catch (err) {
    if (requestId !== carPhotoRequestId) return;
    carPhotoSkeleton.classList.add('is-done');
    carPhoto.hidden = true;
  }
}

searchForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  searchHint.textContent = '';
  searchHint.classList.remove('error');
  searchBtn.disabled = true;
  searchBtn.querySelector('span').textContent = 'Searching…';

  try {
    const params = new URLSearchParams({
      make: makeSelect.value,
      model: modelSelect.value,
      year: yearSelect.value
    });
    const res = await fetch(`/api/fob?${params.toString()}`);
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'No pricing data found for that selection.');
    }

    fobSummary.innerHTML = `<strong>${data.year} ${data.make} ${data.model}</strong> (${data.bodyType}, ${data.engineCC}cc) — estimated FOB <strong>${usd(data.fobUsd)}</strong>. <br><span style="font-size:0.8rem">${data.note}</span>`;
    fobInput.value = data.fobUsd;
    engineCCInput.value = data.engineCC;
    freightInput.value = estimateFreight(data.bodyType);
    insuranceInput.value = Math.round(data.fobUsd * 0.01);

    loadCarPhoto(data.make, data.model);

    hidePanel(searchCard);
    showPanel(fobCard, 'forward');
    setStep(2);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    searchHint.textContent = err.message;
    searchHint.classList.add('error');
  } finally {
    searchBtn.disabled = false;
    searchBtn.querySelector('span').textContent = 'Get FOB Price';
  }
});

function estimateFreight(bodyType) {
  const rates = {
    Sedan: 1200,
    SUV: 1600,
    Pickup: 1700,
    Minivan: 1700
  };
  return rates[bodyType] || 1500;
}

function fmtOrUsdFallback(amountUsd, code) {
  return fmtCurrency(amountUsd, code) || `${usd(amountUsd)} (${code} rate unavailable)`;
}

function renderResults({ animate = false } = {}) {
  if (!lastBreakdown) return;
  const { fob, freight, insurance, cif, importDuty, nacLevy, greenTax, engineCC, surcharge, otherFees, subtotal, vat, totalUsd } =
    lastBreakdown;
  const code = selectedCurrency;

  const rows = [
    ['FOB price', fmtOrUsdFallback(fob, code), ''],
    ['Freight', fmtOrUsdFallback(freight, code), ''],
    ['Insurance', fmtOrUsdFallback(insurance, code), ''],
    ['CIF value', fmtOrUsdFallback(cif, code), 'FOB + Freight + Insurance'],
    ['Import Duty', fmtOrUsdFallback(importDuty, code), '20% of CIF'],
    ['NAC Levy', fmtOrUsdFallback(nacLevy, code), '5% of CIF'],
    [
      'Green Tax',
      fmtOrUsdFallback(greenTax, code),
      engineCC > 2000 ? '2% of CIF (engine > 2000cc)' : 'Not applicable (engine ≤ 2000cc)'
    ],
    ['Surcharge', fmtOrUsdFallback(surcharge, code), '7% of Import Duty'],
    ['Other Fees', fmtOrUsdFallback(otherFees, code), '4% of FOB'],
    ['Subtotal', fmtOrUsdFallback(subtotal, code), 'CIF + Duty + Levy + Green Tax + Surcharge + Other Fees', 'subtotal'],
    ['VAT', fmtOrUsdFallback(vat, code), '7.5% of Subtotal', 'vat']
  ];

  breakdownBody.innerHTML = rows
    .map(
      ([label, value, formula, cls]) => `
      <tr class="${cls || ''}">
        <td>${label}${formula ? `<br><span class="formula-text">${formula}</span>` : ''}</td>
        <td>${value}</td>
      </tr>`
    )
    .join('');

  // Donut segments: FOB, Freight+Insurance, Duties & Levies, VAT — ratios are currency-invariant.
  const shipping = freight + insurance;
  const duties = importDuty + nacLevy + greenTax + surcharge + otherFees;
  const segments = [
    { key: 'fob', value: fob, varName: '--lime' },
    { key: 'shipping', value: shipping, varName: '--cyan' },
    { key: 'duties', value: duties, varName: '--amber' },
    { key: 'vat', value: vat, varName: '--magenta' }
  ];

  const style = getComputedStyle(document.documentElement);
  let cursor = 0;
  const stops = segments.map((seg) => {
    const pct = totalUsd > 0 ? (seg.value / totalUsd) * 100 : 0;
    const from = cursor;
    const to = cursor + pct;
    cursor = to;
    const color = style.getPropertyValue(seg.varName).trim();
    return `${color} ${from}% ${to}%`;
  });
  donutEl.style.background = `conic-gradient(${stops.join(', ')})`;

  Object.entries({ fob, shipping, duties, vat }).forEach(([key, value]) => {
    legendEls[key].textContent = fmtOrUsdFallback(value, code);
  });

  const rate = code === 'USD' ? 1 : ratesTable[code];
  if (animate && rate) {
    const symbol = CURRENCY_SYMBOLS[code] || `${code} `;
    animateValue(heroTotal, 0, totalUsd * rate, (v) => `${symbol}${Math.round(v).toLocaleString('en-US')}`, 800);
  } else {
    heroTotal.textContent = fmtCurrency(totalUsd, code) || 'Rate unavailable';
  }
  heroUsd.textContent = code === 'USD' ? '' : `≈ ${usd(Math.round(totalUsd))}`;
}

calcBtn.addEventListener('click', () => {
  const fob = parseFloat(fobInput.value) || 0;
  const engineCC = parseFloat(engineCCInput.value) || 0;
  const freight = parseFloat(freightInput.value) || 0;
  const insurance = parseFloat(insuranceInput.value) || 0;

  const cif = fob + freight + insurance;
  const importDuty = cif * 0.2;
  const nacLevy = cif * 0.05;
  const greenTax = engineCC > 2000 ? cif * 0.02 : 0;
  const surcharge = importDuty * 0.07;
  const otherFees = fob * 0.04;
  const subtotal = cif + importDuty + nacLevy + greenTax + surcharge + otherFees;
  const vat = subtotal * 0.075;
  const totalUsd = subtotal + vat;

  lastBreakdown = { fob, engineCC, freight, insurance, cif, importDuty, nacLevy, greenTax, surcharge, otherFees, subtotal, vat, totalUsd };
  renderResults({ animate: true });

  hidePanel(fobCard);
  showPanel(resultCard, 'forward');
  setStep(3);
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

init();
