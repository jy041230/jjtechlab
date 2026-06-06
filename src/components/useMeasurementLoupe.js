// useMeasurementLoupe.js
// ──────────────────────────────────────────────────────────────────
// ArUco 측정 화면에서 터치 시 루페(돋보기) + 픽셀 엣지 오버레이 제공
// 사용법: MeasurementCanvas.jsx에서 import해서 사용
// ──────────────────────────────────────────────────────────────────
import { useRef, useCallback } from 'react';

const LOUPE_SIZE   = 160;   // 루페 캔버스 픽셀 크기 (정사각형)
const ZOOM         = 8;     // 확대 배율
const SAMPLE_HALF  = Math.floor(LOUPE_SIZE / 2 / ZOOM); // 원본에서 읽을 반경
const EDGE_ALPHA   = 180;   // 엣지 오버레이 불투명도 (0-255)
const EDGE_COLOR   = [255, 80, 0]; // 엣지 색상 (주황-빨강)
const GRID_COLOR   = 'rgba(255,255,255,0.25)';

// ── Sobel 엣지 검출 ─────────────────────────────────────────────
function sobelEdges(imageData, width, height, threshold = 25) {
  const { data } = imageData;
  const edges = new Uint8Array(width * height); // 0 or 1

  const gray = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (r, c) => gray[(y + r) * width + (x + c)];
      const gx =
        -idx(-1, -1) + idx(-1, 1)
        - 2 * idx(0, -1) + 2 * idx(0, 1)
        - idx(1, -1) + idx(1, 1);
      const gy =
        -idx(-1, -1) - 2 * idx(-1, 0) - idx(-1, 1)
        + idx(1, -1) + 2 * idx(1, 0) + idx(1, 1);
      const mag = Math.sqrt(gx * gx + gy * gy);
      edges[y * width + x] = mag > threshold ? 1 : 0;
    }
  }
  return edges;
}

// ── 루페 캔버스 그리기 ───────────────────────────────────────────
function drawLoupe(loupeCtx, srcCanvas, cx, cy) {
  const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
  const sw = srcCanvas.width;
  const sh = srcCanvas.height;

  // 원본에서 샘플 영역 읽기
  const sx = Math.max(0, cx - SAMPLE_HALF);
  const sy = Math.max(0, cy - SAMPLE_HALF);
  const sw2 = Math.min(SAMPLE_HALF * 2 + 1, sw - sx);
  const sh2 = Math.min(SAMPLE_HALF * 2 + 1, sh - sy);

  const patch = srcCtx.getImageData(sx, sy, sw2, sh2);

  // 엣지 계산
  const edges = sobelEdges(patch, sw2, sh2);

  // 루페 캔버스 클리어
  loupeCtx.clearRect(0, 0, LOUPE_SIZE, LOUPE_SIZE);

  // 픽셀별 확대 그리기 + 엣지 오버레이
  const patchData = patch.data;
  for (let py = 0; py < sh2; py++) {
    for (let px = 0; px < sw2; px++) {
      const pi = (py * sw2 + px) * 4;
      const r = patchData[pi];
      const g = patchData[pi + 1];
      const b = patchData[pi + 2];

      const isEdge = edges[py * sw2 + px] === 1;
      const drawX = px * ZOOM;
      const drawY = py * ZOOM;

      // 원본 픽셀 색상
      loupeCtx.fillStyle = `rgb(${r},${g},${b})`;
      loupeCtx.fillRect(drawX, drawY, ZOOM, ZOOM);

      // 엣지 오버레이
      if (isEdge) {
        loupeCtx.fillStyle =
          `rgba(${EDGE_COLOR[0]},${EDGE_COLOR[1]},${EDGE_COLOR[2]},${EDGE_ALPHA / 255})`;
        loupeCtx.fillRect(drawX, drawY, ZOOM, ZOOM);
      }
    }
  }

  // 픽셀 격자선
  loupeCtx.strokeStyle = GRID_COLOR;
  loupeCtx.lineWidth = 0.5;
  for (let i = 0; i <= sw2; i++) {
    loupeCtx.beginPath();
    loupeCtx.moveTo(i * ZOOM, 0);
    loupeCtx.lineTo(i * ZOOM, sh2 * ZOOM);
    loupeCtx.stroke();
  }
  for (let j = 0; j <= sh2; j++) {
    loupeCtx.beginPath();
    loupeCtx.moveTo(0, j * ZOOM);
    loupeCtx.lineTo(sw2 * ZOOM, j * ZOOM);
    loupeCtx.stroke();
  }

  // 중심 십자선
  const midX = Math.floor(sw2 / 2) * ZOOM + ZOOM / 2;
  const midY = Math.floor(sh2 / 2) * ZOOM + ZOOM / 2;
  loupeCtx.strokeStyle = 'rgba(0,200,100,0.9)';
  loupeCtx.lineWidth = 1.5;
  // 수평선
  loupeCtx.beginPath();
  loupeCtx.moveTo(0, midY); loupeCtx.lineTo(LOUPE_SIZE, midY);
  loupeCtx.stroke();
  // 수직선
  loupeCtx.beginPath();
  loupeCtx.moveTo(midX, 0); loupeCtx.lineTo(midX, LOUPE_SIZE);
  loupeCtx.stroke();
  // 중심점 원
  loupeCtx.beginPath();
  loupeCtx.arc(midX, midY, 4, 0, Math.PI * 2);
  loupeCtx.strokeStyle = 'rgba(0,220,80,1)';
  loupeCtx.lineWidth = 2;
  loupeCtx.stroke();
}

// ── 훅 본체 ─────────────────────────────────────────────────────
export function useMeasurementLoupe(srcCanvasRef) {
  const loupeCanvasRef = useRef(null);
  const pointRef = useRef({ x: 0, y: 0 }); // 현재 선택 픽셀 좌표

  // 루페 업데이트
  const updateLoupe = useCallback((x, y, srcCanvasOverride) => {
    const srcCanvas = srcCanvasOverride || srcCanvasRef.current;
    const loupeCanvas = loupeCanvasRef.current;
    if (!srcCanvas || !loupeCanvas) return;

    pointRef.current = {
      x: Math.round(x),
      y: Math.round(y),
    };
    const ctx = loupeCanvas.getContext('2d');
    drawLoupe(ctx, srcCanvas, Math.round(x), Math.round(y));
  }, [srcCanvasRef]);

  // ±1픽셀 미세 조정
  const nudge = useCallback((dx, dy, srcCanvasOverride) => {
    const { x, y } = pointRef.current;
    updateLoupe(x + dx, y + dy, srcCanvasOverride);
  }, [updateLoupe]);

  // 현재 선택 좌표 반환
  const getPoint = useCallback(() => ({ ...pointRef.current }), []);

  return { loupeCanvasRef, updateLoupe, nudge, getPoint, LOUPE_SIZE };
}
