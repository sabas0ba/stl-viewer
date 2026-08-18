// 単一 HTML へのバンドル
//   node build.mjs            -> dist/index.html と dist/stl-viewer.html を生成
//   node build.mjs --check    -> 生成物が最新かどうかのみ判定 (CI 用、差分があれば終了コード 1)
//   node build.mjs <出力パス>  -> 任意のパスへ 1 ファイルだけ生成
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const srcDir = join(root, 'src');
const jsDir = join(srcDir, 'js');
const distDir = join(root, 'dist');

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const explicitOut = args.find((a) => !a.startsWith('--'));

const files = readdirSync(jsDir).filter((f) => f.endsWith('.js')).sort();
const js = files.map((f) => `// ===== ${f} =====\n${readFileSync(join(jsDir, f), 'utf8')}`).join('\n');
const css = readFileSync(join(srcDir, 'style.css'), 'utf8');
const html = readFileSync(join(srcDir, 'index.html'), 'utf8');

// テンプレートに終了タグが混入するとインライン化が壊れるため事前に検査する
if (/<\/script/i.test(js) || /<\/style/i.test(css)) {
  throw new Error('埋め込み内容に終了タグが含まれています');
}

const bundled = html
  .replace('/*__CSS__*/', () => css)
  .replace('/*__JS__*/', () => `(function () {\n'use strict';\n${js}\n})();`);

const outputs = explicitOut
  ? [explicitOut]
  : [join(distDir, 'index.html'), join(distDir, 'stl-viewer.html')];

if (checkOnly) {
  const stale = outputs.filter((p) => !existsSync(p) || readFileSync(p, 'utf8') !== bundled);
  if (stale.length) {
    console.error('生成物が最新ではありません: ' + stale.join(', '));
    console.error('`node build.mjs` を実行してコミットしてください。');
    process.exit(1);
  }
  console.log('生成物は最新です');
  process.exit(0);
}

for (const out of outputs) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, bundled);
}
// GitHub Pages で Jekyll による加工を行わせない
if (!explicitOut) writeFileSync(join(distDir, '.nojekyll'), '');

console.log(`${outputs.join(', ')}  ${(Buffer.byteLength(bundled) / 1024).toFixed(1)} KB  (js: ${files.length} files)`);
