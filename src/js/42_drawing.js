// ---------------------------------------------------------------------------
// 印刷用の実寸図面 (正投影の輪郭線・断面輪郭) の生成
// 正投影のシルエットは、隣接 2 面の表裏が入れ替わるエッジ (輪郭線) を
// 厳密に抽出して得る。ラスタ化を行わないため、出力はベクタかつ寸法誤差なし。
// ---------------------------------------------------------------------------

var DRAW_VIEWS = {
  front: { name: 'FRONT (XZ)', jp: '正面図', into: [0, 1, 0], uAxis: 0, uSign: 1, vAxis: 2, vSign: 1, uLabel: 'X', vLabel: 'Z' },
  back: { name: 'BACK (XZ)', jp: '背面図', into: [0, -1, 0], uAxis: 0, uSign: -1, vAxis: 2, vSign: 1, uLabel: 'X', vLabel: 'Z' },
  right: { name: 'RIGHT (YZ)', jp: '右側面図', into: [-1, 0, 0], uAxis: 1, uSign: 1, vAxis: 2, vSign: 1, uLabel: 'Y', vLabel: 'Z' },
  left: { name: 'LEFT (YZ)', jp: '左側面図', into: [1, 0, 0], uAxis: 1, uSign: -1, vAxis: 2, vSign: 1, uLabel: 'Y', vLabel: 'Z' },
  top: { name: 'TOP (XY)', jp: '平面図', into: [0, 0, -1], uAxis: 0, uSign: 1, vAxis: 1, vSign: 1, uLabel: 'X', vLabel: 'Y' },
  bottom: { name: 'BOTTOM (XY)', jp: '底面図', into: [0, 0, 1], uAxis: 0, uSign: 1, vAxis: 1, vSign: -1, uLabel: 'X', vLabel: 'Y' }
};

// 頂点統合結果のキャッシュ (図面生成時のみ必要)
function ensureWelded(part) {
  if (part.welded) return part.welded;
  var diag = V3.len(part.localBounds.size) || 1;
  part.welded = weldVertices(part.positions, Math.max(diag * 1e-6, 1e-5));
  return part.welded;
}

// パーツのワールド座標頂点 (統合済み)
function weldedWorldVertices(part) {
  var w = ensureWelded(part);
  var m = part.matrix;
  var out = new Float64Array(w.vertices.length);
  for (var i = 0; i < w.vertices.length; i += 3) {
    var x = w.vertices[i], y = w.vertices[i + 1], z = w.vertices[i + 2];
    out[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
    out[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    out[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  }
  return out;
}

// 指定視線方向における輪郭線と特徴エッジを 2D (u, v) へ投影して返す
function projectedEdges(part, view, opts) {
  var o = opts || {};
  var featureDeg = o.featureAngle === undefined ? 25 : o.featureAngle;
  var wantFeature = !!o.feature;
  var w = ensureWelded(part);
  var verts = weldedWorldVertices(part);
  var index = w.index;
  var faceCount = index.length / 3;
  var into = view.into;

  // 面法線と表裏
  var nx = new Float64Array(faceCount), ny = new Float64Array(faceCount), nz = new Float64Array(faceCount);
  var front = new Uint8Array(faceCount);
  var i, f;
  for (f = 0; f < faceCount; f++) {
    var a = index[f * 3] * 3, b = index[f * 3 + 1] * 3, c = index[f * 3 + 2] * 3;
    var e1x = verts[b] - verts[a], e1y = verts[b + 1] - verts[a + 1], e1z = verts[b + 2] - verts[a + 2];
    var e2x = verts[c] - verts[a], e2y = verts[c + 1] - verts[a + 1], e2z = verts[c + 2] - verts[a + 2];
    var px = e1y * e2z - e1z * e2y, py = e1z * e2x - e1x * e2z, pz = e1x * e2y - e1y * e2x;
    var l = Math.sqrt(px * px + py * py + pz * pz);
    if (l < 1e-20) { nx[f] = 0; ny[f] = 0; nz[f] = 0; front[f] = 0; continue; }
    nx[f] = px / l; ny[f] = py / l; nz[f] = pz / l;
    front[f] = (nx[f] * into[0] + ny[f] * into[1] + nz[f] * into[2]) < 0 ? 1 : 0;
  }

  // エッジ -> 隣接面
  var edgeMap = new Map();
  for (f = 0; f < faceCount; f++) {
    var v0 = index[f * 3], v1 = index[f * 3 + 1], v2 = index[f * 3 + 2];
    if (v0 === v1 || v1 === v2 || v0 === v2) continue;
    var pairs = [[v0, v1], [v1, v2], [v2, v0]];
    for (var e = 0; e < 3; e++) {
      var lo = Math.min(pairs[e][0], pairs[e][1]), hi = Math.max(pairs[e][0], pairs[e][1]);
      var key = lo * 67108864 + hi;
      var rec = edgeMap.get(key);
      if (rec === undefined) edgeMap.set(key, { a: lo, b: hi, f0: f, f1: -1, n: 1 });
      else { rec.n++; if (rec.f1 < 0) rec.f1 = f; }
    }
  }

  var uA = view.uAxis, vA = view.vAxis, uS = view.uSign, vS = view.vSign;
  var sil = [], feat = [];
  var cosFeature = Math.cos(featureDeg * Math.PI / 180);
  edgeMap.forEach(function (rec) {
    var p0 = rec.a * 3, p1 = rec.b * 3;
    var seg = [
      verts[p0 + uA] * uS, verts[p0 + vA] * vS,
      verts[p1 + uA] * uS, verts[p1 + vA] * vS
    ];
    if (rec.n === 1) { sil.push(seg); return; }          // 境界エッジ (穴の縁)
    if (rec.n > 2) { sil.push(seg); return; }            // 非多様体は輪郭として扱う
    if (front[rec.f0] !== front[rec.f1]) { sil.push(seg); return; }
    if (!wantFeature) return;
    if (!front[rec.f0]) return;                          // 裏側の稜線は描かない
    var d = nx[rec.f0] * nx[rec.f1] + ny[rec.f0] * ny[rec.f1] + nz[rec.f0] * nz[rec.f1];
    if (d < cosFeature) feat.push(seg);
  });
  return { silhouette: sil, feature: feat };
}

function segmentsBounds(lists) {
  var minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (var k = 0; k < lists.length; k++) {
    var segs = lists[k];
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      if (s[0] < minU) minU = s[0]; if (s[0] > maxU) maxU = s[0];
      if (s[2] < minU) minU = s[2]; if (s[2] > maxU) maxU = s[2];
      if (s[1] < minV) minV = s[1]; if (s[1] > maxV) maxV = s[1];
      if (s[3] < minV) minV = s[3]; if (s[3] > maxV) maxV = s[3];
    }
  }
  if (!isFinite(minU)) return null;
  return { minU: minU, maxU: maxU, minV: minV, maxV: maxV, width: maxU - minU, height: maxV - minV };
}

// 正投影図を組み立てる。parts はワールド変換済みのパーツ配列
function buildViewDrawing(parts, viewKey, opts) {
  var view = DRAW_VIEWS[viewKey];
  var o = opts || {};
  var sil = [], feat = [];
  for (var i = 0; i < parts.length; i++) {
    var r = projectedEdges(parts[i], view, o);
    sil = sil.concat(r.silhouette);
    feat = feat.concat(r.feature);
  }
  var b = segmentsBounds([sil, feat]);
  if (!b) return null;
  return {
    kind: 'view',
    key: viewKey,
    title: view.name,
    titleJp: view.jp,
    uLabel: view.uLabel,
    vLabel: view.vLabel,
    silhouette: sil,
    feature: feat,
    bounds: b
  };
}

// 断面図 (指定軸・位置) を組み立てる
function buildSectionDrawing(parts, axis, value) {
  var Rm = sliceRotation(axis);
  var segs = [];
  for (var i = 0; i < parts.length; i++) {
    var m = M4.mul(M4.create(), Rm, parts[i].matrix);
    var loops = sliceAtZ(parts[i].positions, m, value);
    for (var l = 0; l < loops.length; l++) {
      var pts = loops[l].points;
      for (var k = 0; k + 1 < pts.length; k++) {
        segs.push([pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1]]);
      }
      if (loops[l].closed && pts.length > 2) {
        segs.push([pts[pts.length - 1][0], pts[pts.length - 1][1], pts[0][0], pts[0][1]]);
      }
    }
  }
  var b = segmentsBounds([segs]);
  if (!b) return null;
  var labels = [['Y', 'Z'], ['X', 'Z'], ['X', 'Y']][axis];
  return {
    kind: 'section',
    key: 'section',
    title: 'SECTION ' + ['X', 'Y', 'Z'][axis] + ' = ' + value.toFixed(2) + ' mm',
    titleJp: '断面 ' + ['X', 'Y', 'Z'][axis] + ' = ' + value.toFixed(2) + ' mm',
    uLabel: labels[0],
    vLabel: labels[1],
    silhouette: segs,
    feature: [],
    bounds: b
  };
}

// ---------------------------------------------------------------------------
// 用紙への割り付け
// ---------------------------------------------------------------------------

var PAGE_HEADER_MM = 9;   // 上部の表題領域
var PAGE_FOOTER_MM = 16;  // 下部の校正スケール領域

function paginateDrawing(drawing, opts) {
  var paperW = opts.landscape ? opts.paper.h : opts.paper.w;
  var paperH = opts.landscape ? opts.paper.w : opts.paper.h;
  var margin = opts.margin === undefined ? 10 : opts.margin;
  var overlap = opts.overlap === undefined ? 10 : opts.overlap;
  var scale = opts.scale || 1;
  var dimPad = opts.dimensions === false ? 3 : 24; // 寸法線と寸法値を描く余地

  var contentW = paperW - margin * 2;
  var contentH = paperH - margin * 2 - PAGE_HEADER_MM - PAGE_FOOTER_MM;
  if (contentW <= 20 || contentH <= 20) throw new Error('用紙に対して余白が大きすぎます');

  // 図面座標 (mm) での描画範囲。寸法線のぶん左下に余地を確保する
  var minU = drawing.bounds.minU - dimPad;
  var minV = drawing.bounds.minV - dimPad;
  var maxU = drawing.bounds.maxU + 2;
  var maxV = drawing.bounds.maxV + 2;
  var totalW = (maxU - minU) * scale;
  var totalH = (maxV - minV) * scale;

  var stepW = contentW - overlap;
  var stepH = contentH - overlap;
  var cols = totalW <= contentW ? 1 : Math.ceil((totalW - overlap) / stepW);
  var rows = totalH <= contentH ? 1 : Math.ceil((totalH - overlap) / stepH);

  // 1 ページに収まる方向は用紙内で中央に寄せる (複数ページ時は継ぎ目を合わせるため寄せない)
  var centerU = cols === 1 ? (contentW - totalW) / 2 / scale : 0;
  var centerV = rows === 1 ? (contentH - totalH) / 2 / scale : 0;
  var pages = [];
  for (var r = 0; r < rows; r++) {
    for (var c = 0; c < cols; c++) {
      pages.push({
        col: c + 1, row: r + 1, cols: cols, rows: rows,
        // このページの左下に対応する図面座標 (mm)
        originU: minU - centerU + (cols === 1 ? 0 : (c * stepW) / scale),
        originV: minV - centerV + (rows === 1 ? 0 : ((rows - 1 - r) * stepH) / scale)
      });
    }
  }
  return {
    pages: pages, cols: cols, rows: rows,
    paperW: paperW, paperH: paperH, margin: margin, overlap: overlap, scale: scale,
    contentW: contentW, contentH: contentH,
    totalW: totalW, totalH: totalH
  };
}

// ---------------------------------------------------------------------------
// PDF 出力
// ---------------------------------------------------------------------------

function renderDrawingsToPDF(drawings, opts) {
  var o = opts || {};
  var paper = o.paper || PAPER_SIZES[0];
  var layoutOpts = {
    paper: paper, landscape: !!o.landscape, margin: o.margin, overlap: o.overlap,
    scale: o.scale || 1, dimensions: o.dimensions !== false
  };
  var first = paginateDrawing(drawings[0], layoutOpts);
  var pdf = createPDF(first.paperW, first.paperH);
  var totalPages = 0;
  var layouts = [];
  for (var i = 0; i < drawings.length; i++) {
    var lay = paginateDrawing(drawings[i], layoutOpts);
    layouts.push(lay);
    totalPages += lay.pages.length;
  }
  var pageNo = 0;
  for (i = 0; i < drawings.length; i++) {
    var d = drawings[i], l = layouts[i];
    for (var p = 0; p < l.pages.length; p++) {
      pageNo++;
      drawPDFPage(pdf.addPage(), d, l, l.pages[p], o, pageNo, totalPages);
    }
  }
  return pdf.toBytes();
}

function drawPDFPage(page, drawing, layout, tile, o, pageNo, totalPages) {
  var margin = layout.margin;
  var scale = layout.scale;
  var x0 = margin, y0 = margin + PAGE_FOOTER_MM;
  var cw = layout.contentW, ch = layout.contentH;

  function toPageX(u) { return x0 + (u - tile.originU) * scale; }
  function toPageY(v) { return y0 + (v - tile.originV) * scale; }

  // --- 表題 ---
  var title = (o.title ? o.title + '  |  ' : '') + drawing.title;
  page.setFill(0, 0, 0);
  page.text(x0, layout.paperH - margin - 4, title, 10, 'left', true);
  var sub = 'scale ' + (scale === 1 ? '1:1 (actual size)' : scale.toFixed(3) + ' x') +
    '   unit: mm' +
    (layout.pages.length > 1 ? '   tile R' + tile.row + 'C' + tile.col + ' of R' + layout.rows + 'C' + layout.cols : '') +
    '   page ' + pageNo + '/' + totalPages;
  page.setFill(0.35, 0.35, 0.35);
  page.text(x0, layout.paperH - margin - 8.4, sub, 7.5, 'left');
  if (o.note) page.text(layout.paperW - margin, layout.paperH - margin - 8.4, o.note, 7.5, 'right');

  // --- 作図領域の枠 ---
  page.setStroke(0.75, 0.75, 0.75).setLineWidth(0.3).setDash(null);
  page.rect(x0, y0, cw, ch, false);

  page.ops.push('q');
  page.ops.push(pdfNum(x0 * MM_TO_PT) + ' ' + pdfNum(y0 * MM_TO_PT) + ' ' +
    pdfNum(cw * MM_TO_PT) + ' ' + pdfNum(ch * MM_TO_PT) + ' re W n');
  page._stroke = page._fill = page._width = null;

  // --- グリッド ---
  if (o.grid) {
    var step = o.gridStep || 10;
    page.setStroke(0.86, 0.86, 0.86).setLineWidth(0.2);
    var uStart = Math.ceil(tile.originU / step) * step;
    for (var u = uStart; toPageX(u) <= x0 + cw; u += step) {
      page.line(toPageX(u), y0, toPageX(u), y0 + ch);
    }
    var vStart = Math.ceil(tile.originV / step) * step;
    for (var v = vStart; toPageY(v) <= y0 + ch; v += step) {
      page.line(x0, toPageY(v), x0 + cw, toPageY(v));
    }
  }

  // --- 特徴エッジ (細線) ---
  var i, s;
  if (drawing.feature.length) {
    page.setStroke(0.45, 0.45, 0.45).setLineWidth(0.25).setDash(null);
    for (i = 0; i < drawing.feature.length; i++) {
      s = drawing.feature[i];
      page.line(toPageX(s[0]), toPageY(s[1]), toPageX(s[2]), toPageY(s[3]));
    }
  }
  // --- 輪郭線 (太線) ---
  page.setStroke(0, 0, 0).setLineWidth(o.lineWidth || 0.7);
  for (i = 0; i < drawing.silhouette.length; i++) {
    s = drawing.silhouette[i];
    page.line(toPageX(s[0]), toPageY(s[1]), toPageX(s[2]), toPageY(s[3]));
  }

  // --- 寸法線 ---
  if (o.dimensions !== false) drawPDFDimensions(page, drawing, toPageX, toPageY);

  page.ops.push('Q');
  page._stroke = page._fill = page._width = null;

  // --- タイル継ぎ目の目印 ---
  if (layout.pages.length > 1) {
    page.setStroke(0.55, 0.55, 0.55).setLineWidth(0.3).setDash([2, 2]);
    page.rect(x0, y0, cw, ch, false);
    page.setDash(null);
    // 位置合わせ用の十字
    var marks = [[x0, y0], [x0 + cw, y0], [x0, y0 + ch], [x0 + cw, y0 + ch]];
    page.setStroke(0.2, 0.2, 0.2).setLineWidth(0.3);
    for (i = 0; i < marks.length; i++) {
      page.line(marks[i][0] - 3, marks[i][1], marks[i][0] + 3, marks[i][1]);
      page.line(marks[i][0], marks[i][1] - 3, marks[i][0], marks[i][1] + 3);
    }
    page.setFill(0.3, 0.3, 0.3);
    page.text(x0 + cw / 2, y0 - 4.5, 'overlap ' + layout.overlap + ' mm - align crosses with the adjacent sheet', 7, 'center');
  }

  // --- 校正スケール (印刷倍率の確認用) ---
  drawCalibrationRuler(page, x0, margin + 4, Math.min(100, cw));
}

function drawPDFDimensions(page, drawing, toPageX, toPageY) {
  var b = drawing.bounds;
  var off = 7;
  page.setStroke(0.1, 0.35, 0.65).setLineWidth(0.3).setDash(null);
  page.setFill(0.1, 0.35, 0.65);
  // 水平 (下側)
  var yl = toPageY(b.minV) - off;
  page.line(toPageX(b.minU), yl, toPageX(b.maxU), yl);
  page.line(toPageX(b.minU), yl - 2, toPageX(b.minU), toPageY(b.minV) + 1);
  page.line(toPageX(b.maxU), yl - 2, toPageX(b.maxU), toPageY(b.minV) + 1);
  page.text((toPageX(b.minU) + toPageX(b.maxU)) / 2, yl + 1.5,
    drawing.uLabel + ' ' + b.width.toFixed(2), 8, 'center');
  // 垂直 (左側)
  var xl = toPageX(b.minU) - off;
  page.line(xl, toPageY(b.minV), xl, toPageY(b.maxV));
  page.line(xl - 2, toPageY(b.minV), toPageX(b.minU) + 1, toPageY(b.minV));
  page.line(xl - 2, toPageY(b.maxV), toPageX(b.minU) + 1, toPageY(b.maxV));
  page.text(xl - 1.5, (toPageY(b.minV) + toPageY(b.maxV)) / 2,
    drawing.vLabel + ' ' + b.height.toFixed(2), 8, 'right');
}

// 100 mm の基準スケール。印刷時の倍率ずれを利用者が検出できるようにする
function drawCalibrationRuler(page, x, y, lengthMm) {
  var len = Math.max(20, Math.min(100, lengthMm));
  page.setStroke(0, 0, 0).setLineWidth(0.4).setDash(null);
  page.line(x, y, x + len, y);
  for (var i = 0; i <= len; i += 10) {
    var h = (i % 50 === 0) ? 3 : 1.8;
    page.line(x + i, y, x + i, y + h);
  }
  page.setFill(0, 0, 0);
  page.text(x, y - 3.4, '0', 7, 'left');
  page.text(x + len, y - 3.4, len + ' mm', 7, 'center');
  page.setFill(0.35, 0.35, 0.35);
  page.text(x + len + 6, y - 0.5,
    'Print at 100% (no page scaling). Measure this bar: it must be exactly ' + len + ' mm.', 7, 'left');
}

// ---------------------------------------------------------------------------
// SVG 出力 (1 図面 = 1 ファイル、mm 指定なので実寸で印刷できる)
// ---------------------------------------------------------------------------

function renderDrawingToSVG(drawing, opts) {
  var o = opts || {};
  var pad = 16;
  var b = drawing.bounds;
  var w = b.width + pad * 2, h = b.height + pad * 2 + 12;
  function X(u) { return (u - b.minU + pad).toFixed(3); }
  function Y(v) { return (b.maxV - v + pad).toFixed(3); }
  var out = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + w.toFixed(3) + 'mm" height="' + h.toFixed(3) +
    'mm" viewBox="0 0 ' + w.toFixed(3) + ' ' + h.toFixed(3) + '">');
  out.push('<title>' + escapeXml((o.title ? o.title + ' - ' : '') + drawing.titleJp) + ' (1:1)</title>');
  out.push('<rect width="100%" height="100%" fill="#ffffff"/>');
  if (o.grid) {
    var step = o.gridStep || 10;
    out.push('<g stroke="#dddddd" stroke-width="0.15">');
    for (var u = Math.ceil(b.minU / step) * step; u <= b.maxU; u += step) {
      out.push('<line x1="' + X(u) + '" y1="' + Y(b.maxV) + '" x2="' + X(u) + '" y2="' + Y(b.minV) + '"/>');
    }
    for (var v = Math.ceil(b.minV / step) * step; v <= b.maxV; v += step) {
      out.push('<line x1="' + X(b.minU) + '" y1="' + Y(v) + '" x2="' + X(b.maxU) + '" y2="' + Y(v) + '"/>');
    }
    out.push('</g>');
  }
  var i, s;
  if (drawing.feature.length) {
    out.push('<g stroke="#888888" stroke-width="0.2" fill="none">');
    for (i = 0; i < drawing.feature.length; i++) {
      s = drawing.feature[i];
      out.push('<line x1="' + X(s[0]) + '" y1="' + Y(s[1]) + '" x2="' + X(s[2]) + '" y2="' + Y(s[3]) + '"/>');
    }
    out.push('</g>');
  }
  out.push('<g stroke="#000000" stroke-width="' + (o.lineWidth || 0.35) + '" fill="none" stroke-linecap="round">');
  for (i = 0; i < drawing.silhouette.length; i++) {
    s = drawing.silhouette[i];
    out.push('<line x1="' + X(s[0]) + '" y1="' + Y(s[1]) + '" x2="' + X(s[2]) + '" y2="' + Y(s[3]) + '"/>');
  }
  out.push('</g>');
  // 表題と校正スケール
  out.push('<g font-family="sans-serif" font-size="3.5" fill="#000000">');
  out.push('<text x="' + pad.toFixed(2) + '" y="' + (pad - 6).toFixed(2) + '">' +
    escapeXml(drawing.titleJp + '  1:1  ' + drawing.uLabel + ' ' + b.width.toFixed(2) +
      ' x ' + drawing.vLabel + ' ' + b.height.toFixed(2) + ' mm') + '</text>');
  var ry = h - 6;
  out.push('<line x1="' + pad + '" y1="' + ry + '" x2="' + (pad + 100) + '" y2="' + ry +
    '" stroke="#000" stroke-width="0.3"/>');
  for (i = 0; i <= 100; i += 10) {
    out.push('<line x1="' + (pad + i) + '" y1="' + ry + '" x2="' + (pad + i) + '" y2="' +
      (ry - (i % 50 === 0 ? 3 : 1.8)) + '" stroke="#000" stroke-width="0.3"/>');
  }
  out.push('<text x="' + (pad + 106) + '" y="' + (ry + 1) + '" font-size="3">100 mm reference - print at 100%</text>');
  out.push('</g>');
  out.push('</svg>');
  return out.join('\n');
}

function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c];
  });
}
