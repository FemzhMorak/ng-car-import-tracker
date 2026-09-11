# ICEstimator

Nigerian car import cost calculator. Search a make/model/year, see a real photo of
that car, get an estimated FOB price, and see the full import duty breakdown and
total landed cost in the currency of your choice using live exchange rates.

## Run it

```bash
npm install
npm start
```

Then open http://localhost:3000.

### Using OANDA for exchange rates (optional)

By default, exchange rates come from the free, keyless
[open.er-api.com](https://open.er-api.com). To use OANDA's Exchange Rates API instead,
set `OANDA_API_KEY` before starting the server:

```bash
OANDA_API_KEY=your-oanda-key npm start
```

Worth knowing: OANDA's Exchange Rates API has no self-service signup or published free
tier — getting a key means contacting their sales team. Because of that, this
integration is written from indirect documentation only and hasn't been tested against
a real key; if it errors, the server logs a warning and automatically falls back to
open.er-api.com so the app keeps working either way. If you have a key and it doesn't
work first try, share the error and it can be fixed against your actual account.

## How it works

- **FOB price** — estimated from a curated dataset of common Japanese-export models
  (`data/models.json`), depreciated by year. This is a modeled estimate, not a live
  auction listing (see [Data sources](#data-sources) below).
- **Car photo** — fetched from Wikipedia/Wikimedia Commons (no API key required) based
  on the selected make and model. It illustrates the model generally and may not show
  the exact year or trim.
- **Exchange rates** — fetched live (OANDA if configured, otherwise open.er-api.com)
  and cached server-side for 1 hour. Pick the display currency — NGN, USD, GBP, EUR,
  CAD, ZAR, or GHS — from the dropdown on the result screen; all duty-breakdown figures
  update to match.
- **Duty breakdown** (computed in USD, then converted to the selected currency):
  - CIF = FOB + Freight + Insurance
  - Import Duty = 20% of CIF
  - NAC Levy = 5% of CIF
  - Green Tax = 2% of CIF (engines over 2000cc only)
  - Surcharge = 7% of Import Duty
  - Other Fees = 4% of FOB
  - Subtotal = CIF + Import Duty + NAC Levy + Green Tax + Surcharge + Other Fees
  - VAT = 7.5% of Subtotal
  - Total Landed Cost = Subtotal + VAT

Freight and insurance default to typical RORO shipping estimates (Japan → Lagos) and
1% of FOB respectively, but are editable in the UI.

## Data sources

Real Japanese auction sites (USS, CAA, TAA, etc.) require dealer membership and
block scraping via their terms of service, so live FOB scraping isn't included.
`data/models.json` instead models realistic pricing trends by make/model/year — treat
figures as planning estimates, not live listings.

Car photos come from Wikipedia's public API (`/api/car-image` on the server, cached
24h in memory per make/model) — free and keyless, but coverage depends on what has an
illustrated Wikipedia article; if nothing suitable is found, the photo is skipped.

Duty rates are simplified and may not reflect the latest Nigeria Customs Service
tariffs; always confirm with a licensed clearing agent before making financial
decisions.
