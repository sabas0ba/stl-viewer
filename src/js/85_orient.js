// ---------------------------------------------------------------------------
// 姿勢 (向き) の評価と自動探索
// ---------------------------------------------------------------------------

// 回転 q を適用し、最低点を Z=0 に置いたときの評価値を返す
function evaluateOrientation(part, q, overhangDeg, sampleStep) {
  var m = M4.compose(M4.create(), [0, 0, 0], q, part.scale);
  var p = part.positions;
  var minZ = Infinity, maxZ = -Infinity;
  var m2 = m[2], m6 = m[6], m10 = m[10], m14 = m[14];
  for (var i = 0; i < p.length; i += 3) {
    var z = m2 * p[i] + m6 * p[i + 1] + m10 * p[i + 2] + m14;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  m[14] -= minZ;
  var st = sampleStep || Math.max(1, Math.ceil((p.length / 9) / 60000));
  var s = overhangStats(p, m, overhangDeg, 0, 0.05, st);
  var height = maxZ - minZ;
  return {
    quat: q,
    height: height,
    overhangArea: s.overhangArea,
    contactArea: s.contactArea,
    totalArea: s.totalArea,
    overhangRatio: s.totalArea > 0 ? s.overhangArea / s.totalArea : 0
  };
}

// 候補姿勢を列挙して評価する (面積の大きい面を下に向ける候補 + 軸方向)
function searchOrientations(part, overhangDeg, maxCandidates) {
  var cands = candidateNormals(part.positions, maxCandidates || 20);
  var axisNormals = [[0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]];
  var qs = [];
  var seen = new Set();
  function addQuat(n) {
    // 法線 n を下向き (0,0,-1) に合わせる
    var q = Quat.norm(Quat.mul(Quat.fromUnitVectors(n, [0, 0, -1]), part.quat));
    var key = [q[0], q[1], q[2], q[3]].map(function (x) { return Math.round(x * 200); }).join('_');
    if (seen.has(key)) return;
    seen.add(key);
    qs.push(q);
  }
  var i;
  // 現在の姿勢も候補に含める
  var cur = part.quat.slice();
  var curKey = cur.map(function (x) { return Math.round(x * 200); }).join('_');
  seen.add(curKey);
  qs.push(cur);
  for (i = 0; i < cands.length; i++) {
    // candidateNormals はローカル法線なので現在の回転を適用してから評価する
    addQuat(Quat.rotate(part.quat, cands[i].n));
  }
  for (i = 0; i < axisNormals.length; i++) addQuat(axisNormals[i]);
  var results = [];
  for (i = 0; i < qs.length; i++) results.push(evaluateOrientation(part, qs[i], overhangDeg));
  // サポート面積を主、造形高さを従として評価する
  var maxH = 1, maxO = 1;
  for (i = 0; i < results.length; i++) {
    if (results[i].height > maxH) maxH = results[i].height;
    if (results[i].overhangArea > maxO) maxO = results[i].overhangArea;
  }
  for (i = 0; i < results.length; i++) {
    var r = results[i];
    r.score = (r.overhangArea / maxO) * 1.0 + (r.height / maxH) * 0.35 - Math.min(r.contactArea / Math.max(1, r.totalArea), 0.3) * 0.5;
  }
  results.sort(function (a, b) { return a.score - b.score; });
  return results;
}

// 指定した面 (三角形番号) をビルドプレートに接地させる
function layFaceOnBed(part, triangleIndex) {
  var p = triangleIndex * 9;
  var pos = part.positions;
  var e1 = [pos[p + 3] - pos[p], pos[p + 4] - pos[p + 1], pos[p + 5] - pos[p + 2]];
  var e2 = [pos[p + 6] - pos[p], pos[p + 7] - pos[p + 1], pos[p + 8] - pos[p + 2]];
  var nLocal = V3.norm([0, 0, 0], V3.cross([0, 0, 0], e1, e2));
  var nWorld = V3.norm([0, 0, 0], Quat.rotate(part.quat, nLocal));
  var q = Quat.fromUnitVectors(nWorld, [0, 0, -1]);
  rotatePartAroundCenter(part, q);
}
