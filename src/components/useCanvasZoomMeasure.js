// useCanvasZoomMeasure.js
// FrozenMeasure.jsx에서 import해서 사용
// 팝업 루페 없이 캔버스 자체를 확대하는 방식

import { useState, useRef, useCallback } from 'react';

const ZOOM = 3;

export function useCanvasZoomMeasure({ canvasRef, wrapperRef, pixelPerMm, onDone }) {
  // step: 0=P1탭대기 | 1=P1확대중 | 2=P2탭대기 | 3=P2확대중 | 4=완료
  const [step, setStep]           = useState(0);
  const [p1, setP1]               = useState(null);   // { x, y } 내부 픽셀
  const [p2, setP2]               = useState(null);
  const [active, setActive]       = useState(null);   // 현재 조정 중인 픽셀
  const [cssTransform, setCss]    = useState('none'); // canvas CSS transform 값
  const [distMm, setDistMm]       = useState(null);

  // ── 픽셀 → transform 계산 ──────────────────────────────────────
  const buildTransform = useCallback((pixelX, pixelY) => {
    const canvas  = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return 'none';

    const ww = wrapper.offsetWidth;
    const wh = wrapper.offsetHeight;
    const scaleX = canvas.width  / canvas.offsetWidth;
    const scaleY = canvas.height / canvas.offsetHeight;

    // 내부 픽셀 → CSS 표시 좌표
    const cx = pixelX / scaleX;
    const cy = pixelY / scaleY;

    // transform-origin:0 0 기준으로 (cx,cy)가 wrapper 중앙에 오게
    const tx = ww / (2 * ZOOM) - cx;
    const ty = wh / (2 * ZOOM) - cy;

    return `scale(${ZOOM}) translate(${tx}px, ${ty}px)`;
  }, [canvasRef, wrapperRef]);

  // ── 캔버스 탭 핸들러 ──────────────────────────────────────────
  const handleTap = useCallback((e) => {
    if (step !== 0 && step !== 2) return; // 대기 상태에서만
    e?.preventDefault?.();

    const canvas = canvasRef.current;
    const rect   = canvas.getBoundingClientRect();
    // Support touchstart/touchend events: prefer touches[0], then changedTouches[0], then event
    const touch  = (e && e.touches && e.touches[0]) || (e && e.changedTouches && e.changedTouches[0]) || e;
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;

    const px = Math.round(((touch.clientX ?? touch.pageX) - rect.left) * scaleX);
    const py = Math.round(((touch.clientY ?? touch.pageY) - rect.top)  * scaleY);

    console.log('handleTap called', px, py)

    setActive({ x: px, y: py });
    setCss(buildTransform(px, py));
    setStep(s => s + 1); // 0→1 또는 2→3
  }, [step, canvasRef, buildTransform]);

  // ── 화살표 버튼 미세 이동 ────────────────────────────────────
  const nudge = useCallback((dx, dy) => {
    setActive(prev => {
      if (!prev) return prev;
      const next = { x: prev.x + dx, y: prev.y + dy };
      setCss(buildTransform(next.x, next.y));
      return next;
    });
  }, [buildTransform]);

  // ── 점 확정 ──────────────────────────────────────────────────
  const confirm = useCallback(() => {
    if (!active) return;
    setCss('none'); // 축소 복귀

    if (step === 1) {
      setP1(active);
      setStep(2);
    } else if (step === 3) {
      const _p2 = active;
      setP2(_p2);
      setStep(4);

      // 거리 계산
      const dx = _p2.x - p1.x;
      const dy = _p2.y - p1.y;
      const mm = Math.sqrt(dx * dx + dy * dy) / pixelPerMm;
      const result = +mm.toFixed(2);
      setDistMm(result);
      onDone && onDone(result);
    }
  }, [active, step, p1, pixelPerMm, onDone]);

  // ── 취소 (확대 해제) ─────────────────────────────────────────
  const cancel = useCallback(() => {
    setCss('none');
    setStep(s => s - 1); // 1→0 또는 3→2
    setActive(null);
  }, []);

  // ── 초기화 ───────────────────────────────────────────────────
  const reset = useCallback(() => {
    setStep(0); setP1(null); setP2(null);
    setActive(null); setCss('none'); setDistMm(null);
  }, []);

  const isZooming = step === 1 || step === 3;
  const stepLabel = [
    'P1: 줄기 한쪽 끝을 탭하세요',
    'P1 위치 조정 후 확정하세요',
    'P2: 줄기 반대쪽 끝을 탭하세요',
    'P2 위치 조정 후 확정하세요',
    '측정 완료',
  ][step] ?? '';

  return {
    step, p1, p2, active, cssTransform: cssTransform, distMm,
    isZooming, stepLabel,
    handleTap, nudge, confirm, cancel, reset,
  };
}
