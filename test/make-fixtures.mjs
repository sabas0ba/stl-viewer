// 検証用の STL を生成する
// 実行: node test/make-fixtures.mjs
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const jsDir = join(root, 'src', 'js');
const files = readdirSync(jsDir).filter((f) => /^(00|10|20|30)_/.test(f)).sort();
const ctx = vm.createContext({ console, TextDecoder, Map, Set });
vm.runInContext(files.map((f) => readFileSync(join(jsDir, f), 'utf8')).join('\n'), ctx);
const G = ctx;

const tris = [];
function tri(a, b, c) { tris.push(...a, ...b, ...c); }

// 直方体。inward=true で法線を内向き (中空部品の内壁用) にする
function box(x0, y0, z0, x1, y1, z1, inward = false) {
  const v = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]
  ];
  const faces = [
    [0, 3, 2], [0, 2, 1], [4, 5, 6], [4, 6, 7],
    [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5],
    [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]
  ];
  for (const f of faces) {
    if (inward) tri(v[f[0]], v[f[2]], v[f[1]]);
    else tri(v[f[0]], v[f[1]], v[f[2]]);
  }
}

function write(name, positions) {
  const buf = G.buildBinarySTL([{ positions: new Float32Array(positions), matrix: G.M4.create() }], name);
  const dir = join(here, 'fixtures');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name + '.stl'), Buffer.from(buf));
  const m = G.computeMassProperties(new Float32Array(positions));
  console.log(`${name}.stl  tri=${m.triangleCount}  vol=${m.volume.toFixed(1)}mm3`);
}

// 1) 中空の箱 (断面表示とシェル数の確認用)
tris.length = 0;
box(0, 0, 0, 30, 30, 30);
box(3, 3, 3, 27, 27, 27, true);
write('hollow-box', tris);

// 2) L 字ブラケット (オーバーハングと姿勢探索の確認用)
tris.length = 0;
box(0, 0, 0, 40, 20, 6);
box(0, 0, 0, 6, 20, 30);
box(6, 4, 20, 34, 16, 26); // 宙に浮いた張り出し (要サポート)
write('bracket', tris);

// 3) 穴の空いた板 (断面輪郭が複数ループになる確認用)
tris.length = 0;
const R = 6, N = 32, T = 4, W = 40;
// 外周板 (中央に正多角形の穴)
function ring(z, flip) {
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
    const p0 = [W / 2 + R * Math.cos(a0), W / 2 + R * Math.sin(a0), z];
    const p1 = [W / 2 + R * Math.cos(a1), W / 2 + R * Math.sin(a1), z];
    // 穴の周囲を外形の角へ扇状に接続する簡易三角形分割
    const corner = [W / 2 + (W / 2) * Math.cos(a0) * 1.0, W / 2 + (W / 2) * Math.sin(a0) * 1.0, z];
    const corner1 = [W / 2 + (W / 2) * Math.cos(a1) * 1.0, W / 2 + (W / 2) * Math.sin(a1) * 1.0, z];
    if (flip) { tri(p0, corner, corner1); tri(p0, corner1, p1); }
    else { tri(p0, corner1, corner); tri(p0, p1, corner1); }
  }
}
ring(T, true);  // 上面 (法線 +Z)
ring(0, false); // 下面 (法線 -Z)
for (let i = 0; i < N; i++) {
  const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
  const i0 = [W / 2 + R * Math.cos(a0), W / 2 + R * Math.sin(a0), 0];
  const i1 = [W / 2 + R * Math.cos(a1), W / 2 + R * Math.sin(a1), 0];
  const i0t = [i0[0], i0[1], T], i1t = [i1[0], i1[1], T];
  tri(i0, i0t, i1t); tri(i0, i1t, i1); // 内周壁
  const o0 = [W / 2 + (W / 2) * Math.cos(a0), W / 2 + (W / 2) * Math.sin(a0), 0];
  const o1 = [W / 2 + (W / 2) * Math.cos(a1), W / 2 + (W / 2) * Math.sin(a1), 0];
  const o0t = [o0[0], o0[1], T], o1t = [o1[0], o1[1], T];
  tri(o0, o1t, o0t); tri(o0, o1, o1t); // 外周壁
}
write('washer', tris);
