# 29Court Converter

Universal file converter — **everything to everything, fully client-side.**

Live: **https://convert.29court.com/**

Drag in any file, pick the target format, download the result. Everything runs
in your browser via open-source libraries. Nothing is uploaded anywhere —
your files never leave your machine.

## Conversion matrix

| From | To | Keeps | Loses |
|---|---|---|---|
| XLSX, XLS | PDF | Values, column order, sheets, number formatting, bold/italic, fills, font colors, merged titles | Charts, images, exact fonts, conditional formatting, vertical merges |
| XLSX, XLS | CSV | Sheet values (all sheets stacked) | Formatting, formulas |
| XLSX, XLS | JSON | First sheet as objects | — |
| CSV, TSV | PDF | Full table as clean PDF | — |
| CSV, TSV | XLSX | Everything, one sheet | — |
| CSV, TSV | JSON | Rows as objects keyed by header | — |
| DOCX | PDF | Text and structure | Exact layout, headers/footers, images |
| DOCX | Markdown | Headings, lists, quotes, text | — |
| DOCX | Plain text | Just the words | — |
| PDF | Plain text | Extracted text | Layout, images |
| PDF | Word | Text in a real .docx | Original layout |
| Markdown | PDF | Headings, lists, code, quotes | Tables flattened to text rows |
| Markdown | HTML | Everything, styled page | — |
| Markdown | Word | Headings, lists, tables, bold/italic | — |
| Markdown | Plain text | Words without markup | — |
| TXT | PDF, HTML, Markdown | Paragraphs preserved | — |

The XLSX → PDF path is "super convert": per-cell formatting via ExcelJS with a
"Final values" / "Raw formulas" toggle. Honesty labels throughout — the app
tells you what each conversion preserves and what it drops.

## Run it locally

The app is a static site. Serve `site/` with any static file server:

```sh
cd site && python3 -m http.server 8000
```

## Deploy

`build.py` inlines the JS modules and assets into `index.html`, then bakes the
page into a Cloudflare Worker (`worker.mjs`, generated — not committed):

```sh
python3 build.py    # -> worker.mjs (generated bundle)
python3 deploy.py   # uploads the worker + wires the route
```

`deploy.py` targets the 29Court Cloudflare account; you'll need your own
credentials to deploy elsewhere.

## Credits

Built by **29Court**. Runs on these open-source libraries:

| Library | Version | License |
|---|---|---|
| ExcelJS | 4.4.0 | MIT |
| SheetJS (xlsx) | 0.20.3 | Apache-2.0 |
| pdf-lib | 1.17.1 | MIT |
| fontkit (@pdf-lib/fontkit) | 1.1.1 | MIT |
| JSZip | 3.10.1 | MIT or GPL-3.0 (dual) |
| js-yaml | 4.1.0 | MIT |
| marked | 12.0.0 | MIT |
| mammoth | 1.8.0 | BSD-2-Clause |
| pdf.js (pdfjs-dist) | 3.11.174 | Apache-2.0 |
| docx | 9.1.1 | MIT |
| fast-formula-parser | 1.0.19 | MIT |

## License

MIT — see [LICENSE](LICENSE).
