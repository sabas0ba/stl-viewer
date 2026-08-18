// ---------------------------------------------------------------------------
// シーン (パーツ集合、ビルドプレート、選択状態)
// ---------------------------------------------------------------------------

var MATERIALS = [
  { name: 'PLA', density: 1.24 },
  { name: 'PETG', density: 1.27 },
  { name: 'ABS', density: 1.04 },
  { name: 'ASA', density: 1.07 },
  { name: 'TPU 95A', density: 1.21 },
  { name: 'Nylon (PA)', density: 1.14 },
  { name: 'Resin (標準)', density: 1.10 }
];

var partSeq = 0;

function createPart(name, positions, fileSize, format) {
  var mass = computeMassProperties(positions);
  var flipped = false;
  if (mass.volume < 0) {
    // 三角形の向きが内向き。表裏を反転して以降の判定を正しくする
    flipWinding(positions);
    mass = computeMassProperties(positions);
    flipped = true;
  }
  var welded = null, topo = null;
  var bounds = computeBounds(positions);
  var diag = V3.len(bounds.size) || 1;
  try {
    welded = weldVertices(positions, Math.max(diag * 1e-6, 1e-5));
    topo = analyzeTopology(welded.index, welded.vertexCount);
  } catch (e) {
    topo = null;
  }
  var part = {
    id: ++partSeq,
    name: name,
    positions: positions,
    normals: buildFlatNormals(positions),
    triangleCount: positions.length / 9,
    localBounds: bounds,
    mass: mass,
    topology: topo,
    vertexCount: welded ? welded.vertexCount : positions.length / 3,
    normalsFlipped: flipped,
    fileSize: fileSize,
    format: format,
    color: PALETTE[(partSeq - 1) % PALETTE.length].slice(),
    visible: true,
    pos: [0, 0, 0],
    quat: [0, 0, 0, 1],
    scale: [1, 1, 1],
    matrix: M4.create(),
    worldBounds: null,
    bvh: null,
    gpu: null,
    stats: null
  };
  updatePartMatrix(part);
  return part;
}

function updatePartMatrix(part) {
  M4.compose(part.matrix, part.pos, part.quat, part.scale);
  part.worldBounds = computeWorldBounds(part);
  part.stats = null;
  return part;
}

// 厳密なワールド AABB (回転後も正確な寸法を得るため全頂点を変換する)
function computeWorldBounds(part) {
  var m = part.matrix, p = part.positions;
  var minx = Infinity, miny = Infinity, minz = Infinity;
  var maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
  var m0 = m[0], m4 = m[4], m8 = m[8], m12 = m[12];
  var m1 = m[1], m5 = m[5], m9 = m[9], m13 = m[13];
  var m2 = m[2], m6 = m[6], m10 = m[10], m14 = m[14];
  for (var i = 0; i < p.length; i += 3) {
    var x = p[i], y = p[i + 1], z = p[i + 2];
    var wx = m0 * x + m4 * y + m8 * z + m12;
    var wy = m1 * x + m5 * y + m9 * z + m13;
    var wz = m2 * x + m6 * y + m10 * z + m14;
    if (wx < minx) minx = wx; if (wx > maxx) maxx = wx;
    if (wy < miny) miny = wy; if (wy > maxy) maxy = wy;
    if (wz < minz) minz = wz; if (wz > maxz) maxz = wz;
  }
  if (!isFinite(minx)) { minx = miny = minz = 0; maxx = maxy = maxz = 0; }
  return {
    min: [minx, miny, minz], max: [maxx, maxy, maxz],
    size: [maxx - minx, maxy - miny, maxz - minz]
  };
}

function partVolume(part) {
  var s = part.scale;
  return part.mass.volume * Math.abs(s[0] * s[1] * s[2]);
}

function partArea(part) {
  // 一様スケール時のみ厳密。非一様の場合は近似値として扱う
  var s = part.scale;
  var f = Math.pow(Math.abs(s[0] * s[1] * s[2]), 2 / 3);
  return part.mass.area * f;
}

function dropToBed(part) {
  part.pos[2] -= part.worldBounds.min[2];
  updatePartMatrix(part);
}

function centerPartOnBed(part, bed) {
  var wb = part.worldBounds;
  var cx = (wb.min[0] + wb.max[0]) / 2, cy = (wb.min[1] + wb.max[1]) / 2;
  part.pos[0] += bed[0] / 2 - cx;
  part.pos[1] += bed[1] / 2 - cy;
  updatePartMatrix(part);
  dropToBed(part);
}

function rotatePartAroundCenter(part, quatDelta) {
  var before = part.worldBounds;
  var cx = (before.min[0] + before.max[0]) / 2;
  var cy = (before.min[1] + before.max[1]) / 2;
  part.quat = Quat.norm(Quat.mul(quatDelta, part.quat));
  updatePartMatrix(part);
  var after = part.worldBounds;
  part.pos[0] += cx - (after.min[0] + after.max[0]) / 2;
  part.pos[1] += cy - (after.min[1] + after.max[1]) / 2;
  updatePartMatrix(part);
  dropToBed(part);
}

function sceneBounds(parts, visibleOnly) {
  var min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  var found = false;
  for (var i = 0; i < parts.length; i++) {
    if (visibleOnly && !parts[i].visible) continue;
    var b = parts[i].worldBounds;
    found = true;
    for (var k = 0; k < 3; k++) {
      if (b.min[k] < min[k]) min[k] = b.min[k];
      if (b.max[k] > max[k]) max[k] = b.max[k];
    }
  }
  if (!found) return null;
  return { min: min, max: max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}

function ensureBVH(part) {
  if (!part.bvh) part.bvh = buildBVH(part.positions, 8);
  return part.bvh;
}

// パーツをベッド上に整列配置する (フットプリントの大きい順に行詰め)
function arrangeParts(parts, bed, margin) {
  var m = margin === undefined ? 5 : margin;
  var list = parts.filter(function (p) { return p.visible; });
  list.sort(function (a, b) {
    return (b.worldBounds.size[0] * b.worldBounds.size[1]) - (a.worldBounds.size[0] * a.worldBounds.size[1]);
  });
  var cursorX = m, cursorY = m, rowH = 0;
  var placed = [];
  for (var i = 0; i < list.length; i++) {
    var p = list[i];
    var w = p.worldBounds.size[0], d = p.worldBounds.size[1];
    if (cursorX + w > bed[0] - m && cursorX > m) {
      cursorX = m; cursorY += rowH + m; rowH = 0;
    }
    var dx = cursorX - p.worldBounds.min[0];
    var dy = cursorY - p.worldBounds.min[1];
    p.pos[0] += dx; p.pos[1] += dy;
    updatePartMatrix(p);
    dropToBed(p);
    cursorX += w + m;
    if (d > rowH) rowH = d;
    placed.push(p);
  }
  return placed;
}

// パーツ間干渉: AABB で粗判定した後、三角形レベルで確認する
function detectCollisions(parts, maxTests) {
  var res = [];
  var budget = maxTests || 400000;
  var list = parts.filter(function (p) { return p.visible; });
  for (var i = 0; i < list.length; i++) {
    for (var j = i + 1; j < list.length; j++) {
      var a = list[i], b = list[j];
      if (!aabbOverlap(a.worldBounds, b.worldBounds, 0)) continue;
      var hit = trianglesIntersect(a, b, budget);
      res.push({ a: a, b: b, exact: hit.decided, intersect: hit.hit });
    }
  }
  return res;
}

function trianglesIntersect(a, b, budget) {
  ensureBVH(a); ensureBVH(b);
  // b の三角形を a のローカル空間へ変換して a の BVH と照合する
  var invA = M4.invert(M4.create(), a.matrix);
  if (!invA) return { hit: true, decided: false };
  var toA = M4.mul(M4.create(), invA, b.matrix);
  var tests = 0;
  var bTri = b.positions.length / 9;
  var step = 1;
  if (bTri > 40000) step = Math.ceil(bTri / 40000);
  var p0 = [0, 0, 0], p1 = [0, 0, 0], p2 = [0, 0, 0];
  for (var t = 0; t < bTri; t += step) {
    var q = t * 9;
    M4.xformPoint(p0, toA, [b.positions[q], b.positions[q + 1], b.positions[q + 2]]);
    M4.xformPoint(p1, toA, [b.positions[q + 3], b.positions[q + 4], b.positions[q + 5]]);
    M4.xformPoint(p2, toA, [b.positions[q + 6], b.positions[q + 7], b.positions[q + 8]]);
    var mn = [Math.min(p0[0], p1[0], p2[0]), Math.min(p0[1], p1[1], p2[1]), Math.min(p0[2], p1[2], p2[2])];
    var mx = [Math.max(p0[0], p1[0], p2[0]), Math.max(p0[1], p1[1], p2[1]), Math.max(p0[2], p1[2], p2[2])];
    var stack = [0];
    var bvh = a.bvh;
    while (stack.length) {
      var node = stack.pop();
      var base = node * 3;
      if (bvh.nodeMax[base] < mn[0] || bvh.nodeMin[base] > mx[0] ||
        bvh.nodeMax[base + 1] < mn[1] || bvh.nodeMin[base + 1] > mx[1] ||
        bvh.nodeMax[base + 2] < mn[2] || bvh.nodeMin[base + 2] > mx[2]) continue;
      var count = bvh.nodeData[base + 2];
      if (count > 0) {
        var start = bvh.nodeData[base + 1];
        for (var k = 0; k < count; k++) {
          var ti = bvh.triIndex[start + k] * 9;
          tests++;
          if (triTriIntersect(
            [a.positions[ti], a.positions[ti + 1], a.positions[ti + 2]],
            [a.positions[ti + 3], a.positions[ti + 4], a.positions[ti + 5]],
            [a.positions[ti + 6], a.positions[ti + 7], a.positions[ti + 8]],
            p0, p1, p2)) {
            return { hit: true, decided: true };
          }
        }
      } else {
        stack.push(bvh.nodeData[base]);
        stack.push(bvh.nodeData[base + 1]);
      }
    }
    if (tests > budget) return { hit: false, decided: false };
  }
  return { hit: false, decided: step === 1 };
}
