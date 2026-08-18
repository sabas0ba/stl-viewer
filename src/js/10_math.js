// ---------------------------------------------------------------------------
// 線形代数 (column-major 4x4 行列、クォータニオン、ベクトル)
// WebGL と同じ column-major 配置: m[col*4 + row]
// ---------------------------------------------------------------------------

var M4 = {
  create: function () {
    return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  },
  identity: function (o) {
    o[0] = 1; o[1] = 0; o[2] = 0; o[3] = 0;
    o[4] = 0; o[5] = 1; o[6] = 0; o[7] = 0;
    o[8] = 0; o[9] = 0; o[10] = 1; o[11] = 0;
    o[12] = 0; o[13] = 0; o[14] = 0; o[15] = 1;
    return o;
  },
  copy: function (o, a) { for (var i = 0; i < 16; i++) o[i] = a[i]; return o; },
  // o = a * b (列ベクトル規約: 点 p に対し a*(b*p))
  mul: function (o, a, b) {
    var a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
    var a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    var a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
    var a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    for (var i = 0; i < 4; i++) {
      var b0 = b[i * 4], b1 = b[i * 4 + 1], b2 = b[i * 4 + 2], b3 = b[i * 4 + 3];
      o[i * 4] = a00 * b0 + a10 * b1 + a20 * b2 + a30 * b3;
      o[i * 4 + 1] = a01 * b0 + a11 * b1 + a21 * b2 + a31 * b3;
      o[i * 4 + 2] = a02 * b0 + a12 * b1 + a22 * b2 + a32 * b3;
      o[i * 4 + 3] = a03 * b0 + a13 * b1 + a23 * b2 + a33 * b3;
    }
    return o;
  },
  perspective: function (o, fovy, aspect, near, far) {
    var f = 1.0 / Math.tan(fovy / 2), nf = 1 / (near - far);
    M4.identity(o);
    o[0] = f / aspect; o[5] = f; o[10] = (far + near) * nf; o[11] = -1;
    o[14] = 2 * far * near * nf; o[15] = 0;
    return o;
  },
  ortho: function (o, l, r, b, t, n, f) {
    var lr = 1 / (l - r), bt = 1 / (b - t), nf = 1 / (n - f);
    M4.identity(o);
    o[0] = -2 * lr; o[5] = -2 * bt; o[10] = 2 * nf;
    o[12] = (l + r) * lr; o[13] = (t + b) * bt; o[14] = (f + n) * nf;
    return o;
  },
  lookAt: function (o, eye, center, up) {
    var z = V3.norm(V3.sub([0, 0, 0], eye, center));
    if (V3.len(z) < 1e-9) { z = [0, 0, 1]; }
    var x = V3.cross([0, 0, 0], up, z);
    if (V3.len(x) < 1e-9) {
      // up と視線が平行な場合は別の up を使う
      var alt = Math.abs(z[2]) > 0.9 ? [0, 1, 0] : [0, 0, 1];
      x = V3.cross([0, 0, 0], alt, z);
    }
    V3.norm(x);
    var y = V3.norm(V3.cross([0, 0, 0], z, x));
    o[0] = x[0]; o[1] = y[0]; o[2] = z[0]; o[3] = 0;
    o[4] = x[1]; o[5] = y[1]; o[6] = z[1]; o[7] = 0;
    o[8] = x[2]; o[9] = y[2]; o[10] = z[2]; o[11] = 0;
    o[12] = -V3.dot(x, eye); o[13] = -V3.dot(y, eye); o[14] = -V3.dot(z, eye); o[15] = 1;
    return o;
  },
  invert: function (o, m) {
    var a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
    var a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
    var a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
    var a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
    var b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10;
    var b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
    var b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
    var b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
    var b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31;
    var b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    var det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return null;
    det = 1.0 / det;
    o[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
    o[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    o[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
    o[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    o[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
    o[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    o[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
    o[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    o[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
    o[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    o[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
    o[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    o[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
    o[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    o[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
    o[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return o;
  },
  // 平行移動・回転(クォータニオン)・スケールから合成
  compose: function (o, pos, q, scl) {
    var x = q[0], y = q[1], z = q[2], w = q[3];
    var x2 = x + x, y2 = y + y, z2 = z + z;
    var xx = x * x2, xy = x * y2, xz = x * z2;
    var yy = y * y2, yz = y * z2, zz = z * z2;
    var wx = w * x2, wy = w * y2, wz = w * z2;
    var sx = scl[0], sy = scl[1], sz = scl[2];
    o[0] = (1 - (yy + zz)) * sx; o[1] = (xy + wz) * sx; o[2] = (xz - wy) * sx; o[3] = 0;
    o[4] = (xy - wz) * sy; o[5] = (1 - (xx + zz)) * sy; o[6] = (yz + wx) * sy; o[7] = 0;
    o[8] = (xz + wy) * sz; o[9] = (yz - wx) * sz; o[10] = (1 - (xx + yy)) * sz; o[11] = 0;
    o[12] = pos[0]; o[13] = pos[1]; o[14] = pos[2]; o[15] = 1;
    return o;
  },
  // 法線変換行列 (逆転置の 3x3) を 4x4 として返す
  normalMatrix: function (o, m) {
    var inv = M4.invert(M4.create(), m);
    if (!inv) return M4.identity(o);
    M4.identity(o);
    o[0] = inv[0]; o[1] = inv[4]; o[2] = inv[8];
    o[4] = inv[1]; o[5] = inv[5]; o[6] = inv[9];
    o[8] = inv[2]; o[9] = inv[6]; o[10] = inv[10];
    return o;
  },
  xformPoint: function (o, m, p) {
    var x = p[0], y = p[1], z = p[2];
    var w = m[3] * x + m[7] * y + m[11] * z + m[15];
    w = w || 1;
    o[0] = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
    o[1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
    o[2] = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w;
    return o;
  },
  xformDir: function (o, m, p) {
    var x = p[0], y = p[1], z = p[2];
    o[0] = m[0] * x + m[4] * y + m[8] * z;
    o[1] = m[1] * x + m[5] * y + m[9] * z;
    o[2] = m[2] * x + m[6] * y + m[10] * z;
    return o;
  }
};

var V3 = {
  add: function (o, a, b) { o[0] = a[0] + b[0]; o[1] = a[1] + b[1]; o[2] = a[2] + b[2]; return o; },
  sub: function (o, a, b) { o[0] = a[0] - b[0]; o[1] = a[1] - b[1]; o[2] = a[2] - b[2]; return o; },
  scale: function (o, a, s) { o[0] = a[0] * s; o[1] = a[1] * s; o[2] = a[2] * s; return o; },
  dot: function (a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; },
  cross: function (o, a, b) {
    var x = a[1] * b[2] - a[2] * b[1];
    var y = a[2] * b[0] - a[0] * b[2];
    var z = a[0] * b[1] - a[1] * b[0];
    o[0] = x; o[1] = y; o[2] = z; return o;
  },
  len: function (a) { return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]); },
  dist: function (a, b) { var x = a[0] - b[0], y = a[1] - b[1], z = a[2] - b[2]; return Math.sqrt(x * x + y * y + z * z); },
  norm: function (o, a) {
    if (a === undefined) a = o;
    var l = V3.len(a);
    if (l < 1e-12) { o[0] = 0; o[1] = 0; o[2] = 0; return o; }
    o[0] = a[0] / l; o[1] = a[1] / l; o[2] = a[2] / l; return o;
  },
  clone: function (a) { return [a[0], a[1], a[2]]; }
};

var Quat = {
  create: function () { return [0, 0, 0, 1]; },
  fromAxisAngle: function (axis, rad) {
    var a = V3.norm([0, 0, 0], axis), h = rad / 2, s = Math.sin(h);
    return [a[0] * s, a[1] * s, a[2] * s, Math.cos(h)];
  },
  mul: function (a, b) {
    var ax = a[0], ay = a[1], az = a[2], aw = a[3];
    var bx = b[0], by = b[1], bz = b[2], bw = b[3];
    return [
      aw * bx + ax * bw + ay * bz - az * by,
      aw * by - ax * bz + ay * bw + az * bx,
      aw * bz + ax * by - ay * bx + az * bw,
      aw * bw - ax * bx - ay * by - az * bz
    ];
  },
  norm: function (q) {
    var l = Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);
    if (l < 1e-12) return [0, 0, 0, 1];
    return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
  },
  // 単位ベクトル from を to へ向ける最小回転
  fromUnitVectors: function (from, to) {
    var f = V3.norm([0, 0, 0], from), t = V3.norm([0, 0, 0], to);
    var d = V3.dot(f, t);
    if (d > 1 - 1e-8) return [0, 0, 0, 1];
    if (d < -1 + 1e-8) {
      // 180 度回転: f に直交する任意軸
      var axis = Math.abs(f[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0];
      axis = V3.norm([0, 0, 0], V3.cross([0, 0, 0], f, axis));
      return [axis[0], axis[1], axis[2], 0];
    }
    var c = V3.cross([0, 0, 0], f, t);
    return Quat.norm([c[0], c[1], c[2], 1 + d]);
  },
  rotate: function (q, v) {
    var x = v[0], y = v[1], z = v[2];
    var qx = q[0], qy = q[1], qz = q[2], qw = q[3];
    var ix = qw * x + qy * z - qz * y;
    var iy = qw * y + qz * x - qx * z;
    var iz = qw * z + qx * y - qy * x;
    var iw = -qx * x - qy * y - qz * z;
    return [
      ix * qw + iw * -qx + iy * -qz - iz * -qy,
      iy * qw + iw * -qy + iz * -qx - ix * -qz,
      iz * qw + iw * -qz + ix * -qy - iy * -qx
    ];
  },
  // XYZ 内因性オイラー角 (度) へ変換 (表示用)
  toEulerDeg: function (q) {
    var x = q[0], y = q[1], z = q[2], w = q[3];
    var m11 = 1 - 2 * (y * y + z * z), m12 = 2 * (x * y - z * w), m13 = 2 * (x * z + y * w);
    var m22 = 1 - 2 * (x * x + z * z), m23 = 2 * (y * z - x * w);
    var m32 = 2 * (y * z + x * w), m33 = 1 - 2 * (x * x + y * y);
    var ey = Math.asin(clamp(m13, -1, 1));
    var ex, ez;
    if (Math.abs(m13) < 0.9999999) {
      ex = Math.atan2(-m23, m33);
      ez = Math.atan2(-m12, m11);
    } else {
      ex = Math.atan2(m32, m22);
      ez = 0;
    }
    var r = 180 / Math.PI;
    return [ex * r, ey * r, ez * r];
  },
  fromEulerDeg: function (e) {
    var r = Math.PI / 180;
    var qx = Quat.fromAxisAngle([1, 0, 0], e[0] * r);
    var qy = Quat.fromAxisAngle([0, 1, 0], e[1] * r);
    var qz = Quat.fromAxisAngle([0, 0, 1], e[2] * r);
    // R = Rx * Ry * Rz (toEulerDeg の抽出規約と一致させる)
    return Quat.norm(Quat.mul(Quat.mul(qx, qy), qz));
  }
};
