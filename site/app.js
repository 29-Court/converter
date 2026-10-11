/* 29Court Convert: all converters run in the browser. No uploads, no servers. */
(function(){
"use strict";

/* ---------- log ---------- */
var loglist = document.getElementById('loglist');
function log(msg, cls){
  var li = document.createElement('li');
  if (cls) li.className = cls;
  var t = document.createElement('time');
  t.textContent = new Date().toLocaleTimeString();
  li.appendChild(t);
  li.appendChild(document.createTextNode(msg));
  loglist.prepend(li);
  while (loglist.children.length > 60) loglist.removeChild(loglist.lastChild);
}

/* ---------- library readiness ---------- */
var LIBS = {
  XLSX: function(){ return typeof XLSX !== 'undefined'; },
  ExcelJS: function(){ return typeof ExcelJS !== 'undefined'; },
  PDFLib: function(){ return typeof PDFLib !== 'undefined'; },
  jsyaml: function(){ return typeof jsyaml !== 'undefined'; },
  marked: function(){ return typeof marked !== 'undefined'; },
  mammoth: function(){ return typeof mammoth !== 'undefined'; },
  pdfjsLib: function(){ return typeof pdfjsLib !== 'undefined'; },
  docx: function(){ return typeof docx !== 'undefined'; },
  FormulaParser: function(){ return typeof FormulaParser !== 'undefined'; }
};
function libsReady(names){ return names.every(function(n){ return LIBS[n] && LIBS[n](); }); }
function missingLibs(names){ return names.filter(function(n){ return !(LIBS[n] && LIBS[n]()); }); }
(function(){
  var need = ['XLSX','PDFLib','jsyaml','marked','mammoth','pdfjsLib','docx'];
  var miss = missingLibs(need);
  var el = document.getElementById('libstatus');
  if (miss.length === 0){ el.textContent = 'all converters ready'; }
  else { el.textContent = 'waiting on: ' + miss.join(', '); log('Some converter libraries failed to load (' + miss.join(', ') + '). Check your connection and reload.', 'err'); }
})();

/* ---------- helpers ---------- */
function extOf(name){ var m = /\.([a-z0-9]+)$/i.exec(name || ''); return m ? m[1].toLowerCase() : ''; }
function baseOf(name){ return (name || 'file').replace(/\.[a-z0-9]+$/i, ''); }
function fmtBytes(n){ if (n < 1024) return n + ' B'; if (n < 1048576) return (n/1024).toFixed(1) + ' KB'; return (n/1048576).toFixed(1) + ' MB'; }
function readAsArrayBuffer(file){ return new Promise(function(res, rej){ var r = new FileReader(); r.onload = function(){ res(r.result); }; r.onerror = rej; r.readAsArrayBuffer(file); }); }
function readAsText(file){ return new Promise(function(res, rej){ var r = new FileReader(); r.onload = function(){ res(r.result); }; r.onerror = rej; r.readAsText(file); }); }
function downloadBlob(blob, filename){
  var a = document.getElementById('download');
  if (a.dataset.url) URL.revokeObjectURL(a.dataset.url);
  var url = URL.createObjectURL(blob);
  a.dataset.url = url;
  a.href = url; a.download = filename;
  a.style.display = 'inline-block';
  a.textContent = 'Download ' + filename;
  log('Ready: ' + filename + ' (' + fmtBytes(blob.size) + ')', 'ok');
}
function setProgress(p){
  var bar = document.getElementById('progress');
  bar.style.display = p == null ? 'none' : 'block';
  if (p != null) bar.firstElementChild.style.width = Math.round(p * 100) + '%';
}

/* ---------- CSV parse (handles quotes) ---------- */
function parseCSV(text){
  var rows = [], row = [], cur = '', q = false, i, c;
  for (i = 0; i < text.length; i++){
    c = text[i];
    if (q){
      if (c === '"'){ if (text[i+1] === '"'){ cur += '"'; i++; } else q = false; }
      else cur += c;
    } else {
      if (c === '"') q = true;
      else if (c === ','){ row.push(cur); cur = ''; }
      else if (c === '\n'){ row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (c === '\r'){ /* skip */ }
      else cur += c;
    }
  }
  row.push(cur); rows.push(row);
  while (rows.length && rows[rows.length-1].length === 1 && rows[rows.length-1][0] === '') rows.pop();
  return rows;
}
function csvCell(v){
  v = String(v == null ? '' : v);
  return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}
function toCSV(rows){ return rows.map(function(r){ return r.map(csvCell).join(','); }).join('\n'); }

/* ---------- PDF kit (pdf-lib) ---------- */
var PDF = {
  A4: PdfKit.A4,
  margin: 44,
  doc: function(){ return PdfKit.doc(); },
  fonts: null,
  loadFonts: function(d){ return PdfKit.loadFonts(d); },
  wrap: function(text, font, size, maxW){ return PdfKit.wrap(text, font, size, maxW); },
  /* Flow-based block writer. blocks: [{type:'h1'|'h2'|'h3'|'p'|'li'|'code'|'quote'|'hr'|'spacer', text}] */
  async blocksToPdf(blocks, opt){
    opt = opt || {};
    var d = await this.doc(), F = await this.loadFonts(d);
    var landscape = !!opt.landscape;
    var PW = landscape ? this.A4[1] : this.A4[0], PH = landscape ? this.A4[0] : this.A4[1];
    var M = this.margin, maxW = PW - M * 2;
    var page = d.addPage([PW, PH]), y = PH - M;
    function need(h){ if (y - h < M){ page = d.addPage([PW, PH]); y = PH - M; } }
    function text(str, o){
      o = o || {};
      var font = F[o.font || 'reg'], size = o.size || 11;
      var lines = PDF.wrap(str, font, size, maxW - (o.indent || 0));
      lines.forEach(function(ln){
        need(size * 1.45);
        page.drawText(ln, { x: M + (o.indent || 0), y: y - size, size: size, font: font, color: o.color || PDFLib.rgb(0.13,0.12,0.10) });
        y -= size * 1.45;
      });
      y -= (o.after || 4);
    }
    blocks.forEach(function(b){
      if (b.type === 'h1') text(b.text, { font:'bold', size:22, after:10 });
      else if (b.type === 'h2') text(b.text, { font:'bold', size:16, after:8 });
      else if (b.type === 'h3') text(b.text, { font:'bold', size:13, after:6 });
      else if (b.type === 'li') text('\u2022  ' + b.text, { indent:14, after:2 });
      else if (b.type === 'code'){
        need(16);
        var lines = String(b.text).split('\n'), h = lines.length * 13 + 10;
        need(h);
        page.drawRectangle({ x:M, y:y-h, width:maxW, height:h, color:PDFLib.rgb(0.96,0.94,0.89), borderColor:PDFLib.rgb(0.85,0.82,0.75), borderWidth:0.5 });
        var yy = y - 12;
        lines.forEach(function(ln){ page.drawText(ln.slice(0,120), { x:M+8, y:yy-9, size:9, font:F.mono }); yy -= 13; });
        y -= h + 8;
      }
      else if (b.type === 'quote') text(b.text, { font:'italic', indent:14, color:PDFLib.rgb(0.35,0.33,0.29), after:6 });
      else if (b.type === 'hr'){ need(14); page.drawLine({ start:{x:M,y:y-6}, end:{x:PW-M,y:y-6}, thickness:0.75, color:PDFLib.rgb(0.8,0.77,0.7) }); y -= 14; }
      else if (b.type === 'spacer') y -= 10;
      else text(b.text, {});
    });
    /* footer page numbers */
    var pages = d.getPages();
    pages.forEach(function(pg, i){
      pg.drawText(String(i+1) + ' / ' + pages.length, { x: PW - M - 40, y: 24, size: 9, font: F.reg, color: PDFLib.rgb(0.55,0.52,0.47) });
    });
    var bytes = await d.save();
    return new Blob([bytes], { type: 'application/pdf' });
  }
};

/* plain string -> rich cell (csv/md paths); rich cells pass through */
function asRich(v){
  if (v && typeof v === 'object' && ('t' in v)) return v;
  return { t: v == null ? '' : String(v), bold:false, italic:false, fill:null, color:null, span:1, skip:false };
}

/* ---------- table to PDF (the hero renderer) ---------- */
async function tablesToPdf(sheets, title){
  var d = await PDF.doc(), F = await PDF.loadFonts(d);
  var M = PDF.margin, size = 9, lh = 12.5;
  var first = sheets[0] || { rows: [] };
  var ncols = 0;
  sheets.forEach(function(s){ s.rows.forEach(function(r){ ncols = Math.max(ncols, r.length); }); });
  var landscape = ncols > 6;
  var PW = landscape ? PDF.A4[1] : PDF.A4[0], PH = landscape ? PDF.A4[0] : PDF.A4[1];
  var maxW = PW - M * 2;
  /* column widths from content length */
  var widths = [];
  function cellText(rc){ return String((rc && rc.t) != null ? rc.t : (rc == null ? '' : rc)); }
  for (var c = 0; c < ncols; c++){
    var mx = 8;
    sheets.forEach(function(s){ s.rows.forEach(function(r){ var v = cellText(r[c]); mx = Math.max(mx, Math.min(v.length, 40)); }); });
    widths.push(mx);
  }
  var tot = widths.reduce(function(a,b){ return a+b; }, 0) || 1;
  widths = widths.map(function(w){ return Math.max(40, maxW * w / tot); });
  var scale = widths.reduce(function(a,b){ return a+b; }, 0) / maxW;
  if (scale > 1) widths = widths.map(function(w){ return w / scale; });

  var page = d.addPage([PW, PH]), y = PH - M;
  function need(h){ if (y - h < M){ page = d.addPage([PW, PH]); y = PH - M; } }
  /* Rich-cell row: cells are {t,bold,italic,fill,color,span,skip}. */
  function drawRow(cells, isHeader){
    var colX = [], x = M;
    widths.forEach(function(w){ colX.push(x); x += w; });
    function spanW(ci){
      var rc = cells[ci] || {}, w = 0, n = rc.span || 1;
      for (var k = 0; k < n && ci + k < widths.length; k++) w += widths[ci + k];
      return w;
    }
    function cellFont(rc){ return (rc.bold || isHeader) ? F.bold : (rc.italic ? F.italic : F.reg); }
    var cellLines = cells.map(function(rc, ci){
      if (rc.skip) return [''];
      return PDF.wrap(rc.t, cellFont(rc), size, Math.max(spanW(ci) - 8, 10));
    });
    var lines = Math.max.apply(null, cellLines.map(function(l){ return l.length; }).concat([1]));
    var h = lines * lh + 8;
    need(h);
    var stripe = !isHeader && (drawRow.alt = !drawRow.alt);
    cells.forEach(function(rc, ci){
      if (rc.skip) return;
      var bg = rc.fill || (isHeader ? [0.93,0.95,1] : (stripe ? [0.98,0.97,0.94] : null));
      if (bg) page.drawRectangle({ x: colX[ci], y: y - h, width: spanW(ci), height: h, color: PDFLib.rgb(bg[0], bg[1], bg[2]) });
    });
    cells.forEach(function(rc, ci){
      if (rc.skip) return;
      var col = rc.color || [0.13,0.12,0.10];
      cellLines[ci].forEach(function(ln, li){
        page.drawText(String(ln).slice(0, 200), { x: colX[ci] + 4, y: y - 10 - li * lh, size: size, font: cellFont(rc), color: PDFLib.rgb(col[0], col[1], col[2]) });
      });
    });
    /* gridlines */
    var gy = y;
    page.drawLine({ start:{x:M,y:gy}, end:{x:M+maxW,y:gy}, thickness:0.5, color:PDFLib.rgb(0.78,0.75,0.68) });
    colX.forEach(function(cx){ page.drawLine({ start:{x:cx,y:gy}, end:{x:cx,y:gy-h}, thickness:0.5, color:PDFLib.rgb(0.85,0.83,0.77) }); });
    page.drawLine({ start:{x:M+maxW,y:gy}, end:{x:M+maxW,y:gy-h}, thickness:0.5, color:PDFLib.rgb(0.85,0.83,0.77) });
    y -= h;
  }
  drawRow.alt = false;
  if (title){ page.drawText(title, { x:M, y:y-14, size:13, font:F.bold, color:PDFLib.rgb(0.13,0.12,0.10) }); y -= 26; }
  sheets.forEach(function(s, si){
    if (sheets.length > 1){
      need(30);
      page.drawText('Sheet: ' + s.name, { x:M, y:y-12, size:11, font:F.bold, color:PDFLib.rgb(0.2,0.35,0.6) });
      y -= 24; drawRow.alt = false;
    }
    if (!s.rows.length){ need(20); page.drawText('(empty sheet)', { x:M, y:y-10, size:10, font:F.italic }); y -= 20; return; }
    s.rows.forEach(function(r, ri){
      var cells = [];
      for (var c = 0; c < ncols; c++) cells.push(asRich(r[c]));
      drawRow(cells, ri === 0 && s.header);
    });
    y -= 14;
  });
  var pages = d.getPages();
  pages.forEach(function(pg, i){
    pg.drawText(String(i+1) + ' / ' + pages.length, { x: PW - M - 40, y: 24, size: 9, font: F.reg, color: PDFLib.rgb(0.55,0.52,0.47) });
  });
  var bytes = await d.save();
  return new Blob([bytes], { type: 'application/pdf' });
}

async function readWorkbook(file){
  var buf = await readAsArrayBuffer(file);
  var wb = XLSX.read(buf, { type: 'array' });
  var sheets = wb.SheetNames.map(function(name){
    var ws = wb.Sheets[name];
    var rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
    while (rows.length && rows[rows.length-1].every(function(v){ return String(v) === ''; })) rows.pop();
    return { name: name, rows: rows, header: rows.length > 0, merges: (ws['!merges'] || []).length };
  });
  return sheets;
}

/* ---------- markdown blocks ---------- */
function mdToBlocks(src){
  var tokens = marked.lexer(src), blocks = [];
  tokens.forEach(function(t){
    if (t.type === 'heading') blocks.push({ type: 'h' + Math.min(t.depth, 3), text: t.text });
    else if (t.type === 'paragraph') blocks.push({ type: 'p', text: t.text });
    else if (t.type === 'list') t.items.forEach(function(it){ blocks.push({ type: 'li', text: it.text }); });
    else if (t.type === 'code') blocks.push({ type: 'code', text: t.text });
    else if (t.type === 'blockquote') blocks.push({ type: 'quote', text: t.text });
    else if (t.type === 'hr') blocks.push({ type: 'hr' });
    else if (t.type === 'space') blocks.push({ type: 'spacer' });
    else if (t.type === 'table'){
      var rows = [t.header.map(function(c){ return c.text; })];
      t.rows.forEach(function(r){ rows.push(r.map(function(c){ return c.text; })); });
      blocks.push({ type: '_table', rows: rows });
    }
  });
  return blocks;
}
/* strip markdown inline markers for plain renderers */
function mdInline(s){
  return String(s).replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/^#+\s*/, '');
}
function mdInlineDocx(s, docx){
  /* split **bold**, *italic*, `code` into runs */
  var runs = [], re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g, last = 0, m;
  while ((m = re.exec(s))){
    if (m.index > last) runs.push(new docx.TextRun(String(s.slice(last, m.index))));
    var tok = m[0];
    if (tok.startsWith('**')) runs.push(new docx.TextRun({ text: tok.slice(2, -2), bold: true }));
    else if (tok.startsWith('`')) runs.push(new docx.TextRun({ text: tok.slice(1, -1), font: 'Courier New' }));
    else runs.push(new docx.TextRun({ text: tok.slice(1, -1), italics: true }));
    last = m.index + tok.length;
  }
  if (last < s.length) runs.push(new docx.TextRun(String(s.slice(last))));
  return runs.length ? runs : [new docx.TextRun(String(s))];
}

/* ---------- converters ---------- */
var C = {};

C.xlsxToPdf = {
  needs: ['XLSX', 'PDFLib'],
  run: async function(file){
    var mode = state.formulaMode || 'final';
    /* Engine seam: when the real spreadsheet engine is present (grid.29court.com),
     * hand the workbook to it so the PDF matches the app pixel-for-pixel. */
    if (typeof window !== 'undefined' && window.SuperConvertEngine && typeof window.SuperConvertEngine.xlsxToPdf === 'function'){
      try {
        log('Rendering with the spreadsheet engine.');
        return await window.SuperConvertEngine.xlsxToPdf(file, { formulaMode: mode });
      } catch(e){ log('Engine render failed (' + (e && e.message) + '), used the built-in renderer.', 'warn'); }
    }
    var buf = await readAsArrayBuffer(file);
    var data = await RichXlsx.readBuffer(buf, mode, {
      ExcelJS: (typeof ExcelJS !== 'undefined') ? ExcelJS : null,
      XLSX: (typeof XLSX !== 'undefined') ? XLSX : null,
      FormulaParser: (typeof FormulaParser !== 'undefined') ? FormulaParser : null,
      JSZip: (typeof JSZip !== 'undefined') ? JSZip : null,
      XlsxCharts: (typeof XlsxCharts !== 'undefined') ? XlsxCharts : null,
      log: log
    });
    var sheets = data.sheets, stats = data.stats;
    var total = sheets.reduce(function(a,s){ return a + s.rows.length; }, 0);
    log('Parsed ' + sheets.length + ' sheet(s), ' + total + ' rows (' + (mode === 'raw' ? 'raw formulas' : 'final values') + ').' +
        (typeof ExcelJS !== 'undefined' ? (stats.themeColors ? ' Theme colors resolved.' : '') : ' Basic reader: no cell styling.'));
    if (stats.evaluated) log('Calculated ' + stats.evaluated + ' formula(s) on this device.', 'ok');
    if (stats.evalFailed) log(stats.evalFailed + ' formula(s) used functions this engine does not support and were left blank.', 'warn');
    if (stats.engineMissing) log('The formula engine did not load, so ' + stats.noCache + ' uncalculated formula(s) were left blank. Reload and try again.', 'warn');
    else if (stats.noCache) log(stats.noCache + ' formula(s) could not be calculated and were left blank.', 'warn');
    if (stats.cfCells) log('Applied ' + stats.cfRules + ' conditional-formatting rule(s) to ' + stats.cfCells + ' cell(s).', 'ok');
    /* Pixel-faithful renderer: theme colors, borders, real column widths and
     * row heights, fonts, alignment, fills, merges, number formats. */
    var pdfBytes = await XlsxPrint.sheetsToPdf(sheets, {
      filename: file.name,
      dateStr: new Date().toLocaleDateString(),
      logoB64: (typeof __CONVERT_LOGO_B64__ !== 'undefined') ? __CONVERT_LOGO_B64__ : null,
      stats: stats
    }, { PDFLib: PDFLib, PDF: PdfKit,
         fontkit: (typeof fontkit !== 'undefined') ? fontkit : null,
         XlsxCharts: (typeof XlsxCharts !== 'undefined') ? XlsxCharts : null });
    if (stats.cjkEmbedded) log('Embedded a CJK font subset for non-Latin text.', 'ok');
    if (stats.chartsDrawn) log('Drew ' + stats.chartsDrawn + ' chart(s) as vector graphics.', 'ok');
    if (stats.chartsTiledAway) log(stats.chartsTiledAway + ' chart(s) sat on tiled-away columns and were skipped.', 'warn');
    if (stats.chartsUnsupported) log(stats.chartsUnsupported + ' chart(s) use an unsupported type and were skipped.', 'warn');
    return new Blob([pdfBytes], { type: 'application/pdf' });
  }
};
C.csvToPdf = {
  needs: ['PDFLib'],
  run: async function(file){
    var text = await readAsText(file);
    var rows = parseCSV(text);
    log('Parsed ' + rows.length + ' rows from CSV.');
    return await tablesToPdf([{ name: baseOf(file.name), rows: rows, header: true }], baseOf(file.name));
  }
};
C.xlsxToCsv = {
  needs: ['XLSX'],
  run: async function(file){
    var sheets = await readWorkbook(file);
    var out = sheets.map(function(s){ return toCSV(s.rows); }).join('\n\n');
    if (sheets.length > 1) log('Workbook had ' + sheets.length + ' sheets; they were stacked with a blank line between.', 'warn');
    return new Blob([out], { type: 'text/csv' });
  }
};
C.csvToXlsx = {
  needs: ['XLSX'],
  run: async function(file){
    var rows = parseCSV(await readAsText(file));
    var ws = XLSX.utils.aoa_to_sheet(rows);
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    var bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    return new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
};
C.sheetToJson = {
  needs: ['XLSX'],
  run: async function(file){
    var buf = await readAsArrayBuffer(file), out;
    if (/\.csv$/i.test(file.name)){
      var rows = parseCSV(await readAsText(file));
      var head = rows[0] || [];
      out = rows.slice(1).map(function(r){ var o = {}; head.forEach(function(h,i){ o[h || ('col'+i)] = r[i] == null ? '' : r[i]; }); return o; });
    } else {
      var wb = XLSX.read(buf, { type: 'array' });
      var ws = wb.Sheets[wb.SheetNames[0]];
      out = XLSX.utils.sheet_to_json(ws, { raw: false, defval: '' });
    }
    return new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  }
};
C.jsonToCsv = {
  needs: [],
  run: async function(file){
    var data = JSON.parse(await readAsText(file));
    if (!Array.isArray(data)) data = [data];
    var keys = [];
    data.forEach(function(o){ Object.keys(o || {}).forEach(function(k){ if (keys.indexOf(k) < 0) keys.push(k); }); });
    var rows = [keys].concat(data.map(function(o){ return keys.map(function(k){ var v = o[k]; return (v != null && typeof v === 'object') ? JSON.stringify(v) : (v == null ? '' : v); }); }));
    log('Flattened ' + data.length + ' objects across ' + keys.length + ' columns. Nested values became JSON strings.', 'warn');
    return new Blob([toCSV(rows)], { type: 'text/csv' });
  }
};
C.jsonToYaml = {
  needs: ['jsyaml'],
  run: async function(file){
    var data = JSON.parse(await readAsText(file));
    return new Blob([jsyaml.dump(data)], { type: 'text/yaml' });
  }
};
C.yamlToJson = {
  needs: ['jsyaml'],
  run: async function(file){
    var data = jsyaml.load(await readAsText(file));
    return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  }
};
C.yamlToCsv = {
  needs: ['jsyaml'],
  run: async function(file){
    var data = jsyaml.load(await readAsText(file));
    if (!Array.isArray(data)) data = [data];
    var keys = [];
    data.forEach(function(o){ Object.keys(o || {}).forEach(function(k){ if (keys.indexOf(k) < 0) keys.push(k); }); });
    var rows = [keys].concat(data.map(function(o){ return keys.map(function(k){ var v = o[k]; return (v != null && typeof v === 'object') ? JSON.stringify(v) : (v == null ? '' : v); }); }));
    return new Blob([toCSV(rows)], { type: 'text/csv' });
  }
};
C.jsonToPdf = {
  needs: ['PDFLib'],
  run: async function(file){
    var text = await readAsText(file);
    JSON.parse(text);
    var lines = text.split('\n');
    var blocks = [{ type: 'h1', text: baseOf(file.name) + '.json' }];
    lines.forEach(function(ln){ blocks.push({ type: 'code', text: ln }); });
    return await PDF.blocksToPdf(blocks);
  }
};
C.docxToPdf = {
  needs: ['mammoth', 'PDFLib'],
  run: async function(file){
    var buf = await readAsArrayBuffer(file);
    var r = await mammoth.convertToHtml({ arrayBuffer: buf });
    if (r.messages && r.messages.length) log('mammoth notes: ' + r.messages.slice(0,3).map(function(m){ return m.message; }).join('; '), 'warn');
    var div = document.createElement('div'); div.innerHTML = r.value;
    var blocks = [];
    Array.prototype.forEach.call(div.childNodes, function(n){
      if (n.nodeType === 3){ var t = n.textContent.trim(); if (t) blocks.push({ type:'p', text:t }); return; }
      var tag = (n.tagName || '').toLowerCase(), txt = mdInline(n.textContent || '');
      if (!txt.trim()) return;
      if (/^h[1-3]$/.test(tag)) blocks.push({ type: tag, text: txt });
      else if (tag === 'li') blocks.push({ type: 'li', text: txt });
      else if (tag === 'blockquote') blocks.push({ type: 'quote', text: txt });
      else if (tag === 'pre') blocks.push({ type: 'code', text: n.textContent });
      else blocks.push({ type: 'p', text: txt });
    });
    log('Extracted ' + blocks.length + ' blocks. Layout, headers, footers and images are not carried over.', 'warn');
    return await PDF.blocksToPdf(blocks);
  }
};
C.docxToText = {
  needs: ['mammoth'],
  run: async function(file){
    var buf = await readAsArrayBuffer(file);
    var r = await mammoth.extractRawText({ arrayBuffer: buf });
    return new Blob([r.value], { type: 'text/plain' });
  }
};
C.docxToMd = {
  needs: ['mammoth'],
  run: async function(file){
    var buf = await readAsArrayBuffer(file);
    var r = await mammoth.convertToHtml({ arrayBuffer: buf });
    var div = document.createElement('div'); div.innerHTML = r.value;
    var out = [];
    Array.prototype.forEach.call(div.childNodes, function(n){
      if (n.nodeType === 3){ var t = n.textContent.trim(); if (t) out.push(t + '\n'); return; }
      var tag = (n.tagName || '').toLowerCase(), txt = n.textContent.trim();
      if (!txt) return;
      if (tag === 'h1') out.push('# ' + txt + '\n');
      else if (tag === 'h2') out.push('## ' + txt + '\n');
      else if (tag === 'h3') out.push('### ' + txt + '\n');
      else if (tag === 'li') out.push('- ' + txt + '\n');
      else if (tag === 'blockquote') out.push('> ' + txt + '\n');
      else out.push(txt + '\n');
    });
    return new Blob([out.join('\n')], { type: 'text/markdown' });
  }
};
async function pdfExtractText(file, onpage){
  var buf = await readAsArrayBuffer(file);
  var pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  var pages = [];
  for (var i = 1; i <= pdf.numPages; i++){
    var pg = await pdf.getPage(i);
    var tc = await pg.getTextContent();
    var lines = {}, li;
    tc.items.forEach(function(it){
      var y = Math.round(it.transform[5]);
      (lines[y] = lines[y] || []).push(it);
    });
    var ys = Object.keys(lines).map(Number).sort(function(a,b){ return b - a; });
    var text = ys.map(function(y){ return lines[y].sort(function(a,b){ return a.transform[4] - b.transform[4]; }).map(function(it){ return it.str; }).join(' '); }).join('\n');
    pages.push(text);
    if (onpage) onpage(i, pdf.numPages);
  }
  return pages;
}
C.pdfToTxt = {
  needs: ['pdfjsLib'],
  run: async function(file){
    var pages = await pdfExtractText(file, function(i,n){ setProgress(i/n*0.8); });
    log('Extracted text from ' + pages.length + ' pages. Layout and images are not carried over.', 'warn');
    return new Blob([pages.join('\n\n--- page break ---\n\n')], { type: 'text/plain' });
  }
};
C.pdfToDocx = {
  needs: ['pdfjsLib', 'docx'],
  run: async function(file){
    var pages = await pdfExtractText(file, function(i,n){ setProgress(i/n*0.7); });
    var children = [];
    pages.forEach(function(p, i){
      if (i > 0) children.push(new docx.Paragraph({ children: [new docx.TextRun({ text: '--- page ' + (i+1) + ' ---', italics: true })] }));
      p.split('\n').forEach(function(ln){ children.push(new docx.Paragraph({ children: [new docx.TextRun(ln)] })); });
    });
    var doc = new docx.Document({ sections: [{ children: children }] });
    var blob = await docx.Packer.toBlob(doc);
    log('Text extracted from ' + pages.length + ' pages into a Word doc. Original layout is not preserved.', 'warn');
    return blob;
  }
};
C.mdToPdf = {
  needs: ['marked', 'PDFLib'],
  run: async function(file){
    var src = await readAsText(file);
    var blocks = mdToBlocks(src), pdfBlocks = [], tables = [];
    blocks.forEach(function(b){
      if (b.type === '_table') tables.push(b.rows);
      else pdfBlocks.push({ type: b.type, text: mdInline(b.text == null ? '' : b.text) });
    });
    if (!tables.length) return await PDF.blocksToPdf(pdfBlocks);
    /* render doc then tables: do tables inline by converting each to code-ish rows */
    var out = [], ti = 0;
    blocks.forEach(function(b){
      if (b.type === '_table'){
        var rows = b.rows, bi = ti++;
        out.push({ type: 'spacer' });
        rows.forEach(function(r, ri){ out.push({ type: ri === 0 ? 'h3' : 'p', text: (ri === 0 ? '' : '\u2022 ') + r.map(mdInline).join(' | ') }); });
        out.push({ type: 'spacer' });
      } else out.push({ type: b.type, text: mdInline(b.text == null ? '' : b.text) });
    });
    log('Markdown tables were flattened to text rows (column alignment is approximate).', 'warn');
    return await PDF.blocksToPdf(out);
  }
};
C.mdToHtml = {
  needs: ['marked'],
  run: async function(file){
    var src = await readAsText(file);
    var body = marked.parse(src);
    var html = '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>' + baseOf(file.name) + '</title>\n<style>body{font-family:system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 20px;line-height:1.6}pre{background:#f4f1ea;padding:12px;border-radius:8px;overflow:auto}code{font-family:monospace}blockquote{border-left:3px solid #ddd;padding-left:12px;color:#666}</style>\n</head>\n<body>\n' + body + '\n</body>\n</html>';
    return new Blob([html], { type: 'text/html' });
  }
};
C.mdToDocx = {
  needs: ['marked', 'docx'],
  run: async function(file){
    var src = await readAsText(file);
    var tokens = marked.lexer(src), children = [];
    tokens.forEach(function(t){
      if (t.type === 'heading') children.push(new docx.Paragraph({ heading: 'Heading' + Math.min(t.depth, 3), children: mdInlineDocx(t.text, docx) }));
      else if (t.type === 'paragraph') children.push(new docx.Paragraph({ children: mdInlineDocx(t.text, docx) }));
      else if (t.type === 'list') t.items.forEach(function(it){ children.push(new docx.Paragraph({ bullet: { level: 0 }, children: mdInlineDocx(it.text, docx) })); });
      else if (t.type === 'code') children.push(new docx.Paragraph({ children: [new docx.TextRun({ text: t.text, font: 'Courier New' })] }));
      else if (t.type === 'blockquote') children.push(new docx.Paragraph({ children: mdInlineDocx(t.text, docx) }));
      else if (t.type === 'hr') children.push(new docx.Paragraph({ children: [new docx.TextRun('---')] }));
      else if (t.type === 'table'){
        var rows = [t.header.map(function(c){ return c.text; })].concat(t.rows.map(function(r){ return r.map(function(c){ return c.text; }); }));
        var tableRows = rows.map(function(r){
          return new docx.TableRow({ children: r.map(function(c){
            return new docx.TableCell({ children: [new docx.Paragraph(mdInline(c))] });
          }) });
        });
        children.push(new docx.Table({ rows: tableRows }));
      }
    });
    var doc = new docx.Document({ sections: [{ children: children }] });
    return await docx.Packer.toBlob(doc);
  }
};
C.mdToTxt = {
  needs: ['marked'],
  run: async function(file){
    var src = await readAsText(file);
    var out = [];
    marked.lexer(src).forEach(function(t){
      if (t.type === 'heading') out.push('\n' + t.text.toUpperCase() + '\n' + '='.repeat(Math.min(t.text.length, 60)));
      else if (t.type === 'paragraph') out.push(mdInline(t.text));
      else if (t.type === 'list') t.items.forEach(function(it){ out.push('- ' + mdInline(it.text)); });
      else if (t.type === 'code') out.push(t.text);
      else if (t.type === 'blockquote') out.push('> ' + mdInline(t.text));
      else if (t.type === 'table'){ out.push(t.header.map(function(c){ return c.text; }).join(' | ')); t.rows.forEach(function(r){ out.push(r.map(function(c){ return c.text; }).join(' | ')); }); }
    });
    return new Blob([out.join('\n\n')], { type: 'text/plain' });
  }
};
C.txtToPdf = {
  needs: ['PDFLib'],
  run: async function(file){
    var text = await readAsText(file);
    var blocks = text.split(/\n\s*\n/).map(function(p){ return { type: 'p', text: p.trim() }; }).filter(function(b){ return b.text; });
    return await PDF.blocksToPdf([{ type: 'h1', text: baseOf(file.name) }].concat(blocks));
  }
};
C.txtToHtml = {
  needs: [],
  run: async function(file){
    var text = await readAsText(file);
    function esc(s){ return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
    var body = text.split(/\n\s*\n/).map(function(p){ return '<p>' + esc(p.trim()).replace(/\n/g, '<br>') + '</p>'; }).join('\n');
    return new Blob(['<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>' + esc(baseOf(file.name)) + '</title>\n</head>\n<body>\n' + body + '\n</body>\n</html>'], { type: 'text/html' });
  }
};
C.txtToMd = {
  needs: [],
  run: async function(file){ return new Blob([await readAsText(file)], { type: 'text/markdown' }); }
};
C.imageConvert = {
  needs: [],
  run: async function(file, target){
    var bmp = await createImageBitmap(file);
    var cv = document.createElement('canvas');
    cv.width = bmp.width; cv.height = bmp.height;
    cv.getContext('2d').drawImage(bmp, 0, 0);
    var mime = target === 'jpg' ? 'image/jpeg' : target === 'webp' ? 'image/webp' : 'image/png';
    if (target === 'gif'){ log('GIF output is not supported by browsers; converting to PNG instead.', 'warn'); mime = 'image/png'; target = 'png'; }
    var blob = await new Promise(function(res){ cv.toBlob(res, mime, 0.92); });
    if (!blob) throw new Error('This browser could not encode ' + target.toUpperCase() + '.');
    if (/\.gif$/i.test(file.name) || /\.bmp$/i.test(file.name)) log('Source was ' + extOf(file.name).toUpperCase() + '; animation and layers are not carried over.', 'warn');
    C.imageConvert._target = target;
    return blob;
  }
};

/* ---------- registry: source -> [{to, label, run, ext, preserves}] ---------- */
var IMAGE_IN = ['png','jpg','jpeg','webp','gif','bmp'];
var IMAGE_OUT = [
  { to:'png', label:'PNG', preserves:'Pixel perfect. Keeps transparency.' },
  { to:'jpg', label:'JPG', preserves:'Smaller file. Loses transparency.' },
  { to:'webp', label:'WebP', preserves:'Modern and small. Keeps transparency.' }
];
var REGISTRY = {
  xlsx: [
    { to:'pdf', label:'PDF', run:C.xlsxToPdf.run, preserves:'Theme colors, borders, real column widths and row heights, fonts (size, bold, italic, underline, strike), alignment and text wrap, fills, merged cells, number formats, embedded images. Every formula is calculated on your device, so values always show (never raw =SUM text). Wide sheets tile across pages instead of shrinking. Each sheet rendered in order with a cover page and footer. Loses: charts, conditional formatting, print settings (orientation/fit), exact font files (rendered in Helvetica); non-Latin scripts show as placeholders. Toggle below for raw formulas.' },
    { to:'csv', label:'CSV', run:C.xlsxToCsv.run, preserves:'First sheet values, or all sheets stacked. Loses: formatting, formulas.' },
    { to:'json', label:'JSON', run:C.sheetToJson.run, preserves:'First sheet as objects. Loses: formatting.' }
  ],
  xls: 'xlsx',
  csv: [
    { to:'pdf', label:'PDF', run:C.csvToPdf.run, preserves:'Full table as a clean PDF. Loses: nothing, CSV has no formatting.' },
    { to:'xlsx', label:'XLSX', run:C.csvToXlsx.run, preserves:'Everything. CSV maps cleanly to one sheet.' },
    { to:'json', label:'JSON', run:C.sheetToJson.run, preserves:'Rows as objects keyed by header row.' }
  ],
  tsv: 'csv',
  docx: [
    { to:'pdf', label:'PDF', run:C.docxToPdf.run, preserves:'Text and structure. Loses: exact layout, headers, footers, images.' },
    { to:'md', label:'Markdown', run:C.docxToMd.run, preserves:'Headings, lists, quotes, text. Loses: exact styling.' },
    { to:'txt', label:'Plain text', run:C.docxToText.run, preserves:'Just the words.' }
  ],
  pdf: [
    { to:'txt', label:'Plain text', run:C.pdfToTxt.run, preserves:'Extracted text. Loses: layout, images.' },
    { to:'docx', label:'Word', run:C.pdfToDocx.run, preserves:'Text in a real .docx. Loses: original layout.' }
  ],
  md: [
    { to:'pdf', label:'PDF', run:C.mdToPdf.run, preserves:'Headings, lists, code, quotes. Tables become text rows.' },
    { to:'html', label:'HTML', run:C.mdToHtml.run, preserves:'Everything, styled page.' },
    { to:'docx', label:'Word', run:C.mdToDocx.run, preserves:'Headings, lists, tables, bold and italic.' },
    { to:'txt', label:'Plain text', run:C.mdToTxt.run, preserves:'Words without markup.' }
  ],
  markdown: 'md',
  txt: [
    { to:'pdf', label:'PDF', run:C.txtToPdf.run, preserves:'Paragraphs as a clean document.' },
    { to:'html', label:'HTML', run:C.txtToHtml.run, preserves:'Paragraphs in a simple page.' },
    { to:'md', label:'Markdown', run:C.txtToMd.run, preserves:'Same text, markdown file.' }
  ],
  text: 'txt',
  json: [
    { to:'csv', label:'CSV', run:C.jsonToCsv.run, preserves:'Array of objects to rows. Nested values become JSON strings.' },
    { to:'yaml', label:'YAML', run:C.jsonToYaml.run, preserves:'Everything. Clean round trip.' },
    { to:'pdf', label:'PDF', run:C.jsonToPdf.run, preserves:'Pretty printed source as PDF.' }
  ],
  yaml: [
    { to:'json', label:'JSON', run:C.yamlToJson.run, preserves:'Everything. Clean round trip.' },
    { to:'csv', label:'CSV', run:C.yamlToCsv.run, preserves:'Arrays of objects to rows.' }
  ],
  yml: 'yaml'
};
IMAGE_IN.forEach(function(e){ REGISTRY[e] = IMAGE_OUT.map(function(o){ return { to:o.to, label:o.label, run:function(f){ return C.imageConvert.run(f, o.to); }, preserves:o.preserves, img:true }; }); });
var VIDEO = ['mp4','mov','avi','mkv','webm','m4v'];
function targetsFor(ext){
  var t = REGISTRY[ext];
  if (typeof t === 'string') t = REGISTRY[t];
  return t || null;
}

/* ---------- matrix cards ---------- */
(function(){
  var wrap = document.getElementById('matrixcards');
  function card(from, to, preserves, server){
    var d = document.createElement('div');
    d.className = 'card' + (server ? ' server' : '');
    d.innerHTML = '<h3>' + from + ' <span class="arrow">&rarr;</span> ' + to + '</h3><p><b>Keeps:</b> ' + preserves + '</p>';
    wrap.appendChild(d);
  }
  Object.keys(REGISTRY).forEach(function(src){
    if (typeof REGISTRY[src] === 'string') return;
    REGISTRY[src].forEach(function(t){ card(src.toUpperCase(), t.label, t.preserves); });
  });
  card('MP4 / MOV / WEBM', 'MP4', 'Server conversion at help.29court.com. This page does not fake it.', true);
})();

/* ---------- UI wiring ---------- */
var state = { file: null, ext: null, target: null, formulaMode: 'final' };
/* Formula display toggle (xlsx -> pdf). */
function setFormulaMode(mode){
  state.formulaMode = mode === 'raw' ? 'raw' : 'final';
  var f = document.getElementById('fmode-final'), r = document.getElementById('fmode-raw');
  if (f) f.setAttribute('aria-pressed', state.formulaMode === 'final' ? 'true' : 'false');
  if (r) r.setAttribute('aria-pressed', state.formulaMode === 'raw' ? 'true' : 'false');
}
var dropzone = document.getElementById('dropzone'), fileinput = document.getElementById('fileinput');
var filebar = document.getElementById('filebar'), targetsEl = document.getElementById('targets');
var convertbtn = document.getElementById('convertbtn'), preservenote = document.getElementById('preservenote');

dropzone.addEventListener('click', function(){ fileinput.click(); });
dropzone.addEventListener('keydown', function(e){ if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); fileinput.click(); } });
['dragenter','dragover'].forEach(function(ev){ dropzone.addEventListener(ev, function(e){ e.preventDefault(); dropzone.classList.add('drag'); }); });
['dragleave','drop'].forEach(function(ev){ dropzone.addEventListener(ev, function(e){ e.preventDefault(); dropzone.classList.remove('drag'); }); });
dropzone.addEventListener('drop', function(e){ if (e.dataTransfer.files.length) pickFile(e.dataTransfer.files[0]); });
fileinput.addEventListener('change', function(){ if (fileinput.files.length) pickFile(fileinput.files[0]); });

/* Inlined at build time by build.py (site/samples/sample-workbook.xlsx). */
var SAMPLE_XLSX_B64 = "__SAMPLE_XLSX_B64__";
document.getElementById('samplebtn').addEventListener('click', function(){
  try {
    if (!SAMPLE_XLSX_B64 || SAMPLE_XLSX_B64.indexOf('__SAMPLE') === 0)
      throw new Error('sample not bundled');
    var bin = atob(SAMPLE_XLSX_B64), n = bin.length, bytes = new Uint8Array(n);
    for (var i = 0; i < n; i++) bytes[i] = bin.charCodeAt(i);
    var file = new File([bytes], 'sample-workbook.xlsx',
      { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    pickFile(file);
    /* one tap: auto-pick the PDF target and convert */
    var btns = targetsEl.children, picked = false, i2;
    for (i2 = 0; i2 < btns.length; i2++){
      if (btns[i2].textContent === 'PDF'){ btns[i2].click(); picked = true; break; }
    }
    if (picked && state.target) convertbtn.click();
    else log('Sample loaded. Pick a target to convert it.', 'warn');
  } catch (e){ log('Sample failed to load: ' + (e && e.message ? e.message : e), 'err'); }
});
/* Fetch an .xlsx from a URL and load it like a dropped file. Honest errors:
 * DNS failure, HTTP errors, timeouts, oversized and non-xlsx responses all
 * land in the conversion log; bytes are zip-signature-checked before use.
 * Never hangs: the fetch aborts at the timeout. */
async function fetchXlsxUrl(url, timeoutMs, maxBytes){
  var ctrl = new AbortController();
  var timer = setTimeout(function(){ try { ctrl.abort(); } catch(e){} }, timeoutMs);
  var host = url.replace(/^https?:\/\//i, '').split(/[\/?#:]/)[0];
  var res;
  try {
    res = await fetch(url, { signal: ctrl.signal });
  } catch(e){
    clearTimeout(timer);
    if (ctrl.signal.aborted)
      throw new Error('timed out after ' + (timeoutMs / 1000) + 's waiting for ' + host);
    throw new Error('could not reach ' + host + ' (' + (e && e.message ? e.message : e) +
      '). The server may also be blocking cross-site downloads (CORS).');
  }
  clearTimeout(timer);
  if (!res.ok)
    throw new Error('HTTP ' + res.status + ' ' + (res.statusText || '') + ' for ' + url);
  var buf = await res.arrayBuffer();
  var bytes = new Uint8Array(buf);
  if (bytes.length > maxBytes)
    throw new Error('file is ' + fmtBytes(bytes.length) + ', over the ' + fmtBytes(maxBytes) + ' limit');
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4B)
    throw new Error('the response is not an xlsx file (bad zip signature)');
  return bytes;
}
document.getElementById('urlbtn').addEventListener('click', async function(){
  var input = document.getElementById('urlinput');
  var url = (input.value || '').trim();
  if (!url){ log('Paste a link to an .xlsx file first.', 'warn'); input.focus(); return; }
  if (!/^https?:\/\//i.test(url)){
    if (/^[\w-]+(\.[\w-]+)+/.test(url)) url = 'https://' + url;
    else { log('That does not look like a URL (it needs http:// or https://).', 'err'); return; }
  }
  var btn = document.getElementById('urlbtn');
  btn.disabled = true;
  log('Fetching ' + url + ' ...');
  try {
    var bytes = await fetchXlsxUrl(url, 30000, 100 * 1024 * 1024);
    var name = 'workbook.xlsx';
    try {
      var base = new URL(url).pathname.split('/').pop();
      if (base) name = decodeURIComponent(base);
    } catch(e){}
    pickFile(new File([bytes],
      /\.xlsx?$/i.test(name) ? name : name + '.xlsx',
      { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    log('Fetched ' + fmtBytes(bytes.length) + '. Pick a target to convert it.', 'ok');
  } catch(e){
    log('Fetch failed: ' + (e && e.message ? e.message : e), 'err');
  }
  btn.disabled = false;
});
document.getElementById('clearbtn').addEventListener('click', function(){
  state = { file: null, ext: null, target: null, formulaMode: 'final' };
  setFormulaMode('final');
  fileinput.value = ''; filebar.style.display = 'none';
  document.getElementById('download').style.display = 'none';
  setProgress(null); dropzone.style.display = '';
});

document.getElementById('fmode-final').addEventListener('click', function(){ setFormulaMode('final'); });
document.getElementById('fmode-raw').addEventListener('click', function(){ setFormulaMode('raw'); });

function pickFile(file){
  var ext = extOf(file.name);
  if (VIDEO.indexOf(ext) >= 0){
    log('Video detected: ' + file.name + '. Video conversion needs our servers.', 'warn');
    if (confirm('Video files convert on our servers at help.29court.com. Open it now?')) window.open('https://help.29court.com/', '_blank');
    return;
  }
  var targets = targetsFor(ext);
  if (!targets){
    log('No converter for .' + (ext || 'unknown') + ' yet. Tell us what you need.', 'err');
    alert('Sorry, .' + (ext || 'that') + ' is not supported yet. The full list is below.');
    return;
  }
  state.file = file; state.ext = ext; state.target = null;
  document.getElementById('filename').textContent = file.name;
  document.getElementById('filemeta').textContent = fmtBytes(file.size) + ' : detected .' + ext;
  document.getElementById('xlsxopts').style.display = 'none';
  targetsEl.innerHTML = '';
  targets.forEach(function(t){
    var b = document.createElement('button');
    b.type = 'button'; b.textContent = t.label; b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', function(){
      Array.prototype.forEach.call(targetsEl.children, function(x){ x.setAttribute('aria-pressed','false'); });
      b.setAttribute('aria-pressed','true');
      state.target = t;
      preservenote.style.display = '';
      preservenote.innerHTML = '<b>' + ext.toUpperCase() + ' to ' + t.label + ' keeps:</b> ' + t.preserves;
      var xopts = document.getElementById('xlsxopts');
      var showToggle = (ext === 'xlsx' || ext === 'xls') && t.to === 'pdf';
      if (xopts) xopts.style.display = showToggle ? '' : 'none';
      convertbtn.disabled = false;
    });
    targetsEl.appendChild(b);
  });
  preservenote.style.display = 'none';
  convertbtn.disabled = true;
  document.getElementById('download').style.display = 'none';
  setProgress(null);
  dropzone.style.display = 'none'; filebar.style.display = 'block';
  log('Loaded ' + file.name + ' (' + fmtBytes(file.size) + '). Pick a target.');
}

convertbtn.addEventListener('click', async function(){
  if (!state.file || !state.target) return;
  var t = state.target;
  var needs = [];
  if (!t.img) Object.keys(C).forEach(function(k){ if (C[k] && C[k].run === t.run && C[k].needs) needs = C[k].needs; });
  var miss = missingLibs(needs);
  if (miss.length){
    log('Cannot convert: library failed to load (' + miss.join(', ') + '). Reload the page and try again.', 'err');
    return;
  }
  setProgress(0.05); convertbtn.disabled = true;
  document.getElementById('download').style.display = 'none';
  log('Converting ' + state.file.name + ' to ' + t.label + '...');
  try {
    var blob = await t.run(state.file, t.to);
    var outName = baseOf(state.file.name) + '.' + (t.img ? (C.imageConvert._target || t.to) : t.to);
    if (t.to === 'jpg') outName = baseOf(state.file.name) + '.jpg';
    setProgress(1);
    downloadBlob(blob, outName);
    log('Converted ' + state.file.name + ' to ' + outName + '.', 'ok');
    /* value moment: the capture loop listens for this (capture.js) */
    try { window.dispatchEvent(new CustomEvent('cv:converted', { detail: {
      srcName: state.file.name, srcExt: state.ext, dstExt: t.to, dstName: outName, bytes: blob.size } })); } catch(e){}
  } catch (err){
    log('Conversion failed: ' + (err && err.message ? err.message : err), 'err');
  }
  setProgress(null); convertbtn.disabled = false;
});

log('29Court Convert ready. Drop a file to begin.');

/* node test seam: exposes internals only when a harness opts in. Inert in the browser. */
if (typeof globalThis !== 'undefined' && globalThis.__convertTest){
  globalThis.__convertTest.C = C;
  globalThis.__convertTest.setFormulaMode = setFormulaMode;
  globalThis.__convertTest.tablesToPdf = tablesToPdf;
}
})();
