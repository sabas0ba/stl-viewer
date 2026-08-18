// ---------------------------------------------------------------------------
// 汎用ユーティリティ
// ---------------------------------------------------------------------------

function $(sel, root) { return (root || document).querySelector(sel); }
function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

function el(tag, attrs, children) {
  var e = document.createElement(tag);
  if (attrs) {
    for (var k in attrs) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'text') e.textContent = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) e.setAttribute(k, attrs[k]);
    }
  }
  if (children) {
    for (var i = 0; i < children.length; i++) {
      var c = children[i];
      if (c === null || c === undefined) continue;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
  }
  return e;
}

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

function fmt(n, digits) {
  if (n === null || n === undefined || !isFinite(n)) return '-';
  var d = digits === undefined ? 2 : digits;
  return n.toFixed(d);
}

function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}

function fmtInt(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

function saveBlob(blob, filename) {
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
}

// 単純な色パレット (パーツ識別用)
var PALETTE = [
  [0.36, 0.62, 0.93], [0.95, 0.62, 0.29], [0.45, 0.80, 0.53],
  [0.87, 0.45, 0.62], [0.62, 0.53, 0.90], [0.90, 0.82, 0.38],
  [0.40, 0.80, 0.82], [0.85, 0.55, 0.42]
];

function rgbToCss(c) {
  return 'rgb(' + Math.round(c[0] * 255) + ',' + Math.round(c[1] * 255) + ',' + Math.round(c[2] * 255) + ')';
}

function cssToRgb(s) {
  var m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(s.trim());
  if (m) return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
  return [0.5, 0.5, 0.5];
}

function rgbToHex(c) {
  function h(x) { var v = Math.round(clamp(x, 0, 1) * 255).toString(16); return v.length < 2 ? '0' + v : v; }
  return '#' + h(c[0]) + h(c[1]) + h(c[2]);
}
