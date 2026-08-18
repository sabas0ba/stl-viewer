// ---------------------------------------------------------------------------
// カメラとビューポート
// 3 面図は JIS 第三角法の配置 (左上: 平面図 / 左下: 正面図 / 右下: 右側面図)
// 3 つの正投影ビューは中心と縮尺を共有し、投影図として整合させる
// ---------------------------------------------------------------------------

var VIEW_DIRS = {
  front: { name: '正面図', dir: [0, -1, 0], up: [0, 0, 1], hAxis: 0, vAxis: 2, hSign: 1, vSign: 1 },
  back: { name: '背面図', dir: [0, 1, 0], up: [0, 0, 1], hAxis: 0, vAxis: 2, hSign: -1, vSign: 1 },
  right: { name: '右側面図', dir: [1, 0, 0], up: [0, 0, 1], hAxis: 1, vAxis: 2, hSign: 1, vSign: 1 },
  left: { name: '左側面図', dir: [-1, 0, 0], up: [0, 0, 1], hAxis: 1, vAxis: 2, hSign: -1, vSign: 1 },
  top: { name: '平面図', dir: [0, 0, 1], up: [0, 1, 0], hAxis: 0, vAxis: 1, hSign: 1, vSign: 1 },
  bottom: { name: '底面図', dir: [0, 0, -1], up: [0, 1, 0], hAxis: 0, vAxis: 1, hSign: -1, vSign: 1 }
};

function makeOrbitCamera() {
  return { yaw: -55 * Math.PI / 180, pitch: 28 * Math.PI / 180, center: [0, 0, 0], height: 240, persp: true, fov: 35 * Math.PI / 180 };
}

function orbitEye(cam, radius) {
  var d = radius;
  var cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  return [
    cam.center[0] + Math.cos(cam.yaw) * cp * d,
    cam.center[1] + Math.sin(cam.yaw) * cp * d,
    cam.center[2] + sp * d
  ];
}

function orbitAxes(cam) {
  var cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  var fwd = [-Math.cos(cam.yaw) * cp, -Math.sin(cam.yaw) * cp, -sp];
  var right = V3.norm([0, 0, 0], V3.cross([0, 0, 0], fwd, [0, 0, 1]));
  var up = V3.norm([0, 0, 0], V3.cross([0, 0, 0], right, fwd));
  return { fwd: fwd, right: right, up: up };
}

// ビューポートの view/proj を構築する
// vp: {kind:'ortho'|'orbit', key:'front'|..., rect:{x,y,w,h}}
function buildViewMatrices(vp, cam, sceneRadius) {
  var view = M4.create(), proj = M4.create();
  var aspect = vp.rect.w / Math.max(1, vp.rect.h);
  var R = Math.max(sceneRadius, 1);
  var dist = R * 6 + 100;
  if (vp.kind === 'orbit' && cam.persp) {
    // 透視投影では注視点での見かけの高さが cam.height になる距離を用いる
    dist = Math.max((cam.height / 2) / Math.tan(cam.fov / 2), R * 1.2 + 10);
  }
  if (vp.kind === 'ortho') {
    var d = VIEW_DIRS[vp.key];
    var eye = [cam.center[0] + d.dir[0] * dist, cam.center[1] + d.dir[1] * dist, cam.center[2] + d.dir[2] * dist];
    M4.lookAt(view, eye, cam.center, d.up);
    var h = cam.height / 2, w = h * aspect;
    M4.ortho(proj, -w, w, -h, h, 0.01, dist * 2 + R * 4);
  } else {
    var eye2 = orbitEye(cam, dist);
    M4.lookAt(view, eye2, cam.center, [0, 0, 1]);
    if (cam.persp) {
      M4.perspective(proj, cam.fov, aspect, Math.max(0.5, dist - R * 3), dist + R * 8);
    } else {
      var h2 = cam.height / 2, w2 = h2 * aspect;
      M4.ortho(proj, -w2, w2, -h2, h2, 0.01, dist * 2 + R * 4);
    }
  }
  var vpm = M4.mul(M4.create(), proj, view);
  return { view: view, proj: proj, vp: vpm, eye: vp.kind === 'ortho' ? null : orbitEye(cam, dist), dist: dist };
}

// ワールド座標 -> canvas ピクセル座標 (左上原点)
function projectToScreen(vpm, rect, canvasH, p) {
  var x = vpm[0] * p[0] + vpm[4] * p[1] + vpm[8] * p[2] + vpm[12];
  var y = vpm[1] * p[0] + vpm[5] * p[1] + vpm[9] * p[2] + vpm[13];
  var w = vpm[3] * p[0] + vpm[7] * p[1] + vpm[11] * p[2] + vpm[15];
  if (Math.abs(w) < 1e-9) return null;
  var ndcX = x / w, ndcY = y / w;
  return [
    rect.x + (ndcX * 0.5 + 0.5) * rect.w,
    (canvasH - rect.y - rect.h) + (1 - (ndcY * 0.5 + 0.5)) * rect.h
  ];
}

// canvas ピクセル座標 -> レイ (origin, dir)
function screenToRay(mats, rect, canvasH, px, py) {
  var inv = M4.invert(M4.create(), mats.vp);
  if (!inv) return null;
  var ndcX = ((px - rect.x) / rect.w) * 2 - 1;
  var yInView = py - (canvasH - rect.y - rect.h);
  var ndcY = (1 - (yInView / rect.h)) * 2 - 1;
  var pNear = M4.xformPoint([0, 0, 0], inv, [ndcX, ndcY, -1]);
  var pFar = M4.xformPoint([0, 0, 0], inv, [ndcX, ndcY, 1]);
  var dir = V3.norm([0, 0, 0], V3.sub([0, 0, 0], pFar, pNear));
  return { origin: pNear, dir: dir };
}
