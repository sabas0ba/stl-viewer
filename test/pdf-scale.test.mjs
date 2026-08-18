// PDF が実寸 (1:1) で出力されているかを、実際にラスタ化して計測して検証する
// poppler-utils (pdftoppm) が必要。無い場合はスキップする。
// 実行: node test/pdf-scale.test.mjs
import { readFileSync, readdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const jsDir = join(root, 'src', 'js');

if (spawnSync('pdftoppm', ['-v']).error) {
  console.log('  skip pdftoppm (poppler-utils) が無いため実寸検証をスキップします');
  process.exit(0);
}

const files = readdirSync(jsDir).filter((f) => /^(00|10|20|30|40|42|70|85)_/.test(f)).sort();
const ctx = vm.createContext({ console, TextDecoder });
vm.runInContext(files.map((f) => readFileSync(join(jsDir, f), 'utf8')).join('\n'), ctx);
const G = ctx;

function boxPositions(x0, y0, z0, x1, y1, z1) {
  const v = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]
  ];
  const faces = [
    [0, 3, 2], [0, 2, 1], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4],
    [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]
  ];
  const out = [];
  for (const f of faces) for (const i of f) out.push(...v[i]);
  return new Float32Array(out);
}

// PGM (P5) を読み取る
function readPGM(path) {
  const buf = readFileSync(path);
  let pos = 0;
  function token() {
    while (buf[pos] === 0x20 || buf[pos] === 0x0a || buf[pos] === 0x0d || buf[pos] === 0x09) pos++;
    if (buf[pos] === 0x23) { while (buf[pos] !== 0x0a) pos++; return token(); }
    let start = pos;
    while (pos < buf.length && buf[pos] > 0x20) pos++;
    return buf.slice(start, pos).toString('ascii');
  }
  assert.equal(token(), 'P5');
  const w = parseInt(token(), 10);
  const h = parseInt(token(), 10);
  const maxv = parseInt(token(), 10);
  pos++; // 1 バイトの区切り
  assert.equal(maxv, 255);
  return { w, h, data: buf.slice(pos) };
}

// 指定した行範囲の暗い画素の外接矩形を求める
function darkBBox(img, rowFrom, rowTo, threshold = 100) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let y = rowFrom; y < rowTo; y++) {
    for (let x = 0; x < img.w; x++) {
      if (img.data[y * img.w + x] < threshold) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (!isFinite(minX)) return null;
  return { minX, maxX, minY, maxY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

const DPI = 300;
const PX_TO_MM = 25.4 / DPI;
const dir = mkdtempSync(join(tmpdir(), 'pdfscale-'));
const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok });
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : '  ' + detail}`);
}

// 100 x 60 mm の板を平面図 (X-Y) で出力する
const PLATE_X = 100, PLATE_Y = 60;
const part = {
  positions: boxPositions(0, 0, 0, PLATE_X, PLATE_Y, 5),
  localBounds: null,
  matrix: G.M4.identity(G.M4.create())
};
part.localBounds = G.computeBounds(part.positions);

const drawing = G.buildViewDrawing([part], 'top', {});
const LINE_PT = 0.7;
const bytes = G.renderDrawingsToPDF([drawing], {
  paper: { w: 210, h: 297 }, landscape: true, margin: 10,
  dimensions: false, grid: false, lineWidth: LINE_PT, title: 'scale-check'
});
const pdfPath = join(dir, 'scale.pdf');
writeFileSync(pdfPath, Buffer.from(bytes));
execFileSync('pdftoppm', ['-gray', '-r', String(DPI), '-f', '1', '-l', '1', pdfPath, join(dir, 'page')]);
const img = readPGM(join(dir, 'page-1.pgm'));

const pageWmm = 297, pageHmm = 210; // 横向き A4
check('ページ寸法が A4 横 (297 x 210 mm)',
  Math.abs(img.w * PX_TO_MM - pageWmm) < 0.5 && Math.abs(img.h * PX_TO_MM - pageHmm) < 0.5,
  `${(img.w * PX_TO_MM).toFixed(2)} x ${(img.h * PX_TO_MM).toFixed(2)} mm`);

// 図形領域 (上部の表題と下部のスケールを除く帯) で輪郭を計測する
const bodyFrom = Math.round(img.h * 0.15), bodyTo = Math.round(img.h * 0.82);
const outline = darkBBox(img, bodyFrom, bodyTo);
assert.ok(outline, '輪郭が検出できません');
const measuredX = outline.w * PX_TO_MM;
const measuredY = outline.h * PX_TO_MM;
// 線幅 (0.7pt) のぶん外側に広がる
const lineMm = LINE_PT * 25.4 / 72;
check('平面図の実寸 X = 100 mm',
  Math.abs(measuredX - (PLATE_X + lineMm)) < 0.25, `${measuredX.toFixed(3)} mm (期待 ${(PLATE_X + lineMm).toFixed(3)})`);
check('平面図の実寸 Y = 60 mm',
  Math.abs(measuredY - (PLATE_Y + lineMm)) < 0.25, `${measuredY.toFixed(3)} mm (期待 ${(PLATE_Y + lineMm).toFixed(3)})`);

// 下部の 100 mm 校正スケール
const rulerFrom = Math.round(img.h * 0.86);
const ruler = darkBBox(img, rulerFrom, img.h);
assert.ok(ruler, '校正スケールが検出できません');
// テキストを除くため、目盛線の左端から 100mm 分の範囲を見る
const rulerMm = ruler.w * PX_TO_MM;
check('校正スケールが 100 mm 以上の描画を含む', rulerMm > 100, `${rulerMm.toFixed(2)} mm`);

// 目盛の左端から右端 (0 と 100 の位置) を測る: 最下段の水平線を走査する
let baseY = -1;
for (let y = img.h - 1; y >= rulerFrom; y--) {
  let run = 0, best = 0;
  for (let x = 0; x < img.w; x++) {
    if (img.data[y * img.w + x] < 100) { run++; if (run > best) best = run; } else run = 0;
  }
  if (best * PX_TO_MM > 90) { baseY = y; break; }
}
assert.ok(baseY >= 0, '校正スケールの基準線が見つかりません');
// 同じ行に説明文が並ぶため、最長の連続区間を基準線とみなす
let run = 0, best = 0;
for (let x = 0; x < img.w; x++) {
  if (img.data[baseY * img.w + x] < 100) { run++; if (run > best) best = run; } else run = 0;
}
const rulerLen = best * PX_TO_MM;
check('校正スケールの長さが 100 mm',
  Math.abs(rulerLen - (100 + LINE_PT * 25.4 / 72 * 0.6)) < 0.25, `${rulerLen.toFixed(3)} mm`);

// 倍率 0.5 では図形が半分になる
const bytes2 = G.renderDrawingsToPDF([drawing], {
  paper: { w: 210, h: 297 }, landscape: true, margin: 10,
  dimensions: false, grid: false, lineWidth: LINE_PT, scale: 0.5
});
writeFileSync(join(dir, 'half.pdf'), Buffer.from(bytes2));
execFileSync('pdftoppm', ['-gray', '-r', String(DPI), '-f', '1', '-l', '1', join(dir, 'half.pdf'), join(dir, 'half')]);
const img2 = readPGM(join(dir, 'half-1.pgm'));
const outline2 = darkBBox(img2, bodyFrom, bodyTo);
const measured2 = outline2.w * PX_TO_MM;
check('倍率 1:2 では 50 mm になる', Math.abs(measured2 - (PLATE_X / 2 + lineMm)) < 0.25, `${measured2.toFixed(3)} mm`);

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
