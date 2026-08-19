// ---------------------------------------------------------------------------
// 図面タブ (実寸 PDF / SVG 出力) の配線
// ---------------------------------------------------------------------------

function setupPrintControls(app) {
  var sel = $('#sel-paper');
  PAPER_SIZES.forEach(function (p, idx) {
    sel.appendChild(el('option', { value: idx, text: p.name + ' (' + p.w + ' × ' + p.h + ' mm)' }));
  });
  sel.value = '0';

  $('#btn-print-pdf').addEventListener('click', function () {
    withBusy(app, '図面を生成中...', function () { exportDrawingPDF(app); });
  });
  $('#btn-print-svg').addEventListener('click', function () {
    withBusy(app, '図面を生成中...', function () { exportDrawingSVG(app); });
  });
  $('#btn-print-preview').addEventListener('click', function () {
    withBusy(app, '図面を生成中...', function () { previewDrawings(app); });
  });
  $$('#print-views input').forEach(function (c) {
    c.addEventListener('change', function () { updatePrintTable(app); });
  });
  ['#sel-paper', '#sel-paper-orient', '#in-print-margin', '#in-print-overlap', '#sel-print-scale',
    '#chk-print-feature', '#chk-print-dims', '#sel-print-target'].forEach(function (id) {
      $(id).addEventListener('change', function () { updatePrintTable(app); });
    });
  updatePrintTable(app);
}

function printOptions(app) {
  var paper = PAPER_SIZES[parseInt($('#sel-paper').value, 10) || 0];
  return {
    paper: paper,
    landscape: $('#sel-paper-orient').value === 'landscape',
    margin: clamp(parseFloat($('#in-print-margin').value) || 0, 0, 40),
    overlap: clamp(parseFloat($('#in-print-overlap').value) || 0, 0, 50),
    scale: parseFloat($('#sel-print-scale').value) || 1,
    feature: $('#chk-print-feature').checked,
    dimensions: $('#chk-print-dims').checked,
    grid: $('#chk-print-grid').checked,
    gridStep: app.gridStep,
    title: printTitle(app)
  };
}

function printTitle(app) {
  var p = selectedPart(app);
  if ($('#sel-print-target').value === 'all' || !p) return 'scene';
  return p.name;
}

function printTargets(app) {
  var mode = $('#sel-print-target').value;
  var p = selectedPart(app);
  if (mode === 'selected' && p) return [p];
  return app.parts.filter(function (x) { return x.visible; });
}

function selectedPrintViews() {
  return $$('#print-views input').filter(function (c) { return c.checked; })
    .map(function (c) { return c.value; });
}

// 選択された図を組み立てる
function collectDrawings(app) {
  var parts = printTargets(app);
  if (!parts.length) throw new Error('対象のパーツがありません');
  var opts = printOptions(app);
  var keys = selectedPrintViews();
  if (!keys.length) throw new Error('出力する図を 1 つ以上選んでください');
  var out = [];
  for (var i = 0; i < keys.length; i++) {
    var d;
    if (keys[i] === 'section') {
      var clip = currentClip(app);
      if (!clip) throw new Error('断面タブでクリップ平面を有効にしてください');
      d = buildSectionDrawing(parts, clip.axis, clip.value);
      if (!d) throw new Error('指定位置に断面がありません (断面タブで位置を確認してください)');
    } else {
      d = buildViewDrawing(parts, keys[i], { feature: opts.feature });
    }
    if (d) out.push(d);
  }
  if (!out.length) throw new Error('図面を生成できませんでした');
  return out;
}

function updatePrintTable(app) {
  var t = $('#tbl-print');
  t.innerHTML = '';
  var parts = printTargets(app);
  if (!parts.length) { t.appendChild(kvRow('-', 'パーツがありません')); return; }
  var opts = printOptions(app);
  var keys = selectedPrintViews();
  if (!keys.length) { t.appendChild(kvRow('-', '図を選んでください')); return; }
  var b = sceneBounds(parts, false);
  var pw = opts.landscape ? opts.paper.h : opts.paper.w;
  var ph = opts.landscape ? opts.paper.w : opts.paper.h;
  t.appendChild(kvRow('対象', parts.length === 1 ? parts[0].name : parts.length + ' パーツ'));
  t.appendChild(kvRow('外形 (mm)', fmt(b.size[0], 1) + ' × ' + fmt(b.size[1], 1) + ' × ' + fmt(b.size[2], 1)));
  t.appendChild(kvRow('用紙', opts.paper.name + ' ' + (opts.landscape ? '横' : '縦') +
    ' (' + fmt(pw, 0) + ' × ' + fmt(ph, 0) + ')'));
  // 概算のページ数 (輪郭抽出を行わず外形から見積もる)
  var est = 0;
  for (var i = 0; i < keys.length; i++) {
    var dims = keys[i] === 'section' ? [b.size[0], b.size[1]] : viewExtent(keys[i], b);
    est += estimatePages(dims[0], dims[1], opts, pw, ph);
  }
  t.appendChild(kvRow('推定ページ数', String(est), est > 4 ? 'warn' : ''));
  t.appendChild(kvRow('倍率', opts.scale === 1 ? '1:1 (実寸)' : opts.scale + ' 倍'));
}

function viewExtent(key, b) {
  var v = DRAW_VIEWS[key];
  if (!v) return [b.size[0], b.size[1]];
  return [b.size[v.uAxis], b.size[v.vAxis]];
}

function estimatePages(wMm, hMm, opts, paperW, paperH) {
  var dimPad = opts.dimensions === false ? 2 : 16;
  var cw = paperW - opts.margin * 2;
  var ch = paperH - opts.margin * 2 - PAGE_HEADER_MM - PAGE_FOOTER_MM;
  if (cw <= 20 || ch <= 20) return 0;
  var W = (wMm + dimPad) * opts.scale, H = (hMm + dimPad) * opts.scale;
  var cols = W <= cw ? 1 : Math.ceil((W - opts.overlap) / (cw - opts.overlap));
  var rows = H <= ch ? 1 : Math.ceil((H - opts.overlap) / (ch - opts.overlap));
  return Math.max(1, cols) * Math.max(1, rows);
}

function exportDrawingPDF(app) {
  var drawings = collectDrawings(app);
  var opts = printOptions(app);
  opts.note = new Date().toISOString().slice(0, 10);
  var bytes = renderDrawingsToPDF(drawings, opts);
  var name = sanitizeFileName(opts.title) + '_1to1.pdf';
  saveBlob(new Blob([bytes], { type: 'application/pdf' }), name);
  setStatus(app, name + ' を書き出しました。100% (等倍) で印刷し、100 mm 基準線で確認してください。');
  updatePrintTable(app);
}

function exportDrawingSVG(app) {
  var drawings = collectDrawings(app);
  var opts = printOptions(app);
  for (var i = 0; i < drawings.length; i++) {
    var svg = renderDrawingToSVG(drawings[i], opts);
    var name = sanitizeFileName(opts.title) + '_' + drawings[i].key + '_1to1.svg';
    saveBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), name);
  }
  setStatus(app, drawings.length + ' 件の SVG を書き出しました (mm 指定のため実寸で印刷できます)。');
}

function previewDrawings(app) {
  var host = $('#print-preview');
  host.hidden = false;
  host.innerHTML = '';
  var drawings = collectDrawings(app);
  var opts = printOptions(app);
  for (var i = 0; i < drawings.length; i++) {
    var d = drawings[i];
    var wrap = el('div', { class: 'preview-item' });
    wrap.appendChild(el('div', {
      class: 'hint', text: d.titleJp + '  ' + d.uLabel + ' ' + fmt(d.bounds.width, 2) +
        ' × ' + d.vLabel + ' ' + fmt(d.bounds.height, 2) + ' mm  /  線分 ' + fmtInt(d.silhouette.length + d.feature.length)
    }));
    var img = el('div', { class: 'preview-svg' });
    img.innerHTML = renderDrawingToSVG(d, opts).replace(/^<\?xml[^>]*\?>\s*/, '')
      .replace(/width="[^"]*"/, 'width="100%"').replace(/height="[^"]*"/, '');
    wrap.appendChild(img);
    host.appendChild(wrap);
  }
  setStatus(app, 'プレビューを更新しました (画面上の表示は実寸ではありません)。');
}

function sanitizeFileName(s) {
  return String(s).replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60) || 'drawing';
}
