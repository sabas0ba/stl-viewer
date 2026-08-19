// ---------------------------------------------------------------------------
// エントリポイント
// ---------------------------------------------------------------------------

function createApp() {
  return {
    parts: [],
    bed: [220, 220, 250],
    bedShape: 'rect',
    gridStep: 10,
    margin: 5,
    layout: 'single',
    singleView: 'iso',
    orbitCam: makeOrbitCamera(),
    orthoCam: { center: [110, 110, 40], height: 300 },
    shadeMode: 0,
    showBed: true,
    showDims: true,
    showBBox: true,
    ghostOthers: false,
    xray: false,
    overhangDeg: 45,
    clips: [
      { axis: 0, enabled: false, value: 0, invert: false, cap: true },
      { axis: 1, enabled: false, value: 0, invert: false, cap: true },
      { axis: 2, enabled: false, value: 0, invert: false, cap: true }
    ],
    // 断面輪郭・断面図面が参照するクリップ平面の番号 (-1 は断面なし)
    activeClip: -1,
    measure: { points: [] },
    mode: null,
    selection: null,
    slice: null,
    hollowResult: null,
    hollowSource: null,
    contourLines: null,
    collisionResult: null,
    lastViewports: null,
    renderPending: false,
    R: null,
    overlay: null
  };
}

function main() {
  var app = createApp();
  // 自動テストおよび外部からの操作用フック
  window.__stlViewer = {
    app: app,
    parseSTL: parseSTL, buildBinarySTL: buildBinarySTL,
    computeBounds: computeBounds, computeMassProperties: computeMassProperties,
    overhangStats: overhangStats, sliceMetrics: sliceMetrics,
    detectCollisions: detectCollisions, updatePartMatrix: updatePartMatrix,
    partVolume: partVolume, partArea: partArea,
    applyScale: applyScale, refreshAll: refreshAll, requestRender: requestRender,
    updateMeasureTable: updateMeasureTable, fitView: fitView,
    projectToScreen: projectToScreen, pickAt: pickAt,
    buildViewDrawing: buildViewDrawing, buildSectionDrawing: buildSectionDrawing,
    renderDrawingsToPDF: renderDrawingsToPDF, renderDrawingToSVG: renderDrawingToSVG,
    paginateDrawing: paginateDrawing, collectDrawings: collectDrawings,
    printOptions: printOptions, outsideBedXY: outsideBedXY,
    applyBedChange: applyBedChange, syncBedInputs: syncBedInputs,
    hollowMesh: hollowMesh, hollowDefaults: hollowDefaults, hollowOptions: hollowOptions,
    surfaceNets: surfaceNets, chooseVoxelSize: chooseVoxelSize, infillPeriod: infillPeriod,
    createPart: createPart, filamentLength: filamentLength,
    setActiveClip: setActiveClip, setClipValue: setClipValue,
    clearClips: clearClips, currentClip: currentClip
  };
  var canvas = document.getElementById('gl');
  try {
    app.R = initRenderer(canvas);
  } catch (e) {
    document.getElementById('viewport').innerHTML =
      '<div style="padding:24px;color:#e05f4f">' + e.message + '</div>';
    return;
  }
  app.overlay = document.getElementById('overlay');
  setupControls(app);
  setupHollowControls(app);
  setupPrintControls(app);
  setupCanvasInteraction(app);
  app.orbitCam.center = [app.bed[0] / 2, app.bed[1] / 2, 30];
  app.orthoCam.center = [app.bed[0] / 2, app.bed[1] / 2, 30];
  fitView(app);
  refreshAll(app);
  setStatus(app, 'STL ファイルをドロップするか「STL を開く」から読み込んでください。');
  document.getElementById('status-right').textContent =
    'F: 全体表示 / Q: 3 面図 / 1-6: 視点 / Del: 削除 / Esc: 中止・断面解除 / ドラッグ: 回転・移動 / ホイール: 拡大';
}

main();
