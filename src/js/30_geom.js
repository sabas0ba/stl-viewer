// ---------------------------------------------------------------------------
// メッシュ解析: 寸法・体積・表面積・トポロジ・BVH・断面・オーバーハング
// 座標系: X 右 / Y 奥 / Z 上、単位 mm、Z=0 がビルドプレート面
// ---------------------------------------------------------------------------

function computeBounds(positions) {
  var min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (var i = 0; i < positions.length; i += 3) {
    for (var k = 0; k < 3; k++) {
      var v = positions[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  if (!isFinite(min[0])) { min = [0, 0, 0]; max = [0, 0, 0]; }
  return { min: min, max: max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}

// 変換行列適用後のバウンディングボックス (8 頂点を変換)
function transformedBounds(localBounds, m) {
  var min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  var p = [0, 0, 0];
  for (var i = 0; i < 8; i++) {
    var c = [
      (i & 1) ? localBounds.max[0] : localBounds.min[0],
      (i & 2) ? localBounds.max[1] : localBounds.min[1],
      (i & 4) ? localBounds.max[2] : localBounds.min[2]
    ];
    M4.xformPoint(p, m, c);
    for (var k = 0; k < 3; k++) {
      if (p[k] < min[k]) min[k] = p[k];
      if (p[k] > max[k]) max[k] = p[k];
    }
  }
  return { min: min, max: max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}

// 符号付き体積 (mm^3)、表面積 (mm^2)、体積重心
function computeMassProperties(positions) {
  var vol = 0, area = 0;
  var cx = 0, cy = 0, cz = 0;
  var tri = positions.length / 9;
  for (var i = 0; i < tri; i++) {
    var p = i * 9;
    var ax = positions[p], ay = positions[p + 1], az = positions[p + 2];
    var bx = positions[p + 3], by = positions[p + 4], bz = positions[p + 5];
    var ccx = positions[p + 6], ccy = positions[p + 7], ccz = positions[p + 8];
    // 原点を頂点とする四面体の符号付き体積
    var v = (ax * (by * ccz - bz * ccy) + ay * (bz * ccx - bx * ccz) + az * (bx * ccy - by * ccx)) / 6;
    vol += v;
    cx += v * (ax + bx + ccx) / 4;
    cy += v * (ay + by + ccy) / 4;
    cz += v * (az + bz + ccz) / 4;
    var e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    var e2x = ccx - ax, e2y = ccy - ay, e2z = ccz - az;
    var nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    area += 0.5 * Math.sqrt(nx * nx + ny * ny + nz * nz);
  }
  var c = Math.abs(vol) > 1e-12 ? [cx / vol, cy / vol, cz / vol] : [0, 0, 0];
  return { volume: vol, area: area, centroid: c, triangleCount: tri };
}

// 頂点マージ。返り値の index は positions の三角形順に対応する頂点番号
function weldVertices(positions, eps) {
  var n = positions.length / 3;
  var index = new Uint32Array(n);
  var map = new Map();
  var inv = 1 / eps;
  var verts = [];
  for (var i = 0; i < n; i++) {
    var x = Math.round(positions[i * 3] * inv);
    var y = Math.round(positions[i * 3 + 1] * inv);
    var z = Math.round(positions[i * 3 + 2] * inv);
    var key = x + '/' + y + '/' + z;
    var id = map.get(key);
    if (id === undefined) {
      id = verts.length / 3;
      map.set(key, id);
      verts.push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    }
    index[i] = id;
  }
  return { index: index, vertexCount: verts.length / 3, vertices: new Float32Array(verts) };
}

// エッジ接続からメッシュ健全性を判定
function analyzeTopology(index, vertexCount) {
  var triCount = index.length / 3;
  var edgeMap = new Map();
  var i, a, b, key, rec;
  var degenerate = 0;
  for (i = 0; i < triCount; i++) {
    var v0 = index[i * 3], v1 = index[i * 3 + 1], v2 = index[i * 3 + 2];
    if (v0 === v1 || v1 === v2 || v0 === v2) { degenerate++; continue; }
    var pairs = [[v0, v1], [v1, v2], [v2, v0]];
    for (var e = 0; e < 3; e++) {
      a = pairs[e][0]; b = pairs[e][1];
      var dir = a < b ? 1 : -1;
      var lo = dir > 0 ? a : b, hi = dir > 0 ? b : a;
      key = lo * 67108864 + hi; // 頂点数 6.7e7 まで一意
      rec = edgeMap.get(key);
      if (rec === undefined) { rec = [0, 0]; edgeMap.set(key, rec); }
      if (dir > 0) rec[0]++; else rec[1]++;
    }
  }
  var boundary = 0, nonManifold = 0, inconsistent = 0;
  edgeMap.forEach(function (r) {
    var total = r[0] + r[1];
    if (total === 1) boundary++;
    else if (total > 2) nonManifold++;
    else if (total === 2 && (r[0] === 2 || r[1] === 2)) inconsistent++;
  });
  // 連結成分数 (シェル数) : union-find
  var parent = new Int32Array(vertexCount);
  for (i = 0; i < vertexCount; i++) parent[i] = i;
  function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
  function union(x, y) { var rx = find(x), ry = find(y); if (rx !== ry) parent[rx] = ry; }
  for (i = 0; i < triCount; i++) {
    union(index[i * 3], index[i * 3 + 1]);
    union(index[i * 3 + 1], index[i * 3 + 2]);
  }
  var roots = new Set();
  var used = new Uint8Array(vertexCount);
  for (i = 0; i < index.length; i++) used[index[i]] = 1;
  for (i = 0; i < vertexCount; i++) if (used[i]) roots.add(find(i));
  return {
    edgeCount: edgeMap.size,
    boundaryEdges: boundary,
    nonManifoldEdges: nonManifold,
    inconsistentEdges: inconsistent,
    degenerateTriangles: degenerate,
    shells: roots.size,
    watertight: boundary === 0 && nonManifold === 0 && inconsistent === 0
  };
}

// ---------------------------------------------------------------------------
// BVH (中央値分割)
// ---------------------------------------------------------------------------

function buildBVH(positions, leafSize) {
  var triCount = positions.length / 9;
  var maxLeaf = leafSize || 8;
  var triIndex = new Uint32Array(triCount);
  var cent = new Float32Array(triCount * 3);
  var triMin = new Float32Array(triCount * 3);
  var triMax = new Float32Array(triCount * 3);
  var i, k;
  for (i = 0; i < triCount; i++) {
    triIndex[i] = i;
    var p = i * 9;
    for (k = 0; k < 3; k++) {
      var v0 = positions[p + k], v1 = positions[p + 3 + k], v2 = positions[p + 6 + k];
      cent[i * 3 + k] = (v0 + v1 + v2) / 3;
      triMin[i * 3 + k] = Math.min(v0, v1, v2);
      triMax[i * 3 + k] = Math.max(v0, v1, v2);
    }
  }
  var maxNodes = Math.max(1, triCount * 2);
  var nodeMin = new Float32Array(maxNodes * 3);
  var nodeMax = new Float32Array(maxNodes * 3);
  var nodeData = new Int32Array(maxNodes * 3); // [leftChild, start, count] count>0 なら葉
  var nodeCount = 0;
  var scratch = new Uint32Array(triCount);

  function buildNode(start, count) {
    var self = nodeCount++;
    var mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    var i2, k2;
    for (i2 = start; i2 < start + count; i2++) {
      var t = triIndex[i2];
      for (k2 = 0; k2 < 3; k2++) {
        if (triMin[t * 3 + k2] < mn[k2]) mn[k2] = triMin[t * 3 + k2];
        if (triMax[t * 3 + k2] > mx[k2]) mx[k2] = triMax[t * 3 + k2];
      }
    }
    for (k2 = 0; k2 < 3; k2++) { nodeMin[self * 3 + k2] = mn[k2]; nodeMax[self * 3 + k2] = mx[k2]; }
    if (count <= maxLeaf) {
      nodeData[self * 3] = -1; nodeData[self * 3 + 1] = start; nodeData[self * 3 + 2] = count;
      return self;
    }
    var axis = 0, ext = mx[0] - mn[0];
    if (mx[1] - mn[1] > ext) { axis = 1; ext = mx[1] - mn[1]; }
    if (mx[2] - mn[2] > ext) { axis = 2; ext = mx[2] - mn[2]; }
    var mid = (mn[axis] + mx[axis]) / 2;
    // 空間中央での分割
    var wl = 0;
    for (i2 = start; i2 < start + count; i2++) {
      var t2 = triIndex[i2];
      if (cent[t2 * 3 + axis] < mid) { scratch[start + wl] = t2; wl++; }
    }
    var wr = 0;
    for (i2 = start; i2 < start + count; i2++) {
      var t3 = triIndex[i2];
      if (cent[t3 * 3 + axis] >= mid) { scratch[start + wl + wr] = t3; wr++; }
    }
    var minSide = count >> 4;
    if (wl <= minSide || wr <= minSide) {
      // 偏りが大きい場合は重心座標でソートして個数二分 (深さを O(log n) に保つ)
      var slice = Array.prototype.slice.call(triIndex.subarray(start, start + count));
      slice.sort(function (x, y) { return cent[x * 3 + axis] - cent[y * 3 + axis]; });
      for (i2 = 0; i2 < count; i2++) scratch[start + i2] = slice[i2];
      wl = count >> 1; wr = count - wl;
    }
    for (i2 = start; i2 < start + count; i2++) triIndex[i2] = scratch[i2];
    nodeData[self * 3 + 2] = 0;
    var left = buildNode(start, wl);
    var right = buildNode(start + wl, wr);
    nodeData[self * 3] = left;
    nodeData[self * 3 + 1] = right;
    return self;
  }
  if (triCount > 0) buildNode(0, triCount);
  return { nodeMin: nodeMin, nodeMax: nodeMax, nodeData: nodeData, triIndex: triIndex, nodeCount: nodeCount, triCount: triCount };
}

function rayAABB(origin, invDir, mn, mx, base) {
  var tmin = -Infinity, tmax = Infinity;
  for (var k = 0; k < 3; k++) {
    var t1 = (mn[base + k] - origin[k]) * invDir[k];
    var t2 = (mx[base + k] - origin[k]) * invDir[k];
    if (t1 > t2) { var t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmax < tmin) return Infinity;
  }
  return tmax < 0 ? Infinity : (tmin > 0 ? tmin : 0);
}

// ローカル空間でのレイ交差。最近傍の三角形を返す
function raycastBVH(bvh, positions, origin, dir) {
  if (!bvh || bvh.triCount === 0) return null;
  var invDir = [1 / (dir[0] || 1e-20), 1 / (dir[1] || 1e-20), 1 / (dir[2] || 1e-20)];
  var stack = [0];
  var best = null, bestT = Infinity;
  while (stack.length) {
    var node = stack.pop();
    if (rayAABB(origin, invDir, bvh.nodeMin, bvh.nodeMax, node * 3) >= bestT) continue;
    var count = bvh.nodeData[node * 3 + 2];
    if (count > 0) {
      var start = bvh.nodeData[node * 3 + 1];
      for (var i = 0; i < count; i++) {
        var t = bvh.triIndex[start + i];
        var hit = rayTriangle(origin, dir, positions, t * 9);
        if (hit !== null && hit < bestT && hit > 1e-6) { bestT = hit; best = t; }
      }
    } else {
      stack.push(bvh.nodeData[node * 3]);
      stack.push(bvh.nodeData[node * 3 + 1]);
    }
  }
  if (best === null) return null;
  var p = best * 9;
  var e1 = [positions[p + 3] - positions[p], positions[p + 4] - positions[p + 1], positions[p + 5] - positions[p + 2]];
  var e2 = [positions[p + 6] - positions[p], positions[p + 7] - positions[p + 1], positions[p + 8] - positions[p + 2]];
  var n = V3.norm(V3.cross([0, 0, 0], e1, e2));
  return {
    t: bestT,
    triangle: best,
    point: [origin[0] + dir[0] * bestT, origin[1] + dir[1] * bestT, origin[2] + dir[2] * bestT],
    normal: n
  };
}

function rayTriangle(o, d, pos, p) {
  var e1x = pos[p + 3] - pos[p], e1y = pos[p + 4] - pos[p + 1], e1z = pos[p + 5] - pos[p + 2];
  var e2x = pos[p + 6] - pos[p], e2y = pos[p + 7] - pos[p + 1], e2z = pos[p + 8] - pos[p + 2];
  var hx = d[1] * e2z - d[2] * e2y, hy = d[2] * e2x - d[0] * e2z, hz = d[0] * e2y - d[1] * e2x;
  var a = e1x * hx + e1y * hy + e1z * hz;
  if (a > -1e-12 && a < 1e-12) return null;
  var f = 1 / a;
  var sx = o[0] - pos[p], sy = o[1] - pos[p + 1], sz = o[2] - pos[p + 2];
  var u = f * (sx * hx + sy * hy + sz * hz);
  if (u < -1e-7 || u > 1 + 1e-7) return null;
  var qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
  var v = f * (d[0] * qx + d[1] * qy + d[2] * qz);
  if (v < -1e-7 || u + v > 1 + 1e-7) return null;
  var t = f * (e2x * qx + e2y * qy + e2z * qz);
  return t > 1e-9 ? t : null;
}

// ---------------------------------------------------------------------------
// 断面 (Z 一定平面) の輪郭抽出
// ---------------------------------------------------------------------------

function sliceAtZ(positions, matrix, z) {
  var segs = [];
  var tri = positions.length / 9;
  var a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0];
  var v = [a, b, c];
  var d = [0, 0, 0];
  // 平面上に乗る頂点 (d = 0) は上側として分類する。
  // 面が切断面と同一平面の場合はすべて上側となり除外されるため、
  // メッシュの頂点列が切断面に一致しても輪郭が二重化しない。
  for (var i = 0; i < tri; i++) {
    var p = i * 9;
    M4.xformPoint(a, matrix, [positions[p], positions[p + 1], positions[p + 2]]);
    M4.xformPoint(b, matrix, [positions[p + 3], positions[p + 4], positions[p + 5]]);
    M4.xformPoint(c, matrix, [positions[p + 6], positions[p + 7], positions[p + 8]]);
    var below = 0, above = 0;
    for (var k = 0; k < 3; k++) {
      var dk = v[k][2] - z;
      d[k] = dk;
      if (dk < 0) below++; else above++;
    }
    if (below === 0 || above === 0) continue;
    var pts = [];
    for (var e = 0; e < 3; e++) {
      var i0 = e, i1 = (e + 1) % 3;
      if ((d[i0] < 0) === (d[i1] < 0)) continue;
      var t = d[i0] / (d[i0] - d[i1]);
      pts.push([
        v[i0][0] + (v[i1][0] - v[i0][0]) * t,
        v[i0][1] + (v[i1][1] - v[i0][1]) * t
      ]);
    }
    if (pts.length >= 2) {
      var sx = pts[0][0] - pts[1][0], sy = pts[0][1] - pts[1][1];
      // 頂点上で交差した場合に生じる長さ 0 の線分は捨てる
      if (sx * sx + sy * sy > 1e-20) segs.push([pts[0], pts[1]]);
    }
  }
  return chainSegments(segs);
}

// 線分群を連結して輪郭 (ポリライン) にまとめる
function chainSegments(segs, tol) {
  var eps = tol || 1e-4;
  var map = new Map();
  function key(p) { return Math.round(p[0] / eps) + '_' + Math.round(p[1] / eps); }
  var i;
  for (i = 0; i < segs.length; i++) {
    var k0 = key(segs[i][0]), k1 = key(segs[i][1]);
    if (k0 === k1) continue;
    if (!map.has(k0)) map.set(k0, []);
    if (!map.has(k1)) map.set(k1, []);
    map.get(k0).push(i);
    map.get(k1).push(i);
  }
  var used = new Uint8Array(segs.length);
  var loops = [];
  for (i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    var poly = [segs[i][0], segs[i][1]];
    var closed = false;
    for (var dir = 0; dir < 2; dir++) {
      for (;;) {
        var endPt = dir === 0 ? poly[poly.length - 1] : poly[0];
        var cand = map.get(key(endPt));
        var next = -1;
        if (cand) {
          for (var j = 0; j < cand.length; j++) {
            if (!used[cand[j]]) { next = cand[j]; break; }
          }
        }
        if (next < 0) break;
        used[next] = 1;
        var s = segs[next];
        var other = (key(s[0]) === key(endPt)) ? s[1] : s[0];
        if (dir === 0) poly.push(other); else poly.unshift(other);
        if (key(other) === key(poly[dir === 0 ? 0 : poly.length - 1])) { closed = true; break; }
      }
      if (closed) break;
    }
    loops.push({ points: poly, closed: closed });
  }
  return loops;
}

// 指定軸を Z に一致させる回転行列。任意軸の断面を sliceAtZ で扱うために用いる
function sliceRotation(axis) {
  var v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]][axis];
  var q = Quat.fromUnitVectors(v, [0, 0, 1]);
  return M4.compose(M4.create(), [0, 0, 0], q, [1, 1, 1]);
}

function polygonArea(points) {
  var a = 0;
  for (var i = 0, n = points.length; i < n; i++) {
    var p = points[i], q = points[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

function polylineLength(points, closed) {
  var l = 0;
  for (var i = 0; i < points.length - 1; i++) {
    l += Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1]);
  }
  if (closed && points.length > 2) {
    l += Math.hypot(points[0][0] - points[points.length - 1][0], points[0][1] - points[points.length - 1][1]);
  }
  return l;
}

// ---------------------------------------------------------------------------
// オーバーハング / 接地面の集計
// 定義: 下向き面の法線 n に対し beta = asin(-n.z)。beta > threshold で要サポート。
// 垂直壁 beta=0、水平下面 beta=90。
// ---------------------------------------------------------------------------

function overhangStats(positions, matrix, thresholdDeg, bedZ, bedTol, step) {
  var sinT = Math.sin(thresholdDeg * Math.PI / 180);
  var tol = bedTol === undefined ? 0.05 : bedTol;
  var tri = positions.length / 9;
  var st = Math.max(1, step | 0);
  var total = 0, over = 0, contact = 0, downTotal = 0;
  var a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0];
  for (var i = 0; i < tri; i += st) {
    var p = i * 9;
    M4.xformPoint(a, matrix, [positions[p], positions[p + 1], positions[p + 2]]);
    M4.xformPoint(b, matrix, [positions[p + 3], positions[p + 4], positions[p + 5]]);
    M4.xformPoint(c, matrix, [positions[p + 6], positions[p + 7], positions[p + 8]]);
    var e1 = V3.sub([0, 0, 0], b, a), e2 = V3.sub([0, 0, 0], c, a);
    var n = V3.cross([0, 0, 0], e1, e2);
    var area2 = V3.len(n);
    if (area2 < 1e-20) continue;
    var area = area2 / 2;
    total += area;
    var nz = n[2] / area2;
    var d = -nz;
    if (d <= 0) continue;
    downTotal += area;
    var maxZ = Math.max(a[2], b[2], c[2]);
    var onBed = (maxZ <= bedZ + tol) && d > 0.999;
    if (onBed) { contact += area; continue; }
    if (d > sinT) over += area;
  }
  if (st > 1) { total *= st; over *= st; downTotal *= st; contact *= st; }
  return { totalArea: total, overhangArea: over, downwardArea: downTotal, contactArea: contact, sampled: st > 1 };
}

// 面積上位の代表法線 (自動姿勢探索の候補)
function candidateNormals(positions, maxCount) {
  var tri = positions.length / 9;
  var map = new Map();
  var step = 1;
  if (tri > 200000) step = Math.ceil(tri / 200000);
  for (var i = 0; i < tri; i += step) {
    var p = i * 9;
    var e1x = positions[p + 3] - positions[p], e1y = positions[p + 4] - positions[p + 1], e1z = positions[p + 5] - positions[p + 2];
    var e2x = positions[p + 6] - positions[p], e2y = positions[p + 7] - positions[p + 1], e2z = positions[p + 8] - positions[p + 2];
    var nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    var l = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (l < 1e-20) continue;
    nx /= l; ny /= l; nz /= l;
    var q = Math.round(nx * 24) + '_' + Math.round(ny * 24) + '_' + Math.round(nz * 24);
    var rec = map.get(q);
    if (rec) { rec.area += l / 2; }
    else map.set(q, { n: [nx, ny, nz], area: l / 2 });
  }
  var arr = [];
  map.forEach(function (r) { arr.push(r); });
  arr.sort(function (x, y) { return y.area - x.area; });
  return arr.slice(0, maxCount || 24);
}

// ---------------------------------------------------------------------------
// 三角形同士の交差 (パーツ干渉検出)
// ---------------------------------------------------------------------------

function triTriIntersect(a0, a1, a2, b0, b1, b2) {
  // 分離軸判定 (エッジ外積 9 軸 + 2 面法線)
  var axes = [];
  var ae = [V3.sub([0, 0, 0], a1, a0), V3.sub([0, 0, 0], a2, a1), V3.sub([0, 0, 0], a0, a2)];
  var be = [V3.sub([0, 0, 0], b1, b0), V3.sub([0, 0, 0], b2, b1), V3.sub([0, 0, 0], b0, b2)];
  axes.push(V3.cross([0, 0, 0], ae[0], ae[1]));
  axes.push(V3.cross([0, 0, 0], be[0], be[1]));
  for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) axes.push(V3.cross([0, 0, 0], ae[i], be[j]));
  var A = [a0, a1, a2], B = [b0, b1, b2];
  for (var k = 0; k < axes.length; k++) {
    var ax = axes[k];
    if (V3.len(ax) < 1e-12) continue;
    var amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
    for (var m = 0; m < 3; m++) {
      var da = V3.dot(ax, A[m]); if (da < amin) amin = da; if (da > amax) amax = da;
      var db = V3.dot(ax, B[m]); if (db < bmin) bmin = db; if (db > bmax) bmax = db;
    }
    if (amax < bmin - 1e-9 || bmax < amin - 1e-9) return false;
  }
  return true;
}

function aabbOverlap(a, b, margin) {
  var m = margin || 0;
  for (var k = 0; k < 3; k++) {
    if (a.max[k] < b.min[k] + m || b.max[k] < a.min[k] + m) return false;
  }
  return true;
}
