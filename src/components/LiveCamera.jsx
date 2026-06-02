/**
 * LiveCamera — 라이브 카메라 프리뷰 + ArUco 실시간 감지 + "촬영" 셔터
 *
 * [변경] 라이브 프리뷰에서 매 프레임 ArUco 마커를 실시간 감지.
 *   - 마커 감지 시: 초록 오버레이 + 셔터 버튼 활성화 + "탭하여 촬영" 안내
 *   - 마커 없을 때: 셔터 버튼 비활성 + "마커를 화면에 맞춰주세요" 안내
 *   - onLiveMarker(bool) 콜백으로 부모에 감지 상태 전달 (optional)
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import styles from './LiveCamera.module.css'

const MARKER_REAL_MM     = 40
const MIN_SIDE_PX        = 60
const DETECT_INTERVAL_MS = 150  // ~6fps (모바일 CPU 보호)

// ── ArUco 검출기 싱글턴 ──────────────────────────────────────────────────────
let _detector = null
let _detectorLoading = false
let _detectorError   = null

async function getDetector() {
  if (_detector)      return _detector
  if (_detectorError) throw new Error(_detectorError)
  if (_detectorLoading) {
    await new Promise(r => setTimeout(r, 500))
    return getDetector()
  }
  _detectorLoading = true
  try {
    const mod = await import('js-aruco2')
    const AR  = mod.AR ?? mod.default?.AR
    const Det = AR?.Detector ?? mod.Detector ?? mod.default
    if (!Det) throw new Error('Detector 클래스를 찾을 수 없습니다')
    try { _detector = new Det({ dictionary: '4X4_50' }) }
    catch { _detector = new Det() }
    return _detector
  } catch (err) {
    _detectorError = `ArUco 로드 실패: ${err.message}`
    throw new Error(_detectorError)
  } finally {
    _detectorLoading = false
  }
}

function avgSidePx(corners) {
  let t = 0
  for (let i = 0; i < 4; i++) {
    const a = corners[i], b = corners[(i + 1) % 4]
    t += Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2)
  }
  return t / 4
}

// ── 오버레이 캔버스에 마커 박스 그리기 ──────────────────────────────────────
function drawMarkerBox(canvas, video, corners) {
  const ctx  = canvas.getContext('2d')
  const vw   = video.videoWidth
  const vh   = video.videoHeight
  const cw   = canvas.width
  const ch   = canvas.height

  ctx.clearRect(0, 0, cw, ch)
  if (!corners) return

  // object-fit:cover 기준 스케일 계산
  const vidAR  = vw / vh
  const canAR  = cw / ch
  let scaleX, scaleY, offX, offY
  if (vidAR > canAR) {
    scaleY = ch / vh; scaleX = scaleY
    offX   = (cw - vw * scaleX) / 2; offY = 0
  } else {
    scaleX = cw / vw; scaleY = scaleX
    offX   = 0; offY = (ch - vh * scaleY) / 2
  }

  const pts = corners.map(c => ({
    x: offX + c.x * scaleX,
    y: offY + c.y * scaleY,
  }))

  ctx.beginPath()
  pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y))
  ctx.closePath()
  ctx.fillStyle   = 'rgba(0,255,136,0.15)'
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
  const cx = pts.reduce((s, p) => s + p.x, 0) / 4
  const cy = pts.reduce((s, p) => s + p.y, 0) / 4
  ctx.font      = 'bold 13px sans-serif'
  ctx.fillStyle = '#00ff88'
  ctx.textAlign = 'center'
  ctx.fillText('ArUco 40mm', cx, cy + 5)
}

// ── 컴포넌트 ─────────────────────────────────────────────────────────────────
export default function LiveCamera({
  stream,
  onCapture,
  onFileCapture,
  onClose,
  onRetry,
  onLiveMarker,          // (found: bool) => void  (optional)
  errorMsg = '',
  hint = '마커가 보이도록 놓고 촬영하세요',
}) {
  const videoRef   = useRef(null)
  const overlayRef = useRef(null)
  const offRef     = useRef(null)   // 오프스크린 캔버스
  const rafRef     = useRef(null)
  const lastRef    = useRef(0)
  const fileRef    = useRef(null)

  const [videoState,   setVideoState]   = useState({ ready: false, width: 0, height: 0, error: '' })
  const [markerFound,  setMarkerFound]  = useState(false)
  const markerFoundRef = useRef(false)  // RAF 루프용 최신값

  // 오프스크린 캔버스 초기화
  useEffect(() => {
    offRef.current = document.createElement('canvas')
    offRef.current.getContext('2d', { willReadFrequently: true })
  }, [])

  // 스트림 연결
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (stream) {
      video.srcObject = stream
      setVideoState({ ready: false, width: 0, height: 0, error: '' })
      video.play()
        .then(() => setVideoState({
          ready:  video.videoWidth > 0,
          width:  video.videoWidth,
          height: video.videoHeight,
          error:  '',
        }))
        .catch(err => setVideoState(prev => ({
          ...prev,
          error: `영상 재생 실패: ${err.name} ${err.message}`.trim(),
        })))
    } else {
      video.srcObject = null
      setVideoState({ ready: false, width: 0, height: 0, error: '' })
      setMarkerFound(false)
      markerFoundRef.current = false
    }
  }, [stream])

  // ArUco 실시간 감지 RAF 루프
  const loop = useCallback(async (now) => {
    rafRef.current = requestAnimationFrame(loop)

    const video   = videoRef.current
    const overlay = overlayRef.current
    const off     = offRef.current
    if (!video || !overlay || video.readyState < 2) return
    if (!video.videoWidth || !video.videoHeight)    return

    // 오버레이 크기 동기화
    const cw = overlay.clientWidth
    const ch = overlay.clientHeight
    if (overlay.width !== cw || overlay.height !== ch) {
      overlay.width  = cw
      overlay.height = ch
    }

    // 주기 제한
    if (now - lastRef.current < DETECT_INTERVAL_MS) return
    lastRef.current = now

    // 오프스크린에 현재 프레임 캡처
    const vw = video.videoWidth
    const vh = video.videoHeight
    off.width  = vw
    off.height = vh
    off.getContext('2d', { willReadFrequently: true }).drawImage(video, 0, 0, vw, vh)
    const imageData = off.getContext('2d').getImageData(0, 0, vw, vh)

    try {
      const det     = await getDetector()
      const markers = (det.detect(imageData) ?? []).filter(m => avgSidePx(m.corners) >= MIN_SIDE_PX)
      const found   = markers.length > 0
      const corners = found
        ? markers.reduce((a, b) => avgSidePx(a.corners) > avgSidePx(b.corners) ? a : b).corners
        : null

      drawMarkerBox(overlay, video, corners)

      if (found !== markerFoundRef.current) {
        markerFoundRef.current = found
        setMarkerFound(found)
        onLiveMarker?.(found)
      }
    } catch (err) {
      console.error('[LiveCamera ArUco]', err)
    }
  }, [onLiveMarker])

  // 스트림 연결/해제 시 루프 시작/정지
  useEffect(() => {
    if (stream) {
      rafRef.current = requestAnimationFrame(loop)
    } else {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [stream, loop])

  // ── 기존 함수들 ──────────────────────────────────────────────────────────

  async function ensurePlay() {
    const video = videoRef.current
    if (!video) return
    try {
      await video.play()
      setVideoState({ ready: video.videoWidth > 0, width: video.videoWidth, height: video.videoHeight, error: '' })
    } catch (err) {
      setVideoState(prev => ({ ...prev, error: `영상 재생 실패: ${err.name} ${err.message}`.trim() }))
    }
  }

  function updateVideoReady() {
    const video = videoRef.current
    if (!video) return
    setVideoState({ ready: video.videoWidth > 0, width: video.videoWidth, height: video.videoHeight, error: '' })
  }

  function handleShutter() {
    const video = videoRef.current
    if (!video || video.readyState < 2 || !video.videoWidth) {
      setVideoState(prev => ({ ...prev, error: '카메라 영상이 준비되지 않았습니다.' }))
      return
    }
    const cap = document.createElement('canvas')
    cap.width  = video.videoWidth
    cap.height = video.videoHeight
    cap.getContext('2d').drawImage(video, 0, 0)
    const dataUrl = cap.toDataURL('image/jpeg', 0.92)
    onCapture({ canvas: cap, dataUrl, videoW: cap.width, videoH: cap.height })
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file || !onFileCapture) return
    onFileCapture(file)
    e.target.value = ''
  }

  // 셔터 버튼: 마커 감지 전에는 비활성 스타일, 감지 후 활성 스타일
  const shutterReady = stream && videoState.ready && markerFound

  return (
    <div className={styles.container}>
      <input
        ref={fileRef}
        className={styles.fileInput}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
      />

      <video
        ref={videoRef}
        className={styles.video}
        playsInline
        webkit-playsinline="true"
        muted
        autoPlay
        onClick={ensurePlay}
        onLoadedMetadata={updateVideoReady}
        onCanPlay={updateVideoReady}
      />

      {/* ArUco 실시간 감지 오버레이 */}
      <canvas
        ref={overlayRef}
        style={{
          position: 'absolute', inset: 0,
          width: '100%', height: '100%',
          pointerEvents: 'none',
        }}
      />

      {!stream && (
        <div className={styles.playOverlay}>
          <span>카메라가 시작되지 않았습니다</span>
          <small>주소가 https인지 확인하고, 브라우저의 카메라 권한을 허용해 주세요.</small>
          {errorMsg && <em>{errorMsg}</em>}
          {onRetry && (
            <button className={styles.retryBtn} onClick={onRetry}>카메라 다시 켜기</button>
          )}
          {onFileCapture && (
            <button className={styles.fileBtn} onClick={() => fileRef.current?.click()}>사진으로 촬영하기</button>
          )}
        </div>
      )}

      {stream && !videoState.ready && (
        <button className={styles.playOverlay} onClick={ensurePlay}>
          <span>카메라 연결 중</span>
          <small>검은 화면이면 여기를 한 번 누르세요</small>
          {videoState.error && <em>{videoState.error}</em>}
        </button>
      )}

      {/* 안내 힌트 — 마커 감지 여부에 따라 내용 변경 */}
      {stream && videoState.ready && (
        <div className={`${styles.hint} ${markerFound ? styles.hintReady : ''}`}>
          {markerFound ? '마커 감지됨 — 탭하여 촬영' : '마커를 화면에 맞춰주세요'}
        </div>
      )}
      {(!stream || !videoState.ready) && hint && (
        <div className={styles.hint}>{hint}</div>
      )}

      <div className={styles.debugBadge}>
        stream {stream ? 'ON' : 'OFF'} · video {videoState.width}×{videoState.height}
        {stream && ` · 마커 ${markerFound ? '✓' : '✗'}`}
      </div>

      {/* 셔터 버튼 — 마커 감지 시 활성화 */}
      <button
        className={`${styles.shutter} ${shutterReady ? styles.shutterReady : styles.shutterWaiting}`}
        onClick={stream ? handleShutter : () => fileRef.current?.click()}
        aria-label="사진 촬영"
        disabled={stream && videoState.ready && !markerFound}
      >
        <span className={styles.shutterInner} />
      </button>

      <button className={styles.closeBtn} onClick={onClose} aria-label="카메라 닫기">✕</button>
    </div>
  )
}
