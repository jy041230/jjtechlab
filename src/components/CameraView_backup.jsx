/**
 * CameraView — 카메라 프리뷰 + ArUco 마커 검출 + 줄기 끝점 탭 입력
 *
 * ArUco 검출 로직은 aruco_calibration_v21.py의 _side_length_px / detect_aruco를 JS로 이식:
 *   - 4변 평균 픽셀 길이 → pixel_per_mm = side_px / MARKER_REAL_MM
 *   - MIN_SIDE_PX(60) 미만 마커는 노이즈로 제거 (Python: _MIN_VALID_SIDE_PX)
 *   - 여러 마커 검출 시 가장 큰(가까운) 마커 사용
 *
 * js-aruco2 라이브러리: OpenCV DICT_4X4_50과 동일한 비트 패턴을 사용하는
 * 순수 JS 구현. OpenCV.js aruco 모듈의 브라우저 대체재.
 */
import { useEffect, useRef, useCallback } from 'react'
import styles from './CameraView.module.css'

const MARKER_REAL_MM = 40   // 물리 마커 한 변 40mm
const MIN_SIDE_PX    = 60   // 최소 유효 마커 변 길이 (노이즈 차단)
const DETECT_INTERVAL_MS = 120  // 검출 주기 ~8fps (모바일 CPU 보호)

// ── ArUco 검출기 싱글턴 ──────────────────────────────────────────────────────
let _detector = null
let _detectorLoading = false
let _detectorError = null

async function getDetector() {
  if (_detector)       return _detector
  if (_detectorError)  throw new Error(_detectorError)
  if (_detectorLoading) {
    // 다른 호출이 로딩 중이면 완료까지 대기
    await new Promise(r => setTimeout(r, 500))
    return getDetector()
  }

  _detectorLoading = true
  try {
    const mod = await import('js-aruco2')
    // js-aruco2 export 형태 유연하게 처리
    const AR = mod.AR ?? mod.default?.AR
    const Detector = AR?.Detector ?? mod.Detector ?? mod.default

    if (!Detector) throw new Error('Detector 클래스를 찾을 수 없습니다')

    // DICT_4X4_50 우선, 지원 안 되면 기본 ARUCO dict 사용
    try {
      _detector = new Detector({ dictionary: '4X4_50' })
    } catch {
      console.warn('[ArUco] 4X4_50 사전 미지원 — 기본 ARUCO 사전 사용')
      _detector = new Detector()
    }
    return _detector
  } catch (err) {
    _detectorError = `ArUco 라이브러리 로드 실패: ${err.message}`
    throw new Error(_detectorError)
  } finally {
    _detectorLoading = false
  }
}

// ── 4변 평균 픽셀 길이 (Python: _side_length_px) ─────────────────────────────
function avgSidePx(corners) {
  let total = 0
  for (let i = 0; i < 4; i++) {
    const a = corners[i]
    const b = corners[(i + 1) % 4]
    total += Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2)
  }
  return total / 4
}

// ── object-fit:contain 기준 비디오 표시 영역 계산 ───────────────────────────
function getVideoDisplayRect(videoW, videoH, contW, contH) {
  const vidAR  = videoW / videoH
  const contAR = contW  / contH
  let displayW, displayH, offsetX, offsetY
  if (vidAR > contAR) {
    displayW = contW
    displayH = contW / vidAR
    offsetX  = 0
    offsetY  = (contH - displayH) / 2
  } else {
    displayH = contH
    displayW = contH * vidAR
    offsetX  = (contW - displayW) / 2
    offsetY  = 0
  }
  return { displayW, displayH, offsetX, offsetY }
}

// ── 캔버스 오버레이 그리기 ───────────────────────────────────────────────────
function drawOverlay(canvas, videoW, videoH, markerCorners, points, pixelPerMm) {
  const ctx   = canvas.getContext('2d')
  const contW = canvas.width
  const contH = canvas.height
  ctx.clearRect(0, 0, contW, contH)

  const { displayW, displayH, offsetX, offsetY } =
    getVideoDisplayRect(videoW, videoH, contW, contH)

  const toDisp = (vx, vy) => ({
    x: offsetX + (vx / videoW) * displayW,
    y: offsetY + (vy / videoH) * displayH,
  })

  // ArUco 마커 박스
  if (markerCorners?.length === 4) {
    const pts = markerCorners.map(c => toDisp(c.x, c.y))
    ctx.beginPath()
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
    ctx.closePath()
    ctx.fillStyle   = 'rgba(0,255,136,0.12)'
    ctx.fill()
    ctx.strokeStyle = '#00ff88'
    ctx.lineWidth   = 3
    ctx.stroke()
    pts.forEach(p => {
      ctx.beginPath()
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2)
      ctx.fillStyle = '#00ff88'
      ctx.fill()
    })
    // 레이블
    const cx = pts.reduce((s, p) => s + p.x, 0) / 4
    const cy = pts.reduce((s, p) => s + p.y, 0) / 4
    ctx.font      = 'bold 13px sans-serif'
    ctx.fillStyle = '#00ff88'
    ctx.textAlign = 'center'
    ctx.fillText(`ArUco 40mm`, cx, cy + 5)
  }

  // 측정 점 & 선
  if (points.length > 0 && pixelPerMm > 0) {
    const dispPts = points.map(p => toDisp(p.x, p.y))

    dispPts.forEach((p, i) => {
      // 십자선
      ctx.strokeStyle = '#ff6b35'
      ctx.lineWidth   = 2.5
      ctx.beginPath()
      ctx.moveTo(p.x - 18, p.y); ctx.lineTo(p.x + 18, p.y)
      ctx.moveTo(p.x, p.y - 18); ctx.lineTo(p.x, p.y + 18)
      ctx.stroke()
      // 원
      ctx.beginPath()
      ctx.arc(p.x, p.y, 11, 0, Math.PI * 2)
      ctx.strokeStyle = '#ff6b35'
      ctx.lineWidth   = 3
      ctx.stroke()
      // 레이블
      ctx.font      = 'bold 15px sans-serif'
      ctx.fillStyle = '#ffffff'
      ctx.textAlign = 'center'
      ctx.fillText(i === 0 ? 'P1' : 'P2', p.x, p.y - 20)
    })

    if (dispPts.length === 2) {
      // 측정선
      ctx.beginPath()
      ctx.moveTo(dispPts[0].x, dispPts[0].y)
      ctx.lineTo(dispPts[1].x, dispPts[1].y)
      ctx.strokeStyle = '#ff6b35'
      ctx.lineWidth   = 2
      ctx.setLineDash([6, 4])
      ctx.stroke()
      ctx.setLineDash([])

      // 중간 거리 레이블
      const midX   = (dispPts[0].x + dispPts[1].x) / 2
      const midY   = (dispPts[0].y + dispPts[1].y) / 2
      const pxDist = Math.sqrt(
        (points[1].x - points[0].x) ** 2 + (points[1].y - points[0].y) ** 2
      )
      const mm = pxDist / pixelPerMm
      ctx.font      = 'bold 18px sans-serif'
      ctx.fillStyle = '#ff6b35'
      ctx.textAlign = 'center'
      ctx.fillText(`${mm.toFixed(1)} mm`, midX, midY - 14)
    }
  }
}

// ── CameraView 컴포넌트 ───────────────────────────────────────────────────────
export default function CameraView({
  stream,
  tapPhase,        // 'detecting' | 'selecting_p1' | 'selecting_p2' | 'result'
  points,          // [{x,y}] in video coords (max 2)
  onMarkerUpdate,  // (markerState) => void
  onTap,           // ({x,y} in video coords) => void
}) {
  const videoRef     = useRef(null)
  const overlayRef   = useRef(null)
  const rafRef       = useRef(null)
  const lastDetectRef = useRef(0)
  const markerRef    = useRef({ found: false, pixelPerMm: 0, corners: null })
  const offCanvasRef = useRef(null) // 오프스크린 캔버스 (검출용)

  // 스트림 연결
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (stream) {
      video.srcObject = stream
      video.play().catch(() => {})
    } else {
      video.srcObject = null
    }
  }, [stream])

  // 오프스크린 캔버스 초기화
  useEffect(() => {
    offCanvasRef.current = document.createElement('canvas')
    offCanvasRef.current.getContext('2d', { willReadFrequently: true })
  }, [])

  // ArUco 검출 + 오버레이 RAF 루프
  const loop = useCallback(async (now) => {
    rafRef.current = requestAnimationFrame(loop)

    const video   = videoRef.current
    const overlay = overlayRef.current
    if (!video || !overlay || video.readyState < 2) return

    const vw = video.videoWidth
    const vh = video.videoHeight
    if (!vw || !vh) return

    // 오버레이 캔버스 크기를 컨테이너에 맞춤
    const cw = overlay.clientWidth
    const ch = overlay.clientHeight
    if (overlay.width !== cw || overlay.height !== ch) {
      overlay.width  = cw
      overlay.height = ch
    }

    // 검출 주기 제한
    if (now - lastDetectRef.current >= DETECT_INTERVAL_MS) {
      lastDetectRef.current = now

      // 오프스크린 캔버스에 비디오 프레임 그리기
      const off = offCanvasRef.current
      off.width  = vw
      off.height = vh
      const offCtx = off.getContext('2d', { willReadFrequently: true })
      offCtx.drawImage(video, 0, 0, vw, vh)
      const imageData = offCtx.getImageData(0, 0, vw, vh)

      try {
        const detector = await getDetector()
        const rawMarkers = detector.detect(imageData)

        // 유효 마커 필터링 (MIN_SIDE_PX 이상)
        const valid = (rawMarkers ?? []).filter(m => avgSidePx(m.corners) >= MIN_SIDE_PX)

        if (valid.length === 0) {
          if (markerRef.current.found) {
            markerRef.current = { found: false, pixelPerMm: 0, corners: null }
            onMarkerUpdate(markerRef.current)
          }
        } else {
          // 가장 큰(가까운) 마커 선택
          const best   = valid.reduce((a, b) => avgSidePx(a.corners) > avgSidePx(b.corners) ? a : b)
          const sidePx = avgSidePx(best.corners)
          const ppm    = sidePx / MARKER_REAL_MM
          const next   = { found: true, pixelPerMm: ppm, corners: best.corners, markerId: best.id }
          markerRef.current = next
          onMarkerUpdate(next)
        }
      } catch (err) {
        console.error('[ArUco]', err)
      }
    }

    // 매 프레임 오버레이 갱신
    const m = markerRef.current
    drawOverlay(overlay, vw, vh, m.found ? m.corners : null, points, m.pixelPerMm)
  }, [points, onMarkerUpdate])

  useEffect(() => {
    if (stream) {
      rafRef.current = requestAnimationFrame(loop)
    } else {
      cancelAnimationFrame(rafRef.current)
    }
    return () => cancelAnimationFrame(rafRef.current)
  }, [stream, loop])

  // 탭/클릭 → 비디오 좌표 변환
  function handleTap(e) {
    if (tapPhase !== 'selecting_p1' && tapPhase !== 'selecting_p2') return
    e.preventDefault()

    const overlay = overlayRef.current
    const video   = videoRef.current
    if (!overlay || !video) return

    const rect   = overlay.getBoundingClientRect()
    const touch  = e.changedTouches?.[0] ?? e
    const dispX  = touch.clientX - rect.left
    const dispY  = touch.clientY - rect.top

    const { displayW, displayH, offsetX, offsetY } =
      getVideoDisplayRect(video.videoWidth, video.videoHeight, overlay.clientWidth, overlay.clientHeight)

    // 비디오 표시 영역 밖 탭 무시
    if (dispX < offsetX || dispX > offsetX + displayW ||
        dispY < offsetY || dispY > offsetY + displayH) return

    const videoX = ((dispX - offsetX) / displayW) * video.videoWidth
    const videoY = ((dispY - offsetY) / displayH) * video.videoHeight
    onTap({ x: videoX, y: videoY })
  }

  const isTapping = tapPhase === 'selecting_p1' || tapPhase === 'selecting_p2'

  return (
    <div className={styles.wrapper}>
      <video
        ref={videoRef}
        className={styles.video}
        playsInline
        muted
        autoPlay
      />
      <canvas
        ref={overlayRef}
        className={`${styles.overlay} ${isTapping ? styles.tapCursor : ''}`}
        onTouchEnd={handleTap}
        onClick={handleTap}
      />

      {tapPhase === 'detecting' && (
        <div className={styles.hint}>
          ArUco 마커를 화면에 보이도록 놓으세요
        </div>
      )}
      {tapPhase === 'selecting_p1' && (
        <div className={`${styles.hint} ${styles.hintTap}`}>
          줄기 한쪽 끝을 탭하세요 (P1)
        </div>
      )}
      {tapPhase === 'selecting_p2' && (
        <div className={`${styles.hint} ${styles.hintTap}`}>
          줄기 반대쪽 끝을 탭하세요 (P2)
        </div>
      )}
    </div>
  )
}
