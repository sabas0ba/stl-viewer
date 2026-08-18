// ---------------------------------------------------------------------------
// 中抜きタブの配線
// ---------------------------------------------------------------------------

var HOLLOW_INPUT_IDS = [
  '#in-hollow-wall', '#in-hollow-top', '#in-hollow-bottom',
  '#sel-hollow-infill', '#in-hollow-density', '#in-hollow-rib',
  '#sel-hollow-hole', '#in-hollow-hole-d', '#in-hollow-hole-n',
  '#sel-hollow-mode', '#in-hollow-voxel', '#in-hollow-line', '#in-hollow-layer'
];

function setupHollowControls(app) {
  HOLLOW_INPUT_IDS.forEach(function (id) {
    $(id).addEventListener('change', function () { updateHollowPlan(app); });
    $(id).addEventListener('input', function () { updateHollowPlan(app); });
  });
  $('#btn-hollow-run').addEventListener('click', function () {
    var p = selectedPart(app);
    if (!p) { setStatus(app, 'パーツを選択してください。'); return; }
    withBusy(app, '中抜きを計算中...', function () { runHollow(app, p); });
  });
  $('#btn-hollow-section').addEventListener('click', function () { showHollowSection(app); });
  updateHollowPlan(app);
}

function hollowOptions(app) {
  var infill = $('#sel-hollow-infill').value;
  return {
    wall: clamp(parseFloat($('#in-hollow-wall').value) || 2, 0.05, 100),
    top: clamp(parseFloat($('#in-hollow-top').value) || 2, 0.05, 100),
    bottom: clamp(parseFloat($('#in-hollow-bottom').value) || 2, 0.05, 100),
    infill: infill,
    density: clamp(parseFloat($('#in-hollow-density').value) || 15, 1, 90) / 100,
    rib: clamp(parseFloat($('#in-hollow-rib').value) || 1, 0.05, 50),
    hole: $('#sel-hollow-hole').value,
    holeDiameter: clamp(parseFloat($('#in-hollow-hole-d').value) || 4, 0.5, 100),
    holeCount: clamp(Math.round(parseFloat($('#in-hollow-hole-n').value) || 1), 1, 20),
    mode: $('#sel-hollow-mode').value,
    voxel: Math.max(0, parseFloat($('#in-hollow-voxel').value) || 0),
    lineWidth: clamp(parseFloat($('#in-hollow-line').value) || 0.4, 0.05, 5),
    layer: clamp(parseFloat($('#in-hollow-layer').value) || 0.2, 0.01, 5)
  };
}

// 実行前の見込み (格子の細かさと内部構造の周期) を出す
function updateHollowPlan(app) {
  var p = selectedPart(app);
  $('#hollow-target').textContent = p ? p.name : 'パーツ未選択';
  var t = $('#tbl-hollow-plan');
  t.innerHTML = '';
  if (!p) { t.appendChild(kvRow('-', 'パーツを選択してください')); return; }
  var opt = hollowOptions(app);
  var size = p.worldBounds.size;
  var h = chooseVoxelSize(size, {
    wall: opt.wall, top: opt.top, bottom: opt.bottom, rib: opt.rib,
    infill: opt.infill, hole: opt.hole, holeDiameter: opt.holeDiameter,
    voxel: opt.voxel, maxVoxels: hollowDefaults().maxVoxels
  });
  var nx = Math.ceil(size[0] / h) + 5, ny = Math.ceil(size[1] / h) + 5, nz = Math.ceil(size[2] / h) + 5;
  t.appendChild(kvRow('外形 (mm)', fmt(size[0], 1) + ' × ' + fmt(size[1], 1) + ' × ' + fmt(size[2], 1)));
  t.appendChild(kvRow('格子間隔', fmt(h, 3) + ' mm  (' + nx + ' × ' + ny + ' × ' + nz + ')',
    h > opt.wall / 2 ? 'warn' : ''));
  if (opt.infill !== 'none') {
    t.appendChild(kvRow('リブ間隔', fmt(infillPeriod(opt.infill, opt.rib, opt.density), 2) + ' mm'));
  }
  t.appendChild(kvRow('最小の壁', fmt(Math.min(opt.wall, opt.top, opt.bottom), 2) + ' mm / 押出 ' +
    fmt(Math.min(opt.wall, opt.top, opt.bottom) / opt.lineWidth, 1) + ' 本',
    Math.min(opt.wall, opt.top, opt.bottom) < opt.lineWidth * 2 ? 'warn' : 'ok'));
}

function runHollow(app, part) {
  var opt = hollowOptions(app);
  var res = hollowMesh(part.positions, part.matrix, opt);
  if (res.triangleCount === 0) throw new Error('中抜き結果が空になりました。壁厚や格子間隔を見直してください。');
  // hollowMesh はワールド座標で生成するため、新しいパーツは変換なしで置く
  var made = createPart(part.name + ' (中抜き)', new Float32Array(res.positions), 0, '中抜き');
  made.color = part.color.slice();
  app.parts.push(made);
  part.visible = false;
  app.selection = made.id;
  app.hollowResult = res;
  app.hollowSource = part.name;
  refreshAll(app);
  refreshHollowTable(app);
  setStatus(app, made.name + ' を作成しました (体積 ' + fmt(res.volume.ratio * 100, 1) + ' %、' +
    fmtInt(res.triangleCount) + ' 三角形)。元のパーツは非表示にしました。');
}

function refreshHollowTable(app) {
  var t = $('#tbl-hollow');
  t.innerHTML = '';
  var host = $('#hollow-warn');
  var res = app.hollowResult;
  if (!res) { t.appendChild(kvRow('-', '未実行')); host.innerHTML = '-'; return; }
  var mat = MATERIALS[parseInt($('#sel-material').value, 10) || 0];
  var solidG = res.volume.solid / 1000 * mat.density;
  var hollowG = res.volume.hollow / 1000 * mat.density;
  t.appendChild(kvRow('元 (' + (app.hollowSource || '-') + ')', fmt(res.volume.solid / 1000, 2) + ' cm³ / ' + fmt(solidG, 1) + ' g', 'sec'));
  t.appendChild(kvRow('中抜き後', fmt(res.volume.hollow / 1000, 2) + ' cm³ / ' + fmt(hollowG, 1) + ' g'));
  t.appendChild(kvRow('削減量', fmt(res.volume.removed / 1000, 2) + ' cm³ / ' + fmt(solidG - hollowG, 1) + ' g  (' +
    fmt((1 - res.volume.ratio) * 100, 1) + ' % 減)', 'ok'));
  t.appendChild(kvRow('フィラメント長 φ1.75', fmt(filamentLength(res.volume.hollow, 1.75) / 1000, 2) + ' m  (元 ' +
    fmt(filamentLength(res.volume.solid, 1.75) / 1000, 2) + ' m)'));
  t.appendChild(kvRow('断面二次モーメント比', fmt(res.sections.minInertiaRatio * 100, 1) + ' %  (最小 Z = ' +
    fmt(res.sections.minInertiaZ, 1) + ' mm)', res.sections.minInertiaRatio < 0.4 ? 'warn' : (res.sections.minInertiaRatio > 0.7 ? 'ok' : ''), '曲げ剛性の目安。層ごとに弱軸の断面二次モーメントを中実と比べた最小値'));
  t.appendChild(kvRow('断面積比', fmt(res.sections.minAreaRatio * 100, 1) + ' %  (最小 Z = ' +
    fmt(res.sections.minAreaZ, 1) + ' mm)', res.sections.minAreaRatio < 0.2 ? 'warn' : ''));
  t.appendChild(kvRow('抜き穴', res.holes.length ? fmtInt(res.holes.length) + ' 個 (φ' + fmt(res.options.holeDiameter, 1) + ')' : 'なし'));
  t.appendChild(kvRow('格子', res.grid.nx + ' × ' + res.grid.ny + ' × ' + res.grid.nz + ' @ ' + fmt(res.grid.h, 3) + ' mm'));
  t.appendChild(kvRow('三角形数', fmtInt(res.triangleCount)));
  host.innerHTML = res.warnings.length
    ? res.warnings.map(function (w) { return '<span class="w">' + escapeHtml(w) + '</span>'; }).join('<br>')
    : '<span class="g">問題は検出されていません</span>';
}

// 中抜き結果を確認しやすいよう Y 平面で切って表示する
function showHollowSection(app) {
  var p = selectedPart(app);
  if (!p) { setStatus(app, 'パーツを選択してください。'); return; }
  var b = p.worldBounds;
  var clip = app.clips[1];
  clip.enabled = true;
  clip.cap = true;
  clip.value = (b.min[1] + b.max[1]) / 2;
  if (clip.ui) {
    clip.ui.chk.checked = true;
    clip.ui.range.value = clip.value;
    clip.ui.num.value = fmt(clip.value, 2);
  }
  $('#chk-cap').checked = true;
  requestRender(app);
  setStatus(app, 'Y 平面で切断して表示しています (断面タブで解除できます)。');
}
