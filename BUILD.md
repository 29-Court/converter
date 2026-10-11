# convert.29court.com — build log

**Live:** https://convert.29court.com/
**Built:** 2026-10-09 ~11:50pm PT by subagent 89d9462d
**Deploy:** Cloudflare Worker `convert-site` (modules format, no bindings), DNS A + `convert.29court.com/*` route. Fully client-side, no backend.

## What it is

Universal file converter. Drag in any file, pick the target format, download the result. Everything runs in the browser via CDN libraries (SheetJS, pdf-lib, js-yaml, marked, mammoth, pdf.js, docx). Nothing is uploaded anywhere. Video files are detected and routed to help.29court.com instead of faked.

## Conversion matrix (v1)

| From | To | Keeps |
|---|---|---|
| XLSX, XLS | PDF | Values, column order, sheets, number formatting. Loses: colors, fonts, charts, images, formulas (values only). Merged cells are flattened with a warning. |
| XLSX, XLS | CSV | Sheet values (all sheets stacked with a warning). Loses: formatting, formulas. |
| XLSX, XLS | JSON | First sheet as objects. |
| CSV, TSV | PDF | Full table as clean PDF. |
| CSV, TSV | XLSX | Everything, one sheet. |
| CSV, TSV | JSON | Rows as objects keyed by header. |
| DOCX | PDF | Text and structure. Loses: exact layout, headers, footers, images. |
| DOCX | Markdown | Headings, lists, quotes, text. |
| DOCX | Plain text | Just the words. |
| PDF | Plain text | Extracted text via pdf.js. Loses: layout, images. |
| PDF | Word | Text in a real .docx. Loses: original layout. |
| Markdown | PDF | Headings, lists, code, quotes. Tables flattened to text rows (warning). |
| Markdown | HTML | Everything, styled page. |
| Markdown | Word | Headings, lists, tables, bold, italic. Real .docx via docx lib. |
| Markdown | Plain text | Words without markup. |
| TXT | PDF, HTML, Markdown | Paragraphs preserved. |
| JSON | CSV | Array of objects to rows; nested values become JSON strings (warning). |
| JSON | YAML | Clean round trip. |
| JSON | PDF | Pretty printed source. |
| YAML | JSON | Clean round trip. |
| YAML | CSV | Arrays of objects to rows. |
| PNG, JPG, WebP, GIF, BMP | PNG, JPG, WebP | Canvas re-encode. GIF animation and layers are not carried over (warning). GIF output falls back to PNG (warning). |
| MP4, MOV, WEBM, etc. | (server) | Detected on drop; offers to open help.29court.com. Never faked. |

Every converter states what it preserves on the target picker and in the matrix. Warnings go to the conversion log.

## Verification (2026-10-09)

- `node --check` clean on app.js.
- Pure logic (CSV parse/roundtrip with quoted commas and escaped quotes, mdInline, ext/base/fmtBytes): PASS in Node.
- **Hero xlsx to PDF, end to end in Node with the real CDN libraries:** built a 2-sheet workbook with SheetJS, ran the app's actual `tablesToPdf`, got a valid `%PDF-` file; decompressed content streams contain the table text ("test", "Sheet: Inventory" confirmed as hex-encoded PDF text). PASS.
- Markdown lexing with real marked: headings, paragraphs, lists, code blocks, tables all tokenize correctly. PASS.
- js-yaml round trip, marked to HTML: PASS.
- **DOCX round trip:** docx lib generated a valid .docx (PK zip magic, 7456 bytes); mammoth converted it back to HTML and extracted raw text correctly. PASS.
- docx IIFE exposes the `docx` global exactly as the page's script tag expects. PASS.
- Live: homepage 200 with correct title, `/api/health` returns ok, loader snippet present, all 7 CDN library references present in served HTML.

**Not verified (needs a live browser, subagents cannot):** the actual click flow (drop file, pick target, click Convert, download bytes) in a real browser. The parent should do one xlsx to PDF run on the live URL before announcing.

## Files

- `site/index.html` — page shell, 29Court tokens, loader, drop zone, matrix
- `site/app.js` — all converters (~700 lines)
- `worker-template.mjs`, `build.py`, `deploy.py` — build and deploy
- `test/` — Node verification scripts (t1..t4, mdtest)

## Notes

- XLSX to PDF auto-switches to landscape for wide sheets (>6 columns), computes column widths from content, header row styling, row striping, page numbers, multi-sheet support.
- UI self-check: tokens.css + theme.css included, no hardcoded hex in custom CSS (only the shared loader snippet's var fallbacks), no em-dashes, no AI tells, 44px targets, focus-visible, 390px media query, prefers-reduced-motion honored.

## Capture loop v1 (2026-10-10, funnel step 2)

**Live:** https://convert.29court.com/ — capture fires at the value moment (conversion done, download ready). Free tool stays 100% free and ungated.

**Stack:** Worker `convert-site` + D1 `convert-capture` (21013edc-b35c-4836-a5e5-d6697d1b1239) bound as `DB` + static HTML. Client: `site/capture.js` (inlined by build.py), hooked at `downloadBlob` success via `cv:converted` CustomEvent.

**API:** POST /api/event (instrumentation, no PII) · POST /api/capture (email -> account + 30d session, guest history migrates) · GET /api/me · GET/POST /api/history · POST /api/pair/new + /api/pair/claim (6-digit, 5-min, single-use) · POST /api/signout · GET /api/stats (aggregate counts only) · POST /api/magic-link (501 until RESEND_API_KEY) · GET /api/verify (dormant verify path).

**The one metric:** capture rate = capture_done / value_moment from /api/stats. Target to beat: 3%.

**Honest labels (nothing faked):**
- No mail sender exists (no RESEND_API_KEY). Sessions are instant; UI says "email not verified yet: we cannot send sign-in emails until our mail sender is connected." Pairing codes are the real cross-device path.
- POST /api/magic-link answers 501 `email-sender-not-configured`, never a fake "check your inbox".
- Follow-up receipt emails are queued in `pending_emails` (funnel step 5) and send when a sender key lands.
- "Your stuff" = conversion history (metadata), not cloud file storage. Never promised.

**Verification (2026-10-10, curl):** event -> capture (cookie set, 1 guest conversion migrated) -> me (signed_in) -> history (1 row) -> pair/new (code) -> pair/claim on fresh "device" (signed in, code single-use, bad code rejected) -> signout (signed_in:false) -> stats {value_moment:1, capture_done:1, accounts:1}. Test data deleted after. Live HTML contains the capture bundle.

### REVLOG: offer/copy iterations (Hormozi value equation)

Value = (dream outcome x perceived likelihood) / (time delay x effort). Constraint: every stacked item must be real. No fake dollar values, no fake guarantees, no "magic link" promise we cannot send.

- **Rev 1** (funnel-report baseline): "Nice work. Want to keep this? One email, magic link, no password." Killed: promises a magic-link email we cannot send. No dream outcome.
- **Rev 2**: "Never lose a converted file again. One email keeps every conversion in one place. No password, ever." Killed: "never lose a converted file" overclaims, we keep history metadata, not the file bytes.
- **Rev 3**: stacked headline "Done. Now keep it forever." + bullets (this conversion saved / every future conversion in one place / cheat sheet). Kept the headline, tightened the honesty.
- **Rev 4**: added risk reversal microcopy: "Free forever. No password. Unsubscribe anytime." Objection at the value moment is spam fear, not price.
- **Rev 5**: killed time delay on the bonus: cheat sheet generates instantly client-side (pdf-lib already loaded) and is offered in the success state, not "coming soon".
- **Rev 6**: CTA "Keep my stuff" (about them, one motion) beats "Sign up" / "Create account" (about us, sounds like work).
- **Rev 7**: added the pairing-code claim path inside the panel ("Have a pairing code from another device?") so device B can join without email. Removed the last reason to bounce.
- **Rev 8 (SHIPPED)**: final panel: headline "Done. Now keep it forever." / sub "Your conversion is saved to your stuff the moment you sign in." / 3 checkmark bullets (every conversion kept in one place; your stuff on any device, no password ever; the everything-to-everything cheat sheet, free right now) / email + "Keep my stuff" / micro "Free forever. New converters hit your inbox first. Unsubscribe anytime." / quiet dismiss "No thanks, just the download". Success state: "You are in. This conversion is saved." + instant cheat sheet button + "See your stuff". Verification label lives in the drawer, plainly worded.

**Not yet real-browser verified** (subagents cannot): the click flow (drop file, convert, panel renders, submit, drawer). Parent should run one xlsx to PDF on the live URL.

### Pre-existing production bugs found and fixed during capture build (2026-10-10)

The converter's click flow had never been browser-verified. E2E testing surfaced three `style.display = ''` bugs where the stylesheet's `display:none` won over the cleared inline style, so **after dropping a file the whole UI stayed invisible**:
1. `#filebar` never appeared after file pick (`filebar.style.display = ''` -> `'block'`).
2. `#download` link never appeared after conversion (`a.style.display = ''` -> `'inline-block'`).
3. `#progress` bar never appeared (`setProgress` show branch -> `'block'`).
Also fixed: `.cv-cap [hidden]{display:none!important}` — the capture panel's own `display:flex` on forms was overriding the `hidden` attribute, leaking the pairing-code form on load.

### End-to-end verification (2026-10-10, real Chromium, headless)

Sandbox Chromium cannot reach the internet, so: production worker code + local D1 + page with CDN libs vendored locally, driven in real Chromium via Playwright. Full pass, zero page errors: CSV dropped -> filebar visible -> PDF target -> Convert -> real PDF downloaded (1355 bytes, %PDF- magic) -> capture panel rendered with final copy -> value_moment + capture_shown instrumented -> invalid email rejected -> valid email captured (guest conversion migrated) -> success state -> Your stuff drawer (history + honest unverified-email label) -> cheat sheet PDF downloaded (real, 4491 bytes) -> pairing code minted -> sign out. Desktop + mobile (390px) screenshots reviewed; panel renders as a proper 29Court component in both.
Live API separately verified via curl against production: capture/me/history/pair-new/pair-claim (good + bad + reuse)/signout/stats/magic-link-501. Production D1 left clean (0 accounts, 0 events).

**Still owed (subagents have no live-browser route):** one real-browser pass on the production URL by the parent: drop a file, convert, submit the panel.

### Hardening pass: formula engine, clipping, wide-sheet tiling, crisp UI (2026-10-10, shipped)

Victor tested the pixel-perfect renderer with a real client file (BOMA Method A workbook, 20-col sheets, 41 formulas with NO cached values) and got raw `=SUM(...)` text plus jumbled overlap. Three fixes shipped:

1. **Real formula engine, in-browser.** fast-formula-parser (MIT) evaluates every formula workbook-wide (cross-sheet refs resolve) before rendering. NOTE: the brief said HyperFormula, but HyperFormula is GPL-3.0-only, which would copyleft the product, so the MIT engine was substituted. Plus `FORMULA_POLYFILLS` in xlsx-rich.js overriding the engine's 26 empty stubs with Excel-faithful implementations: MAX, MIN, MAXA, MINA, LARGE, SMALL, MEDIAN, COUNTBLANK, SUMIFS, COUNTIFS, AVERAGEIFS, MAXIFS, MINIFS, MATCH, and INDEX (context-style override). Unevaluatable formulas render blank with an honest log line. Raw `=SUM` text never ships in final mode (raw mode is the user's explicit toggle).
2. **Excel-faithful text clipping.** Every cell is drawn inside a PDF clip path. Text overflows into adjacent EMPTY cells (like Excel) but can never draw over another cell's content. The old "mash together" overlap is gone.
3. **Wide-sheet tiling.** Fit-to-width now floors at 0.6 scale; wider sheets tile across horizontal pages (Excel print-tiling) with `(cols A-R, 1 of 2)` headers instead of shrinking into illegibility. Auto-landscape kept.

**Site polish:** crisp/sharp pass per Victor's 2026-10-10 direction (bencho.dev + Element UI 2.0, Cloudflare-console dense): left-aligned hero, mono uppercase micro-labels, 4px radii, denser cards/log. Token colors kept, 44px targets kept, focus states kept, no em dashes, 390px verified with no horizontal scroll.

**Acceptance (Victor's real file, ~/workspace/user/files/methodA_single.xlsx):** converted in REAL headless Chromium (Playwright, CDN libs vendored locally): "Calculated 41 formula(s) on this device", 5-page PDF (cover + 2 tiled Method A + Floor 1 + Floor 2), zero page errors from our code. Independent numeric audit: 36/36 directly-checkable formulas match to the cent, 5 chained formulas (formula referencing formula) verified consistent. Side-by-side against a LibreOffice reference render: identical layout, values, and clipping behavior. Evidence: bench/xlsx-harden-proof/ (bp-1..5.png, methodA_browser.pdf, ui-styled.png, ui-styled-file.png, ui-mobile.png).

**Tests:** 41/41 rich.test.js (new: engine evaluation, polyfills incl. INDEX/MATCH/MAX, blank-not-raw contract), 15/15 pdf.test.js (computed values in PDF text, no raw formulas). Deployed 2026-10-10 ~10:55pm PT, verified live at https://convert.29court.com/.

**Honest remaining gaps:** charts, images, conditional formatting still not carried over; exact font files still Helvetica (labeled); mixed formatting within one cell renders in base style; the formula engine covers ~280 functions plus the 15 polyfills, genuinely exotic functions (e.g. XLOOKUP, dynamic arrays) render blank with a log line.

### Hill-climb Phase 2: feel, awful cases, library decoupling, images (2026-10-11, shipped)

Victor's verdict on the previous build ("LONNNG way off lmao"): table feel was the #1 problem, plus a
black-band report, page-numbering confusion, and orders to (a) architect for awful cases, (b) decouple
for a future `xlsxtopdf` library. Shipped:

1. **Table feel.** Cell padding 3→3.5pt, line height 1.18→1.2, balanced tile stacking with 22pt gaps,
   orphan-banner pagination fixed (a lone total row was wasting a full page). Method A: 4 pages, tables breathe.
2. **Page numbering.** Footers now count ALL pages including the cover ("Page 2 of 4"), matching the viewer exactly.
3. **Black band.** Could not reproduce: fresh conversion of Victor's exact file shows a clean page 2, and the
   "Made with" string exists exactly once in both `site/` and the deployed worker (cover only). Treated as a
   stale-deploy artifact from his 5th attempt during the tiling deploy window; verified absent, watching.
4. **Awful cases.** 10-file fuzz corpus (50 cols, 10k rows, empty, single-cell, RTL, 72pt fonts, weird merges,
   2000-char text, 30 sheets, formula stress): 10/10 convert, 0 crashes. 2000-trial `layoutTiles` fuzz:
   exact partition every trial, never throws. RTL/CJK/emoji no longer crash (WinAnsi-safe text, □ placeholders).
5. **Library decoupling (planned `xlsxtopdf` extraction).** Core modules (`xlsx-print.js`, `xlsx-rich.js`,
   `pdf-kit.js`) now have zero DOM refs, UMD exports, injected deps (`{ExcelJS, XLSX, FormulaParser}`,
   `{PDFLib, PDF}`), and a clean bytes-in→bytes-out API (`sheetsToPdf` returns `Uint8Array`; the app shell
   wraps in `Blob`). Branding via `meta.logoB64`, not baked in. MIT-compatible deps only. Publishable as a
   standalone npm package with minimal surgery. Full API notes in `bench/xlsx-hillclimb/SCORECARD.md`.
6. **Embedded images.** Extracted from the xlsx (ExcelJS anchors) and placed at their grid positions in the PDF.
7. **Honest label updated.** Now reads: "Loses: charts, conditional formatting, print settings
   (orientation/fit), exact font files (rendered in Helvetica); non-Latin scripts show as placeholders."

**Tests:** 41 rich + 15 pdf + 4000 layoutTiles fuzz assertions, all green. Scorecard: `bench/xlsx-hillclimb/SCORECARD.md`.
Deployed 2026-10-10 ~11:58pm PT, verified live at https://convert.29court.com/ (200, new label present).

### Hill-climb round 3: fit-to-page-width + faithful label sizes (2026-10-11, shipped)

Victor's verdict on the Phase 2 build ("Still a lot of hill to climb"): (1) the 20-column front table must fit on
ONE full page, not tile 11+9; (2) Floor 1/Floor 2 labels rendered at inconsistent font sizes vs the source.

1. **Fit-to-page-width (Excel "Fit to 1 page wide").** `sheetsToPdf` now picks the orientation that renders the
   largest type and puts the whole sheet on one page whenever the fit scale stays at or above **FIT_FLOOR = 0.5**.
   At 0.5 an 11pt body renders at ~5.5pt — the smallest honestly readable print size, and the largest scale that
   fits the sheet on one page. Horizontal tiling ("cols A-Q, 1 of 3") now only kicks in when even landscape
   fit-to-width would drop below 0.5 (tiles still render at >= K_FLOOR = 0.75). Method A (20 cols): single
   landscape page at k≈0.55. 24-col sheet: single page. 50-col sheet: correctly tiles 3 ways.
2. **Faithful label sizes.** Audit: the parser (`xlsx-rich.js`) already reported every Floor label faithfully
   (12pt bold underline, matching the xlsx styles). The bug was in the draw layer: unbounded shrink-to-fit
   scaled a 12pt label down to 5.7pt in a narrow column while its 12pt sibling rendered at 9.5pt. Shrink is now
   bounded at **SHRINK_MIN = 0.8** of the cell's own rendered size — a label may shrink a touch to fit, never
   far enough to read as a different font size. Beyond that the text keeps its true size and clips at the cell
   rect, the way Excel clips over-wide text. Wrapped header cells (Method A) are unaffected — wrapping, not
   shrinking, handles them.

**Acceptance (Victor's real file):** 4-page PDF (cover + Method A single page + Floor 1 + Floor 2); all 41
formulas computed (numeric audit of PDF text: all values present, zero raw `=FORMULA` leaks); page numbers
"Page 2/3/4 of 4"; Floor labels render at consistent sizes left and right.

**Tests:** 41 rich + 15 pdf + 4000 layoutTiles fuzz assertions, all green. Full corpus: 23/23 files convert,
0 crashes (13 acceptance + 10 fuzz).
