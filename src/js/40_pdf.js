// ---------------------------------------------------------------------------
// 最小構成の PDF ライタ (外部ライブラリ非依存)
// - 座標は mm 指定、内部で pt (1/72 inch) へ変換する
// - 原点はページ左下、Y 上向き (PDF の既定と同じ)
// - フォントは標準 14 フォントの Helvetica のみ。埋め込みを行わないため
//   文字列は ASCII に限定し、非 ASCII は '?' に置換する
// ---------------------------------------------------------------------------

var MM_TO_PT = 72 / 25.4;

function pdfNum(v) {
  // PDF の実数表記。指数表記は許されないため固定小数で出力する
  var s = (Math.round(v * 1000) / 1000).toFixed(3);
  return s.replace(/\.?0+$/, '') || '0';
}

function pdfEscapeText(s) {
  var out = '';
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    var ch = (c >= 32 && c <= 126) ? s[i] : '?';
    if (ch === '(' || ch === ')' || ch === '\\') out += '\\';
    out += ch;
  }
  return out;
}

function createPDF(pageWidthMm, pageHeightMm) {
  return {
    width: pageWidthMm,
    height: pageHeightMm,
    pages: [],
    addPage: function () {
      var ops = [];
      var page = {
        ops: ops,
        _stroke: null,
        _fill: null,
        _width: null,
        setStroke: function (r, g, b) {
          var key = r + ',' + g + ',' + b;
          if (this._stroke !== key) { ops.push(pdfNum(r) + ' ' + pdfNum(g) + ' ' + pdfNum(b) + ' RG'); this._stroke = key; }
          return this;
        },
        setFill: function (r, g, b) {
          var key = r + ',' + g + ',' + b;
          if (this._fill !== key) { ops.push(pdfNum(r) + ' ' + pdfNum(g) + ' ' + pdfNum(b) + ' rg'); this._fill = key; }
          return this;
        },
        setLineWidth: function (pt) {
          if (this._width !== pt) { ops.push(pdfNum(pt) + ' w'); this._width = pt; }
          return this;
        },
        setDash: function (arrPt, phase) {
          if (!arrPt || !arrPt.length) ops.push('[] 0 d');
          else ops.push('[' + arrPt.map(pdfNum).join(' ') + '] ' + pdfNum(phase || 0) + ' d');
          return this;
        },
        line: function (x1, y1, x2, y2) {
          ops.push(pdfNum(x1 * MM_TO_PT) + ' ' + pdfNum(y1 * MM_TO_PT) + ' m ' +
            pdfNum(x2 * MM_TO_PT) + ' ' + pdfNum(y2 * MM_TO_PT) + ' l S');
          return this;
        },
        // points: [[x,y], ...] (mm)
        polyline: function (points, close, fill) {
          if (!points.length) return this;
          var s = pdfNum(points[0][0] * MM_TO_PT) + ' ' + pdfNum(points[0][1] * MM_TO_PT) + ' m';
          for (var i = 1; i < points.length; i++) {
            s += ' ' + pdfNum(points[i][0] * MM_TO_PT) + ' ' + pdfNum(points[i][1] * MM_TO_PT) + ' l';
          }
          if (close) s += ' h';
          s += fill ? ' f' : ' S';
          ops.push(s);
          return this;
        },
        rect: function (x, y, w, h, fill) {
          ops.push(pdfNum(x * MM_TO_PT) + ' ' + pdfNum(y * MM_TO_PT) + ' ' +
            pdfNum(w * MM_TO_PT) + ' ' + pdfNum(h * MM_TO_PT) + ' re ' + (fill ? 'f' : 'S'));
          return this;
        },
        circle: function (cx, cy, r, fill) {
          // 4 本の 3 次ベジエで円を近似する
          var k = 0.5522847498 * r;
          var p = function (x, y) { return pdfNum(x * MM_TO_PT) + ' ' + pdfNum(y * MM_TO_PT); };
          ops.push(
            p(cx + r, cy) + ' m ' +
            p(cx + r, cy + k) + ' ' + p(cx + k, cy + r) + ' ' + p(cx, cy + r) + ' c ' +
            p(cx - k, cy + r) + ' ' + p(cx - r, cy + k) + ' ' + p(cx - r, cy) + ' c ' +
            p(cx - r, cy - k) + ' ' + p(cx - k, cy - r) + ' ' + p(cx, cy - r) + ' c ' +
            p(cx + k, cy - r) + ' ' + p(cx + r, cy - k) + ' ' + p(cx + r, cy) + ' c ' +
            (fill ? 'f' : 'S'));
          return this;
        },
        // align: 'left' | 'center' | 'right'
        text: function (x, y, str, sizePt, align, bold) {
          var t = pdfEscapeText(String(str));
          var size = sizePt || 8;
          var w = pdfTextWidthMm(t, size);
          var tx = x;
          if (align === 'center') tx = x - w / 2;
          else if (align === 'right') tx = x - w;
          ops.push('BT /' + (bold ? 'F2' : 'F1') + ' ' + pdfNum(size) + ' Tf ' +
            pdfNum(tx * MM_TO_PT) + ' ' + pdfNum(y * MM_TO_PT) + ' Td (' + t + ') Tj ET');
          return this;
        }
      };
      this.pages.push(page);
      return page;
    },
    toBytes: function () {
      return serializePDF(this);
    }
  };
}

// Helvetica の概算文字幅 (mm)。寸法テキストの中央寄せに用いる
function pdfTextWidthMm(str, sizePt) {
  var w = 0;
  for (var i = 0; i < str.length; i++) {
    var c = str[i];
    if (/[ilj.,:;'|!\[\]]/.test(c)) w += 0.30;
    else if (/[A-Z@%]/.test(c)) w += 0.68;
    else if (/[mwMW]/.test(c)) w += 0.85;
    else w += 0.53;
  }
  return w * sizePt / MM_TO_PT;
}

function serializePDF(doc) {
  var objects = [];   // 1-indexed で扱うため 0 番はダミー
  objects.push(null);
  function addObject(body) { objects.push(body); return objects.length - 1; }

  var catalogId = addObject(null);   // 1
  var pagesId = addObject(null);     // 2
  var fontId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  var fontBoldId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

  var kids = [];
  for (var i = 0; i < doc.pages.length; i++) {
    var content = doc.pages[i].ops.join('\n') + '\n';
    var contentId = addObject('<< /Length ' + content.length + ' >>\nstream\n' + content + 'endstream');
    var pageId = addObject(
      '<< /Type /Page /Parent ' + pagesId + ' 0 R' +
      ' /MediaBox [0 0 ' + pdfNum(doc.width * MM_TO_PT) + ' ' + pdfNum(doc.height * MM_TO_PT) + ']' +
      ' /Resources << /Font << /F1 ' + fontId + ' 0 R /F2 ' + fontBoldId + ' 0 R >> >>' +
      ' /Contents ' + contentId + ' 0 R >>');
    kids.push(pageId + ' 0 R');
  }
  objects[catalogId] = '<< /Type /Catalog /Pages ' + pagesId + ' 0 R >>';
  objects[pagesId] = '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + doc.pages.length + ' >>';

  var out = '%PDF-1.4\n';
  var offsets = [0];
  for (i = 1; i < objects.length; i++) {
    offsets[i] = out.length;
    out += i + ' 0 obj\n' + objects[i] + '\nendobj\n';
  }
  var xrefPos = out.length;
  out += 'xref\n0 ' + objects.length + '\n';
  out += '0000000000 65535 f \n';
  for (i = 1; i < objects.length; i++) {
    out += ('0000000000' + offsets[i]).slice(-10) + ' 00000 n \n';
  }
  out += 'trailer\n<< /Size ' + objects.length + ' /Root ' + catalogId + ' 0 R >>\n';
  out += 'startxref\n' + xrefPos + '\n%%EOF\n';

  // 内容は ASCII に限定しているため 1 文字 = 1 バイトで対応する
  var bytes = new Uint8Array(out.length);
  for (i = 0; i < out.length; i++) {
    var c = out.charCodeAt(i);
    bytes[i] = c > 255 ? 63 : c;
  }
  return bytes;
}

var PAPER_SIZES = [
  { name: 'A4', w: 210, h: 297 },
  { name: 'A3', w: 297, h: 420 },
  { name: 'A5', w: 148, h: 210 },
  { name: 'Letter', w: 215.9, h: 279.4 },
  { name: 'Legal', w: 215.9, h: 355.6 }
];
