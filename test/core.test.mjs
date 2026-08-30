// コア処理 (DOM 非依存) の単体テスト
// 実行: node test/core.test.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const jsDir = join(root, 'src', 'js');
const files = readdirSync(jsDir).filter((f) => /^(00|10|20|30|35|40|42|70|85)_/.test(f)).sort();
const src = files.map((f) => readFileSync(join(jsDir, f), 'utf8')).join('\n');

const ctx = vm.createContext({ console, TextDecoder, Map, Set });
vm.runInContext(src, ctx);
const G = ctx;

let passed = 0;
const cases = [];
function test(name, fn) { cases.push([name, fn]); }

// --- 立方体 (10mm) の三角形メッシュを作る ---
function cubePositions(size = 10, ox = 0, oy = 0, oz = 0) {
  const s = size;
  const v = [
    [ox, oy, oz], [ox + s, oy, oz], [ox + s, oy + s, oz], [ox, oy + s, oz],
    [ox, oy, oz + s], [ox + s, oy, oz + s], [ox + s, oy + s, oz + s], [ox, oy + s, oz + s]
  ];
  // 外向き法線になる頂点順序
  const faces = [
    [0, 3, 2], [0, 2, 1], // 底面 (-Z)
    [4, 5, 6], [4, 6, 7], // 上面 (+Z)
    [0, 1, 5], [0, 5, 4], // -Y
    [1, 2, 6], [1, 6, 5], // +X
    [2, 3, 7], [2, 7, 6], // +Y
    [3, 0, 4], [3, 4, 7]  // -X
  ];
  const out = [];
  for (const f of faces) for (const idx of f) out.push(...v[idx]);
  return new Float32Array(out);
}

const I = () => G.M4.identity(G.M4.create());

test('M4: 逆行列との積が単位行列になる', () => {
  const m = G.M4.compose(G.M4.create(), [3, -2, 5], G.Quat.fromAxisAngle([0.3, 1, 0.2], 0.7), [2, 2, 2]);
  const inv = G.M4.invert(G.M4.create(), m);
  const p = G.M4.mul(G.M4.create(), m, inv);
  for (let i = 0; i < 16; i++) assert.ok(Math.abs(p[i] - I()[i]) < 1e-5, `element ${i}`);
});

test('Quat: オイラー角の往復変換が一致する', () => {
  const e = [23, -47, 116];
  const q = G.Quat.fromEulerDeg(e);
  const e2 = G.Quat.toEulerDeg(q);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(e[i] - e2[i]) < 1e-3, `axis ${i}: ${e2[i]}`);
});

test('Quat: fromUnitVectors が始点を終点に写す', () => {
  const from = G.V3.norm([0, 0, 0], [0.3, -0.8, 0.5]);
  const to = [0, 0, -1];
  const r = G.Quat.rotate(G.Quat.fromUnitVectors(from, to), from);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(r[i] - to[i]) < 1e-6);
});

test('質量特性: 10mm 立方体で体積 1000 / 表面積 600', () => {
  const pos = cubePositions(10);
  const m = G.computeMassProperties(pos);
  assert.ok(Math.abs(m.volume - 1000) < 1e-3, `volume=${m.volume}`);
  assert.ok(Math.abs(m.area - 600) < 1e-3, `area=${m.area}`);
  assert.ok(Math.abs(m.centroid[0] - 5) < 1e-4);
  assert.ok(Math.abs(m.centroid[2] - 5) < 1e-4);
  assert.equal(m.triangleCount, 12);
});

test('質量特性: 内向きメッシュは体積が負になる', () => {
  const pos = G.flipWinding(cubePositions(10));
  assert.ok(G.computeMassProperties(pos).volume < 0);
});

test('頂点統合とトポロジ: 立方体は水密・1 シェル・8 頂点', () => {
  const pos = cubePositions(10);
  const w = G.weldVertices(pos, 1e-5);
  assert.equal(w.vertexCount, 8);
  const t = G.analyzeTopology(w.index, w.vertexCount);
  assert.equal(t.boundaryEdges, 0);
  assert.equal(t.nonManifoldEdges, 0);
  assert.equal(t.inconsistentEdges, 0);
  assert.equal(t.shells, 1);
  assert.equal(t.edgeCount, 18);
  assert.equal(t.watertight, true);
});

test('独立成分: 2 つの離れた立方体を別成分として検出する', () => {
  const a = cubePositions(10, 0, 0, 0);
  const b = cubePositions(4, 20, 0, 6);
  const pos = new Float32Array(a.length + b.length);
  pos.set(a); pos.set(b, a.length);
  const w = G.weldVertices(pos, 1e-5);
  const components = G.analyzeComponents(pos, w);
  assert.equal(components.length, 2);
  assert.equal(components[0].triangleCount, 12);
  assert.equal(components[1].triangleCount, 12);
  assert.ok(Math.abs(components[0].localBounds.size[0] - 10) < 1e-5);
  assert.ok(Math.abs(components[1].localBounds.size[2] - 4) < 1e-5);
  assert.equal(components[1].triangleIndices.length, 12);
});

test('トポロジ: 三角形を 1 枚削ると境界エッジを検出する', () => {
  const full = cubePositions(10);
  const pos = full.slice(0, full.length - 9);
  const w = G.weldVertices(pos, 1e-5);
  const t = G.analyzeTopology(w.index, w.vertexCount);
  assert.equal(t.boundaryEdges, 3);
  assert.equal(t.watertight, false);
});

test('STL: binary の書き出しと読み込みが往復する', () => {
  const pos = cubePositions(10);
  const buf = G.buildBinarySTL([{ positions: pos, matrix: I() }], 'test');
  assert.equal(G.detectSTLFormat(buf), 'binary');
  const r = G.parseSTL(buf);
  assert.equal(r.triangleCount, 12);
  assert.ok(Math.abs(G.computeMassProperties(r.positions).volume - 1000) < 1e-2);
});

test('STL: 鏡映変換でも表裏が保たれる', () => {
  const pos = cubePositions(10);
  const m = I();
  m[0] = -1; // X 反転
  const buf = G.buildBinarySTL([{ positions: pos, matrix: m }], 'mirror');
  const r = G.parseSTL(buf);
  assert.ok(G.computeMassProperties(r.positions).volume > 0);
});

test('STL: ASCII を解釈できる', () => {
  const pos = cubePositions(10);
  let ascii = 'solid cube\n';
  for (let i = 0; i < pos.length; i += 9) {
    ascii += ' facet normal 0 0 0\n  outer loop\n';
    for (let k = 0; k < 3; k++) {
      ascii += `   vertex ${pos[i + k * 3]} ${pos[i + k * 3 + 1]} ${pos[i + k * 3 + 2]}\n`;
    }
    ascii += '  endloop\n endfacet\n';
  }
  ascii += 'endsolid cube\n';
  const buf = new TextEncoder().encode(ascii).buffer;
  assert.equal(G.detectSTLFormat(buf), 'ascii');
  const r = G.parseSTL(buf);
  assert.equal(r.triangleCount, 12);
  assert.ok(Math.abs(G.computeMassProperties(r.positions).volume - 1000) < 1e-2);
});

test('BVH: 上方からのレイが上面に当たる', () => {
  const pos = cubePositions(10);
  const bvh = G.buildBVH(pos, 4);
  const hit = G.raycastBVH(bvh, pos, [5, 5, 40], [0, 0, -1]);
  assert.ok(hit, 'ヒットしない');
  assert.ok(Math.abs(hit.point[2] - 10) < 1e-4, `z=${hit.point[2]}`);
  assert.ok(Math.abs(hit.normal[2] - 1) < 1e-4);
  assert.equal(G.raycastBVH(bvh, pos, [50, 50, 40], [0, 0, -1]), null);
});

test('BVH: 三角形数が多くても再帰が破綻しない', () => {
  const n = 4000;
  const arr = new Float32Array(n * 9);
  for (let i = 0; i < n; i++) {
    // ほぼ同一位置に集中させて分割の縮退を誘発する
    const x = (i % 7) * 1e-4;
    arr.set([x, 0, 0, x + 0.001, 0, 0, x, 0.001, 0], i * 9);
  }
  const bvh = G.buildBVH(arr, 8);
  assert.ok(bvh.nodeCount > 0 && bvh.nodeCount <= n * 2);
});

test('断面: 立方体の中央断面は 100mm2 / 周長 40mm', () => {
  const pos = cubePositions(10);
  const loops = G.sliceAtZ(pos, I(), 5);
  assert.equal(loops.length, 1);
  assert.equal(loops[0].closed, true);
  assert.ok(Math.abs(Math.abs(G.polygonArea(loops[0].points)) - 100) < 1e-3);
  assert.ok(Math.abs(G.polylineLength(loops[0].points, true) - 40) < 1e-3);
});

test('断面: 範囲外の平面では輪郭が生じない', () => {
  assert.equal(G.sliceAtZ(cubePositions(10), I(), 20).length, 0);
});

test('断面: 切断面と面が同一平面でも輪郭が二重化しない', () => {
  // z=5 に頂点列を持つ 2 段積みの箱
  const lower = cubePositions(10);
  const upper = cubePositions(10);
  const stacked = new Float32Array(lower.length + upper.length);
  stacked.set(lower, 0);
  // 下段を z:0-5、上段を z:5-10 に潰して段差を作る
  for (let i = 2; i < lower.length; i += 3) stacked[i] = lower[i] / 2;
  for (let i = 0; i < upper.length; i++) {
    stacked[lower.length + i] = (i % 3 === 2) ? upper[i] / 2 + 5 : upper[i];
  }
  const loops = G.sliceAtZ(stacked, I(), 5);
  assert.equal(loops.length, 1, `loops=${loops.length}`);
  assert.ok(Math.abs(Math.abs(G.polygonArea(loops[0].points)) - 100) < 1e-3);
});

test('断面: 平面上の頂点は上側として扱う (最下面では輪郭なし)', () => {
  // 平面上の頂点を上側に寄せる規約のため、z=最下面では断面が生じず
  // z=最上面では上端の輪郭が得られる
  assert.equal(G.sliceAtZ(cubePositions(10), I(), 0).length, 0);
  const top = G.sliceAtZ(cubePositions(10), I(), 10);
  assert.equal(top.length, 1);
  assert.ok(Math.abs(Math.abs(G.polygonArea(top[0].points)) - 100) < 1e-3);
});

test('オーバーハング: ベッド上の立方体は接地 100mm2 / サポート不要', () => {
  const pos = cubePositions(10);
  const s = G.overhangStats(pos, I(), 45, 0, 0.05);
  assert.ok(Math.abs(s.contactArea - 100) < 1e-3, `contact=${s.contactArea}`);
  assert.ok(s.overhangArea < 1e-6, `over=${s.overhangArea}`);
  assert.ok(Math.abs(s.totalArea - 600) < 1e-3);
});

test('オーバーハング: 持ち上げた立方体の下面は要サポートになる', () => {
  const pos = cubePositions(10);
  const m = I();
  m[14] = 20; // Z 方向に浮かせる
  const s = G.overhangStats(pos, m, 45, 0, 0.05);
  assert.ok(Math.abs(s.overhangArea - 100) < 1e-3, `over=${s.overhangArea}`);
  assert.equal(s.contactArea, 0);
});

test('オーバーハング: 45 度傾けた面はしきい値で切り替わる', () => {
  const pos = cubePositions(10);
  const q = G.Quat.fromAxisAngle([1, 0, 0], 44 * Math.PI / 180);
  const m = G.M4.compose(G.M4.create(), [0, 0, 100], q, [1, 1, 1]);
  const s40 = G.overhangStats(pos, m, 40, 0, 0.05);
  const s50 = G.overhangStats(pos, m, 50, 0, 0.05);
  assert.ok(s40.overhangArea > s50.overhangArea);
});

test('サンプリングした集計値が全数と近い', () => {
  const pos = cubePositions(10);
  const full = G.overhangStats(pos, I(), 45, 0, 0.05, 1);
  const samp = G.overhangStats(pos, I(), 45, 0, 0.05, 2);
  assert.ok(Math.abs(full.totalArea - samp.totalArea) / full.totalArea < 0.2);
});

test('三角形交差判定', () => {
  const a0 = [0, 0, 0], a1 = [10, 0, 0], a2 = [0, 10, 0];
  assert.equal(G.triTriIntersect(a0, a1, a2, [1, 1, -5], [1, 1, 5], [3, 2, 5]), true);
  assert.equal(G.triTriIntersect(a0, a1, a2, [1, 1, 5], [2, 2, 6], [3, 2, 7]), false);
});

test('AABB 重なり判定', () => {
  const a = { min: [0, 0, 0], max: [10, 10, 10] };
  const b = { min: [9, 9, 9], max: [20, 20, 20] };
  const c = { min: [11, 0, 0], max: [20, 10, 10] };
  assert.equal(G.aabbOverlap(a, b), true);
  assert.equal(G.aabbOverlap(a, c), false);
});

test('姿勢評価: 直方体は低い姿勢の方がサポートが少ない', () => {
  const pos = cubePositions(10);
  const part = { positions: pos, scale: [1, 1, 1], quat: [0, 0, 0, 1] };
  const flat = G.evaluateOrientation(part, [0, 0, 0, 1], 45);
  assert.ok(Math.abs(flat.height - 10) < 1e-4);
  assert.ok(flat.overhangArea < 1e-6);
  const tilt = G.evaluateOrientation(part, G.Quat.fromAxisAngle([1, 0, 0], Math.PI / 4), 45);
  assert.ok(tilt.height > flat.height);
});

test('候補法線: 立方体では 6 方向が得られる', () => {
  const c = G.candidateNormals(cubePositions(10), 24);
  assert.equal(c.length, 6);
  assert.ok(Math.abs(c[0].area - 100) < 1e-3);
});

// --- 図面 / PDF ---

function makePart(positions) {
  return { positions: positions, localBounds: G.computeBounds(positions), matrix: I() };
}

// PDF の相互参照表を検証する (各オフセットが "N 0 obj" を指しているか)
function verifyPdfXref(bytes) {
  const text = Buffer.from(bytes).toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4'), 'ヘッダが不正');
  assert.ok(text.endsWith('%%EOF\n'), '終端が不正');
  const m = /startxref\s+(\d+)/.exec(text);
  assert.ok(m, 'startxref がない');
  const xrefPos = parseInt(m[1], 10);
  assert.equal(text.slice(xrefPos, xrefPos + 4), 'xref', 'startxref の位置が不正');
  const header = /xref\n0 (\d+)\n/.exec(text.slice(xrefPos));
  assert.ok(header, 'xref ヘッダが不正');
  const count = parseInt(header[1], 10);
  const entryStart = xrefPos + header[0].length;
  for (let i = 1; i < count; i++) {
    const entry = text.substr(entryStart + i * 20, 20);
    const off = parseInt(entry.slice(0, 10), 10);
    assert.equal(text.slice(off, off + String(i).length + 6), i + ' 0 obj', `オブジェクト ${i} のオフセットが不正`);
  }
  return { text: text, objectCount: count };
}

test('図面: 立方体の正面シルエットは 4 本の輪郭線', () => {
  const part = makePart(cubePositions(10));
  const d = G.buildViewDrawing([part], 'front', { feature: false });
  assert.equal(d.silhouette.length, 4, `segs=${d.silhouette.length}`);
  assert.ok(Math.abs(d.bounds.width - 10) < 1e-6 && Math.abs(d.bounds.height - 10) < 1e-6);
  assert.equal(d.uLabel, 'X');
  assert.equal(d.vLabel, 'Z');
});

test('図面: 各投影で対応する 2 軸の実寸が得られる', () => {
  const pos = cubePositions(10);
  // Y 方向に 2 倍した直方体 (10 x 20 x 10)
  const scaled = Float32Array.from(pos);
  for (let i = 1; i < scaled.length; i += 3) scaled[i] *= 2;
  const part = makePart(scaled);
  const front = G.buildViewDrawing([part], 'front', {});
  const top = G.buildViewDrawing([part], 'top', {});
  const right = G.buildViewDrawing([part], 'right', {});
  assert.ok(Math.abs(front.bounds.width - 10) < 1e-6 && Math.abs(front.bounds.height - 10) < 1e-6);
  assert.ok(Math.abs(top.bounds.width - 10) < 1e-6 && Math.abs(top.bounds.height - 20) < 1e-6);
  assert.ok(Math.abs(right.bounds.width - 20) < 1e-6 && Math.abs(right.bounds.height - 10) < 1e-6);
});

test('図面: 回転させたパーツの輪郭も実寸を保つ', () => {
  const part = makePart(cubePositions(10));
  part.matrix = G.M4.compose(G.M4.create(), [0, 0, 0], G.Quat.fromAxisAngle([0, 0, 1], Math.PI / 4), [1, 1, 1]);
  const top = G.buildViewDrawing([part], 'top', {});
  // 45 度回転した正方形の外接幅は 10 * sqrt(2)
  assert.ok(Math.abs(top.bounds.width - 10 * Math.SQRT2) < 1e-4, String(top.bounds.width));
});

test('図面: 特徴エッジは指定時のみ出力される', () => {
  const pos = cubePositions(10);
  const part = makePart(pos);
  const off = G.buildViewDrawing([part], 'front', { feature: false });
  const on = G.buildViewDrawing([part], 'front', { feature: true });
  assert.equal(off.feature.length, 0);
  // 立方体を正面から見ると手前の面は平坦なので稜線は増えない
  assert.equal(on.feature.length, 0);
  const stepped = new Float32Array([...pos, ...cubePositions(6, 0, 0, 10)]);
  const on2 = G.buildViewDrawing([makePart(stepped)], 'front', { feature: true });
  assert.ok(on2.silhouette.length > 4, `segs=${on2.silhouette.length}`);
});

test('図面: 断面図を生成できる', () => {
  const d = G.buildSectionDrawing([makePart(cubePositions(10))], 2, 5);
  assert.ok(d.silhouette.length >= 4);
  assert.ok(Math.abs(d.bounds.width - 10) < 1e-6 && Math.abs(d.bounds.height - 10) < 1e-6);
  assert.match(d.title, /SECTION Z = 5\.00/);
});

test('割り付け: 小さい図は 1 ページに中央配置される', () => {
  const d = G.buildViewDrawing([makePart(cubePositions(10))], 'front', {});
  const lay = G.paginateDrawing(d, { paper: { w: 210, h: 297 }, margin: 10, overlap: 10, scale: 1 });
  assert.equal(lay.pages.length, 1);
  const p = lay.pages[0];
  // 図の中心が作図領域の中心に一致する
  const cx = (d.bounds.minU + d.bounds.maxU) / 2 - p.originU;
  const cy = (d.bounds.minV + d.bounds.maxV) / 2 - p.originV;
  assert.ok(Math.abs(cx - lay.contentW / 2) < 12, `cx=${cx} / ${lay.contentW / 2}`);
  assert.ok(Math.abs(cy - lay.contentH / 2) < 12, `cy=${cy} / ${lay.contentH / 2}`);
});

test('割り付け: 用紙を超える図は重ね代付きで分割される', () => {
  const big = new Float32Array(cubePositions(400));
  const d = G.buildViewDrawing([makePart(big)], 'front', {});
  const opts = { paper: { w: 210, h: 297 }, margin: 10, overlap: 10, scale: 1 };
  const lay = G.paginateDrawing(d, opts);
  assert.ok(lay.cols >= 3 && lay.rows >= 2, `${lay.cols}x${lay.rows}`);
  assert.equal(lay.pages.length, lay.cols * lay.rows);
  // 隣接タイルの原点差 = 作図領域幅 - 重ね代
  const step = lay.pages[1].originU - lay.pages[0].originU;
  assert.ok(Math.abs(step - (lay.contentW - opts.overlap)) < 1e-6, String(step));
  // 全タイルで図面全体を覆う
  const last = lay.pages[lay.pages.length - 1];
  assert.ok(last.originU + lay.contentW >= d.bounds.maxU, '右端が覆われていない');
});

test('割り付け: 倍率を変えるとページ数が変わる', () => {
  const d = G.buildViewDrawing([makePart(cubePositions(400))], 'front', {});
  const base = { paper: { w: 210, h: 297 }, margin: 10, overlap: 10 };
  const p1 = G.paginateDrawing(d, Object.assign({ scale: 1 }, base));
  const p2 = G.paginateDrawing(d, Object.assign({ scale: 0.25 }, base));
  assert.ok(p2.pages.length < p1.pages.length);
  assert.equal(p2.pages.length, 1);
});

test('PDF: 構造 (xref / ページ数 / 用紙サイズ) が正しい', () => {
  const d1 = G.buildViewDrawing([makePart(cubePositions(10))], 'front', {});
  const d2 = G.buildViewDrawing([makePart(cubePositions(10))], 'top', {});
  const bytes = G.renderDrawingsToPDF([d1, d2], { paper: { w: 210, h: 297 }, title: 'cube' });
  const { text } = verifyPdfXref(bytes);
  assert.match(text, /\/Type \/Catalog/);
  assert.equal((text.match(/\/Type \/Page[^s]/g) || []).length, 2);
  assert.match(text, /\/Count 2/);
  // A4 縦 = 595.276 x 841.89 pt
  assert.match(text, /MediaBox \[0 0 595\.276 841\.89\]/);
  assert.match(text, /\(cube {2}\| {2}FRONT \\\(XZ\\\)\)/);
});

test('PDF: 図形が実寸 (pt) で配置される', () => {
  const d = G.buildViewDrawing([makePart(cubePositions(10))], 'front', {});
  const bytes = G.renderDrawingsToPDF([d], { paper: { w: 210, h: 297 }, dimensions: false });
  const text = Buffer.from(bytes).toString('latin1');
  const coords = [];
  const re = /(-?[\d.]+) (-?[\d.]+) m (-?[\d.]+) (-?[\d.]+) l S/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    coords.push([parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]), parseFloat(m[4])]);
  }
  assert.ok(coords.length >= 4, `lines=${coords.length}`);
  // 輪郭 4 本のうち水平線の長さは 10mm = 28.346pt
  const lens = coords.map((c) => Math.hypot(c[2] - c[0], c[3] - c[1]));
  const target = 10 * 72 / 25.4;
  const matched = lens.filter((l) => Math.abs(l - target) < 0.05);
  assert.ok(matched.length >= 4, `10mm の線が ${matched.length} 本しかない: ${lens.slice(0, 8)}`);
});

test('PDF: 非 ASCII 文字は置換され構造を壊さない', () => {
  const d = G.buildViewDrawing([makePart(cubePositions(10))], 'front', {});
  const bytes = G.renderDrawingsToPDF([d], { paper: { w: 210, h: 297 }, title: '部品(A)\\test' });
  const { text } = verifyPdfXref(bytes);
  // 非 ASCII は '?' に置換され、() と \\ はエスケープされる
  assert.match(text, /\(\?\?\\\(A\\\)\\\\test/);
});

test('SVG: mm 指定で実寸出力される', () => {
  const d = G.buildViewDrawing([makePart(cubePositions(10))], 'front', {});
  const svg = G.renderDrawingToSVG(d, {});
  const m = /width="([\d.]+)mm" height="([\d.]+)mm"/.exec(svg);
  assert.ok(m, 'mm 指定がない');
  assert.ok(Math.abs(parseFloat(m[1]) - (10 + 32)) < 1e-3, m[1]);
  assert.match(svg, /viewBox="0 0 42\.000/);
  assert.equal((svg.match(/<line /g) || []).length >= 4, true);
});

test('ステージ: 円形の範囲判定', () => {
  const bed = [200, 200, 250];
  const inside = { min: [80, 80, 0], max: [120, 120, 10] };
  const outside = { min: [0, 0, 0], max: [30, 30, 10] };   // 角は円の外
  assert.equal(G.outsideBedXY(inside, bed, 'circle'), false);
  assert.equal(G.outsideBedXY(outside, bed, 'circle'), true);
  assert.equal(G.outsideBedXY(outside, bed, 'rect'), false);
  assert.equal(G.outsideBedXY({ min: [-1, 0, 0], max: [10, 10, 10] }, bed, 'rect'), true);
});

// --- 中抜き (ホロー化) ---

function topologyOf(positions) {
  const w = G.weldVertices(positions, 1e-4);
  return G.analyzeTopology(w.index, w.vertexCount);
}

test('中抜き: 20mm 立方体を壁厚 2mm で抜くと理論体積に一致する', () => {
  const r = G.hollowMesh(cubePositions(20), null, { wall: 2, top: 2, bottom: 2, voxel: 0.4 });
  // 外 20^3 = 8000、空洞 16^3 = 4096 -> 残り 3904 mm^3
  assert.ok(Math.abs(r.volume.hollow - 3904) < 3904 * 0.02, `volume=${r.volume.hollow}`);
  assert.ok(Math.abs(r.volume.solid - 8000) < 1, `solid=${r.volume.solid}`);
  const t = topologyOf(r.positions);
  assert.ok(t.watertight, JSON.stringify(t));
  assert.equal(t.shells, 2); // 外殻と空洞の 2 シェル
});

test('中抜き: 天面厚と底面厚を造形方向に沿って個別に確保する', () => {
  const r = G.hollowMesh(cubePositions(20), null, { wall: 1, top: 3, bottom: 2, voxel: 0.4 });
  // 空洞は X/Y が 18、Z が 20-3-2 = 15 -> 8000 - 4860 = 3140 mm^3
  assert.ok(Math.abs(r.volume.hollow - 3140) < 3140 * 0.02, `volume=${r.volume.hollow}`);
});

test('中抜き: 内向きメッシュでも同じ結果になる', () => {
  const a = G.hollowMesh(cubePositions(20), null, { wall: 2, voxel: 0.4 });
  const b = G.hollowMesh(G.flipWinding(cubePositions(20)), null, { wall: 2, voxel: 0.4 });
  assert.ok(Math.abs(a.volume.hollow - b.volume.hollow) < 1e-3, `${a.volume.hollow} != ${b.volume.hollow}`);
  assert.ok(b.volume.hollow > 0);
});

test('中抜き: 変換行列 (回転・移動) を適用した姿勢で計算する', () => {
  const m = G.M4.compose(G.M4.create(), [30, 10, 0], G.Quat.fromAxisAngle([0, 0, 1], 0.3), [1, 1, 1]);
  const r = G.hollowMesh(cubePositions(20), m, { wall: 2, voxel: 0.4 });
  assert.ok(Math.abs(r.volume.hollow - 3904) < 3904 * 0.03, `volume=${r.volume.hollow}`);
  const b = G.computeBounds(r.positions);
  assert.ok(b.min[0] > 20, `x=${b.min[0]}`); // 出力はワールド座標
});

test('中抜き: 断面二次モーメント比が角筒の解析値と一致する', () => {
  const r = G.hollowMesh(cubePositions(20), null, { wall: 2, top: 2, bottom: 2, voxel: 0.4 });
  // 側壁だけの層は 20 角筒 - 16 角筒: (20^4 - 16^4) / 20^4 = 0.5904
  assert.ok(Math.abs(r.sections.minInertiaRatio - 0.5904) < 0.02, `I=${r.sections.minInertiaRatio}`);
  // 同じ層の断面積比は (400 - 256) / 400 = 0.36
  assert.ok(Math.abs(r.sections.minAreaRatio - 0.36) < 0.02, `A=${r.sections.minAreaRatio}`);
});

test('中抜き: 内部構造を入れると体積と剛性が上がる', () => {
  const empty = G.hollowMesh(cubePositions(20), null, { wall: 2, voxel: 0.4 });
  const grid = G.hollowMesh(cubePositions(20), null, { wall: 2, voxel: 0.4, infill: 'grid', density: 0.3, rib: 1.2 });
  assert.ok(grid.volume.hollow > empty.volume.hollow, `${grid.volume.hollow} <= ${empty.volume.hollow}`);
  assert.ok(grid.sections.minInertiaRatio > empty.sections.minInertiaRatio);
  assert.ok(grid.volume.hollow < 8000);
});

test('中抜き: 内部構造の周期が指定した充填率を再現する', () => {
  const period = G.infillPeriod('grid', 1, 0.2);
  const u = 1 / period;                 // リブ厚 1mm に対する比
  assert.ok(Math.abs((2 * u - u * u) - 0.2) < 1e-6, `period=${period}`);
  assert.ok(G.infillPeriod('grid', 1, 0.4) < period); // 充填率を上げると間隔は詰まる
});

test('中抜き: 全体再構築なら抜き穴が外へ貫通する', () => {
  const r = G.hollowMesh(cubePositions(20), null, {
    wall: 2, voxel: 0.4, mode: 'rebuild', hole: 'bottom', holeDiameter: 5, holeCount: 1
  });
  assert.equal(r.holes.length, 1);
  const t = topologyOf(r.positions);
  assert.ok(t.watertight, JSON.stringify(t));
  assert.equal(t.shells, 1); // 空洞が穴で外とつながり 1 シェルになる
  assert.ok(r.volume.hollow < 3904, `volume=${r.volume.hollow}`);
});

test('中抜き: 外殻保持では抜き穴を作らず警告を出す', () => {
  const r = G.hollowMesh(cubePositions(20), null, { wall: 2, voxel: 0.4, hole: 'bottom' });
  assert.equal(r.holes.length, 0);
  assert.ok(r.warnings.some((w) => /抜き穴は/.test(w)), r.warnings.join(' / '));
});

test('中抜き: 壁が厚すぎて空洞ができない場合は警告する', () => {
  const r = G.hollowMesh(cubePositions(20), null, { wall: 11, voxel: 0.4 });
  assert.ok(Math.abs(r.volume.hollow - 8000) < 1, `volume=${r.volume.hollow}`);
  assert.ok(r.warnings.some((w) => /空洞ができていません/.test(w)), r.warnings.join(' / '));
});

test('中抜き: 薄い壁と粗い格子を警告する', () => {
  const r = G.hollowMesh(cubePositions(20), null, { wall: 0.6, top: 0.6, bottom: 0.6, voxel: 0.5, lineWidth: 0.4 });
  assert.ok(r.warnings.some((w) => /押出幅/.test(w)), r.warnings.join(' / '));
  assert.ok(r.warnings.some((w) => /格子間隔/.test(w)), r.warnings.join(' / '));
});

test('surface nets: 球の等値面が外向きかつ体積が理論値に近い', () => {
  const R = 8, h = 0.25;
  const nx = Math.ceil(2.4 * R / h), n = nx * nx * nx;
  const field = new Float32Array(n);
  const o = -1.2 * R;
  for (let k = 0; k < nx; k++) {
    for (let j = 0; j < nx; j++) {
      for (let i = 0; i < nx; i++) {
        const x = o + i * h, y = o + j * h, z = o + k * h;
        field[i + j * nx + k * nx * nx] = R - Math.sqrt(x * x + y * y + z * z);
      }
    }
  }
  const g = { nx, ny: nx, nz: nx, h, origin: [o, o, o] };
  const pos = G.surfaceNets(field, g, false);
  const m = G.computeMassProperties(pos);
  const exact = 4 / 3 * Math.PI * R * R * R;
  assert.ok(m.volume > 0, `volume=${m.volume}`); // 正 = 外向き
  assert.ok(Math.abs(m.volume - exact) < exact * 0.01, `volume=${m.volume} exact=${exact}`);
  const t = topologyOf(pos);
  assert.ok(t.watertight && t.shells === 1, JSON.stringify(t));
  // flip を指定すると裏返る
  assert.ok(G.computeMassProperties(G.surfaceNets(field, g, true)).volume < 0);
});

test('フィラメント長: 体積を φ1.75 の長さに換算する', () => {
  const len = G.filamentLength(1000, 1.75);
  assert.ok(Math.abs(len - 1000 / (Math.PI * 1.75 * 1.75 / 4)) < 1e-9, String(len));
  assert.ok(Math.abs(len - 415.75) < 0.1, String(len));
});

let failed = 0;
for (const [name, fn] of cases) {
  try {
    fn();
    passed++;
    console.log('  ok   ' + name);
  } catch (e) {
    failed++;
    console.log('  FAIL ' + name + '\n       ' + e.message);
  }
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
