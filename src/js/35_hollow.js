// ---------------------------------------------------------------------------
// 中抜き (印刷用のホロー化)
// 座標系はワールド (X 右 / Y 奥 / Z 上、単位 mm、Z=0 がビルドプレート面)。
//
//   1. 等方格子で符号付き距離場を作る
//      (表面近傍は三角形までの厳密距離、その外はチャンファ変換で伝播、
//       内外は X 方向の巻き数で判定する)
//   2. 壁厚・天面厚・底面厚・内部構造・抜き穴から「空洞」の場を組み立てる
//   3. surface nets で等値面を三角形化する
//
// 天面厚・底面厚・リブの向きは造形方向 (Z) に依存するため、すべてワールド座標で
// 扱う。パーツの姿勢を変えれば中抜き形状もそれに追従する。
// ---------------------------------------------------------------------------

function hollowDefaults() {
  return {
    wall: 2.0,          // 側壁の厚み (表面の法線方向) mm
    top: 2.0,           // 天面 (+Z 側) の厚み mm
    bottom: 2.0,        // 底面 (-Z 側) の厚み mm
    infill: 'none',     // 内部構造 'none' | 'grid' | 'gyroid'
    density: 0.15,      // 内部構造の体積率 (0-1)
    rib: 1.0,           // リブの厚み mm
    hole: 'none',       // 抜き穴 'none' | 'bottom' | 'top'
    holeDiameter: 4.0,  // 抜き穴の直径 mm
    holeCount: 2,       // 抜き穴の数
    mode: 'shell',      // 'shell' 外殻を保持 / 'rebuild' 全体を再構築
    voxel: 0,           // 格子間隔 mm (0 で自動)
    maxVoxels: 4200000, // 格子点数の上限 (超える場合は自動で粗くする)
    lineWidth: 0.4,     // 押出幅 (印刷可否の判定にのみ使う)
    layer: 0.2          // 層厚 (同上)
  };
}

// ワールド変換を適用した三角形列を返す (鏡映では頂点順序を入れ替えて表裏を保つ)
function transformPositions(positions, m) {
  var out = new Float32Array(positions.length);
  var det = m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) +
    m[8] * (m[1] * m[6] - m[2] * m[5]);
  var mirrored = det < 0;
  var tri = positions.length / 9;
  var p = [0, 0, 0];
  var order = mirrored ? [0, 2, 1] : [0, 1, 2];
  for (var i = 0; i < tri; i++) {
    var b = i * 9;
    for (var v = 0; v < 3; v++) {
      var s = order[v];
      M4.xformPoint(p, m, [positions[b + s * 3], positions[b + s * 3 + 1], positions[b + s * 3 + 2]]);
      out[b + v * 3] = p[0]; out[b + v * 3 + 1] = p[1]; out[b + v * 3 + 2] = p[2];
    }
  }
  return out;
}

// 内部構造の周期 (mm)。体積率が指定値になるようリブ間隔を決める
function infillPeriod(kind, rib, density) {
  var d = clamp(density, 0.01, 0.95);
  var t = Math.max(rib, 1e-3);
  if (kind === 'grid') {
    // 直交する 2 組の板の体積率は rho = 2u - u^2 (u = リブ厚 / 周期)
    return t / (1 - Math.sqrt(1 - d));
  }
  // ジャイロイドの体積率はおよそ 1.65 * リブ厚 / 周期 (近似式)
  return 1.65 * t / d;
}

// 格子間隔を決める。指定がなければ最小形状の 1/3 を目安とし、格子点数の上限で丸める
function chooseVoxelSize(size, opt) {
  var feature = Math.min(opt.wall, opt.top, opt.bottom);
  if (opt.infill !== 'none') feature = Math.min(feature, opt.rib);
  if (opt.hole !== 'none') feature = Math.min(feature, opt.holeDiameter / 2);
  var h = opt.voxel > 0 ? opt.voxel : Math.max(feature / 3, 1e-3);
  var maxN = Math.max(1000, opt.maxVoxels || 4200000);
  for (var i = 0; i < 400; i++) {
    var n = 1;
    for (var k = 0; k < 3; k++) n *= Math.ceil(size[k] / h) + 5;
    if (n <= maxN) break;
    h *= 1.05;
  }
  return h;
}

// 点と三角形の距離の二乗 (Ericson の領域判定)
function pointTriangleDist2(px, py, pz, ax, ay, az, bx, by, bz, cx, cy, cz) {
  var abx = bx - ax, aby = by - ay, abz = bz - az;
  var acx = cx - ax, acy = cy - ay, acz = cz - az;
  var apx = px - ax, apy = py - ay, apz = pz - az;
  var d1 = abx * apx + aby * apy + abz * apz;
  var d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return apx * apx + apy * apy + apz * apz;
  var bpx = px - bx, bpy = py - by, bpz = pz - bz;
  var d3 = abx * bpx + aby * bpy + abz * bpz;
  var d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return bpx * bpx + bpy * bpy + bpz * bpz;
  var cpx = px - cx, cpy = py - cy, cpz = pz - cz;
  var d5 = abx * cpx + aby * cpy + abz * cpz;
  var d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return cpx * cpx + cpy * cpy + cpz * cpz;
  var vc = d1 * d4 - d3 * d2, dx, dy, dz, t;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    t = d1 / (d1 - d3);
    dx = apx - abx * t; dy = apy - aby * t; dz = apz - abz * t;
    return dx * dx + dy * dy + dz * dz;
  }
  var vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    t = d2 / (d2 - d6);
    dx = apx - acx * t; dy = apy - acy * t; dz = apz - acz * t;
    return dx * dx + dy * dy + dz * dz;
  }
  var va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    t = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    dx = bpx - (cx - bx) * t; dy = bpy - (cy - by) * t; dz = bpz - (cz - bz) * t;
    return dx * dx + dy * dy + dz * dz;
  }
  var denom = 1 / (va + vb + vc);
  var v = vb * denom, w = vc * denom;
  dx = apx - (abx * v + acx * w);
  dy = apy - (aby * v + acy * w);
  dz = apz - (abz * v + acz * w);
  return dx * dx + dy * dy + dz * dz;
}

// 符号付き距離場を作る。sdf は内部が正、band を超える距離は band に丸める。
// 表面の近傍 (seed 帯) だけ三角形までの厳密距離を求め、そこから先はチャンファ変換で
// 伝播させる。厳密距離を band 全体で求めると三角形あたりの走査量が (band/h)^3 で
// 増えるため、格子を細かくするほど不利になる。
function buildSignedField(positions, h, band) {
  var b = computeBounds(positions);
  var nx = Math.ceil(b.size[0] / h) + 5;
  var ny = Math.ceil(b.size[1] / h) + 5;
  var nz = Math.ceil(b.size[2] / h) + 5;
  // 格子線がモデルの頂点や面と重なると内外判定が縮退するため、原点を僅かにずらす
  var ox = b.min[0] - h * 2.0137, oy = b.min[1] - h * 2.0219, oz = b.min[2] - h * 2.0331;
  var n = nx * ny * nz;
  var sdf = new Float32Array(n);
  var seed = h * 1.75;          // 厳密距離を求める帯の幅
  var seed2 = seed * seed;
  var far = band * 4;           // 未確定を表す値 (伝播後に band で頭打ちにする)
  var i, j, k, idx;
  for (i = 0; i < n; i++) sdf[i] = seed2;

  var tri = positions.length / 9;
  var strideY = nx, strideZ = nx * ny;
  for (var t = 0; t < tri; t++) {
    var p = t * 9;
    var ax = positions[p], ay = positions[p + 1], az = positions[p + 2];
    var bx = positions[p + 3], by = positions[p + 4], bz = positions[p + 5];
    var cx = positions[p + 6], cy = positions[p + 7], cz = positions[p + 8];
    var mnx = Math.min(ax, bx, cx), mxx = Math.max(ax, bx, cx);
    var mny = Math.min(ay, by, cy), mxy = Math.max(ay, by, cy);
    var mnz = Math.min(az, bz, cz), mxz = Math.max(az, bz, cz);
    var i0 = Math.max(0, Math.ceil((mnx - seed - ox) / h)), i1 = Math.min(nx - 1, Math.floor((mxx + seed - ox) / h));
    var j0 = Math.max(0, Math.ceil((mny - seed - oy) / h)), j1 = Math.min(ny - 1, Math.floor((mxy + seed - oy) / h));
    var k0 = Math.max(0, Math.ceil((mnz - seed - oz) / h)), k1 = Math.min(nz - 1, Math.floor((mxz + seed - oz) / h));
    for (k = k0; k <= k1; k++) {
      var z = oz + k * h;
      var dz = z < mnz ? mnz - z : (z > mxz ? z - mxz : 0);
      if (dz * dz > seed2) continue;
      for (j = j0; j <= j1; j++) {
        var y = oy + j * h;
        var dy2 = y < mny ? mny - y : (y > mxy ? y - mxy : 0);
        var rest = seed2 - dz * dz - dy2 * dy2;
        if (rest < 0) continue;
        var base = j * strideY + k * strideZ;
        for (i = i0; i <= i1; i++) {
          var x = ox + i * h;
          var dx2 = x < mnx ? mnx - x : (x > mxx ? x - mxx : 0);
          if (dx2 * dx2 > rest) continue;
          idx = base + i;
          var cur = sdf[idx];
          if (dx2 * dx2 + dy2 * dy2 + dz * dz >= cur) continue;
          var d = pointTriangleDist2(x, y, z, ax, ay, az, bx, by, bz, cx, cy, cz);
          if (d < cur) sdf[idx] = d;
        }
      }
    }
  }
  for (i = 0; i < n; i++) sdf[i] = sdf[i] >= seed2 ? far : Math.sqrt(sdf[i]);
  chamferPropagate(sdf, nx, ny, nz, h, band);

  // 内外判定: +X 方向の巻き数 (0 以外なら内部)。非水密メッシュでも破綻しにくい
  var delta = new Int16Array(n);
  for (t = 0; t < tri; t++) {
    var q = t * 9;
    var ay2 = positions[q + 1], az2 = positions[q + 2];
    var by2 = positions[q + 4], bz2 = positions[q + 5];
    var cy2 = positions[q + 7], cz2 = positions[q + 8];
    var e = (by2 - ay2) * (cz2 - az2) - (bz2 - az2) * (cy2 - ay2); // 法線の X 成分
    if (e === 0) continue;
    var sgn = e > 0 ? 1 : -1;
    var jj0 = Math.max(0, Math.ceil((Math.min(ay2, by2, cy2) - oy) / h));
    var jj1 = Math.min(ny - 1, Math.floor((Math.max(ay2, by2, cy2) - oy) / h));
    var kk0 = Math.max(0, Math.ceil((Math.min(az2, bz2, cz2) - oz) / h));
    var kk1 = Math.min(nz - 1, Math.floor((Math.max(az2, bz2, cz2) - oz) / h));
    var ax2 = positions[q], bx2 = positions[q + 3], cx2 = positions[q + 6];
    var inv = 1 / e;
    for (k = kk0; k <= kk1; k++) {
      var pz = oz + k * h;
      for (j = jj0; j <= jj1; j++) {
        var py = oy + j * h;
        // (y,z) 平面での重心座標
        var w0 = ((by2 - py) * (cz2 - pz) - (bz2 - pz) * (cy2 - py)) * inv;
        if (w0 < 0) continue;
        var w1 = ((cy2 - py) * (az2 - pz) - (cz2 - pz) * (ay2 - py)) * inv;
        if (w1 < 0) continue;
        var w2 = 1 - w0 - w1;
        if (w2 < 0) continue;
        var xc = ax2 * w0 + bx2 * w1 + cx2 * w2;
        var ic = Math.ceil((xc - ox) / h);
        if (ic >= nx) continue;
        if (ic < 0) ic = 0;
        delta[ic + j * strideY + k * strideZ] += sgn;
      }
    }
  }
  for (k = 0; k < nz; k++) {
    for (j = 0; j < ny; j++) {
      var row = j * strideY + k * strideZ;
      var wind = 0;
      for (i = 0; i < nx; i++) {
        wind += delta[row + i];
        if (wind === 0) sdf[row + i] = -sdf[row + i];
      }
    }
  }
  return {
    nx: nx, ny: ny, nz: nz, h: h, origin: [ox, oy, oz], sdf: sdf,
    bounds: b, band: band
  };
}

// 空洞の場を組み立てる (正の領域が空洞)
function buildCavityField(g, opt) {
  var nx = g.nx, ny = g.ny, nz = g.nz, h = g.h, sdf = g.sdf;
  var n = nx * ny * nz, strideY = nx, strideZ = nx * ny;
  var cav = new Float32Array(n);
  var i, j, k, idx;
  for (i = 0; i < n; i++) cav[i] = sdf[i] - opt.wall;

  // 造形方向の厚み: 上下それぞれで材料が続く距離を数え、天面厚・底面厚を確保する
  for (j = 0; j < ny; j++) {
    for (i = 0; i < nx; i++) {
      var col = i + j * strideY;
      var run = 0;
      for (k = 0; k < nz; k++) {
        idx = col + k * strideZ;
        run = sdf[idx] > 0 ? run + 1 : 0;
        var dDown = run * h - h / 2 - opt.bottom;
        if (dDown < cav[idx]) cav[idx] = dDown;
      }
      run = 0;
      for (k = nz - 1; k >= 0; k--) {
        idx = col + k * strideZ;
        run = sdf[idx] > 0 ? run + 1 : 0;
        var dUp = run * h - h / 2 - opt.top;
        if (dUp < cav[idx]) cav[idx] = dUp;
      }
    }
  }

  if (opt.infill === 'grid' || opt.infill === 'gyroid') {
    var period = infillPeriod(opt.infill, opt.rib, opt.density);
    var ox = g.origin[0], oy = g.origin[1], oz = g.origin[2];
    var cxm = (g.bounds.min[0] + g.bounds.max[0]) / 2;
    var cym = (g.bounds.min[1] + g.bounds.max[1]) / 2;
    var czm = (g.bounds.min[2] + g.bounds.max[2]) / 2;
    var half = opt.rib / 2;
    var a1 = new Float64Array(nx), a2 = new Float64Array(ny), a3 = new Float64Array(nz);
    var b1 = new Float64Array(nx), b2 = new Float64Array(ny), b3 = new Float64Array(nz);
    if (opt.infill === 'grid') {
      // 直交する縦壁。造形方向に垂直な板を作らないため支持なしで積める
      for (i = 0; i < nx; i++) a1[i] = ribDistance(ox + i * h - cxm, period);
      for (j = 0; j < ny; j++) a2[j] = ribDistance(oy + j * h - cym, period);
      for (k = 0; k < nz; k++) {
        var kz = k * strideZ;
        for (j = 0; j < ny; j++) {
          var jb = kz + j * strideY, dyr = a2[j];
          for (i = 0; i < nx; i++) {
            var dr = a1[i] < dyr ? a1[i] : dyr;
            var v = dr - half;
            if (v < cav[jb + i]) cav[jb + i] = v;
          }
        }
      }
    } else {
      // ジャイロイド: g = sin x cos y + sin y cos z + sin z cos x
      var kw = 2 * Math.PI / period;
      var w = kw * opt.rib / 2;
      for (i = 0; i < nx; i++) { a1[i] = Math.sin((ox + i * h - cxm) * kw); b1[i] = Math.cos((ox + i * h - cxm) * kw); }
      for (j = 0; j < ny; j++) { a2[j] = Math.sin((oy + j * h - cym) * kw); b2[j] = Math.cos((oy + j * h - cym) * kw); }
      for (k = 0; k < nz; k++) { a3[k] = Math.sin((oz + k * h - czm) * kw); b3[k] = Math.cos((oz + k * h - czm) * kw); }
      for (k = 0; k < nz; k++) {
        var sz = a3[k], cz = b3[k], kz2 = k * strideZ;
        for (j = 0; j < ny; j++) {
          var sy = a2[j], cy = b2[j], jb2 = kz2 + j * strideY;
          var syz = sy * cz;
          for (i = 0; i < nx; i++) {
            var gv = a1[i] * cy + syz + sz * b1[i];
            if (gv < 0) gv = -gv;
            var v2 = (gv - w) / kw; // 勾配で割っておよその距離に直す
            if (v2 < cav[jb2 + i]) cav[jb2 + i] = v2;
          }
        }
      }
    }
  }
  return cav;
}

// 周期 period の平面群までの距離
function ribDistance(x, period) {
  var m = x % period;
  if (m < 0) m += period;
  return Math.min(m, period - m);
}

// 抜き穴の位置を選ぶ。空洞へ確実に貫通する柱だけを候補にする
function pickDrainHoles(g, cav, opt) {
  var nx = g.nx, ny = g.ny, nz = g.nz, h = g.h;
  var strideY = nx, strideZ = nx * ny;
  var fromBottom = opt.hole !== 'top';
  var r = Math.max(opt.holeDiameter / 2, h);
  var rv = Math.ceil(r / h);
  var want = clamp(Math.round(opt.holeCount) || 1, 1, 20);
  var edge = new Int32Array(nx * ny);
  var cands = [];
  var i, j, k;
  for (j = 0; j < ny; j++) {
    for (i = 0; i < nx; i++) {
      var col = i + j * strideY, found = -1;
      if (fromBottom) {
        for (k = 0; k < nz; k++) if (cav[col + k * strideZ] > 0) { found = k; break; }
      } else {
        for (k = nz - 1; k >= 0; k--) if (cav[col + k * strideZ] > 0) { found = k; break; }
      }
      edge[col] = found;
      if (found >= 0) cands.push(col);
    }
  }
  if (!cands.length) return [];
  // 到達距離が短い順、同じなら中央に近い順 (端に寄せると壁を斜めに抜けやすい)
  var mx = (nx - 1) / 2, my = (ny - 1) / 2;
  function centerDist2(col) {
    var di = (col % strideY) - mx, dj = ((col / strideY) | 0) - my;
    return di * di + dj * dj;
  }
  cands.sort(function (a, b) {
    var d = fromBottom ? edge[a] - edge[b] : edge[b] - edge[a];
    if (d !== 0) return d;
    return centerDist2(a) - centerDist2(b);
  });
  var picked = [];
  var minSep = r * 2 + 2;
  for (var c = 0; c < cands.length && picked.length < want; c++) {
    var ci = cands[c] % strideY, cj = (cands[c] / strideY) | 0;
    var x = g.origin[0] + ci * h, y = g.origin[1] + cj * h;
    var ok = true;
    for (var q = 0; q < picked.length; q++) {
      if (Math.hypot(x - picked[q].x, y - picked[q].y) < minSep) { ok = false; break; }
    }
    if (!ok) continue;
    // 穴の断面すべてが空洞に達しているかを確認し、最も奥の位置を穴の到達点にする
    var limit = edge[cands[c]];
    for (var dj = -rv; dj <= rv && ok; dj++) {
      for (var di = -rv; di <= rv; di++) {
        if (di * di + dj * dj > rv * rv) continue;
        var ii = ci + di, jj = cj + dj;
        if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) { ok = false; break; }
        var e = edge[ii + jj * strideY];
        if (e < 0) { ok = false; break; }
        if (fromBottom ? e > limit : e < limit) limit = e;
      }
    }
    if (!ok) continue;
    picked.push({
      x: x, y: y, r: r,
      z: g.origin[2] + limit * h + (fromBottom ? h : -h),
      fromBottom: fromBottom
    });
  }
  return picked;
}

// 材料の場 (正の領域が樹脂)。外形・空洞・抜き穴の積で表す
function buildMaterialField(g, cav, holes) {
  var nx = g.nx, ny = g.ny, nz = g.nz, h = g.h, sdf = g.sdf;
  var n = nx * ny * nz, strideY = nx, strideZ = nx * ny;
  var mat = new Float32Array(n);
  var i;
  for (i = 0; i < n; i++) mat[i] = Math.min(sdf[i], -cav[i]);
  for (var q = 0; q < holes.length; q++) {
    var hl = holes[q];
    var i0 = Math.max(0, Math.floor((hl.x - hl.r - g.origin[0]) / h));
    var i1 = Math.min(nx - 1, Math.ceil((hl.x + hl.r - g.origin[0]) / h));
    var j0 = Math.max(0, Math.floor((hl.y - hl.r - g.origin[1]) / h));
    var j1 = Math.min(ny - 1, Math.ceil((hl.y + hl.r - g.origin[1]) / h));
    for (var k = 0; k < nz; k++) {
      var z = g.origin[2] + k * h;
      var dz = hl.fromBottom ? hl.z - z : z - hl.z;
      if (dz < -hl.r) continue;
      for (var j = j0; j <= j1; j++) {
        var dy = g.origin[1] + j * h - hl.y;
        for (i = i0; i <= i1; i++) {
          var dx = g.origin[0] + i * h - hl.x;
          var v = Math.min(hl.r - Math.sqrt(dx * dx + dy * dy), dz);
          var idx = i + j * strideY + k * strideZ;
          if (-v < mat[idx]) mat[idx] = -v;
        }
      }
    }
  }
  return mat;
}

// 距離のチャンファ変換。seed 帯の厳密距離から外側へ伝播させ、
// band で頭打ちにする。格子の最外周は必ずモデルの外側にあり、符号は巻き数で別に決めるため
// 走査から除外してよい (境界判定を省いて内側だけを走査する)。
function chamferPropagate(dist, nx, ny, nz, h, band) {
  var strideY = nx, strideZ = nx * ny;
  // 重みはユークリッド距離そのもの。軸方向は厳密、斜め方向のみ数 % 過大に出る
  var w1 = h, w2 = Math.SQRT2 * h, w3 = Math.sqrt(3) * h;
  var off = [], wt = [];
  var di, dj, dk;
  for (dk = -1; dk <= 1; dk++) {
    for (dj = -1; dj <= 1; dj++) {
      for (di = -1; di <= 1; di++) {
        var m = Math.abs(di) + Math.abs(dj) + Math.abs(dk);
        if (m === 0) continue;
        var o = di + dj * strideY + dk * strideZ;
        if (o >= 0) continue; // 前方走査で参照するのは走査済みの 13 近傍のみ
        off.push(o);
        wt.push(m === 1 ? w1 : (m === 2 ? w2 : w3));
      }
    }
  }
  var i, j, k, q, idx, v, cand;
  for (k = 1; k < nz - 1; k++) {
    for (j = 1; j < ny - 1; j++) {
      var base = j * strideY + k * strideZ;
      for (i = 1; i < nx - 1; i++) {
        idx = base + i;
        v = dist[idx];
        for (q = 0; q < off.length; q++) {
          cand = dist[idx + off[q]] + wt[q];
          if (cand < v) v = cand;
        }
        dist[idx] = v;
      }
    }
  }
  for (k = nz - 2; k >= 1; k--) {
    for (j = ny - 2; j >= 1; j--) {
      var base2 = j * strideY + k * strideZ;
      for (i = nx - 2; i >= 1; i--) {
        idx = base2 + i;
        v = dist[idx];
        for (q = 0; q < off.length; q++) {
          cand = dist[idx - off[q]] + wt[q];
          if (cand < v) v = cand;
        }
        if (v > band) v = band;
        dist[idx] = v;
      }
    }
  }
  return dist;
}

// ---------------------------------------------------------------------------
// surface nets (双対法による等値面の三角形化)
// 場は正が内側。符号が変わるセルに 1 頂点を置き、辺を共有する 4 セルを四角形で結ぶ。
// マーチングキューブと違い表引きが不要で、出力は常に多様体かつ水密になる。
// ---------------------------------------------------------------------------

var SN_EDGES = [
  [0, 1], [2, 3], [4, 5], [6, 7],
  [0, 2], [1, 3], [4, 6], [5, 7],
  [0, 4], [1, 5], [2, 6], [3, 7]
];

function surfaceNets(field, g, flip) {
  var nx = g.nx, ny = g.ny, nz = g.nz, h = g.h;
  var ox = g.origin[0], oy = g.origin[1], oz = g.origin[2];
  var strideY = nx, strideZ = nx * ny;
  var cx = nx - 1, cy = ny - 1, cz = nz - 1;
  if (cx < 1 || cy < 1 || cz < 1) return new Float32Array(0);
  var cellIndex = new Int32Array(cx * cy * cz);
  var vx = [], vy = [], vz = [];
  var f = new Float64Array(8);
  var i, j, k, e, g0, g1;
  var cStrideY = cx, cStrideZ = cx * cy;

  for (k = 0; k < cz; k++) {
    for (j = 0; j < cy; j++) {
      var cbase = j * cStrideY + k * cStrideZ;
      var gbase = j * strideY + k * strideZ;
      for (i = 0; i < cx; i++) {
        var o = gbase + i;
        f[0] = field[o]; f[1] = field[o + 1];
        f[2] = field[o + strideY]; f[3] = field[o + strideY + 1];
        f[4] = field[o + strideZ]; f[5] = field[o + strideZ + 1];
        f[6] = field[o + strideY + strideZ]; f[7] = field[o + strideY + strideZ + 1];
        var mask = 0;
        for (e = 0; e < 8; e++) if (f[e] > 0) mask |= (1 << e);
        cellIndex[cbase + i] = -1;
        if (mask === 0 || mask === 255) continue;
        var sx = 0, sy = 0, sz = 0, cnt = 0;
        for (e = 0; e < 12; e++) {
          g0 = SN_EDGES[e][0]; g1 = SN_EDGES[e][1];
          var v0 = f[g0], v1 = f[g1];
          if ((v0 > 0) === (v1 > 0)) continue;
          var t = v0 / (v0 - v1);
          sx += (g0 & 1) + ((g1 & 1) - (g0 & 1)) * t;
          sy += ((g0 >> 1) & 1) + (((g1 >> 1) & 1) - ((g0 >> 1) & 1)) * t;
          sz += ((g0 >> 2) & 1) + (((g1 >> 2) & 1) - ((g0 >> 2) & 1)) * t;
          cnt++;
        }
        if (!cnt) continue;
        cellIndex[cbase + i] = vx.length;
        vx.push(ox + (i + sx / cnt) * h);
        vy.push(oy + (j + sy / cnt) * h);
        vz.push(oz + (k + sz / cnt) * h);
      }
    }
  }

  var gStride = [1, strideY, strideZ];
  var cStride = [1, cStrideY, cStrideZ];
  var quads = [];
  // 格子点 (i,j,k) から各軸へ伸びる辺のうち符号が変わるものを探し、
  // その辺を共有する 4 セルの頂点を四角形として結ぶ
  for (k = 1; k < nz - 1; k++) {
    for (j = 1; j < ny - 1; j++) {
      var gb = j * strideY + k * strideZ;
      var cb = j * cStrideY + k * cStrideZ;
      for (i = 1; i < nx - 1; i++) {
        var here = field[gb + i] > 0;
        for (var d = 0; d < 3; d++) {
          if ((field[gb + i + gStride[d]] > 0) === here) continue;
          var u = (d + 1) % 3, v = (d + 2) % 3;
          var cellBase = cb + i;
          var a = cellIndex[cellBase];
          var b = cellIndex[cellBase - cStride[u]];
          var c = cellIndex[cellBase - cStride[u] - cStride[v]];
          var dd = cellIndex[cellBase - cStride[v]];
          if (a < 0 || b < 0 || c < 0 || dd < 0) continue;
          if (here !== !!flip) quads.push(a, b, c, dd);
          else quads.push(dd, c, b, a);
        }
      }
    }
  }

  // 四角形を 2 枚の三角形に分ける。頂点が重なった面積 0 の三角形は捨てる
  var out = new Float32Array(quads.length / 4 * 18);
  var w = 0;
  for (var q = 0; q < quads.length; q += 4) {
    var t0 = [quads[q], quads[q + 1], quads[q + 2]];
    var t1 = [quads[q], quads[q + 2], quads[q + 3]];
    w = emitTriangle(out, w, vx, vy, vz, t0);
    w = emitTriangle(out, w, vx, vy, vz, t1);
  }
  return out.subarray(0, w);
}

function emitTriangle(out, w, vx, vy, vz, t) {
  var ax = vx[t[0]], ay = vy[t[0]], az = vz[t[0]];
  var bx = vx[t[1]], by = vy[t[1]], bz = vz[t[1]];
  var cx = vx[t[2]], cy = vy[t[2]], cz = vz[t[2]];
  var e1x = bx - ax, e1y = by - ay, e1z = bz - az;
  var e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
  var nx2 = e1y * e2z - e1z * e2y, ny2 = e1z * e2x - e1x * e2z, nz2 = e1x * e2y - e1y * e2x;
  if (nx2 * nx2 + ny2 * ny2 + nz2 * nz2 < 1e-24) return w;
  out[w] = ax; out[w + 1] = ay; out[w + 2] = az;
  out[w + 3] = bx; out[w + 4] = by; out[w + 5] = bz;
  out[w + 6] = cx; out[w + 7] = cy; out[w + 8] = cz;
  return w + 9;
}

// ---------------------------------------------------------------------------
// 断面性能 (造形方向に直交する層ごとの断面積と断面二次モーメント)
// 曲げ剛性は断面二次モーメントに比例するため、中実との比が強度保持の目安になる。
// ---------------------------------------------------------------------------

function sectionProfile(g, cav, mat) {
  var nx = g.nx, ny = g.ny, nz = g.nz, h = g.h, sdf = g.sdf;
  var strideY = nx, strideZ = nx * ny;
  var dA = h * h;
  var layers = [];
  for (var k = 0; k < nz; k++) {
    var s = { n: 0, x: 0, y: 0, xx: 0, yy: 0 };
    var m = { n: 0, x: 0, y: 0, xx: 0, yy: 0 };
    for (var j = 0; j < ny; j++) {
      var base = j * strideY + k * strideZ;
      var y = g.origin[1] + j * h;
      for (var i = 0; i < nx; i++) {
        var idx = base + i;
        var solid = sdf[idx] > 0;
        var matVal = mat ? mat[idx] : Math.min(sdf[idx], -cav[idx]);
        if (!solid && matVal <= 0) continue;
        var x = g.origin[0] + i * h;
        if (solid) { s.n++; s.x += x; s.y += y; s.xx += x * x; s.yy += y * y; }
        if (matVal > 0) { m.n++; m.x += x; m.y += y; m.xx += x * x; m.yy += y * y; }
      }
    }
    if (s.n === 0) continue;
    layers.push({
      z: g.origin[2] + k * h,
      solidArea: s.n * dA,
      hollowArea: m.n * dA,
      solidI: minInertia(s, dA),
      hollowI: m.n ? minInertia(m, dA) : 0
    });
  }
  return layers;
}

// 重心を通る X / Y 軸まわりの断面二次モーメントのうち小さい方 (弱軸) mm^4
function minInertia(s, dA) {
  var ix = (s.yy - s.y * s.y / s.n) * dA;
  var iy = (s.xx - s.x * s.x / s.n) * dA;
  if (ix < 0) ix = 0;
  if (iy < 0) iy = 0;
  return Math.min(ix, iy);
}

// 断面性能の要約。中実に対する比が最も小さい層を弱点として返す
function summarizeSections(layers) {
  var worstI = null, worstA = null;
  for (var i = 0; i < layers.length; i++) {
    var l = layers[i];
    if (l.solidI > 1e-9) {
      var ri = l.hollowI / l.solidI;
      if (!worstI || ri < worstI.ratio) worstI = { ratio: ri, z: l.z };
    }
    if (l.solidArea > 1e-9) {
      var ra = l.hollowArea / l.solidArea;
      if (!worstA || ra < worstA.ratio) worstA = { ratio: ra, z: l.z };
    }
  }
  return {
    layerCount: layers.length,
    minInertiaRatio: worstI ? worstI.ratio : 1,
    minInertiaZ: worstI ? worstI.z : 0,
    minAreaRatio: worstA ? worstA.ratio : 1,
    minAreaZ: worstA ? worstA.z : 0
  };
}

// ---------------------------------------------------------------------------
// 中抜きの実行
// ---------------------------------------------------------------------------

function hollowMesh(positions, matrix, options) {
  var def = hollowDefaults(), opt = {}, key;
  for (key in def) opt[key] = def[key];
  if (options) for (key in options) if (options[key] !== undefined && options[key] !== null) opt[key] = options[key];
  opt.wall = Math.max(opt.wall, 0.01);
  opt.top = Math.max(opt.top, 0.01);
  opt.bottom = Math.max(opt.bottom, 0.01);
  opt.rib = Math.max(opt.rib, 0.01);

  // ワールド座標に移し、内向きメッシュはここで是正しておく
  // (外殻をそのまま使う「外殻保持」で表裏が反転しないようにする)
  var world = matrix ? transformPositions(positions, matrix) : new Float32Array(positions);
  var solidMass = computeMassProperties(world);
  if (solidMass.volume < 0) {
    flipWinding(world);
    solidMass = computeMassProperties(world);
  }
  var bounds = computeBounds(world);
  var h = chooseVoxelSize(bounds.size, opt);
  var band = opt.wall + h * 3;
  var g = buildSignedField(world, h, band);
  var cav = buildCavityField(g, opt);
  var holes = [];
  var warnings = [];
  if (opt.hole !== 'none') {
    if (opt.mode === 'shell') {
      warnings.push('抜き穴は「全体を再構築」でのみ作成できます (外殻保持では外側の面を加工しないため)。');
    } else {
      holes = pickDrainHoles(g, cav, opt);
      if (!holes.length) warnings.push('抜き穴を配置できる位置が見つかりませんでした (直径を小さくしてください)。');
    }
  }
  var mat = opt.mode === 'rebuild' ? buildMaterialField(g, cav, holes) : null;

  var out, cavityPositions = null;
  if (mat) {
    out = surfaceNets(mat, g, false);
  } else {
    cavityPositions = surfaceNets(cav, g, true);
    out = new Float32Array(world.length + cavityPositions.length);
    out.set(world, 0);
    out.set(cavityPositions, world.length);
  }

  var outMass = computeMassProperties(out);
  var solidVolume = Math.abs(solidMass.volume);
  var hollowVolume = Math.abs(outMass.volume);
  var layers = sectionProfile(g, cav, mat);
  var sections = summarizeSections(layers);

  if (hollowVolume > solidVolume * 0.995) {
    warnings.push('空洞ができていません。壁厚・天面厚・底面厚を薄くするか、より細かい格子を指定してください。');
  }
  if (opt.wall < opt.lineWidth * 2) {
    warnings.push('壁厚 ' + fmt(opt.wall, 2) + ' mm は押出幅 ' + fmt(opt.lineWidth, 2) + ' mm の 2 本分に満たないため、造形時に隙間が出ます。');
  }
  if (opt.top < opt.layer * 4) {
    warnings.push('天面厚 ' + fmt(opt.top, 2) + ' mm は層厚 ' + fmt(opt.layer, 2) + ' mm の 4 層分に満たないため、空洞の上でブリッジが落ちる可能性があります。');
  }
  if (opt.infill !== 'none' && opt.rib < opt.lineWidth) {
    warnings.push('リブ厚 ' + fmt(opt.rib, 2) + ' mm が押出幅を下回っています。');
  }
  if (h > opt.wall / 2) {
    warnings.push('格子間隔 ' + fmt(h, 3) + ' mm が壁厚の半分より粗いため、壁厚に ±' + fmt(h, 2) + ' mm 程度の誤差が出ます。');
  }
  if (opt.infill !== 'none' && h > opt.rib / 2.5) {
    warnings.push('格子間隔に対してリブが細いため、内部構造が途切れたり接合部が縮退する場合があります。');
  }
  if (out.length / 9 > 400000) {
    warnings.push('三角形数が ' + fmtInt(Math.round(out.length / 9)) + ' 個あります。格子間隔を大きくすると軽くなります。');
  }
  if (!holes.length && hollowVolume < solidVolume * 0.995) {
    warnings.push('空洞は密閉されます。光造形では未硬化樹脂が残るため抜き穴を検討してください。');
  }

  return {
    positions: out,
    cavityPositions: cavityPositions,
    holes: holes,
    warnings: warnings,
    options: opt,
    grid: { nx: g.nx, ny: g.ny, nz: g.nz, h: h, count: g.nx * g.ny * g.nz },
    triangleCount: out.length / 9,
    volume: {
      solid: solidVolume,
      hollow: hollowVolume,
      removed: solidVolume - hollowVolume,
      ratio: solidVolume > 0 ? hollowVolume / solidVolume : 1
    },
    sections: sections,
    infillPeriod: opt.infill === 'none' ? 0 : infillPeriod(opt.infill, opt.rib, opt.density)
  };
}

// フィラメント長 (mm)。直径 d のフィラメント換算
function filamentLength(volumeMm3, diameter) {
  var d = diameter || 1.75;
  return volumeMm3 / (Math.PI * d * d / 4);
}
