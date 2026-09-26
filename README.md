# karanam: in-hand salary calculator

A ₹30 lakh CTC doesn't mean ₹2.5 lakh a month. Upload an offer letter and this app works out what
actually reaches your bank account each month until 31 March. It covers PF, professional tax, NPS
and TDS as payroll would deduct it, the tax you owe or get back when you file, and optionally the
following year.

It automates the `tax_calculation.xlsx` workbook this repo started from. The unit tests reproduce
that workbook's figures exactly (`src/domain/__tests__/workbook.test.ts`).

## What it does

1. **Reads your offer letter** (PDF, Word or a photo) and fills in Basic, HRA, special allowance,
   PF, NPS, joining bonus, variable pay, CTC and the date of joining. Every field can be edited, and
   the ones it guessed are highlighted.
2. **If you're switching jobs mid-year**, it asks about your current job. You can upload that
   letter or a payslip, record salary changes, and enter your last working day, TDS so far and full
   & final settlement details (leave encashment, notice recovery, clawback, notice buyout).
3. **Shows month-by-month cash flow** for both employers, including how the new employer's TDS
   changes once it gets your Form 12B, your tax for the year, and the refund or amount payable at
   filing.
4. **Explains the gap** between "CTC ÷ 12" and a normal month's in-hand pay, and can project the
   next year with a hike prorated for the months you've worked.

Tax rules: the new regime (FY 2025-26 onwards) with the ₹75,000 standard deduction, the 87A rebate
up to ₹12 lakh with marginal relief, surcharge with marginal relief, 4% cess, employer NPS under
80CCD(2) (capped at 14% of basic), and leave encashment exempt up to ₹25 lakh under 10(10AA). All
law-dependent numbers are in `src/domain/tax.ts`.

## Private and offline

Everything runs in the browser, and nothing is uploaded anywhere. It is a PWA: open it once and it
works offline, and you can "Add to Home screen" on Android or iOS. The OCR engine (~10 MB) is
downloaded only the first time you upload a photo, then cached.

## Development

```sh
npm install
npm run dev      # http://localhost:5173/karanam/
npm test         # engine + parser tests
npm run build    # production build in dist/
```

`scripts/copy-ocr.mjs` runs before `dev` and `build`. It copies the Tesseract worker, wasm core and
English model from `node_modules` into `public/ocr/`, so OCR never touches a CDN.

| Path | What |
| --- | --- |
| `src/domain/` | Tax engine: slabs, proration, F&F, payroll TDS projection, filing position, next FY |
| `src/extract/` | File → text (pdf.js, mammoth, tesseract.js) and text → salary components |
| `src/ui/`, `src/app.tsx` | The step-by-step wizard and results screen (Preact) |

## Deploying

`.github/workflows/deploy.yml` tests, builds and publishes to GitHub Pages on every push to `main`.
To turn it on, go to **Settings → Pages → Source: GitHub Actions**. The site is served at
`https://<user>.github.io/karanam/`. For another host or path, build with `BASE=/ npm run build`.

*This is a rough estimate, not tax advice.*
