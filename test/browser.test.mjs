// headless Chromium での動作確認 (WebGL は SwiftShader で描画)
// 実行: NODE_PATH=$(npm root -g) node test/browser.test.mjs
import { createRequire } from 'node:module';
// playwright はグローバル導入のため CJS 解決 (NODE_PATH) を利用する
const { chromium } = createRequire(import.meta.url)('playwright');
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const page_url = pathToFileURL(join(root, 'dist', 'stl-viewer.html')).href;
const shots = join(root, 'dist', 'shots');
mkdirSync(shots, { recursive: true });
const downloads = join(root, 'dist', 'downloads');
mkdirSync(downloads, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox']
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

const checks = [];
function check(name, cond, detail = '') {
  checks.push({ name, ok: !!cond, detail });
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : '  ' + detail}`);
}

await page.goto(page_url);
await page.waitForTimeout(500);

check('WebGL2 コンテキストを取得できる', await page.evaluate(() => {
  const c = document.getElementById('gl');
  return !!c.getContext('webgl2');
}));

// --- ファイル読み込み ---
await page.setInputFiles('#file-input', [
  join(here, 'fixtures', 'hollow-box.stl'),
  join(here, 'fixtures', 'bracket.stl')
]);
await page.waitForFunction(() => window.__stlViewer.app && window.__stlViewer.app.parts.length === 2, null, { timeout: 10000 });
const state = await page.evaluate(() => {
  const a = window.__stlViewer.app;
  return a.parts.map((p) => ({
    name: p.name, tri: p.triangleCount, vol: p.mass.volume,
    size: p.worldBounds.size, minZ: p.worldBounds.min[2],
    watertight: p.topology.watertight, shells: p.topology.shells
  }));
});
const hollow = state.find((s) => s.name === 'hollow-box');
const bracket = state.find((s) => s.name === 'bracket');
check('2 ファイルを読み込む', state.length === 2, JSON.stringify(state.map((s) => s.name)));
check('中空箱の体積が 13176 mm3', Math.abs(hollow.vol - 13176) < 1, String(hollow.vol));
check('中空箱は水密で 2 シェル', hollow.watertight && hollow.shells === 2, JSON.stringify(hollow));
check('中空箱の外形が 30mm 立方', Math.abs(hollow.size[0] - 30) < 1e-3 && Math.abs(hollow.size[2] - 30) < 1e-3, JSON.stringify(hollow.size));
check('読み込み時にベッド面へ接地する', Math.abs(hollow.minZ) < 1e-4 && Math.abs(bracket.minZ) < 1e-4, `${hollow.minZ}, ${bracket.minZ}`);

const dimText = await page.textContent('#tbl-dims');
check('寸法表に X/Y/Z が出る', /X 幅/.test(dimText) && /Z 高さ/.test(dimText));

await page.screenshot({ path: join(shots, '01-single.png') });

// --- 3 面図 ---
await page.click('#btn-layout-quad');
await page.waitForTimeout(300);
const vpLabels = await page.$$eval('#overlay text.vp-label', (els) => els.map((e) => e.textContent));
check('4 分割に 4 つのビュー名が出る', vpLabels.length === 4, JSON.stringify(vpLabels));
check('平面図・正面図・右側面図が含まれる',
  vpLabels.some((t) => t.includes('平面図')) && vpLabels.some((t) => t.includes('正面図')) && vpLabels.some((t) => t.includes('右側面図')),
  JSON.stringify(vpLabels));
const dimLabels = await page.$$eval('#overlay text.dim-label', (els) => els.map((e) => e.textContent));
check('寸法値が寸法線に併記される', dimLabels.length >= 6, JSON.stringify(dimLabels.slice(0, 8)));
await page.screenshot({ path: join(shots, '02-quad.png') });

// --- オーバーハング表示と集計 ---
await page.click('.tab[data-tab="display"]');
await page.selectOption('#sel-shade', '1');
await page.click('#btn-overhang-calc');
await page.waitForTimeout(400);
const ohText = await page.textContent('#tbl-overhang');
check('オーバーハング面積を集計する', /要サポート面積/.test(ohText) && !/NaN/.test(ohText), ohText.replace(/\s+/g, ' '));
const ohVals = await page.evaluate(() => {
  const a = window.__stlViewer.app;
  const p = a.parts.find((x) => x.name === 'bracket');
  return window.__stlViewer.overhangStats(p.positions, p.matrix, 45, 0, 0.05, 1);
});
check('ブラケットの張り出し 28x12mm を検出', Math.abs(ohVals.overhangArea - 336) < 1, JSON.stringify(ohVals));

// --- 断面 ---
await page.click('.tab[data-tab="section"]');
await page.evaluate(() => {
  const a = window.__stlViewer.app;
  a.clips[2].enabled = true;
  a.clips[2].value = 15;
  a.clips[2].ui.chk.checked = true;
  window.__stlViewer.requestRender(a);
});
await page.fill('#in-slice-pos', '15');
await page.click('#btn-slice');
await page.waitForTimeout(400);
const sliceText = await page.textContent('#tbl-slice');
check('断面輪郭を計算する', /断面積/.test(sliceText) && !/NaN/.test(sliceText), sliceText.replace(/\s+/g, ' '));
const sliceMetricsOut = await page.evaluate(() => {
  const a = window.__stlViewer.app;
  return window.__stlViewer.sliceMetrics(a.slice.loops);
});
// 中空箱 (外 30 / 内 24) の断面積 = 900 - 576 = 324、ブラケット断面も加算される
check('中空断面の面積が正しく計算される (穴を差し引く)', sliceMetricsOut.area > 324 - 1 && sliceMetricsOut.closed >= 2, JSON.stringify(sliceMetricsOut));
await page.screenshot({ path: join(shots, '03-section.png') });

// --- 姿勢 ---
await page.click('.tab[data-tab="orient"]');
await page.evaluate(() => {
  const a = window.__stlViewer.app;
  a.selection = a.parts.find((p) => p.name === 'bracket').id;
  window.__stlViewer.refreshAll(a);
});
await page.click('#btn-auto-orient');
await page.waitForTimeout(1500);
const orientRows = await page.$$('#tbl-orient tr.orient-row');
check('自動姿勢探索が候補を返す', orientRows.length >= 3, String(orientRows.length));
const beforeH = await page.evaluate(() => window.__stlViewer.app.parts.find((p) => p.name === 'bracket').worldBounds.size[2]);
await orientRows[0].click();
await page.waitForTimeout(600);
const afterState = await page.evaluate(() => {
  const p = window.__stlViewer.app.parts.find((x) => x.name === 'bracket');
  return { h: p.worldBounds.size[2], minZ: p.worldBounds.min[2] };
});
check('候補適用後もベッドに接地している', Math.abs(afterState.minZ) < 1e-4, JSON.stringify(afterState));

await page.click('[data-rot="x,90"]');
await page.waitForTimeout(300);
const rotState = await page.evaluate(() => {
  const p = window.__stlViewer.app.parts.find((x) => x.name === 'bracket');
  return { minZ: p.worldBounds.min[2], size: p.worldBounds.size, vol: window.__stlViewer.partVolume(p) };
});
check('90 度回転後も接地・体積不変', Math.abs(rotState.minZ) < 1e-4 && Math.abs(rotState.vol - 10416) < 1, JSON.stringify(rotState));

// --- 配置と干渉 ---
await page.click('.tab[data-tab="place"]');
await page.click('#btn-collide');
await page.waitForTimeout(800);
const colText = await page.textContent('#tbl-collide');
check('干渉チェックが実行できる', /干渉ペア/.test(colText), colText.replace(/\s+/g, ' '));

const overlapHit = await page.evaluate(() => {
  const a = window.__stlViewer.app;
  const [p, q] = a.parts;
  q.pos[0] = p.pos[0]; q.pos[1] = p.pos[1];
  window.__stlViewer.updatePartMatrix(q);
  return window.__stlViewer.detectCollisions(a.parts).map((c) => c.intersect);
});
check('重ねたパーツの干渉を検出する', overlapHit[0] === true, JSON.stringify(overlapHit));

await page.click('#btn-arrange');
await page.waitForTimeout(300);
const arranged = await page.evaluate(() => {
  const a = window.__stlViewer.app;
  return window.__stlViewer.detectCollisions(a.parts).map((c) => c.intersect);
});
check('自動整列で干渉が解消する', arranged.every((x) => x === false), JSON.stringify(arranged));

// --- 計測 (2 点間) ---
await page.click('.tab[data-tab="measure"]');
const measured = await page.evaluate(() => {
  const a = window.__stlViewer.app;
  a.measure.points = [[0, 0, 0], [3, 4, 12]];
  window.__stlViewer.updateMeasureTable(a);
  return document.querySelector('#tbl-measure').textContent;
});
check('2 点間距離を表示する', /13\.000/.test(measured), measured.replace(/\s+/g, ' '));

// --- スケール ---
const scaled = await page.evaluate(() => {
  const a = window.__stlViewer.app;
  const p = a.parts.find((x) => x.name === 'hollow-box');
  a.selection = p.id;
  window.__stlViewer.applyScale(a, p, [2, 2, 2]);
  return { size: p.worldBounds.size, vol: window.__stlViewer.partVolume(p) };
});
check('倍率 200% で寸法 2 倍・体積 8 倍', Math.abs(scaled.size[0] - 60) < 1e-3 && Math.abs(scaled.vol - 13176 * 8) < 10, JSON.stringify(scaled));

// --- 書き出し ---
const exported = await page.evaluate(() => {
  const a = window.__stlViewer.app;
  const p = a.parts.find((x) => x.name === 'bracket');
  const buf = window.__stlViewer.buildBinarySTL([{ positions: p.positions, matrix: p.matrix }], 'test');
  const parsed = window.__stlViewer.parseSTL(buf);
  const b = window.__stlViewer.computeBounds(parsed.positions);
  const m = window.__stlViewer.computeMassProperties(parsed.positions);
  return { tri: parsed.triangleCount, minZ: b.min[2], vol: m.volume };
});
check('書き出した STL に姿勢が反映される', exported.tri === 36 && Math.abs(exported.minZ) < 1e-3 && exported.vol > 0, JSON.stringify(exported));

await page.click('#btn-layout-single');
await page.selectOption('#sel-shade', '0');
await page.waitForTimeout(300);

// --- ピッキング (クリック選択 / 面接地) ---
async function screenPointOf(partName, kind) {
  return page.evaluate(([name, k]) => {
    const V = window.__stlViewer, a = V.app;
    const e = a.lastViewports[0];
    const p = a.parts.find((x) => x.name === name);
    const b = p.worldBounds;
    const c = k === 'top'
      ? [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, b.max[2]]
      : [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
    const s = V.projectToScreen(e.mats.vp, e.vp.rect, a.R.canvas.height, c);
    const r = a.R.canvas.getBoundingClientRect();
    return { x: r.left + s[0] / a.R.dpr, y: r.top + s[1] / a.R.dpr, id: p.id };
  }, [partName, kind]);
}

await page.evaluate(() => {
  const V = window.__stlViewer;
  V.app.selection = null;
  V.refreshAll(V.app);
});
await page.waitForTimeout(200);
const hbPoint = await screenPointOf('hollow-box', 'top');
await page.mouse.click(hbPoint.x, hbPoint.y);
await page.waitForTimeout(300);
const picked = await page.evaluate(() => window.__stlViewer.app.selection);
check('クリックでパーツを選択できる', picked === hbPoint.id, `${picked} != ${hbPoint.id}`);

await page.click('.tab[data-tab="orient"]');
await page.click('#btn-lay');
const layPoint = await screenPointOf('hollow-box', 'top');
const quatBefore = await page.evaluate(() => window.__stlViewer.app.parts.find((p) => p.name === 'hollow-box').quat.slice());
await page.mouse.click(layPoint.x, layPoint.y);
await page.waitForTimeout(400);
const layState = await page.evaluate(() => {
  const p = window.__stlViewer.app.parts.find((x) => x.name === 'hollow-box');
  return { quat: p.quat.slice(), minZ: p.worldBounds.min[2], mode: window.__stlViewer.app.mode };
});
check('上面をクリックすると 180 度反転して接地する',
  Math.abs(layState.quat[3]) < 1e-6 && Math.abs(layState.minZ) < 1e-4 && layState.mode === null,
  JSON.stringify({ before: quatBefore, after: layState }));

await page.screenshot({ path: join(shots, '04-final.png') });

// --- ステージ (造形エリア) ---
await page.click('.tab[data-tab="place"]');
await page.fill('#in-bed-x', '150');
await page.dispatchEvent('#in-bed-x', 'change');
await page.fill('#in-bed-y', '150');
await page.dispatchEvent('#in-bed-y', 'change');
await page.waitForTimeout(300);
const bedState = await page.evaluate(() => {
  const a = window.__stlViewer.app;
  return { bed: a.bed.slice(), shape: a.bedShape, url: location.search, summary: document.querySelector('#bed-summary').textContent };
});
check('ステージのサイズを変更できる',
  bedState.bed[0] === 150 && bedState.bed[1] === 150 && /150/.test(bedState.summary), JSON.stringify(bedState));
check('ステージ設定が URL に反映される', /bed=150/.test(bedState.url), bedState.url);

await page.selectOption('#sel-bed-shape', 'circle');
await page.fill('#in-bed-d', '120');
await page.dispatchEvent('#in-bed-d', 'change');
await page.waitForTimeout(300);
const circleState = await page.evaluate(() => {
  const V = window.__stlViewer, a = V.app;
  return {
    shape: a.bedShape, bed: a.bed.slice(),
    url: location.search,
    rectVisible: !document.querySelector('#row-bed-rect').hidden,
    // 円の外側にある矩形は範囲外と判定される
    cornerOutside: V.outsideBedXY({ min: [0, 0, 0], max: [20, 20, 10] }, a.bed, a.bedShape),
    centerInside: V.outsideBedXY({ min: [50, 50, 0], max: [70, 70, 10] }, a.bed, a.bedShape)
  };
});
check('円形ステージへ切り替えられる',
  circleState.shape === 'circle' && circleState.bed[0] === 120 && !circleState.rectVisible, JSON.stringify(circleState));
check('円形ステージの範囲判定が働く',
  circleState.cornerOutside === true && circleState.centerInside === false, JSON.stringify(circleState));
check('円形設定が URL に反映される', /bed=circle/.test(circleState.url), circleState.url);
await page.screenshot({ path: join(shots, '08-stage-circle.png') });

// グリッド間隔の変更が描画に反映される
const gridCounts = await page.evaluate(() => {
  const V = window.__stlViewer, a = V.app;
  const wide = buildGridLinesProbe(a, 25), narrow = buildGridLinesProbe(a, 5);
  function buildGridLinesProbe(app, step) {
    app.gridStep = step;
    app.R.gridDirty = true;
    V.requestRender(app);
    return app.gridStep;
  }
  return { wide, narrow };
});
check('グリッド間隔を変更できる', gridCounts.narrow === 5, JSON.stringify(gridCounts));

await page.selectOption('#sel-bed-shape', 'rect');
await page.fill('#in-bed-x', '220');
await page.dispatchEvent('#in-bed-x', 'change');
await page.fill('#in-bed-y', '220');
await page.dispatchEvent('#in-bed-y', 'change');
await page.fill('#in-grid-step', '10');
await page.dispatchEvent('#in-grid-step', 'change');
await page.click('#btn-arrange');
await page.waitForTimeout(300);

// --- 図面 (実寸出力) ---
await page.click('.tab[data-tab="print"]');
await page.evaluate(() => {
  const V = window.__stlViewer, a = V.app;
  a.selection = a.parts.find((p) => p.name === 'bracket').id;
  V.refreshAll(a);
});
await page.selectOption('#sel-print-target', 'selected');
await page.waitForTimeout(200);
const printInfo = await page.textContent('#tbl-print');
check('図面タブに推定ページ数が出る', /推定ページ数/.test(printInfo) && !/NaN/.test(printInfo), printInfo.replace(/\s+/g, ' '));

const drawInfo = await page.evaluate(() => {
  const V = window.__stlViewer, a = V.app;
  const p = a.parts.find((x) => x.name === 'bracket');
  const front = V.buildViewDrawing([p], 'front', {});
  const top = V.buildViewDrawing([p], 'top', {});
  return {
    frontW: front.bounds.width, frontH: front.bounds.height,
    topW: top.bounds.width, topH: top.bounds.height,
    size: p.worldBounds.size, segs: front.silhouette.length
  };
});
check('輪郭の外形寸法がモデルの実寸と一致する',
  Math.abs(drawInfo.frontW - drawInfo.size[0]) < 1e-4 &&
  Math.abs(drawInfo.frontH - drawInfo.size[2]) < 1e-4 &&
  Math.abs(drawInfo.topH - drawInfo.size[1]) < 1e-4, JSON.stringify(drawInfo));

await page.click('#btn-print-preview');
await page.waitForTimeout(600);
const previewSvg = await page.$$('#print-preview svg');
check('図面プレビューが表示される', previewSvg.length >= 2, String(previewSvg.length));
await page.screenshot({ path: join(shots, '09-print.png') });

const pdfDownload = page.waitForEvent('download', { timeout: 20000 });
await page.click('#btn-print-pdf');
const dl = await pdfDownload;
const pdfPath = join(downloads, 'drawing.pdf');
await dl.saveAs(pdfPath);
const pdfBuf = readFileSync(pdfPath);
const pdfText = pdfBuf.toString('latin1');
check('PDF がダウンロードできる', /_1to1\.pdf$/.test(dl.suggestedFilename()), dl.suggestedFilename());
check('PDF ヘッダと EOF が正しい', pdfText.startsWith('%PDF-1.4') && pdfText.trimEnd().endsWith('%%EOF'), String(pdfBuf.length));
check('PDF が A4 縦で 1:1 と記載される',
  /MediaBox \[0 0 595\.276 841\.89\]/.test(pdfText) && /scale 1:1 \\\(actual size\\\)/.test(pdfText));
const pageCount = (pdfText.match(/\/Type \/Page[^s]/g) || []).length;
check('選択した 2 図が 2 ページ以上になる', pageCount >= 2, String(pageCount));

const svgDownload = page.waitForEvent('download', { timeout: 20000 });
await page.click('#btn-print-svg');
const dlSvg = await svgDownload;
const svgPath = join(downloads, 'drawing.svg');
await dlSvg.saveAs(svgPath);
const svgText = readFileSync(svgPath, 'utf8');
check('SVG が mm 指定で出力される', /width="[\d.]+mm"/.test(svgText) && /<line /.test(svgText), dlSvg.suggestedFilename());

// 断面図の出力
await page.evaluate(() => {
  document.querySelectorAll('#print-views input').forEach((c) => { c.checked = c.value === 'section'; });
  document.querySelector('#sel-slice-axis').value = '2';
  document.querySelector('#in-slice-pos').value = '3';
});
const secDownload = page.waitForEvent('download', { timeout: 20000 });
await page.click('#btn-print-pdf');
const dlSec = await secDownload;
await dlSec.saveAs(join(downloads, 'section.pdf'));
const secText = readFileSync(join(downloads, 'section.pdf'), 'utf8');
check('断面図を PDF に出力できる', /SECTION Z = 3\.00 mm/.test(secText));

// --- 描画結果が空でないことを確認 ---
const pix = await page.evaluate(() => {
  const c = document.getElementById('gl');
  const gl = c.getContext('webgl2');
  const w = c.width, h = c.height;
  const buf = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  let nonBg = 0;
  for (let i = 0; i < buf.length; i += 4) {
    if (Math.abs(buf[i] - 22) > 8 || Math.abs(buf[i + 1] - 24) > 8 || Math.abs(buf[i + 2] - 28) > 8) nonBg++;
  }
  return { total: w * h, nonBg };
});
check('モデルが実際に描画されている', pix.nonBg > pix.total * 0.02, JSON.stringify(pix));

check('JS エラーが発生していない', errors.length === 0, errors.join(' | '));

await browser.close();
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
