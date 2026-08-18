// ---------------------------------------------------------------------------
// WebGL2 の薄いラッパとシェーダ定義
// ---------------------------------------------------------------------------

var MESH_VS = [
  '#version 300 es',
  'layout(location=0) in vec3 aPos;',
  'layout(location=1) in vec3 aNormal;',
  'uniform mat4 uMVP;',
  'uniform mat4 uModel;',
  'uniform mat4 uNormalMat;',
  'out vec3 vWorld;',
  'out vec3 vNormal;',
  'void main(){',
  '  vec4 w = uModel * vec4(aPos, 1.0);',
  '  vWorld = w.xyz;',
  '  vNormal = mat3(uNormalMat) * aNormal;',
  '  gl_Position = uMVP * vec4(aPos, 1.0);',
  '}'
].join('\n');

var MESH_FS = [
  '#version 300 es',
  'precision highp float;',
  'in vec3 vWorld;',
  'in vec3 vNormal;',
  'uniform vec4 uClip[6];',
  'uniform int uClipCount;',
  'uniform vec3 uColor;',
  'uniform float uOpacity;',
  'uniform int uShadeMode;',   // 0: 単色, 1: オーバーハング, 2: 高さ
  'uniform float uOverhangSin;',
  'uniform float uBedZ;',
  'uniform float uHeightMax;',
  'uniform float uSelected;',
  'out vec4 fragColor;',
  'vec3 heatmap(float t){',
  '  t = clamp(t, 0.0, 1.0);',
  '  return clamp(vec3(1.5 - abs(4.0*t - 3.0), 1.5 - abs(4.0*t - 2.0), 1.5 - abs(4.0*t - 1.0)), 0.0, 1.0);',
  '}',
  'void main(){',
  '  for(int i=0;i<6;i++){',
  '    if(i >= uClipCount) break;',
  '    if(dot(vec4(vWorld,1.0), uClip[i]) > 0.0) discard;',
  '  }',
  '  vec3 n = normalize(vNormal);',
  '  bool front = gl_FrontFacing;',
  '  if(!front) n = -n;',
  '  vec3 base = uColor;',
  '  if(uShadeMode == 1){',
  '    float d = -n.z;',
  '    bool onBed = (vWorld.z <= uBedZ + 0.2) && d > 0.9;',
  '    if(onBed){ base = vec3(0.20, 0.72, 0.45); }',
  '    else if(d > uOverhangSin){',
  '      float f = clamp((d - uOverhangSin) / max(1e-3, 1.0 - uOverhangSin), 0.0, 1.0);',
  '      base = mix(vec3(0.98, 0.78, 0.20), vec3(0.95, 0.20, 0.18), f);',
  '    } else { base = vec3(0.58, 0.60, 0.64); }',
  '  } else if(uShadeMode == 2){',
  '    base = heatmap((vWorld.z - uBedZ) / max(1e-3, uHeightMax));',
  '  }',
  '  if(!front) base *= 0.45;',
  '  vec3 lightA = normalize(vec3(0.45, -0.75, 0.75));',
  '  vec3 lightB = normalize(vec3(-0.6, 0.4, 0.35));',
  '  float dA = max(dot(n, lightA), 0.0);',
  '  float dB = max(dot(n, lightB), 0.0) * 0.35;',
  '  float amb = 0.34 + 0.16 * (n.z * 0.5 + 0.5);',
  '  vec3 col = base * (amb + dA * 0.62 + dB);',
  '  col = mix(col, vec3(1.0), uSelected * 0.12);',
  '  col = pow(col, vec3(0.4545));',
  '  fragColor = vec4(col, uOpacity);',
  '}'
].join('\n');

var LINE_VS = [
  '#version 300 es',
  'layout(location=0) in vec3 aPos;',
  'uniform mat4 uMVP;',
  'void main(){ gl_Position = uMVP * vec4(aPos, 1.0); }'
].join('\n');

var LINE_FS = [
  '#version 300 es',
  'precision highp float;',
  'uniform vec4 uColor;',
  'out vec4 fragColor;',
  'void main(){ fragColor = uColor; }'
].join('\n');

var CAP_VS = [
  '#version 300 es',
  'layout(location=0) in vec3 aPos;',
  'uniform mat4 uMVP;',
  'out vec3 vWorld;',
  'void main(){ vWorld = aPos; gl_Position = uMVP * vec4(aPos, 1.0); }'
].join('\n');

var CAP_FS = [
  '#version 300 es',
  'precision highp float;',
  'in vec3 vWorld;',
  'uniform vec4 uClip[6];',
  'uniform int uClipCount;',
  'uniform vec3 uColor;',
  'out vec4 fragColor;',
  'void main(){',
  '  for(int i=0;i<6;i++){',
  '    if(i >= uClipCount) break;',
  '    if(dot(vec4(vWorld,1.0), uClip[i]) > 0.0001) discard;',
  '  }',
  '  fragColor = vec4(pow(uColor, vec3(0.4545)), 1.0);',
  '}'
].join('\n');

function compileShader(gl, type, src) {
  var sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    var log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error('シェーダのコンパイルに失敗しました: ' + log);
  }
  return sh;
}

function createProgram(gl, vsSrc, fsSrc) {
  var vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
  var fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  var p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    var log = gl.getProgramInfoLog(p);
    gl.deleteProgram(p);
    throw new Error('シェーダのリンクに失敗しました: ' + log);
  }
  var uniforms = {};
  var count = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (var i = 0; i < count; i++) {
    var info = gl.getActiveUniform(p, i);
    var name = info.name.replace(/\[0\]$/, '');
    uniforms[name] = gl.getUniformLocation(p, name);
  }
  return { program: p, u: uniforms };
}

// 動的な線分バッファ (グリッド、バウンディングボックス、断面輪郭など)
function createDynamicLineBuffer(gl) {
  var vao = gl.createVertexArray();
  var vbo = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  return {
    vao: vao, vbo: vbo, count: 0,
    upload: function (arr) {
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, arr, gl.DYNAMIC_DRAW);
      this.count = arr.length / 3;
    }
  };
}
