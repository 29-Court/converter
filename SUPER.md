# SUPER.md — super convert: Excel to PDF

Date: 2026-10-10 (built ~01:05-03:00 PT, deployed ~03:00 PT)
Live: https://convert.29court.com (verified 200, toggle + exceljs refs in served HTML)

## What shipped

XLSX/XLS to PDF is now "super convert":

1. **ExcelJS import** (CDN `exceljs@4.4.0`, 947KB, verified 200) as the primary
   reader; SheetJS stays as the fallback. New module `site/xlsx-rich.js`
   (DOM-free, Node-testable) extracts per-cell: computed/cached formula
   values, number formats (via SSF), bold/italic, fills, font colors,
   horizontal merges (spanned, covered cells skipped).
2. **Toggle: "Final values" (default) vs "Raw formulas"**, shown only when
   an xlsx/xls file targets PDF. Stored in `state.formulaMode`.
3. **Richer PDF renderer**: per-cell bold/italic/fill/font-color, merged
   title cells span their columns, gridlines, 29Court styling kept.
4. **Engine seam**: `C.xlsxToPdf.run` first tries
   `window.SuperConvertEngine.xlsxToPdf(file, {formulaMode})` so a future
   grid.29court.com (or any page-provided engine) can take over rendering;
   falls back to the built-in path with a log line.
5. **Honesty labels kept**: log lines for uncached formulas shown as-written
   (counted, never invented), vertical merges, basic-reader fallback;
   registry `preserves` text updated (loses: charts, images, exact fonts,
   conditional formatting).

## Verification (all in Node, real libs, no mocks of the conversion)

- `bench/node/rich.test.js`: **28/28 pass** — ExcelJS path (styles, formats,
  merges, cached values, raw mode, noCache counting), SheetJS fallback,
  pure helpers (argb, merge refs, SSF).
- `bench/node/pdf.test.js`: **13/13 pass** — full `C.xlsxToPdf.run` through
  the real `tablesToPdf` renderer with stub DOM: final/raw modes, cached
  values, no `undefined` leaks.
- Sample PDFs: `bench/sample-final.pdf`, `bench/sample-raw.pdf`.
- `node --check` clean on both JS files. Build/deploy via `build.py`
  (bundles xlsx-rich.js, asserts exceljs CDN ref) + `deploy.py` (worker
  `convert-site`, 200). Served page re-verified with curl.
- **Not done**: live-browser click-through (no browser in this lane).
  Parent must verify the toggle + conversion in a real browser before
  announcing.

## Benchmark: gridcraft's own Excel to PDF (his curiosity)

Method: built `gridcraft-cli` (release, 38m39s) and ran
`file.exportPdf={"sheets":"all"}` on `bench/super-test.xlsx`, a stress file
written by openpyxl with **zero cached formula values**, plus
`bench/chart-test.xlsx` (bar chart). PDF streams decoded and inspected.

Verdict: **genuinely excellent — better than the converter's own path.**

What survives:
- Real formula evaluation: SUM, AVERAGE, INDEX/MATCH, IF, CONCAT,
  cross-sheet references — all computed correctly with no cached values
  in the file (485, 1,595, 531.67, Gamma, STRONG, FY2026 all correct).
- Correct error values: `=1/0` -> `#DIV/0!`, `=NOSUCHFN(1)` -> `#NAME?`.
- Number formats: `#,##0` -> `1,595`; `0.00` -> `140.00`; `0.0%` -> `18.4%`.
- Cell fills (header blue 2F5496, grand-total DDEBF7), merged title cell.
- Charts: bar chart rendered with bars, title, series, Excel-blue fills.
- Multi-sheet -> one page per sheet (3 pages).

Comparison:
- gridcraft engine: real evaluation engine, charts, true spreadsheet
  rendering. Strictly higher fidelity.
- converter (ExcelJS path): cached values only (uncached shown as-written,
  honestly counted); no charts/images; but runs fully client-side today
  with zero new infrastructure.

## Why the engine is not wired in yet

`~/workspace/video-site/dist-grid/` contains the gridcraft **app** WASM
(canvas UI via Trunk); its JS glue exports only `init`, no document or
`exportPdf` binding. There is no browser-callable conversion API today.
Building one (wasm-bindgen export + ~14MB wasm bundle in the converter)
is a real project in the grid agent's lane. The `SuperConvertEngine`
seam is in place and tested; when grid.29court.com exposes
`xlsxToPdf(file, {formulaMode}) -> Blob`, the converter picks it up with
zero changes.

## Known limitations (documented, honest)

- SheetJS 0.18.5 fallback quirk (verified): formula cells with no cached
  value and no `t="str"` are dropped from its parsed sheet, so the
  fallback shows them blank. Primary ExcelJS path is unaffected. The
  fallback only triggers if the ExcelJS CDN fails.
- openpyxl-style files (no cached values): converter shows `=FORMULA`
  as-written with a counted warning; gridcraft engine evaluates them.
- Vertical merges: content shown once in the top cell, logged.
- Charts/images never survive the converter path (stated in preserves text).

## Files

- `site/xlsx-rich.js` (new) — rich reader
- `site/app.js` — renderer, toggle, seam, test seam (`__convertTest`)
- `site/index.html` — ExcelJS script tag, `#xlsxopts` toggle
- `build.py` — bundles xlsx-rich.js, asserts exceljs ref
- `bench/super-test.xlsx`, `bench/chart-test.xlsx`
- `bench/node/rich.test.js`, `bench/node/pdf.test.js`, `bench/node/make-sample.js`
- `bench/sample-final.pdf`, `bench/sample-raw.pdf`, `bench/gridcraft-sample.pdf`
- `bench/gc-out.json`, `bench/gc-chart.json`, `bench/gc-text.py`
