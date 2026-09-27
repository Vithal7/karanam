# karanam: in-hand salary calculator

A ₹30 lakh CTC doesn't mean ₹2.5 lakh a month. Upload an offer letter and this app works out what
actually reaches your bank account each month until 31 March. It covers PF, professional tax, NPS
and TDS as payroll would deduct it, the tax you owe or get back when you file, and optionally the
following year.

It automates the `tax_calculation.xlsx` workbook this repo started from. The unit tests reproduce
that workbook's figures exactly (`src/domain/__tests__/workbook.test.ts`).

## What it does

1. **Takes all your documents at once.** Offer letters (old and new), appraisal letters, payslips,
   your resignation email and the F&F slip, as PDF, Word, photos or pasted text. It works out what
   each file is and which company it's from, groups them into jobs (up to 3 in a year), and puts
   the jobs in date order with the new job last.
2. **Tells your year as a story.** "Joined Sigma on 1 Mar 2024 at ₹67,500 basic. Hike from Apr
   2026: CTC ₹18L → ₹21.9L (+21.6%), first paid in Jul 2026 with ₹93,933 arrears. Last working day
   11 Nov 2026: November salary pro-rata for 11 of 30 days. Leave encashment 22 days × ₹2,736..."
   Old letters are used as your starting salary and later letters or payslips update it.
   - **Appraisal letters** without a breakup (just a % or a new CTC) raise every component by the
     same %, from the effective date. If it's paid later, the difference comes as arrears.
   - **Leaving a job:** last working day and pro-rata salary, leave encashment at basic ÷ 30,
     basic ÷ 26, gross ÷ 30 or your own rate, notice-shortfall recovery on basic or gross, bonus
     clawback, bond penalty, gratuity, and the month the F&F is paid. Amounts on an F&F slip win.
   - **Joining:** joining date, joining bonus and when it's paid (and repayable), notice buyout
     on actuals or up to a cap, and whether Form 12B is given.
3. **Month-by-month money in your bank account** for every job, with TDS the way each payroll
   deducts it.
4. **ITR help:** the salary schedule as ITR-1 / Form 16 lay it out, the refund or tax payable,
   TDS per employer to check against Form 16 and AIS, and a checklist to file by 31 July.
5. **Explains the gap** between "CTC ÷ 12" and a normal month's in-hand pay, and projects the next
   year with a prorated hike.

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
| `src/domain/` | Tax engine: up to 3 jobs, hikes with arrears, PF by date, F&F, buyout, payroll TDS with Form 12B, filing position, story, ITR summary, next FY |
| `src/extract/` | File → text (pdf.js, mammoth, tesseract.js), document type and dated facts, grouping files into jobs, merging several files per job |
| `src/ui/`, `src/app.tsx` | The step-by-step wizard and results screen (Preact) |

## Hosting (Cloudflare)

Deployed as a Cloudflare Worker serving static assets (`wrangler.jsonc`), free for private repos.
In the Cloudflare dashboard, open the worker → **Settings → Build**:

- Git repository: `Vithal7/karanam`
- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`
- Production branch: `main`. Other branches get preview URLs.

`public/_headers` keeps `rules.json`, `sw.js` and `index.html` uncached so updates reach users
quickly. Node 22 comes from `.node-version`.

`.github/workflows/ci.yml` runs the tests and a build on every push and PR. To host under a
sub-path instead of a domain root, build with `BASE=/sub/path/ npm run build`.

*This is a rough estimate, not tax advice.*
