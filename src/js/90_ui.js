// ---------------------------------------------------------------------------
// UI 配線
// ---------------------------------------------------------------------------

var PRINTERS = [
  { name: '汎用 220 x 220 x 250', bed: [220, 220, 250] },
  { name: 'Ender 3 系 (235 x 235 x 250)', bed: [235, 235, 250] },
  { name: 'Prusa MK3/MK4 (250 x 210 x 210)', bed: [250, 210, 210] },
  { name: 'Bambu X1/P1 (256 x 256 x 256)', bed: [256, 256, 256] },
  { name: 'Voron 2.4 350 (350 x 350 x 340)', bed: [350, 350, 340] },
  { name: '光造形 (143 x 89 x 175)', bed: [143, 89, 175] },
  { name: 'デルタ φ180 x 300', bed: [180, 180, 300], shape: 'circle' },
  { name: 'デルタ φ250 x 400', bed: [250, 250, 400], shape: 'circle' },
  { name: 'A4 相当の作業領域 (210 x 297)', bed: [210, 297, 200] }
];

function selectedPart(app) {
  if (!app.selection) return null;
  for (var i = 0; i < app.parts.length; i++) if (app.parts[i].id === app.selection) return app.parts[i];
  return null;
}

function requestRender(app) {
  if (app.renderPending) return;
  app.renderPending = true;
  requestAnimationFrame(function () {
    app.renderPending = false;
    try { renderFrame(app); } catch (e) { setStatus(app, '描画エラー: ' + e.message); }
  });
}

function setStatus(app, msg) { $('#status-msg').textContent = msg; }

function setBusy(app, msg) {
  var b = $('#busy');
  if (!msg) { b.hidden = true; return; }
  b.hidden = false;
  b.firstElementChild.textContent = msg;
}

// 重い処理の前に画面を更新させる
function withBusy(app, msg, fn) {
  setBusy(app, msg);
  setTimeout(function () {
    try { fn(); } catch (e) { setStatus(app, 'エラー: ' + e.message); }
    setBusy(app, null);
  }, 16);
}

// ---------------------------------------------------------------------------
// ファイル読み込み
// ---------------------------------------------------------------------------

function loadFiles(app, files) {
  var list = Array.prototype.slice.call(files).filter(function (f) { return /\.stl$/i.test(f.name) || f.type === 'model/stl'; });
  if (!list.length) { setStatus(app, 'STL ファイルが含まれていません。'); return; }
  var remaining = list.length;
  setBusy(app, '読み込み中...');
  list.forEach(function (file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = parseSTL(reader.result);
        if (parsed.triangleCount === 0) throw new Error('三角形が 0 個です');
        var part = createPart(file.name.replace(/\.stl$/i, ''), parsed.positions, file.size, parsed.format);
        app.parts.push(part);
        centerPartOnBed(part, app.bed);
        if (app.parts.length > 1) arrangeParts(app.parts, app.bed, app.margin);
        app.selection = part.id;
        setStatus(app, part.name + ' を読み込みました (' + fmtInt(part.triangleCount) + ' 三角形, ' + parsed.format + ', ' + fmtBytes(file.size) + ')');
      } catch (e) {
        setStatus(app, file.name + ' の読み込みに失敗しました: ' + e.message);
      }
      remaining--;
      if (remaining === 0) {
        setBusy(app, null);
        fitView(app);
        refreshAll(app);
        var sb = sceneBounds(app.parts, true);
        if (sb) $('#in-slice-pos').value = fmt((sb.min[2] + sb.max[2]) / 2, 2);
      }
    };
    reader.onerror = function () {
      remaining--;
      setStatus(app, file.name + ' を読み込めませんでした。');
      if (remaining === 0) { setBusy(app, null); refreshAll(app); }
    };
    reader.readAsArrayBuffer(file);
  });
}

// ---------------------------------------------------------------------------
// 表示更新
// ---------------------------------------------------------------------------

function refreshAll(app) {
  refreshPartList(app);
  refreshDims(app);
  refreshQuality(app);
  refreshWarnings(app);
  refreshTransformInputs(app);
  updateClipRanges(app);
  updateHollowPlan(app);
  requestRender(app);
}

function refreshPartList(app) {
  var host = $('#part-list');
  host.innerHTML = '';
  $('#part-count').textContent = app.parts.length;
  $('#drop-hint').style.display = app.parts.length ? 'none' : '';
  app.parts.forEach(function (p) {
    var row = el('div', { class: 'part' + (app.selection === p.id ? ' selected' : '') + (p.visible ? '' : ' hidden-part') });
    var color = el('input', { type: 'color', value: rgbToHex(p.color), title: '色' });
    color.addEventListener('input', function (ev) {
      p.color = cssToRgb(ev.target.value);
      requestRender(app);
    });
    color.addEventListener('click', function (ev) { ev.stopPropagation(); });
    var vis = el('button', { class: 'vis', title: '表示 / 非表示', text: p.visible ? '◉' : '○' });
    vis.addEventListener('click', function (ev) {
      ev.stopPropagation();
      p.visible = !p.visible;
      refreshAll(app);
    });
    row.appendChild(color);
    row.appendChild(el('span', { class: 'nm', text: p.name }));
    row.appendChild(el('span', { class: 'tri', text: fmtInt(p.triangleCount) }));
    row.appendChild(vis);
    row.addEventListener('click', function () {
      app.selection = p.id;
      refreshAll(app);
    });
    host.appendChild(row);
  });
}

function targetBounds(app) {
  var p = selectedPart(app);
  if (p) return p.worldBounds;
  return sceneBounds(app.parts, true);
}

function refreshDims(app) {
  var p = selectedPart(app);
  var b = targetBounds(app);
  $('#measure-target').textContent = p ? p.name : 'シーン全体';
  var t = $('#tbl-dims');
  t.innerHTML = '';
  if (!b) { t.appendChild(kvRow('-', 'パーツがありません')); updateMass(app); return; }
  t.appendChild(kvRow('X 幅', fmt(b.size[0], 2) + ' mm'));
  t.appendChild(kvRow('Y 奥行', fmt(b.size[1], 2) + ' mm'));
  t.appendChild(kvRow('Z 高さ', fmt(b.size[2], 2) + ' mm'));
  t.appendChild(kvRow('対角', fmt(V3.len(b.size), 2) + ' mm'));
  t.appendChild(kvRow('X 範囲', fmt(b.min[0], 1) + ' … ' + fmt(b.max[0], 1)));
  t.appendChild(kvRow('Y 範囲', fmt(b.min[1], 1) + ' … ' + fmt(b.max[1], 1)));
  t.appendChild(kvRow('Z 範囲', fmt(b.min[2], 1) + ' … ' + fmt(b.max[2], 1)));
  var vol = 0, area = 0, tri = 0;
  var list = p ? [p] : app.parts.filter(function (x) { return x.visible; });
  list.forEach(function (x) { vol += partVolume(x); area += partArea(x); tri += x.triangleCount; });
  t.appendChild(kvRow('体積', fmt(vol / 1000, 3) + ' cm³', 'sec'));
  t.appendChild(kvRow('表面積', fmt(area / 100, 2) + ' cm²'));
  t.appendChild(kvRow('三角形数', fmtInt(tri)));
  if (p) {
    var c = M4.xformPoint([0, 0, 0], p.matrix, p.mass.centroid);
    t.appendChild(kvRow('重心', fmt(c[0], 1) + ', ' + fmt(c[1], 1) + ', ' + fmt(c[2], 1)));
  }
  updateMass(app);
}

function kvRow(k, v, cls, title) {
  var attrs = {};
  if (cls) attrs.class = cls;
  if (title) attrs.title = title;
  return el('tr', attrs, [el('td', { text: k }), el('td', { text: v })]);
}

function updateMass(app) {
  var p = selectedPart(app);
  var list = p ? [p] : app.parts.filter(function (x) { return x.visible; });
  var vol = 0;
  list.forEach(function (x) { vol += partVolume(x); });
  var mat = MATERIALS[parseInt($('#sel-material').value, 10) || 0];
  var infill = clamp(parseFloat($('#in-infill').value) || 100, 1, 100) / 100;
  var grams = vol / 1000 * mat.density * infill;
  $('#mass-out').textContent = fmt(grams, 1) + ' g (' + fmt(vol / 1000 * infill, 2) + ' cm³)';
}

function refreshQuality(app) {
  var t = $('#tbl-quality');
  t.innerHTML = '';
  var p = selectedPart(app);
  if (!p) {
    t.appendChild(kvRow('-', 'パーツを選択してください'));
    return;
  }
  var q = p.topology;
  t.appendChild(kvRow('形式', p.format + ' / ' + fmtBytes(p.fileSize || 0)));
  t.appendChild(kvRow('三角形数', fmtInt(p.triangleCount)));
  t.appendChild(kvRow('頂点数 (統合後)', fmtInt(p.vertexCount)));
  if (!q) { t.appendChild(kvRow('トポロジ', '解析できませんでした')); return; }
  t.appendChild(kvRow('シェル数', fmtInt(q.shells), q.shells > 1 ? 'warn' : ''));
  t.appendChild(kvRow('水密性', q.watertight ? '閉じている' : '開いている', q.watertight ? 'ok' : 'warn'));
  t.appendChild(kvRow('境界エッジ', fmtInt(q.boundaryEdges), q.boundaryEdges ? 'warn' : ''));
  t.appendChild(kvRow('非多様体エッジ', fmtInt(q.nonManifoldEdges), q.nonManifoldEdges ? 'warn' : ''));
  t.appendChild(kvRow('向き不整合エッジ', fmtInt(q.inconsistentEdges), q.inconsistentEdges ? 'warn' : ''));
  t.appendChild(kvRow('縮退三角形', fmtInt(q.degenerateTriangles), q.degenerateTriangles ? 'warn' : ''));
  if (p.normalsFlipped) t.appendChild(kvRow('法線', '内向きだったため反転', 'warn'));
}

function refreshWarnings(app) {
  var host = $('#warnings');
  var msgs = [];
  var bed = app.bed;
  app.parts.forEach(function (p) {
    if (!p.visible) return;
    var b = p.worldBounds;
    if (outsideBedXY(b, bed, app.bedShape)) {
      msgs.push('<span class="w">' + escapeHtml(p.name) + ': ステージ範囲外</span>');
    }
    if (b.max[2] > bed[2] + 0.01) {
      msgs.push('<span class="w">' + escapeHtml(p.name) + ': 造形高さ超過 (' + fmt(b.max[2], 1) + ' mm)</span>');
    }
    if (b.min[2] < -0.01) {
      msgs.push('<span class="w">' + escapeHtml(p.name) + ': プレート下に沈み込み (' + fmt(b.min[2], 2) + ' mm)</span>');
    }
    if (p.topology && !p.topology.watertight) {
      var q = p.topology;
      var reason = q.boundaryEdges
        ? 'メッシュに穴があります (境界エッジ ' + fmtInt(q.boundaryEdges) + ')'
        : (q.nonManifoldEdges
          ? '非多様体エッジが ' + fmtInt(q.nonManifoldEdges) + ' 本あります (体積は閉じており多くのスライサで扱えます)'
          : '面の向きが揃っていません');
      msgs.push('<span class="w">' + escapeHtml(p.name) + ': ' + reason + '</span>');
    }
    var thin = Math.min(b.size[0], b.size[1], b.size[2]);
    if (thin < 0.8) {
      msgs.push('<span class="w">' + escapeHtml(p.name) + ': 最小外形が ' + fmt(thin, 2) + ' mm (薄すぎる可能性)</span>');
    }
  });
  if (app.collisionResult) {
    app.collisionResult.forEach(function (c) {
      if (c.intersect) msgs.push('<span class="w">干渉: ' + escapeHtml(c.a.name) + ' ↔ ' + escapeHtml(c.b.name) + '</span>');
    });
  }
  host.innerHTML = msgs.length ? msgs.join('<br>') : (app.parts.length ? '<span class="g">問題は検出されていません</span>' : '-');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, function (c) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
  });
}

function refreshTransformInputs(app) {
  var p = selectedPart(app);
  if (!p) return;
  var e = Quat.toEulerDeg(p.quat);
  $('#in-eul-x').value = fmt(e[0], 1);
  $('#in-eul-y').value = fmt(e[1], 1);
  $('#in-eul-z').value = fmt(e[2], 1);
  $('#in-pos-x').value = fmt((p.worldBounds.min[0] + p.worldBounds.max[0]) / 2, 1);
  $('#in-pos-y').value = fmt((p.worldBounds.min[1] + p.worldBounds.max[1]) / 2, 1);
  $('#in-scale').value = fmt(p.scale[0] * 100, 2);
}

function fitView(app) {
  var b = sceneBounds(app.parts, true);
  if (!b) {
    b = { min: [0, 0, 0], max: [app.bed[0], app.bed[1], app.bed[2]], size: app.bed.slice() };
  }
  var center = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
  var h = Math.max(b.size[0], b.size[1], b.size[2]) * 1.6 + 10;
  app.orthoCam.center = center.slice();
  app.orthoCam.height = h;
  app.orbitCam.center = center.slice();
  app.orbitCam.height = h;
  requestRender(app);
}

// ---------------------------------------------------------------------------
// キャンバス操作
// ---------------------------------------------------------------------------

function viewportAt(app, cssX, cssY) {
  var dpr = app.R.dpr;
  var W = app.R.canvas.width, H = app.R.canvas.height;
  var px = cssX * dpr, py = cssY * dpr;
  var vps = computeViewports(app, W, H);
  for (var i = 0; i < vps.length; i++) {
    var r = vps[i].rect;
    var top = H - r.y - r.h;
    if (px >= r.x && px < r.x + r.w && py >= top && py < top + r.h) return vps[i];
  }
  return vps[0];
}

function setupCanvasInteraction(app) {
  var canvas = app.R.canvas;
  var drag = null;
  var pointers = new Map();
  var pinch = null;

  canvas.addEventListener('pointerdown', function (ev) {
    canvas.setPointerCapture(ev.pointerId);
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pointers.size === 2) {
      var pts = Array.from(pointers.values());
      pinch = { dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) };
      drag = null;
      return;
    }
    var rect = canvas.getBoundingClientRect();
    var vp = viewportAt(app, ev.clientX - rect.left, ev.clientY - rect.top);
    var pan = ev.button === 1 || ev.button === 2 || ev.shiftKey || vp.kind === 'ortho';
    drag = { vp: vp, x: ev.clientX, y: ev.clientY, moved: 0, pan: pan, startX: ev.clientX, startY: ev.clientY };
  });

  canvas.addEventListener('pointermove', function (ev) {
    if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pinch && pointers.size === 2) {
      var pts = Array.from(pointers.values());
      var d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (pinch.dist > 0) {
        var f = pinch.dist / Math.max(1, d);
        app.orthoCam.height = clamp(app.orthoCam.height * f, 1, 100000);
        app.orbitCam.height = clamp(app.orbitCam.height * f, 1, 100000);
        requestRender(app);
      }
      pinch.dist = d;
      return;
    }
    if (!drag) return;
    var dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
    drag.x = ev.clientX; drag.y = ev.clientY;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    var cam = drag.vp.kind === 'orbit' ? app.orbitCam : app.orthoCam;
    if (!drag.pan && drag.vp.kind === 'orbit') {
      app.orbitCam.yaw -= dx * 0.008;
      app.orbitCam.pitch = clamp(app.orbitCam.pitch + dy * 0.008, -1.553, 1.553);
    } else {
      var rectH = drag.vp.rect.h / app.R.dpr;
      var worldPerPx = cam.height / Math.max(1, rectH);
      if (drag.vp.kind === 'ortho') {
        var d2 = VIEW_DIRS[drag.vp.key];
        cam.center[d2.hAxis] -= dx * worldPerPx * d2.hSign;
        cam.center[d2.vAxis] += dy * worldPerPx * d2.vSign;
      } else {
        var ax = orbitAxes(cam);
        for (var k = 0; k < 3; k++) {
          cam.center[k] -= ax.right[k] * dx * worldPerPx;
          cam.center[k] += ax.up[k] * dy * worldPerPx;
        }
      }
    }
    requestRender(app);
  });

  function endPointer(ev) {
    pointers.delete(ev.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!drag) return;
    if (drag.moved < 5) handleClick(app, ev);
    drag = null;
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });

  canvas.addEventListener('wheel', function (ev) {
    ev.preventDefault();
    var rect = canvas.getBoundingClientRect();
    var vp = viewportAt(app, ev.clientX - rect.left, ev.clientY - rect.top);
    var cam = vp.kind === 'orbit' ? app.orbitCam : app.orthoCam;
    var factor = Math.exp(clamp(ev.deltaY, -120, 120) * 0.0016);
    var before = pointOnFocalPlane(app, vp, ev.clientX - rect.left, ev.clientY - rect.top);
    cam.height = clamp(cam.height * factor, 0.5, 200000);
    var after = pointOnFocalPlane(app, vp, ev.clientX - rect.left, ev.clientY - rect.top);
    if (before && after) {
      for (var k = 0; k < 3; k++) cam.center[k] += before[k] - after[k];
    }
    requestRender(app);
  }, { passive: false });

  // ダブルクリックで注視点を移動
  canvas.addEventListener('dblclick', function (ev) {
    var hit = pickAt(app, ev);
    if (hit) {
      app.orbitCam.center = hit.point.slice();
      app.orthoCam.center = hit.point.slice();
      requestRender(app);
    }
  });
}

// カーソル位置のワールド座標 (注視点を通る視線直交平面との交点)
function pointOnFocalPlane(app, vp, cssX, cssY) {
  if (!app.lastViewports) return null;
  var entry = null;
  for (var i = 0; i < app.lastViewports.length; i++) {
    if (app.lastViewports[i].vp.key === vp.key) entry = app.lastViewports[i];
  }
  if (!entry) return null;
  var dpr = app.R.dpr, H = app.R.canvas.height;
  var ray = screenToRay(entry.mats, entry.vp.rect, H, cssX * dpr, cssY * dpr);
  if (!ray) return null;
  var cam = vp.kind === 'orbit' ? app.orbitCam : app.orthoCam;
  var n;
  if (vp.kind === 'ortho') n = VIEW_DIRS[vp.key].dir;
  else n = V3.scale([0, 0, 0], orbitAxes(cam).fwd, -1);
  var denom = V3.dot(n, ray.dir);
  if (Math.abs(denom) < 1e-9) return null;
  var t = V3.dot(n, V3.sub([0, 0, 0], cam.center, ray.origin)) / denom;
  return [ray.origin[0] + ray.dir[0] * t, ray.origin[1] + ray.dir[1] * t, ray.origin[2] + ray.dir[2] * t];
}

function pickAt(app, ev) {
  if (!app.lastViewports) return null;
  var rect = app.R.canvas.getBoundingClientRect();
  var cssX = ev.clientX - rect.left, cssY = ev.clientY - rect.top;
  var vp = viewportAt(app, cssX, cssY);
  var entry = null;
  for (var i = 0; i < app.lastViewports.length; i++) {
    if (app.lastViewports[i].vp.key === vp.key) entry = app.lastViewports[i];
  }
  if (!entry) return null;
  var dpr = app.R.dpr, H = app.R.canvas.height;
  var ray = screenToRay(entry.mats, entry.vp.rect, H, cssX * dpr, cssY * dpr);
  if (!ray) return null;
  var best = null, bestD = Infinity;
  for (i = 0; i < app.parts.length; i++) {
    var p = app.parts[i];
    if (!p.visible) continue;
    var inv = M4.invert(M4.create(), p.matrix);
    if (!inv) continue;
    var o = M4.xformPoint([0, 0, 0], inv, ray.origin);
    var d = M4.xformDir([0, 0, 0], inv, ray.dir);
    var hit = raycastBVH(ensureBVH(p), p.positions, o, d);
    if (!hit) continue;
    var wp = M4.xformPoint([0, 0, 0], p.matrix, hit.point);
    var dist = V3.dist(wp, ray.origin);
    if (dist < bestD) {
      bestD = dist;
      best = { part: p, triangle: hit.triangle, point: wp, localPoint: hit.point };
    }
  }
  return best;
}

function handleClick(app, ev) {
  var hit = pickAt(app, ev);
  if (app.mode === 'lay') {
    if (hit) {
      layFaceOnBed(hit.part, hit.triangle);
      setMode(app, null);
      setStatus(app, '選択した面をビルドプレートに接地しました。');
      refreshAll(app);
    }
    return;
  }
  if (app.mode === 'measure') {
    if (hit) {
      var pt = snapToVertex(hit);
      app.measure.points.push(pt);
      if (app.measure.points.length > 2) app.measure.points = [pt];
      updateMeasureTable(app);
      requestRender(app);
    }
    return;
  }
  app.selection = hit ? hit.part.id : null;
  refreshAll(app);
}

// クリック点が三角形の頂点に近ければ頂点へスナップする
function snapToVertex(hit) {
  var p = hit.part, t = hit.triangle * 9;
  var verts = [];
  for (var k = 0; k < 3; k++) {
    verts.push(M4.xformPoint([0, 0, 0], p.matrix,
      [p.positions[t + k * 3], p.positions[t + k * 3 + 1], p.positions[t + k * 3 + 2]]));
  }
  var edge = Math.min(V3.dist(verts[0], verts[1]), V3.dist(verts[1], verts[2]), V3.dist(verts[2], verts[0]));
  var best = null, bd = Infinity;
  for (k = 0; k < 3; k++) {
    var d = V3.dist(verts[k], hit.point);
    if (d < bd) { bd = d; best = verts[k]; }
  }
  return (bd < edge * 0.25) ? best : hit.point;
}

function updateMeasureTable(app) {
  var t = $('#tbl-measure');
  t.innerHTML = '';
  var pts = app.measure.points;
  if (pts.length === 0) { t.appendChild(kvRow('-', 'モデル上を 2 点クリック')); return; }
  t.appendChild(kvRow('P1', pts[0].map(function (v) { return fmt(v, 2); }).join(', ')));
  if (pts.length < 2) { t.appendChild(kvRow('P2', '未指定')); return; }
  t.appendChild(kvRow('P2', pts[1].map(function (v) { return fmt(v, 2); }).join(', ')));
  var d = V3.sub([0, 0, 0], pts[1], pts[0]);
  t.appendChild(kvRow('ΔX / ΔY / ΔZ', fmt(Math.abs(d[0]), 2) + ' / ' + fmt(Math.abs(d[1]), 2) + ' / ' + fmt(Math.abs(d[2]), 2), 'sec'));
  t.appendChild(kvRow('距離', fmt(V3.len(d), 3) + ' mm'));
}

function setMode(app, mode) {
  app.mode = mode;
  var hint = $('#mode-hint');
  if (!mode) { hint.hidden = true; }
  else {
    hint.hidden = false;
    hint.textContent = mode === 'lay' ? 'ベッドに接地させる面をクリック (Esc で中止)' : '計測する 2 点をクリック (Esc で終了)';
  }
  $('#btn-measure').textContent = mode === 'measure' ? '計測を終了' : '計測を開始';
}
