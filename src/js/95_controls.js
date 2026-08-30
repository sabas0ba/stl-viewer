// ---------------------------------------------------------------------------
// パネル操作の配線
// ---------------------------------------------------------------------------

var BAR_CONTROLS = {
  left: { target: '#left', label: '左', visibleText: '‹', hiddenText: '›' },
  right: { target: '#right', label: '右', visibleText: '›', hiddenText: '‹' },
  top: { target: '#topbar', label: '上', visibleText: '⌃', hiddenText: '⌄' },
  bottom: { target: '#status', label: '下', visibleText: '⌄', hiddenText: '⌃' }
};

function setBarVisible(app, name, visible) {
  var control = BAR_CONTROLS[name];
  var button = $('#btn-bar-' + name);
  app.bars[name] = visible;
  $(control.target).hidden = !visible;
  button.classList.toggle('active', visible);
  button.setAttribute('aria-pressed', visible ? 'true' : 'false');
  button.setAttribute('aria-label', control.label + 'バーを' + (visible ? '隠す' : '表示'));
  button.title = button.getAttribute('aria-label');
  button.textContent = visible ? control.visibleText : control.hiddenText;
  requestRender(app);
}

function setupControls(app) {
  var i;

  // --- ファイル ---
  $('#btn-open').addEventListener('click', function () { $('#file-input').click(); });
  $('#file-input').addEventListener('change', function (ev) {
    loadFiles(app, ev.target.files);
    ev.target.value = '';
  });
  var vpEl = $('#viewport');
  ['dragenter', 'dragover'].forEach(function (t) {
    document.addEventListener(t, function (ev) { ev.preventDefault(); vpEl.classList.add('dragover'); });
  });
  ['dragleave', 'drop'].forEach(function (t) {
    document.addEventListener(t, function (ev) {
      ev.preventDefault();
      if (t === 'drop' || ev.target === document.documentElement) vpEl.classList.remove('dragover');
    });
  });
  document.addEventListener('drop', function (ev) {
    if (ev.dataTransfer && ev.dataTransfer.files.length) loadFiles(app, ev.dataTransfer.files);
  });

  // --- レイアウト / 視点 ---
  function setLayout(mode) {
    app.layout = mode;
    $('#btn-layout-single').classList.toggle('active', mode === 'single');
    $('#btn-layout-quad').classList.toggle('active', mode === 'quad');
    $('#view-preset-group').style.opacity = mode === 'quad' ? 0.4 : 1;
    requestRender(app);
  }
  $('#btn-layout-single').addEventListener('click', function () { setLayout('single'); });
  $('#btn-layout-quad').addEventListener('click', function () { setLayout('quad'); });
  setLayout('single');

  Object.keys(BAR_CONTROLS).forEach(function (name) {
    $('#btn-bar-' + name).addEventListener('click', function () {
      setBarVisible(app, name, !app.bars[name]);
    });
    setBarVisible(app, name, app.bars[name]);
  });

  $('#sel-view').addEventListener('change', function (ev) {
    app.singleView = ev.target.value;
    app.layout = 'single';
    setLayout('single');
  });
  $('#sel-shade').addEventListener('change', function (ev) {
    app.shadeMode = parseInt(ev.target.value, 10);
    requestRender(app);
  });
  $('#btn-fit').addEventListener('click', function () { fitView(app); });
  $('#btn-png').addEventListener('click', function () { exportPNG(app); });
  $('#btn-export').addEventListener('click', function () { exportSTL(app); });
  $('#btn-report').addEventListener('click', function () { exportReport(app); });

  // --- ライト / AO ---
  function updateLightControl() {
    app.light.position[0] = clamp(parseFloat($('#in-light-x').value) || 0, -5, 5);
    app.light.position[1] = clamp(parseFloat($('#in-light-y').value) || 0, -5, 5);
    app.light.position[2] = clamp(parseFloat($('#in-light-z').value) || 0, -5, 5);
    app.light.strength = clamp(parseFloat($('#in-light-strength').value) || 0, 0, 2);
    app.light.ambient = clamp(parseFloat($('#in-light-ambient').value) || 0, 0, 1);
    app.light.ao = clamp(parseFloat($('#in-ao-strength').value) || 0, 0, 1);
    $('#light-strength-val').textContent = fmt(app.light.strength, 2);
    $('#light-ambient-val').textContent = fmt(app.light.ambient, 2);
    $('#ao-strength-val').textContent = fmt(app.light.ao, 2);
    requestRender(app);
  }
  ['#in-light-x', '#in-light-y', '#in-light-z', '#in-light-strength', '#in-light-ambient', '#in-ao-strength']
    .forEach(function (id) { $(id).addEventListener('input', updateLightControl); });
  updateLightControl();

  // --- View 内の Z 断面 ---
  var zSectionCheck = $('#chk-z-section');
  var zSectionRange = $('#in-z-section');
  zSectionCheck.addEventListener('change', function () {
    var clip = app.clips[2];
    clip.enabled = zSectionCheck.checked;
    if (clip.ui) clip.ui.chk.checked = clip.enabled;
    if (clip.enabled) app.activeClip = 2;
    else if (app.activeClip === 2) app.activeClip = firstEnabledClip(app);
    syncSlice(app);
  });
  zSectionRange.addEventListener('input', function () {
    var clip = app.clips[2];
    clip.value = parseFloat(zSectionRange.value) || 0;
    updateZSectionValue(app);
    if (zSectionCheck.checked) {
      app.activeClip = 2;
      requestRender(app);
      updateClipBadge(app);
      updateSliceSource(app);
    }
  });
  zSectionRange.addEventListener('change', function () {
    if (zSectionCheck.checked) app.activeClip = 2;
    setClipValue(app, 2, app.clips[2].value);
  });

  // --- タブ ---
  $$('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      $$('.tab').forEach(function (t) { t.classList.remove('active'); });
      tab.classList.add('active');
      $$('.tabpanel').forEach(function (p) { p.hidden = p.getAttribute('data-panel') !== tab.getAttribute('data-tab'); });
    });
  });

  // --- 計測タブ ---
  var mSel = $('#sel-material');
  MATERIALS.forEach(function (m, idx) {
    mSel.appendChild(el('option', { value: idx, text: m.name + ' (' + m.density + ' g/cm³)' }));
  });
  mSel.addEventListener('change', function () { updateMass(app); });
  $('#in-infill').addEventListener('input', function () { updateMass(app); });

  $('#btn-scale-apply').addEventListener('click', function () {
    var p = selectedPart(app);
    if (!p) return;
    var s = (parseFloat($('#in-scale').value) || 100) / 100;
    applyScale(app, p, [s, s, s]);
  });
  $('#btn-inch').addEventListener('click', function () {
    var p = selectedPart(app);
    if (!p) return;
    applyScale(app, p, [p.scale[0] * 25.4, p.scale[1] * 25.4, p.scale[2] * 25.4]);
  });
  $('#btn-scale-reset').addEventListener('click', function () {
    var p = selectedPart(app);
    if (!p) return;
    applyScale(app, p, [1, 1, 1]);
  });
  $('#btn-fit-size').addEventListener('click', function () {
    var p = selectedPart(app);
    if (!p) return;
    var axis = parseInt($('#sel-fit-axis').value, 10);
    var target = parseFloat($('#in-fit-size').value);
    if (!target || target <= 0) return;
    var cur = p.worldBounds.size[axis];
    if (cur < 1e-9) return;
    var f = target / cur;
    applyScale(app, p, [p.scale[0] * f, p.scale[1] * f, p.scale[2] * f]);
  });

  $('#btn-measure').addEventListener('click', function () {
    setMode(app, app.mode === 'measure' ? null : 'measure');
    if (app.mode !== 'measure') { /* 終了時は結果を残す */ }
  });
  $('#btn-measure-clear').addEventListener('click', function () {
    app.measure.points = [];
    updateMeasureTable(app);
    requestRender(app);
  });
  updateMeasureTable(app);

  // --- 表示タブ ---
  $('#in-overhang').addEventListener('input', function (ev) {
    app.overhangDeg = parseFloat(ev.target.value);
    $('#overhang-val').textContent = app.overhangDeg + '°';
    requestRender(app);
  });
  $('#btn-overhang-calc').addEventListener('click', function () {
    withBusy(app, '面積を集計中...', function () { computeOverhangTable(app); });
  });
  function bindCheck(id, key, after) {
    $(id).addEventListener('change', function (ev) {
      app[key] = ev.target.checked;
      if (after) after();
      requestRender(app);
    });
  }
  bindCheck('#chk-bed', 'showBed');
  bindCheck('#chk-dims', 'showDims');
  bindCheck('#chk-bbox', 'showBBox');
  bindCheck('#chk-ghost', 'ghostOthers');
  bindCheck('#chk-xray', 'xray');
  bindCheck('#chk-components', 'showComponents');
  bindCheck('#chk-component-colors', 'componentColors');
  $('#btn-quick-xray').addEventListener('click', function () {
    app.xray = true; app.componentColors = true;
    $('#chk-xray').checked = true; $('#chk-component-colors').checked = true;
    requestRender(app);
  });
  $('#btn-quick-xray-off').addEventListener('click', function () {
    app.xray = false; app.componentColors = false;
    $('#chk-xray').checked = false; $('#chk-component-colors').checked = false;
    requestRender(app);
  });
  $('#sel-component').addEventListener('change', function (ev) {
    var p = selectedPart(app), id = parseInt(ev.target.value, 10);
    app.componentFocus = p && id > 0 ? { partId: p.id, componentId: id } : null;
    requestRender(app);
  });
  $('#btn-component-all').addEventListener('click', function () {
    app.componentFocus = null;
    $('#sel-component').value = '';
    requestRender(app);
  });
  $('#btn-component-add').addEventListener('click', function () { addSelectedComponent(app); });
  $('#btn-component-export').addEventListener('click', function () { exportSelectedComponent(app); });
  $('#chk-persp').addEventListener('change', function (ev) {
    app.orbitCam.persp = ev.target.checked;
    requestRender(app);
  });

  // --- ステージ (造形エリア) ---
  var pSel = $('#sel-printer');
  pSel.appendChild(el('option', { value: '-1', text: 'プリセット' }));
  PRINTERS.forEach(function (pr, idx) { pSel.appendChild(el('option', { value: idx, text: pr.name })); });
  pSel.addEventListener('change', function (ev) {
    var idx = parseInt(ev.target.value, 10);
    if (idx < 0) return;
    var pr = PRINTERS[idx];
    app.bedShape = pr.shape || 'rect';
    app.bed = pr.bed.slice();
    syncBedInputs(app);
    applyBedChange(app);
  });
  $('#sel-bed-shape').addEventListener('change', function () {
    app.bedShape = $('#sel-bed-shape').value;
    syncBedInputs(app);
    readBedInputs(app);
    applyBedChange(app);
  });
  ['#in-bed-x', '#in-bed-y', '#in-bed-z', '#in-bed-d', '#in-grid-step'].forEach(function (id) {
    $(id).addEventListener('change', function () {
      readBedInputs(app);
      applyBedChange(app);
    });
  });
  $('#btn-bed-fit').addEventListener('click', function () {
    var b = sceneBounds(app.parts, true);
    if (!b) { setStatus(app, 'パーツがありません。'); return; }
    var margin = parseFloat($('#in-margin').value) || 5;
    if (app.bedShape === 'circle') {
      var cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2;
      var r = 0;
      for (var i = 0; i < 4; i++) {
        var x = (i & 1) ? b.max[0] : b.min[0], y = (i & 2) ? b.max[1] : b.min[1];
        r = Math.max(r, Math.hypot(x - cx, y - cy));
      }
      var d = Math.ceil((r + margin) * 2);
      app.bed = [d, d, Math.max(1, Math.ceil(b.max[2] + margin))];
    } else {
      app.bed = [
        Math.max(1, Math.ceil(b.size[0] + margin * 2)),
        Math.max(1, Math.ceil(b.size[1] + margin * 2)),
        Math.max(1, Math.ceil(b.max[2] + margin))
      ];
    }
    syncBedInputs(app);
    applyBedChange(app);
    // モデルをステージ中央へ寄せる
    app.parts.forEach(function (p) { if (p.visible) centerPartOnBed(p, app.bed); });
    if (app.parts.filter(function (p) { return p.visible; }).length > 1) {
      arrangeParts(app.parts, app.bed, parseFloat($('#in-margin').value) || 5);
    }
    fitView(app);
    refreshAll(app);
  });
  $('#btn-bed-reset').addEventListener('click', function () {
    app.bedShape = 'rect';
    app.bed = [220, 220, 250];
    app.gridStep = 10;
    syncBedInputs(app);
    applyBedChange(app);
  });
  applyBedFromURL(app);
  syncBedInputs(app);

  // --- 断面タブ ---
  buildClipControls(app);
  $('#chk-cap').addEventListener('change', function (ev) {
    app.clips.forEach(function (c) { c.cap = ev.target.checked; });
    requestRender(app);
  });
  $('#btn-clip-clear').addEventListener('click', function () {
    if (!clearClips(app)) setStatus(app, '有効な断面はありません。');
  });
  $('#clip-badge').addEventListener('click', function () { clearClips(app); });
  $('#btn-slice-prev').addEventListener('click', function () { stepSlice(app, -1); });
  $('#btn-slice-next').addEventListener('click', function () { stepSlice(app, 1); });

  // --- 向きタブ ---
  $$('[data-rot]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var spec = btn.getAttribute('data-rot').split(',');
      var axis = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[spec[0]];
      rotateSelected(app, axis, parseFloat(spec[1]));
    });
  });
  $('#btn-rot-apply').addEventListener('click', function () {
    var axisIdx = parseInt($('#sel-rot-axis').value, 10);
    var axis = [[1, 0, 0], [0, 1, 0], [0, 0, 1]][axisIdx];
    rotateSelected(app, axis, parseFloat($('#in-rot-angle').value) || 0);
  });
  $('#btn-eul-apply').addEventListener('click', function () {
    var p = selectedPart(app);
    if (!p) return;
    p.quat = Quat.fromEulerDeg([
      parseFloat($('#in-eul-x').value) || 0,
      parseFloat($('#in-eul-y').value) || 0,
      parseFloat($('#in-eul-z').value) || 0
    ]);
    updatePartMatrix(p);
    dropToBed(p);
    refreshAll(app);
  });
  $('#btn-lay').addEventListener('click', function () {
    if (!selectedPart(app)) { setStatus(app, 'パーツを選択してください。'); return; }
    setMode(app, app.mode === 'lay' ? null : 'lay');
  });
  $('#btn-drop').addEventListener('click', function () {
    var p = selectedPart(app);
    if (!p) return;
    dropToBed(p);
    refreshAll(app);
  });
  $('#btn-rot-reset').addEventListener('click', function () {
    var p = selectedPart(app);
    if (!p) return;
    p.quat = [0, 0, 0, 1];
    updatePartMatrix(p);
    dropToBed(p);
    refreshAll(app);
  });
  $('#btn-auto-orient').addEventListener('click', function () {
    var p = selectedPart(app);
    if (!p) { setStatus(app, 'パーツを選択してください。'); return; }
    withBusy(app, '姿勢を探索中...', function () { runAutoOrient(app, p); });
  });

  // --- 配置タブ ---
  $('#btn-pos-apply').addEventListener('click', function () {
    var p = selectedPart(app);
    if (!p) return;
    var cx = (p.worldBounds.min[0] + p.worldBounds.max[0]) / 2;
    var cy = (p.worldBounds.min[1] + p.worldBounds.max[1]) / 2;
    p.pos[0] += (parseFloat($('#in-pos-x').value) || 0) - cx;
    p.pos[1] += (parseFloat($('#in-pos-y').value) || 0) - cy;
    updatePartMatrix(p);
    refreshAll(app);
  });
  $('#btn-center').addEventListener('click', function () {
    var p = selectedPart(app);
    if (!p) return;
    centerPartOnBed(p, app.bed);
    refreshAll(app);
  });
  $('#btn-arrange').addEventListener('click', function () {
    app.margin = parseFloat($('#in-margin').value) || 5;
    arrangeParts(app.parts, app.bed, app.margin);
    refreshAll(app);
  });
  $('#btn-duplicate').addEventListener('click', function () {
    var p = selectedPart(app);
    if (!p) return;
    var copy = createPart(p.name + ' (複製)', p.positions.slice(), p.fileSize, p.format);
    copy.scale = p.scale.slice();
    copy.quat = p.quat.slice();
    copy.pos = [p.pos[0] + 10, p.pos[1] + 10, p.pos[2]];
    updatePartMatrix(copy);
    app.parts.push(copy);
    app.selection = copy.id;
    refreshAll(app);
  });
  $('#btn-delete').addEventListener('click', function () { deleteSelected(app); });
  $('#btn-clear').addEventListener('click', function () {
    app.parts.forEach(function (p) { disposePartGPU(app.R, p); });
    app.parts = [];
    app.selection = null;
    app.collisionResult = null;
    app.contourLines = null;
    refreshAll(app);
    setStatus(app, 'すべてのパーツを削除しました。');
  });
  $('#btn-collide').addEventListener('click', function () {
    withBusy(app, '干渉を判定中...', function () { runCollisionCheck(app); });
  });

  // --- キーボード ---
  window.addEventListener('keydown', function (ev) {
    var inField = /^(INPUT|SELECT|TEXTAREA)$/.test(ev.target.tagName);
    // Esc は入力欄にフォーカスがあっても効かせる。断面を有効にした直後は
    // チェックボックスにフォーカスが残るため、ここで弾くと解除が届かない。
    if (ev.key === 'Escape') {
      if (inField) ev.target.blur();
      if (app.mode) setMode(app, null);
      else clearClips(app);
      return;
    }
    if (inField) return;
    if (ev.key === 'Delete' || ev.key === 'Backspace') { deleteSelected(app); }
    else if (ev.key === 'f' || ev.key === 'F') { fitView(app); }
    else if (ev.key === 'q' || ev.key === 'Q') {
      $(app.layout === 'quad' ? '#btn-layout-single' : '#btn-layout-quad').click();
    } else if (/^[1-6]$/.test(ev.key)) {
      var keys = ['iso', 'front', 'right', 'top', 'left', 'back'];
      $('#sel-view').value = keys[parseInt(ev.key, 10) - 1];
      $('#sel-view').dispatchEvent(new Event('change'));
    }
  });

  window.addEventListener('resize', function () { requestRender(app); });
}

function deleteSelected(app) {
  var p = selectedPart(app);
  if (!p) return;
  disposePartGPU(app.R, p);
  app.parts = app.parts.filter(function (x) { return x !== p; });
  app.selection = app.parts.length ? app.parts[0].id : null;
  app.collisionResult = null;
  refreshAll(app);
}

function applyScale(app, part, scale) {
  part.scale = scale;
  updatePartMatrix(part);
  dropToBed(part);
  refreshAll(app);
  setStatus(app, '倍率を ' + fmt(scale[0] * 100, 2) + ' % に設定しました。');
}

function rotateSelected(app, axis, deg) {
  var p = selectedPart(app);
  if (!p) { setStatus(app, 'パーツを選択してください。'); return; }
  rotatePartAroundCenter(p, Quat.fromAxisAngle(axis, deg * Math.PI / 180));
  refreshAll(app);
}

// ---------------------------------------------------------------------------
// オーバーハング集計
// ---------------------------------------------------------------------------

function computeOverhangTable(app) {
  var t = $('#tbl-overhang');
  t.innerHTML = '';
  var list = app.parts.filter(function (p) { return p.visible; });
  if (!list.length) { t.appendChild(kvRow('-', 'パーツがありません')); return; }
  var total = 0, over = 0, contact = 0, sampled = false;
  list.forEach(function (p) {
    var step = Math.max(1, Math.ceil(p.triangleCount / 300000));
    var s = overhangStats(p.positions, p.matrix, app.overhangDeg, 0, 0.05, step);
    total += s.totalArea; over += s.overhangArea; contact += s.contactArea;
    if (s.sampled) sampled = true;
  });
  t.appendChild(kvRow('しきい値', app.overhangDeg + '° 超で要サポート'));
  t.appendChild(kvRow('要サポート面積', fmt(over / 100, 2) + ' cm²', over > 0 ? 'warn' : 'ok'));
  t.appendChild(kvRow('全表面積比', fmt(total > 0 ? over / total * 100 : 0, 1) + ' %'));
  t.appendChild(kvRow('ベッド接地面積', fmt(contact / 100, 2) + ' cm²', contact > 0 ? 'ok' : 'warn'));
  if (sampled) t.appendChild(kvRow('注記', '三角形を間引いた概算値'));
}

// ---------------------------------------------------------------------------
// クリップ平面
// ---------------------------------------------------------------------------

var CLIP_NAMES = ['X', 'Y', 'Z'];

// 断面輪郭と断面図面が参照するクリップ平面。有効な平面がなければ null
function currentClip(app) {
  var i = app.activeClip;
  if (i < 0 || i >= app.clips.length) return null;
  return app.clips[i].enabled ? app.clips[i] : null;
}

function firstEnabledClip(app) {
  for (var i = 0; i < app.clips.length; i++) {
    if (app.clips[i].enabled) return i;
  }
  return -1;
}

// 参照元の平面を切り替える (中抜きタブなど他機能から呼ぶ)
function setActiveClip(app, idx) {
  app.activeClip = idx;
  syncSlice(app);
}

// 平面の位置を設定し、UI と断面輪郭を追従させる
function setClipValue(app, idx, v) {
  var clip = app.clips[idx];
  if (!clip) return;
  clip.value = v;
  if (clip.ui) {
    clip.ui.range.value = v;
    clip.ui.num.value = fmt(v, 2);
  }
  if (idx === 2) updateZSectionValue(app);
  syncSlice(app);
}

// クリップ平面をまとめて解除する。解除するものがあれば true
function clearClips(app) {
  var any = false;
  app.clips.forEach(function (c) {
    if (c.enabled) any = true;
    c.enabled = false;
    if (c.ui) c.ui.chk.checked = false;
  });
  app.activeClip = -1;
  syncSlice(app);
  if (any) setStatus(app, '断面表示を解除しました。');
  return any;
}

// クリップ平面の状態から 3D 表示・断面輪郭・表・バッジをまとめて更新する。
// 断面に関わる表示はすべてここを通し、状態が食い違わないようにする。
function syncSlice(app) {
  updateZSectionValue(app);
  if (currentClip(app)) {
    computeSlice(app);
  } else {
    app.slice = null;
    app.contourLines = null;
    drawSliceCanvas(app);
    updateSliceTable(app);
    requestRender(app);
  }
  updateSliceSource(app);
  updateClipBadge(app);
}

// 断面輪郭がどの平面を見ているかを断面タブに明示する
function updateSliceSource(app) {
  var host = $('#slice-source');
  if (!host) return;
  var clip = currentClip(app);
  app.clips.forEach(function (c, i) {
    if (c.ui) c.ui.row.classList.toggle('clip-active', clip !== null && i === app.activeClip);
  });
  host.textContent = clip
    ? CLIP_NAMES[clip.axis] + ' 平面 = ' + fmt(clip.value, 2) + ' mm の断面を表示している (図面タブの断面も同じ位置を使う)'
    : 'クリップ平面を有効にすると、その位置の断面をここに表示する。';
}

// タブに関係なく断面表示中であることを示し、その場で解除できるようにする
function updateClipBadge(app) {
  var badge = $('#clip-badge');
  if (!badge) return;
  var on = app.clips.filter(function (c) { return c.enabled; });
  if (!on.length) { badge.hidden = true; return; }
  badge.hidden = false;
  badge.textContent = '断面表示中 ' + on.map(function (c) {
    return CLIP_NAMES[c.axis] + ' = ' + fmt(c.value, 1);
  }).join(' / ') + ' — 解除';
}

function buildClipControls(app) {
  var host = $('#clip-controls');
  host.innerHTML = '';
  app.clips.forEach(function (clip, idx) {
    var chk = el('input', { type: 'checkbox' });
    var range = el('input', { type: 'range', min: 0, max: 100, step: 0.1, value: clip.value });
    var num = el('input', { type: 'number', step: 0.5, value: clip.value, style: 'width:74px' });
    var invBtn = el('button', { class: 'btn sm', text: '反転' });
    var row = el('div', { class: 'row' }, [
      el('label', {}, [chk, document.createTextNode(' ' + CLIP_NAMES[idx] + ' 平面')]),
      range, num, invBtn
    ]);
    chk.addEventListener('change', function () {
      clip.enabled = chk.checked;
      // 有効にした平面をそのまま断面輪郭の参照元にする
      if (clip.enabled) app.activeClip = idx;
      else if (app.activeClip === idx) app.activeClip = firstEnabledClip(app);
      syncSlice(app);
    });
    // ドラッグ中は 3D だけ追従させ、離した時点で断面輪郭を計算する
    range.addEventListener('input', function () {
      clip.value = parseFloat(range.value);
      num.value = fmt(clip.value, 2);
      if (!clip.enabled) return;
      app.activeClip = idx;
      requestRender(app);
      updateClipBadge(app);
      updateSliceSource(app);
    });
    range.addEventListener('change', function () {
      if (clip.enabled) app.activeClip = idx;
      setClipValue(app, idx, parseFloat(range.value));
    });
    num.addEventListener('change', function () {
      if (clip.enabled) app.activeClip = idx;
      setClipValue(app, idx, parseFloat(num.value) || 0);
    });
    invBtn.addEventListener('click', function () {
      clip.invert = !clip.invert;
      invBtn.classList.toggle('active', clip.invert);
      requestRender(app);
    });
    clip.ui = { range: range, num: num, chk: chk, row: row };
    host.appendChild(row);
  });
  updateClipRanges(app);
  syncSlice(app);
}

function updateClipRanges(app) {
  var b = sceneBounds(app.parts, true);
  var hasSceneBounds = !!b;
  if (!b) {
    app.zClipInitialized = false;
    b = { min: [0, 0, 0], max: app.bed.slice() };
  }
  app.clips.forEach(function (clip, idx) {
    if (!clip.ui) return;
    var lo = b.min[idx], hi = b.max[idx];
    if (hi - lo < 1e-6) { hi = lo + 1; }
    clip.ui.range.min = lo;
    clip.ui.range.max = hi;
    clip.ui.range.step = Math.max((hi - lo) / 500, 0.01);
    if (idx === 2 && hasSceneBounds && !app.zClipInitialized) {
      clip.value = (lo + hi) / 2;
      app.zClipInitialized = true;
      clip.ui.range.value = clip.value;
      clip.ui.num.value = fmt(clip.value, 2);
    } else if (clip.value < lo || clip.value > hi) {
      clip.value = (lo + hi) / 2;
      clip.ui.range.value = clip.value;
      clip.ui.num.value = fmt(clip.value, 2);
    }
    if (idx === 2) {
      var zRange = $('#in-z-section');
      if (zRange) {
        zRange.min = lo; zRange.max = hi;
        zRange.step = Math.max((hi - lo) / 500, 0.01);
        zRange.value = clip.value;
      }
      updateZSectionValue(app);
    }
  });
}

function updateZSectionValue(app) {
  var out = $('#z-section-value');
  if (!out) return;
  var clip = app.clips[2];
  out.textContent = fmt(clip.value, 1) + ' mm';
  $('#chk-z-section').checked = clip.enabled;
  var zRange = $('#in-z-section');
  var b = sceneBounds(app.parts, true);
  if (zRange && b && b.max[2] > b.min[2]) {
    zRange.min = b.min[2];
    zRange.max = b.max[2];
    zRange.step = Math.max((b.max[2] - b.min[2]) / 500, 0.01);
    zRange.value = clip.value;
  }
}

// ---------------------------------------------------------------------------
// 断面輪郭
// ---------------------------------------------------------------------------

function computeSlice(app) {
  var clip = currentClip(app);
  if (!clip) return;
  var axis = clip.axis;
  var value = clip.value;
  var Rm = sliceRotation(axis);
  var invR = M4.invert(M4.create(), Rm);
  var loops = [];
  app.parts.forEach(function (p) {
    if (!p.visible) return;
    var m = M4.mul(M4.create(), Rm, p.matrix);
    var ls = sliceAtZ(p.positions, m, value);
    ls.forEach(function (l) { loops.push(l); });
  });
  app.slice = { axis: axis, value: value, loops: loops };
  // 3D 表示用の輪郭線
  var lines = [];
  loops.forEach(function (l) {
    var pts = l.points;
    for (var i = 0; i + 1 < pts.length; i++) {
      var a = M4.xformPoint([0, 0, 0], invR, [pts[i][0], pts[i][1], value]);
      var b = M4.xformPoint([0, 0, 0], invR, [pts[i + 1][0], pts[i + 1][1], value]);
      lines.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    }
    if (l.closed && pts.length > 2) {
      var a2 = M4.xformPoint([0, 0, 0], invR, [pts[pts.length - 1][0], pts[pts.length - 1][1], value]);
      var b2 = M4.xformPoint([0, 0, 0], invR, [pts[0][0], pts[0][1], value]);
      lines.push(a2[0], a2[1], a2[2], b2[0], b2[1], b2[2]);
    }
  });
  app.contourLines = lines;
  drawSliceCanvas(app);
  updateSliceTable(app);
  requestRender(app);
}

function stepSlice(app, dir) {
  var clip = currentClip(app);
  if (!clip) { setStatus(app, 'クリップ平面を有効にしてください。'); return; }
  var step = parseFloat($('#in-slice-step').value) || 0.2;
  setClipValue(app, app.activeClip, clip.value + dir * step);
}

function pointInPolygon(pt, poly) {
  var inside = false;
  for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if (((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < (xj - xi) * (pt[1] - yi) / ((yj - yi) || 1e-20) + xi)) inside = !inside;
  }
  return inside;
}

function sliceMetrics(loops) {
  var closed = loops.filter(function (l) { return l.closed && l.points.length > 2; });
  var open = loops.length - closed.length;
  var perimeter = 0;
  loops.forEach(function (l) { perimeter += polylineLength(l.points, l.closed); });
  var area = 0;
  if (closed.length <= 300) {
    closed.forEach(function (l, idx) {
      var depth = 0;
      for (var k = 0; k < closed.length; k++) {
        if (k === idx) continue;
        if (pointInPolygon(l.points[0], closed[k].points)) depth++;
      }
      var a = Math.abs(polygonArea(l.points));
      area += (depth % 2 === 0) ? a : -a;
    });
  } else {
    closed.forEach(function (l) { area += polygonArea(l.points); });
    area = Math.abs(area);
  }
  return { closed: closed.length, open: open, perimeter: perimeter, area: area };
}

function updateSliceTable(app) {
  var t = $('#tbl-slice');
  t.innerHTML = '';
  if (!app.slice) { t.appendChild(kvRow('-', 'クリップ平面が無効')); return; }
  var m = sliceMetrics(app.slice.loops);
  var axisName = ['X', 'Y', 'Z'][app.slice.axis];
  t.appendChild(kvRow('切断位置', axisName + ' = ' + fmt(app.slice.value, 3) + ' mm'));
  t.appendChild(kvRow('断面積', fmt(m.area, 2) + ' mm²'));
  t.appendChild(kvRow('輪郭長', fmt(m.perimeter, 2) + ' mm'));
  t.appendChild(kvRow('閉ループ数', fmtInt(m.closed)));
  t.appendChild(kvRow('開ループ数', fmtInt(m.open), m.open ? 'warn' : ''));
  if (m.open) t.appendChild(kvRow('注記', 'メッシュの穴により輪郭が閉じません'));
}

function drawSliceCanvas(app) {
  var cv = $('#slice-canvas');
  var ctx = cv.getContext('2d');
  var W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#101317';
  ctx.fillRect(0, 0, W, H);
  if (!app.slice || !app.slice.loops.length) {
    ctx.fillStyle = '#9aa1ad';
    ctx.font = '12px sans-serif';
    ctx.fillText('この位置に断面はありません', 12, 20);
    return;
  }
  var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  app.slice.loops.forEach(function (l) {
    l.points.forEach(function (p) {
      if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
    });
  });
  var pad = 16;
  var sx = (W - pad * 2) / Math.max(maxX - minX, 1e-6);
  var sy = (H - pad * 2) / Math.max(maxY - minY, 1e-6);
  var s = Math.min(sx, sy);
  var ox = pad + ((W - pad * 2) - (maxX - minX) * s) / 2;
  var oy = pad + ((H - pad * 2) - (maxY - minY) * s) / 2;
  function tx(p) { return [ox + (p[0] - minX) * s, H - (oy + (p[1] - minY) * s)]; }

  var path = new Path2D();
  app.slice.loops.forEach(function (l) {
    if (!l.closed || l.points.length < 3) return;
    var p0 = tx(l.points[0]);
    path.moveTo(p0[0], p0[1]);
    for (var i = 1; i < l.points.length; i++) {
      var p = tx(l.points[i]);
      path.lineTo(p[0], p[1]);
    }
    path.closePath();
  });
  ctx.fillStyle = 'rgba(79,157,224,0.35)';
  ctx.fill(path, 'evenodd');
  ctx.strokeStyle = '#7fd6ff';
  ctx.lineWidth = 1.2;
  ctx.stroke(path);

  // 開いた輪郭は警告色で描く
  ctx.strokeStyle = '#e05f4f';
  app.slice.loops.forEach(function (l) {
    if (l.closed) return;
    ctx.beginPath();
    var p0 = tx(l.points[0]);
    ctx.moveTo(p0[0], p0[1]);
    for (var i = 1; i < l.points.length; i++) {
      var p = tx(l.points[i]);
      ctx.lineTo(p[0], p[1]);
    }
    ctx.stroke();
  });

  // スケールバー
  var axisName = ['X', 'Y', 'Z'][app.slice.axis];
  ctx.fillStyle = '#9aa1ad';
  ctx.font = '11px ui-monospace, monospace';
  ctx.fillText(axisName + ' = ' + fmt(app.slice.value, 2) + ' mm', 8, 14);
  ctx.fillText(fmt(maxX - minX, 1) + ' x ' + fmt(maxY - minY, 1) + ' mm', 8, H - 8);
}

// ---------------------------------------------------------------------------
// 自動姿勢探索
// ---------------------------------------------------------------------------

function runAutoOrient(app, part) {
  var results = searchOrientations(part, app.overhangDeg, 18);
  var t = $('#tbl-orient');
  t.innerHTML = '';
  var head = el('tr', { class: 'sec' }, [
    el('td', { text: '候補 (高さ / 要サポート)' }), el('td', { text: '接地' })
  ]);
  t.appendChild(head);
  results.slice(0, 6).forEach(function (r, idx) {
    var tr = el('tr', { class: 'orient-row' }, [
      el('td', { text: (idx + 1) + '. ' + fmt(r.height, 1) + ' mm / ' + fmt(r.overhangArea / 100, 2) + ' cm²' }),
      el('td', { text: fmt(r.contactArea / 100, 2) + ' cm²' })
    ]);
    tr.addEventListener('click', function () {
      part.quat = r.quat.slice();
      updatePartMatrix(part);
      centerPartOnBed(part, app.bed);
      refreshAll(app);
      setStatus(app, '候補 ' + (idx + 1) + ' の姿勢を適用しました。');
    });
    t.appendChild(tr);
  });
  setStatus(app, results.length + ' 件の姿勢を評価しました。行をクリックで適用します。');
}

// ---------------------------------------------------------------------------
// 干渉チェック
// ---------------------------------------------------------------------------

function runCollisionCheck(app) {
  var t = $('#tbl-collide');
  t.innerHTML = '';
  var res = detectCollisions(app.parts);
  app.collisionResult = res;
  var out = [];
  app.parts.forEach(function (p) {
    if (!p.visible) return;
    var b = p.worldBounds;
    var outside = outsideBedXY(b, app.bed, app.bedShape) || b.max[2] > app.bed[2] + 0.01;
    if (outside) out.push(p.name);
  });
  var hits = res.filter(function (c) { return c.intersect; });
  t.appendChild(kvRow('干渉ペア', fmtInt(hits.length), hits.length ? 'warn' : 'ok'));
  hits.forEach(function (c) { t.appendChild(kvRow(c.a.name, '↔ ' + c.b.name, 'warn')); });
  var undecided = res.filter(function (c) { return !c.exact && !c.intersect; });
  if (undecided.length) t.appendChild(kvRow('判定打ち切り', fmtInt(undecided.length) + ' ペア'));
  t.appendChild(kvRow('領域外パーツ', out.length ? out.join(', ') : 'なし', out.length ? 'warn' : 'ok'));
  refreshWarnings(app);
}

// ---------------------------------------------------------------------------
// 書き出し
// ---------------------------------------------------------------------------

function exportSTL(app) {
  var p = selectedPart(app);
  var list = p ? [p] : app.parts.filter(function (x) { return x.visible; });
  if (!list.length) { setStatus(app, '書き出す対象がありません。'); return; }
  var buf = buildBinarySTL(list.map(function (x) {
    return { positions: x.positions, matrix: x.matrix };
  }), 'stl-viewer export');
  var name = (p ? p.name : 'scene') + '_transformed.stl';
  saveBlob(new Blob([buf], { type: 'model/stl' }), name);
  setStatus(app, name + ' を書き出しました (現在の位置・姿勢・倍率を反映)。');
}

function exportSelectedComponent(app) {
  var p = selectedPart(app), focus = app.componentFocus;
  if (!p || !focus || focus.partId !== p.id) { setStatus(app, '保存する成分を選択してください。'); return; }
  var c = (p.components || []).filter(function (x) { return x.id === focus.componentId; })[0];
  if (!c) { setStatus(app, '選択した成分が見つかりません。'); return; }
  var buf = buildBinarySTL([{ positions: componentPositions(p, c), matrix: p.matrix }], 'stl-viewer component export');
  var name = String(p.name).replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 50) + '_C' + c.id + '.stl';
  saveBlob(new Blob([buf], { type: 'model/stl' }), name);
  setStatus(app, name + ' を書き出しました。');
}

function exportPNG(app) {
  renderFrame(app);
  app.R.canvas.toBlob(function (blob) {
    if (!blob) { setStatus(app, 'PNG を生成できませんでした。'); return; }
    saveBlob(blob, 'stl-view.png');
    setStatus(app, 'PNG を保存しました。');
  }, 'image/png');
}

function exportReport(app) {
  var lines = [];
  lines.push('STL Viewer 計測レポート');
  lines.push('生成: ' + new Date().toISOString());
  lines.push('ビルドプレート: ' + app.bed.join(' x ') + ' mm');
  lines.push('');
  app.parts.forEach(function (p) {
    var b = p.worldBounds;
    var q = p.topology || {};
    lines.push('[' + p.name + ']');
    lines.push('  形式            : ' + p.format + ' / ' + fmtBytes(p.fileSize || 0));
    lines.push('  外形寸法 (mm)   : ' + fmt(b.size[0], 3) + ' x ' + fmt(b.size[1], 3) + ' x ' + fmt(b.size[2], 3));
    lines.push('  配置範囲 X      : ' + fmt(b.min[0], 3) + ' … ' + fmt(b.max[0], 3));
    lines.push('  配置範囲 Y      : ' + fmt(b.min[1], 3) + ' … ' + fmt(b.max[1], 3));
    lines.push('  配置範囲 Z      : ' + fmt(b.min[2], 3) + ' … ' + fmt(b.max[2], 3));
    lines.push('  体積            : ' + fmt(partVolume(p) / 1000, 4) + ' cm3');
    lines.push('  表面積          : ' + fmt(partArea(p) / 100, 3) + ' cm2');
    lines.push('  三角形数        : ' + p.triangleCount);
    lines.push('  倍率            : ' + fmt(p.scale[0] * 100, 3) + ' %');
    lines.push('  姿勢 XYZ (deg)  : ' + Quat.toEulerDeg(p.quat).map(function (v) { return fmt(v, 2); }).join(', '));
    lines.push('  水密性          : ' + (q.watertight ? 'OK' : 'NG'));
    lines.push('  境界/非多様体   : ' + (q.boundaryEdges || 0) + ' / ' + (q.nonManifoldEdges || 0));
    lines.push('  シェル数        : ' + (q.shells || 0));
    var s = overhangStats(p.positions, p.matrix, app.overhangDeg, 0, 0.05,
      Math.max(1, Math.ceil(p.triangleCount / 300000)));
    lines.push('  要サポート面積  : ' + fmt(s.overhangArea / 100, 3) + ' cm2 (しきい値 ' + app.overhangDeg + ' deg)');
    lines.push('  接地面積        : ' + fmt(s.contactArea / 100, 3) + ' cm2');
    lines.push('');
  });
  saveBlob(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }), 'stl-report.txt');
  setStatus(app, 'レポートを書き出しました。');
}

// ---------------------------------------------------------------------------
// ステージ (造形エリア) の設定
// ---------------------------------------------------------------------------

function readBedInputs(app) {
  var z = Math.max(1, parseFloat($('#in-bed-z').value) || 250);
  if (app.bedShape === 'circle') {
    var d = Math.max(1, parseFloat($('#in-bed-d').value) || 220);
    app.bed = [d, d, z];
  } else {
    app.bed = [
      Math.max(1, parseFloat($('#in-bed-x').value) || 220),
      Math.max(1, parseFloat($('#in-bed-y').value) || 220),
      z
    ];
  }
  app.gridStep = clamp(parseFloat($('#in-grid-step').value) || 10, 0.5, 500);
}

function syncBedInputs(app) {
  $('#sel-bed-shape').value = app.bedShape;
  $('#row-bed-rect').hidden = app.bedShape === 'circle';
  $('#row-bed-circle').hidden = app.bedShape !== 'circle';
  $('#in-bed-x').value = fmt(app.bed[0], 1);
  $('#in-bed-y').value = fmt(app.bed[1], 1);
  $('#in-bed-d').value = fmt(app.bed[0], 1);
  $('#in-bed-z').value = fmt(app.bed[2], 1);
  $('#in-grid-step').value = fmt(app.gridStep, 1);
  $('#bed-summary').textContent = app.bedShape === 'circle'
    ? 'φ' + fmt(app.bed[0], 0) + ' × H' + fmt(app.bed[2], 0)
    : fmt(app.bed[0], 0) + ' × ' + fmt(app.bed[1], 0) + ' × ' + fmt(app.bed[2], 0);
}

function applyBedChange(app) {
  app.R.gridDirty = true;
  syncBedInputs(app);
  updateBedURL(app);
  refreshWarnings(app);
  updateClipRanges(app);
  requestRender(app);
}

// ステージ設定を URL に反映する (ブックマークで再現できるようにする)
function updateBedURL(app) {
  try {
    var v = app.bedShape === 'circle'
      ? 'circle:' + fmt(app.bed[0], 1) + 'x' + fmt(app.bed[2], 1)
      : fmt(app.bed[0], 1) + 'x' + fmt(app.bed[1], 1) + 'x' + fmt(app.bed[2], 1);
    var url = new URL(window.location.href);
    url.searchParams.set('bed', v);
    if (app.gridStep !== 10) url.searchParams.set('grid', fmt(app.gridStep, 1));
    else url.searchParams.delete('grid');
    window.history.replaceState(null, '', url.toString());
  } catch (e) { /* file:// などで失敗する場合は無視する */ }
}

function applyBedFromURL(app) {
  try {
    var params = new URLSearchParams(window.location.search);
    var bed = params.get('bed');
    if (bed) {
      var circle = /^circle:/i.test(bed);
      var nums = bed.replace(/^circle:/i, '').split(/[x,]/).map(parseFloat).filter(function (n) { return isFinite(n) && n > 0; });
      if (circle && nums.length >= 1) {
        app.bedShape = 'circle';
        app.bed = [nums[0], nums[0], nums[1] || app.bed[2]];
      } else if (nums.length >= 2) {
        app.bedShape = 'rect';
        app.bed = [nums[0], nums[1], nums[2] || app.bed[2]];
      }
    }
    var grid = parseFloat(params.get('grid'));
    if (isFinite(grid) && grid > 0) app.gridStep = clamp(grid, 0.5, 500);
  } catch (e) { /* 解析できない場合は既定値のまま */ }
}
