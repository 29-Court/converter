#!/usr/bin/env python3
"""Build convert.29court.com: inline app.js into index.html, then into the worker."""
import base64, json, pathlib

HERE = pathlib.Path(__file__).parent
html = (HERE / "site" / "index.html").read_text()
kit = (HERE / "site" / "pdf-kit.js").read_text()
rich = (HERE / "site" / "xlsx-rich.js").read_text()
prt = (HERE / "site" / "xlsx-print.js").read_text()
charts = (HERE / "site" / "xlsx-charts.js").read_text()
js = (HERE / "site" / "app.js").read_text()
cap = (HERE / "site" / "capture.js").read_text()
logo_b64 = base64.b64encode((HERE / "site" / "logo-29court.png").read_bytes()).decode()
assert '"__LOGO_B64__"' in prt, "logo placeholder missing in xlsx-print.js"
prt = prt.replace('"__LOGO_B64__"', json.dumps(logo_b64), 1)
sample_b64 = base64.b64encode((HERE / "site" / "samples" / "sample-workbook.xlsx").read_bytes()).decode()
assert '"__SAMPLE_XLSX_B64__"' in js, "sample placeholder missing in app.js"
js = js.replace('"__SAMPLE_XLSX_B64__"', json.dumps(sample_b64), 1)
assert "/*__APP_JS__*/" in html, "placeholder missing"
assert "/*__CAPTURE_JS__*/" in html, "capture placeholder missing"
html = html.replace("/*__APP_JS__*/", kit + "\n" + rich + "\n" + charts + "\n" + prt + "\n" +
    "var __CONVERT_LOGO_B64__ = " + json.dumps(logo_b64) + ";\n" + js, 1)
html = html.replace("/*__CAPTURE_JS__*/", cap, 1)
# sanity: no leftover placeholder, libs still referenced
assert "__APP_JS__" not in html
assert "__CAPTURE_JS__" not in html
assert "__LOGO_B64__" not in html
assert "__SAMPLE_XLSX_B64__" not in html
for lib in ["exceljs.min.js", "xlsx.full.min.js", "pdf-lib.min.js", "js-yaml.min.js",
            "marked.min.js", "mammoth.browser.min.js", "pdf.min.js", "index.iife.js",
            "parser.min.js", "fontkit.umd.min.js", "jszip.min.js"]:
    assert lib in html, f"missing lib ref: {lib}"
tpl = (HERE / "worker-template.mjs").read_text()
worker = tpl.replace("__HTML_JSON__", json.dumps(html), 1)
(HERE / "worker.mjs").write_text(worker)
print(f"built: index {len(html)} bytes -> worker.mjs {len(worker)} bytes")
