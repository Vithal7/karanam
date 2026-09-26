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
2. **Up to 3 jobs in one financial year.** Add the jobs you had before the offer. For each one you can
   upload several files (offer letter, revision letters, payslips) or enter just the totals. When
   files disagree, the app asks which figure is right, or whether your salary changed between them.
   It also takes F&F settlement (leave encashment, notice recovery, clawback, buyout by the next
   job) and when each new employer gets Form 12B.
3. **Month-by-month cash flow** for every job, TDS the way each payroll deducts it, your tax for
   the year, and the refund or amount due at filing.
4. **Explains the gap** between "CTC ÷ 12" and a normal month's in-hand pay, and projects the next
   year with a hike prorated for the months you've worked.

## Tax rules that update themselves

Every law-dependent number lives in [`src/rules/rules.json`](src/rules/rules.json): new-regime
slabs per FY, standard deduction, 87A rebate, surcharge, cess, the 80CCD(2) NPS cap, the
10(10AA) leave-encashment cap, the EPF wage ceiling with effective dates (₹15,000, then ₹25,000
from 17 Sep 2026) and the default professional tax.

- The app ships with a copy, so it always works offline.
- Whenever it's online (at start, on reconnecting, and daily while open), it downloads
  `/rules.json` from the site. If that copy is valid and newer, the app uses it and says so.
- A monthly Claude routine checks official sources (Income Tax Department, CBDT, Finance Act,
  EPFO) and opens a PR here when something changes. Merging the PR deploys the site, and every
  installed app picks up the new rules the next time it's online.

## Private and offline

Everything runs in the browser, and nothing is uploaded anywhere. Only the numbers read from your
files are kept on your device, never the files themselves. It is a PWA: open it once and it
works offline, and you can "Add to Home screen" on Android or iOS. The OCR engine (~10 MB) is
downloaded only the first time you upload a photo, then cached.

## Development

```sh
npm install
npm run dev      # http://localhost:5173/
npm test         # engine + parser tests
npm run build    # production build in dist/
```

`scripts/copy-ocr.mjs` runs before `dev` and `build`. It copies the Tesseract worker, wasm core and
English model from `node_modules` into `public/ocr/`, so OCR never touches a CDN.

| Path | What |
| --- | --- |
| `src/rules/` | Tax and statutory rules as data, validation, and the online refresh |
| `src/domain/` | Tax engine: up to 3 jobs, proration, PF by date, F&F, payroll TDS with Form 12B, filing position, next FY |
| `src/extract/` | File → text (pdf.js, mammoth, tesseract.js), text → salary components, and merging several files per job |
| `src/ui/`, `src/app.tsx` | The step-by-step wizard and results screen (Preact) |

## Hosting (Cloudflare Pages)

The repo is private, so it's hosted on Cloudflare Pages (free for private repos). One-time setup:

1. In the Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect to Git**, then pick
   `Vithal7/karanam`.
2. Production branch `main`, build command `npm run build`, output directory `dist`. Node 22 is
   picked up from `.node-version`.
3. Every push to `main` deploys, and every PR gets a preview URL. `public/_headers` keeps
   `rules.json`, `sw.js` and `index.html` uncached, so updates reach users quickly.

`.github/workflows/ci.yml` runs the tests and a build on every push and PR. To host under a
sub-path instead of a domain root, build with `BASE=/sub/path/ npm run build`.

*This is a rough estimate, not tax advice.*
