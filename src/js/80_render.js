// ---------------------------------------------------------------------------
// 描画
// ---------------------------------------------------------------------------

function initRenderer(canvas) {
  var gl = canvas.getContext('webgl2', {
    antialias: true, stencil: true, depth: true,
    preserveDrawingBuffer: true, powerPreference: 'high-performance'
  });
  if (!gl) throw new Error('WebGL2 を利用できません。対応ブラウザで開いてください。');
  var R = {
    gl: gl,
    canvas: canvas,
    mesh: createProgram(gl, MESH_VS, MESH_FS),
    line: createProgram(gl, LINE_VS, LINE_FS),
    cap: createProgram(gl, CAP_VS, CAP_FS),
    gridBuf: createDynamicLineBuffer(gl),
    boxBuf: createDynamicLineBuffer(gl),
    auxBuf: createDynamicLineBuffer(gl),
    capBuf: createDynamicLineBuffer(gl),
    dpr: 1
  };
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.disable(gl.CULL_FACE);
  return R;
}

function uploadPartGPU(R, part) {
  var gl = R.gl;
  if (part.gpu) return part.gpu;
  if (!part.normals) part.normals = buildFlatNormals(part.positions);
  var vao = gl.createVertexArray();
  var pbo = gl.createBuffer();
  var nbo = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, pbo);
  gl.bufferData(gl.ARRAY_BUFFER, part.positions, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, nbo);
  gl.bufferData(gl.ARRAY_BUFFER, part.normals, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  part.gpu = { vao: vao, pbo: pbo, nbo: nbo, count: part.positions.length / 3 };
  // GPU 転送後は展開済み法線を解放する (面法線は必要時に再計算)
  part.normals = null;
  return part.gpu;
}

function disposePartGPU(R, part) {
  if (!part.gpu) return;
  var gl = R.gl;
  gl.deleteVertexArray(part.gpu.vao);
  gl.deleteBuffer(part.gpu.pbo);
  gl.deleteBuffer(part.gpu.nbo);
  part.gpu = null;
}

// クリップ平面を vec4 配列 (法線 xyz, オフセット w) に変換する
function activeClipPlanes(app, excludeIndex) {
  var out = [];
  for (var i = 0; i < app.clips.length; i++) {
    var c = app.clips[i];
    if (!c.enabled) continue;
    if (excludeIndex === i) continue;
    var n = [0, 0, 0];
    n[c.axis] = c.invert ? -1 : 1;
    var d = c.invert ? c.value : -c.value;
    out.push([n[0], n[1], n[2], d]);
  }
  return out;
}

function clipUniformArray(planes) {
  var arr = new Float32Array(24);
  for (var i = 0; i < planes.length && i < 6; i++) {
    arr[i * 4] = planes[i][0]; arr[i * 4 + 1] = planes[i][1];
    arr[i * 4 + 2] = planes[i][2]; arr[i * 4 + 3] = planes[i][3];
  }
  return arr;
}

// ステージのグリッド線。円形ステージでは円内に収まる範囲のみ引く
function buildGridLines(bed, step, shape) {
  var v = [];
  var s = step > 0 ? step : 10;
  // 線数が過大にならないよう間隔を自動調整する
  var maxLines = 400;
  while ((bed[0] / s + bed[1] / s) > maxLines) s *= 2;
  var strongEvery = s * 5;
  var i;
  var circle = shape === 'circle';
  var r = bed[0] / 2, cx = bed[0] / 2, cy = bed[1] / 2;
  function spanY(x) {
    if (!circle) return [0, bed[1]];
    var dx = x - cx;
    if (Math.abs(dx) >= r) return null;
    var h = Math.sqrt(r * r - dx * dx);
    return [cy - h, cy + h];
  }
  function spanX(y) {
    if (!circle) return [0, bed[0]];
    var dy = y - cy;
    if (Math.abs(dy) >= r) return null;
    var h = Math.sqrt(r * r - dy * dy);
    return [cx - h, cx + h];
  }
  for (i = 0; i <= bed[0] + 1e-6; i += s) {
    var sy = spanY(i);
    if (!sy) continue;
    var strong = Math.abs(i % strongEvery) < 1e-6;
    v.push(i, sy[0], 0, i, sy[1], 0);
    if (strong) { /* 太線の代替として二重線を引く */ v.push(i + 0.15, sy[0], 0, i + 0.15, sy[1], 0); }
  }
  for (i = 0; i <= bed[1] + 1e-6; i += s) {
    var sx = spanX(i);
    if (!sx) continue;
    var strong2 = Math.abs(i % strongEvery) < 1e-6;
    v.push(sx[0], i, 0, sx[1], i, 0);
    if (strong2) { v.push(sx[0], i + 0.15, 0, sx[1], i + 0.15, 0); }
  }
  return new Float32Array(v);
}

// 円形ステージの造形可能領域 (円柱) の輪郭
function buildCylinderLines(bed, segments) {
  var n = segments || 72;
  var r = bed[0] / 2, cx = bed[0] / 2, cy = bed[1] / 2, h = bed[2];
  var v = [];
  for (var i = 0; i < n; i++) {
    var a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    var x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
    var x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    v.push(x0, y0, 0, x1, y1, 0);
    v.push(x0, y0, h, x1, y1, h);
  }
  for (var k = 0; k < 4; k++) {
    var a = (k / 4) * Math.PI * 2;
    var x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
    v.push(x, y, 0, x, y, h);
  }
  return v;
}

function buildBoxLines(min, max, out) {
  var v = out || [];
  var c = [
    [min[0], min[1], min[2]], [max[0], min[1], min[2]], [max[0], max[1], min[2]], [min[0], max[1], min[2]],
    [min[0], min[1], max[2]], [max[0], min[1], max[2]], [max[0], max[1], max[2]], [min[0], max[1], max[2]]
  ];
  var e = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
  for (var i = 0; i < e.length; i++) {
    var a = c[e[i][0]], b = c[e[i][1]];
    v.push(a[0], a[1], a[2], b[0], b[1], b[2]);
  }
  return v;
}

function computeViewports(app, W, H) {
  if (app.layout === 'quad') {
    var hw = Math.floor(W / 2), hh = Math.floor(H / 2);
    // GL のビューポートは左下原点。JIS 第三角法: 左上=平面図, 左下=正面図, 右下=右側面図
    return [
      { key: 'top', kind: 'ortho', rect: { x: 0, y: hh, w: hw, h: H - hh } },
      { key: 'iso', kind: 'orbit', rect: { x: hw, y: hh, w: W - hw, h: H - hh } },
      { key: 'front', kind: 'ortho', rect: { x: 0, y: 0, w: hw, h: hh } },
      { key: 'right', kind: 'ortho', rect: { x: hw, y: 0, w: W - hw, h: hh } }
    ];
  }
  var v = app.singleView;
  return [{ key: v, kind: (v === 'iso' ? 'orbit' : 'ortho'), rect: { x: 0, y: 0, w: W, h: H } }];
}

function renderFrame(app) {
  var R = app.R, gl = R.gl;
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var cw = Math.max(1, Math.floor(R.canvas.clientWidth * dpr));
  var ch = Math.max(1, Math.floor(R.canvas.clientHeight * dpr));
  if (R.canvas.width !== cw || R.canvas.height !== ch) {
    R.canvas.width = cw; R.canvas.height = ch;
  }
  R.dpr = dpr;
  var sb = sceneBounds(app.parts, true);
  var radius = sb ? Math.max(V3.len(sb.size) / 2, 20) : Math.max(app.bed[0], app.bed[1]) / 2;
  if (app.showBed) radius = Math.max(radius, V3.len([app.bed[0], app.bed[1], app.bed[2]]) / 2);
  var vps = computeViewports(app, cw, ch);
  gl.enable(gl.SCISSOR_TEST);
  gl.clearColor(0.086, 0.094, 0.110, 1);
  var overlays = [];
  for (var i = 0; i < vps.length; i++) {
    var vp = vps[i];
    var cam = (vp.kind === 'orbit') ? app.orbitCam : app.orthoCam;
    gl.viewport(vp.rect.x, vp.rect.y, vp.rect.w, vp.rect.h);
    gl.scissor(vp.rect.x, vp.rect.y, vp.rect.w, vp.rect.h);
    gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    var mats = buildViewMatrices(vp, cam, radius);
    drawScene(app, vp, mats, sb);
    overlays.push({ vp: vp, mats: mats });
  }
  gl.disable(gl.SCISSOR_TEST);
  app.lastViewports = overlays;
  updateOverlay(app, overlays, cw, ch, dpr, sb);
}

function drawScene(app, vp, mats, sb) {
  var R = app.R, gl = R.gl;
  var planes = activeClipPlanes(app, -1);
  var clipArr = clipUniformArray(planes);

  // --- ベッドとグリッド ---
  if (app.showBed) {
    gl.useProgram(R.line.program);
    gl.uniformMatrix4fv(R.line.u.uMVP, false, mats.vp);
    if (!R.gridDirty && R.gridBuf.count > 0) { /* 再利用 */ } else {
      R.gridBuf.upload(buildGridLines(app.bed, app.gridStep, app.bedShape));
      R.gridDirty = false;
    }
    gl.uniform4f(R.line.u.uColor, 0.30, 0.34, 0.40, 1);
    gl.bindVertexArray(R.gridBuf.vao);
    gl.drawArrays(gl.LINES, 0, R.gridBuf.count);
    // 造形可能領域の枠
    var box = app.bedShape === 'circle'
      ? buildCylinderLines(app.bed)
      : buildBoxLines([0, 0, 0], [app.bed[0], app.bed[1], app.bed[2]]);
    R.boxBuf.upload(new Float32Array(box));
    gl.uniform4f(R.line.u.uColor, 0.45, 0.52, 0.62, 1);
    gl.bindVertexArray(R.boxBuf.vao);
    gl.drawArrays(gl.LINES, 0, R.boxBuf.count);
  }

  // --- メッシュ ---
  gl.useProgram(R.mesh.program);
  gl.uniform4fv(R.mesh.u.uClip, clipArr);
  gl.uniform1i(R.mesh.u.uClipCount, planes.length);
  gl.uniform1i(R.mesh.u.uShadeMode, app.shadeMode);
  gl.uniform1f(R.mesh.u.uOverhangSin, Math.sin(app.overhangDeg * Math.PI / 180));
  gl.uniform1f(R.mesh.u.uBedZ, 0);
  gl.uniform1f(R.mesh.u.uHeightMax, sb ? Math.max(sb.max[2], 1) : 1);
  var lightCenter = sb ? [(sb.min[0] + sb.max[0]) / 2, (sb.min[1] + sb.max[1]) / 2, (sb.min[2] + sb.max[2]) / 2]
    : [app.bed[0] / 2, app.bed[1] / 2, app.bed[2] / 2];
  var lightRadius = sb ? Math.max(V3.len(sb.size) / 2, 20) : Math.max(app.bed[0], app.bed[1]) / 2;
  var lightPos = [
    lightCenter[0] + app.light.position[0] * lightRadius,
    lightCenter[1] + app.light.position[1] * lightRadius,
    lightCenter[2] + app.light.position[2] * lightRadius
  ];
  gl.uniform3fv(R.mesh.u.uLightPos, lightPos);
  gl.uniform1f(R.mesh.u.uSceneRadius, lightRadius);
  gl.uniform1f(R.mesh.u.uLightStrength, app.light.strength);
  gl.uniform1f(R.mesh.u.uAmbientStrength, app.light.ambient);
  gl.uniform1f(R.mesh.u.uAoStrength, app.light.ao);
  gl.disable(gl.CULL_FACE);
  var transparent = [];
  var i;
  for (i = 0; i < app.parts.length; i++) {
    var part = app.parts[i];
    if (!part.visible) continue;
    var opacity = 1;
    if (app.ghostOthers && app.selection && part.id !== app.selection) opacity = 0.25;
    if (app.xray) opacity = Math.min(opacity, 0.35);
    if (opacity < 1) { transparent.push(part); continue; }
    drawPart(app, part, mats, 1);
  }
  if (transparent.length) {
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    for (i = 0; i < transparent.length; i++) {
      var op = app.xray ? 0.35 : 0.25;
      drawPart(app, transparent[i], mats, op);
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  // --- 断面キャップ ---
  for (i = 0; i < app.clips.length; i++) {
    if (!app.clips[i].enabled || !app.clips[i].cap) continue;
    drawSectionCap(app, i, mats, sb);
  }

  // --- 補助線 ---
  var aux = [];
  if (app.showBBox) {
    for (i = 0; i < app.parts.length; i++) {
      var p2 = app.parts[i];
      if (!p2.visible) continue;
      if (app.selection && p2.id !== app.selection) continue;
      buildBoxLines(p2.worldBounds.min, p2.worldBounds.max, aux);
    }
  }
  if (app.measure.points.length === 2) {
    var m0 = app.measure.points[0], m1 = app.measure.points[1];
    aux.push(m0[0], m0[1], m0[2], m1[0], m1[1], m1[2]);
    pushCrossMarks(aux, m0, 1.5);
    pushCrossMarks(aux, m1, 1.5);
  } else if (app.measure.points.length === 1) {
    pushCrossMarks(aux, app.measure.points[0], 1.5);
  }
  if (app.contourLines && app.contourLines.length) {
    for (i = 0; i < app.contourLines.length; i++) aux.push(app.contourLines[i]);
  }
  if (aux.length) {
    gl.useProgram(R.line.program);
    gl.uniformMatrix4fv(R.line.u.uMVP, false, mats.vp);
    gl.uniform4f(R.line.u.uColor, 0.98, 0.85, 0.35, 1);
    R.auxBuf.upload(new Float32Array(aux));
    gl.bindVertexArray(R.auxBuf.vao);
    gl.disable(gl.DEPTH_TEST);
    gl.drawArrays(gl.LINES, 0, R.auxBuf.count);
    gl.enable(gl.DEPTH_TEST);
  }
  if (app.showComponents) drawComponentBoxes(app, mats);
  gl.bindVertexArray(null);
}

function drawComponentBoxes(app, mats) {
  var R = app.R, gl = R.gl;
  gl.useProgram(R.line.program);
  gl.uniformMatrix4fv(R.line.u.uMVP, false, mats.vp);
  gl.bindVertexArray(R.boxBuf.vao);
  for (var i = 0; i < app.parts.length; i++) {
    var part = app.parts[i];
    if (!part.visible || !part.components || part.components.length < 2) continue;
    for (var j = 0; j < part.components.length; j++) {
      var c = part.components[j];
      var b = transformedBounds(c.localBounds, part.matrix);
      R.boxBuf.upload(new Float32Array(buildBoxLines(b.min, b.max)));
      if (c.floating) gl.uniform4f(R.line.u.uColor, 0.95, 0.25, 0.20, 1);
      else gl.uniform4f(R.line.u.uColor, 0.25, 0.75, 0.95, 1);
      gl.drawArrays(gl.LINES, 0, R.boxBuf.count);
    }
  }
}

function pushCrossMarks(arr, p, s) {
  arr.push(p[0] - s, p[1], p[2], p[0] + s, p[1], p[2]);
  arr.push(p[0], p[1] - s, p[2], p[0], p[1] + s, p[2]);
  arr.push(p[0], p[1], p[2] - s, p[0], p[1], p[2] + s);
}

function drawPart(app, part, mats, opacity) {
  var R = app.R, gl = R.gl;
  var gpu = uploadPartGPU(R, part);
  var mvp = M4.mul(M4.create(), mats.vp, part.matrix);
  var nrm = M4.normalMatrix(M4.create(), part.matrix);
  gl.uniformMatrix4fv(R.mesh.u.uMVP, false, mvp);
  gl.uniformMatrix4fv(R.mesh.u.uModel, false, part.matrix);
  gl.uniformMatrix4fv(R.mesh.u.uNormalMat, false, nrm);
  gl.uniform3fv(R.mesh.u.uColor, part.color);
  gl.uniform1f(R.mesh.u.uOpacity, opacity);
  gl.uniform1f(R.mesh.u.uSelected, app.selection === part.id ? 1 : 0);
  gl.bindVertexArray(gpu.vao);
  gl.drawArrays(gl.TRIANGLES, 0, gpu.count);
}

// ステンシルで断面を塞ぐ (中空・肉厚の確認用)
function drawSectionCap(app, clipIndex, mats, sb) {
  var R = app.R, gl = R.gl;
  var clip = app.clips[clipIndex];
  var allPlanes = activeClipPlanes(app, -1);
  var others = activeClipPlanes(app, clipIndex);

  gl.enable(gl.STENCIL_TEST);
  gl.clearStencil(0);
  gl.clear(gl.STENCIL_BUFFER_BIT); // 平面ごとにカウントをリセットする
  gl.colorMask(false, false, false, false);
  gl.depthMask(false);
  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.CULL_FACE);
  gl.stencilFunc(gl.ALWAYS, 0, 0xff);

  gl.useProgram(R.mesh.program);
  gl.uniform4fv(R.mesh.u.uClip, clipUniformArray(allPlanes));
  gl.uniform1i(R.mesh.u.uClipCount, allPlanes.length);
  gl.uniform1f(R.mesh.u.uOpacity, 1);

  var i;
  gl.cullFace(gl.FRONT);
  gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR_WRAP);
  for (i = 0; i < app.parts.length; i++) if (app.parts[i].visible) drawPart(app, app.parts[i], mats, 1);
  gl.cullFace(gl.BACK);
  gl.stencilOp(gl.KEEP, gl.KEEP, gl.DECR_WRAP);
  for (i = 0; i < app.parts.length; i++) if (app.parts[i].visible) drawPart(app, app.parts[i], mats, 1);

  gl.colorMask(true, true, true, true);
  gl.depthMask(true);
  gl.enable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  gl.stencilFunc(gl.NOTEQUAL, 0, 0xff);
  gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);

  // 平面上の大きな四角形を描く
  var n = [0, 0, 0];
  n[clip.axis] = clip.invert ? -1 : 1;
  var center = [0, 0, 0];
  if (sb) { for (i = 0; i < 3; i++) center[i] = (sb.min[i] + sb.max[i]) / 2; }
  center[clip.axis] = clip.value;
  var radius = sb ? V3.len(sb.size) : 200;
  var a = Math.abs(n[0]) > 0.5 ? [0, 1, 0] : [1, 0, 0];
  var u = V3.norm([0, 0, 0], V3.cross([0, 0, 0], n, a));
  var v = V3.norm([0, 0, 0], V3.cross([0, 0, 0], n, u));
  var quad = [];
  var corners = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];
  for (i = 0; i < corners.length; i++) {
    var cu = corners[i][0] * radius, cv = corners[i][1] * radius;
    quad.push(center[0] + u[0] * cu + v[0] * cv, center[1] + u[1] * cu + v[1] * cv, center[2] + u[2] * cu + v[2] * cv);
  }
  R.capBuf.upload(new Float32Array(quad));
  gl.useProgram(R.cap.program);
  gl.uniformMatrix4fv(R.cap.u.uMVP, false, mats.vp);
  gl.uniform4fv(R.cap.u.uClip, clipUniformArray(others));
  gl.uniform1i(R.cap.u.uClipCount, others.length);
  gl.uniform3f(R.cap.u.uColor, 0.85, 0.42, 0.30);
  gl.bindVertexArray(R.capBuf.vao);
  gl.drawArrays(gl.TRIANGLES, 0, R.capBuf.count);
  gl.disable(gl.STENCIL_TEST);

  // メッシュ側の uniform を戻す
  gl.useProgram(R.mesh.program);
  var planes = activeClipPlanes(app, -1);
  gl.uniform4fv(R.mesh.u.uClip, clipUniformArray(planes));
  gl.uniform1i(R.mesh.u.uClipCount, planes.length);
}

// ---------------------------------------------------------------------------
// SVG オーバーレイ (寸法線・ビュー名・計測値)
// ---------------------------------------------------------------------------

var SVGNS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs) {
  var e = document.createElementNS(SVGNS, tag);
  for (var k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}

function updateOverlay(app, overlays, cw, ch, dpr, sb) {
  var svg = app.overlay;
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  svg.setAttribute('viewBox', '0 0 ' + (cw / dpr) + ' ' + (ch / dpr));
  var target = null;
  if (app.selection) {
    for (var i = 0; i < app.parts.length; i++) if (app.parts[i].id === app.selection) target = app.parts[i];
  }
  var dimBounds = target ? target.worldBounds : sb;

  for (var v = 0; v < overlays.length; v++) {
    var o = overlays[v];
    var rect = o.vp.rect;
    var cssRect = {
      x: rect.x / dpr,
      y: (ch - rect.y - rect.h) / dpr,
      w: rect.w / dpr,
      h: rect.h / dpr
    };
    if (overlays.length > 1) {
      svg.appendChild(svgEl('rect', {
        x: cssRect.x + 0.5, y: cssRect.y + 0.5, width: cssRect.w - 1, height: cssRect.h - 1,
        fill: 'none', stroke: 'rgba(255,255,255,0.10)', 'stroke-width': 1
      }));
    }
    var label = o.vp.kind === 'orbit' ? '等角図' : VIEW_DIRS[o.vp.key].name;
    var t = svgEl('text', { x: cssRect.x + 10, y: cssRect.y + 20, class: 'vp-label' });
    t.textContent = label + (o.vp.kind === 'ortho' ? ' (正投影)' : '');
    svg.appendChild(t);

    if (app.showDims && dimBounds) {
      if (o.vp.kind === 'ortho') drawOrthoDims(svg, app, o, cssRect, dimBounds, ch, dpr);
      else drawIsoDims(svg, app, o, cssRect, dimBounds, ch, dpr);
    }
    if (app.measure.points.length === 2) {
      var pA = projectToScreen(o.mats.vp, rect, ch, app.measure.points[0]);
      var pB = projectToScreen(o.mats.vp, rect, ch, app.measure.points[1]);
      if (pA && pB) {
        var mx = (pA[0] + pB[0]) / 2 / dpr, my = (pA[1] + pB[1]) / 2 / dpr;
        var d = V3.dist(app.measure.points[0], app.measure.points[1]);
        addLabel(svg, mx, my - 8, fmt(d, 3) + ' mm', 'dim-label measure-label');
      }
    }
    if (app.showComponents) {
      for (var pi = 0; pi < app.parts.length; pi++) {
        var cp = app.parts[pi];
        if (!cp.visible || !cp.components || cp.components.length < 2) continue;
        for (var ci = 0; ci < cp.components.length; ci++) {
          var cb = cp.components[ci].worldBounds;
          var center = [(cb.min[0] + cb.max[0]) / 2, (cb.min[1] + cb.max[1]) / 2, (cb.min[2] + cb.max[2]) / 2];
          var cs = projectToScreen(o.mats.vp, rect, ch, center);
          if (cs) addLabel(svg, cs[0] / dpr, cs[1] / dpr - 6, 'C' + cp.components[ci].id + (cp.components[ci].floating ? ' 浮遊' : ''),
            'component-label' + (cp.components[ci].floating ? ' floating' : ''));
        }
      }
    }
  }
}

function addLabel(svg, x, y, text, cls) {
  var g = svgEl('g', {});
  var t = svgEl('text', { x: x, y: y, class: cls || 'dim-label', 'text-anchor': 'middle' });
  t.textContent = text;
  g.appendChild(t);
  svg.appendChild(g);
  return t;
}

function dimLine(svg, x1, y1, x2, y2, cls) {
  svg.appendChild(svgEl('line', { x1: x1, y1: y1, x2: x2, y2: y2, class: cls || 'dim-line' }));
}

// 正投影ビューでの寸法記入 (水平軸・垂直軸)
function drawOrthoDims(svg, app, o, cssRect, b, canvasH, dpr) {
  var d = VIEW_DIRS[o.vp.key];
  var corners = [];
  for (var i = 0; i < 8; i++) {
    corners.push([
      (i & 1) ? b.max[0] : b.min[0],
      (i & 2) ? b.max[1] : b.min[1],
      (i & 4) ? b.max[2] : b.min[2]
    ]);
  }
  var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (i = 0; i < 8; i++) {
    var s = projectToScreen(o.mats.vp, o.vp.rect, canvasH, corners[i]);
    if (!s) continue;
    var sx = s[0] / dpr, sy = s[1] / dpr;
    if (sx < minX) minX = sx; if (sx > maxX) maxX = sx;
    if (sy < minY) minY = sy; if (sy > maxY) maxY = sy;
  }
  if (!isFinite(minX)) return;
  var pad = 18;
  var hVal = b.size[d.hAxis], vVal = b.size[d.vAxis];
  var axisName = ['X', 'Y', 'Z'];
  // 水平寸法 (下側)
  var yLine = Math.min(maxY + pad, cssRect.y + cssRect.h - 14);
  dimLine(svg, minX, yLine, maxX, yLine);
  dimLine(svg, minX, maxY + 3, minX, yLine + 4, 'dim-ext');
  dimLine(svg, maxX, maxY + 3, maxX, yLine + 4, 'dim-ext');
  addLabel(svg, (minX + maxX) / 2, yLine - 5, axisName[d.hAxis] + ' ' + fmt(hVal, 2) + ' mm');
  // 垂直寸法 (左側)
  var xLine = Math.max(minX - pad, cssRect.x + 34);
  dimLine(svg, xLine, minY, xLine, maxY);
  dimLine(svg, minX - 3, minY, xLine - 4, minY, 'dim-ext');
  dimLine(svg, minX - 3, maxY, xLine - 4, maxY, 'dim-ext');
  var vl = svgEl('text', {
    x: xLine - 6, y: (minY + maxY) / 2, class: 'dim-label', 'text-anchor': 'middle',
    transform: 'rotate(-90 ' + (xLine - 6) + ',' + ((minY + maxY) / 2) + ')'
  });
  vl.textContent = axisName[d.vAxis] + ' ' + fmt(vVal, 2) + ' mm';
  svg.appendChild(vl);
}

// 等角図では各辺の中点にサイズを表示する
function drawIsoDims(svg, app, o, cssRect, b, canvasH, dpr) {
  var origin = [b.min[0], b.min[1], b.min[2]];
  var axes = [
    { p: [b.max[0], b.min[1], b.min[2]], label: 'X ' + fmt(b.size[0], 2) },
    { p: [b.min[0], b.max[1], b.min[2]], label: 'Y ' + fmt(b.size[1], 2) },
    { p: [b.min[0], b.min[1], b.max[2]], label: 'Z ' + fmt(b.size[2], 2) }
  ];
  for (var i = 0; i < axes.length; i++) {
    var mid = [(origin[0] + axes[i].p[0]) / 2, (origin[1] + axes[i].p[1]) / 2, (origin[2] + axes[i].p[2]) / 2];
    var s = projectToScreen(o.mats.vp, o.vp.rect, canvasH, mid);
    if (!s) continue;
    addLabel(svg, s[0] / dpr, s[1] / dpr - 4, axes[i].label);
  }
}
