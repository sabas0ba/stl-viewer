// ---------------------------------------------------------------------------
// STL の読み込み / 書き出し
// 返却する法線はファイル記載値ではなく頂点順序から再計算した幾何法線を用いる。
// (STL の法線欄は不正確な出力が多いため)
// ---------------------------------------------------------------------------

function detectSTLFormat(buffer) {
  if (buffer.byteLength < 15) return 'invalid';
  if (buffer.byteLength >= 84) {
    var dv = new DataView(buffer);
    var n = dv.getUint32(80, true);
    if (n > 0 && 84 + n * 50 === buffer.byteLength) return 'binary';
  }
  var head = new Uint8Array(buffer, 0, Math.min(1024, buffer.byteLength));
  var s = '';
  for (var i = 0; i < head.length; i++) s += String.fromCharCode(head[i]);
  if (/^\s*solid/.test(s) && /facet|vertex/.test(s)) return 'ascii';
  if (buffer.byteLength >= 84) return 'binary';
  return 'invalid';
}

function parseSTLBinary(buffer) {
  var dv = new DataView(buffer);
  var tri = dv.getUint32(80, true);
  var avail = Math.floor((buffer.byteLength - 84) / 50);
  if (tri > avail) tri = avail;
  var pos = new Float32Array(tri * 9);
  var off = 84;
  for (var i = 0; i < tri; i++) {
    var p = i * 9;
    off += 12; // ファイル記載法線は読み飛ばす
    for (var v = 0; v < 9; v++) { pos[p + v] = dv.getFloat32(off, true); off += 4; }
    off += 2; // attribute byte count
  }
  return { positions: pos, triangleCount: tri, format: 'binary' };
}

function parseSTLAscii(buffer) {
  var text = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(buffer));
  var re = /vertex\s+(-?[0-9eE+.\-]+)\s+(-?[0-9eE+.\-]+)\s+(-?[0-9eE+.\-]+)/g;
  var vals = [];
  var m;
  while ((m = re.exec(text)) !== null) {
    vals.push(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
  }
  var tri = Math.floor(vals.length / 9);
  var pos = new Float32Array(tri * 9);
  for (var i = 0; i < tri * 9; i++) pos[i] = vals[i];
  return { positions: pos, triangleCount: tri, format: 'ascii' };
}

function parseSTL(buffer) {
  var f = detectSTLFormat(buffer);
  if (f === 'binary') return parseSTLBinary(buffer);
  if (f === 'ascii') {
    var r = parseSTLAscii(buffer);
    if (r.triangleCount === 0 && buffer.byteLength >= 84) return parseSTLBinary(buffer);
    return r;
  }
  throw new Error('STL として解釈できません');
}

// 三角形ごとの幾何法線を頂点展開して返す (フラットシェーディング用)
function buildFlatNormals(positions) {
  var tri = positions.length / 9;
  var out = new Float32Array(positions.length);
  for (var i = 0; i < tri; i++) {
    var p = i * 9;
    var ax = positions[p], ay = positions[p + 1], az = positions[p + 2];
    var bx = positions[p + 3], by = positions[p + 4], bz = positions[p + 5];
    var cx = positions[p + 6], cy = positions[p + 7], cz = positions[p + 8];
    var e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    var e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    var nx = e1y * e2z - e1z * e2y;
    var ny = e1z * e2x - e1x * e2z;
    var nz = e1x * e2y - e1y * e2x;
    var l = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (l > 1e-20) { nx /= l; ny /= l; nz /= l; } else { nx = 0; ny = 0; nz = 1; }
    for (var v = 0; v < 3; v++) {
      out[p + v * 3] = nx; out[p + v * 3 + 1] = ny; out[p + v * 3 + 2] = nz;
    }
  }
  return out;
}

// 三角形の向きを一括反転 (法線が内向きだった場合の是正)
function flipWinding(positions) {
  var tri = positions.length / 9;
  for (var i = 0; i < tri; i++) {
    var p = i * 9;
    for (var k = 0; k < 3; k++) {
      var t = positions[p + 3 + k];
      positions[p + 3 + k] = positions[p + 6 + k];
      positions[p + 6 + k] = t;
    }
  }
  return positions;
}

// ワールド変換を適用した binary STL を生成する
// parts: [{positions: Float32Array, matrix: Float32Array}]
function buildBinarySTL(parts, header) {
  var total = 0, i, j;
  for (i = 0; i < parts.length; i++) total += parts[i].positions.length / 9;
  var buf = new ArrayBuffer(84 + total * 50);
  var dv = new DataView(buf);
  var head = (header || 'stl-viewer export') + '';
  for (i = 0; i < 80; i++) dv.setUint8(i, i < head.length ? (head.charCodeAt(i) & 0x7f) : 0x20);
  dv.setUint32(80, total, true);
  var off = 84;
  var a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0];
  for (i = 0; i < parts.length; i++) {
    var pos = parts[i].positions, m = parts[i].matrix;
    // 鏡映変換 (行列式が負) では頂点順序を入れ替えて表裏を保つ
    var det = m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]);
    var mirrored = det < 0;
    var tri = pos.length / 9;
    for (j = 0; j < tri; j++) {
      var p = j * 9;
      M4.xformPoint(a, m, [pos[p], pos[p + 1], pos[p + 2]]);
      M4.xformPoint(b, m, [pos[p + 3], pos[p + 4], pos[p + 5]]);
      M4.xformPoint(c, m, [pos[p + 6], pos[p + 7], pos[p + 8]]);
      if (mirrored) { var tmp = b; b = c; c = tmp; }
      var e1 = V3.sub([0, 0, 0], b, a), e2 = V3.sub([0, 0, 0], c, a);
      var n = V3.norm(V3.cross([0, 0, 0], e1, e2));
      dv.setFloat32(off, n[0], true); dv.setFloat32(off + 4, n[1], true); dv.setFloat32(off + 8, n[2], true);
      off += 12;
      var vs = [a, b, c];
      for (var k = 0; k < 3; k++) {
        dv.setFloat32(off, vs[k][0], true);
        dv.setFloat32(off + 4, vs[k][1], true);
        dv.setFloat32(off + 8, vs[k][2], true);
        off += 12;
      }
      dv.setUint16(off, 0, true); off += 2;
    }
  }
  return buf;
}
