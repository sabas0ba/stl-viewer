// コア処理 (DOM 非依存) の単体テスト
// 実行: node test/core.test.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const jsDir = join(root, 'src', 'js');
const files = readdirSync(jsDir).filter((f) => /^(00|10|20|30|85)_/.test(f)).sort();
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
