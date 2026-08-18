// 単一 HTML へのバンドル
// 使い方: node build.mjs [出力パス]
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const srcDir = join(root, 'src');
const jsDir = join(srcDir, 'js');
const out = process.argv[2] || join(root, 'dist', 'stl-viewer.html');

const files = readdirSync(jsDir).filter((f) => f.endsWith('.js')).sort();
const js = files.map((f) => `// ===== ${f} =====\n${readFileSync(join(jsDir, f), 'utf8')}`).join('\n');
const css = readFileSync(join(srcDir, 'style.css'), 'utf8');
const html = readFileSync(join(srcDir, 'index.html'), 'utf8');

if (/<\/script/i.test(js) || /<\/style/i.test(css)) {
  throw new Error('埋め込み内容に終了タグが含まれています');
}

const bundled = html
  .replace('/*__CSS__*/', () => css)
  .replace('/*__JS__*/', () => `(function () {\n'use strict';\n${js}\n})();`);

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, bundled);
console.log(`${out}  ${(Buffer.byteLength(bundled) / 1024).toFixed(1)} KB  (js: ${files.length} files)`);
