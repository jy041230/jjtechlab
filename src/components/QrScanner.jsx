/**
 * QrScanner — 수목 QR 코드를 카메라로 읽어 수목ID를 반환
 *
 * QR 내용 규칙(둘 다 허용):
 *   1) 수목ID 그대로: "케이싱1년-03"
 *   2) 리포트 URL:    "...?tree=케이싱1년-03"  → tree= 뒤를 추출
 *
 * 측정 정확도(ArUco)와 무관. 측정 전에 수목을 정하는 용도.
 */
import { useRef, useEffect, useState } from 'react'
import jsQR from 'jsqr'
import styles from './QrScanner.module.css'

export default function QrScanner({ onResult, onCancel }) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const rafRef = useRef(null)
  const streamRef = useRef(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        })
        if (!alive) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
          tick()
        }
      } catch (e) {
        setError('카메라를 열 수 없습니다. 권한을 확인해 주세요.')
      }
    })()

    function tick() {
      const video = videoRef.current
      const canvas = canvasRef.current
      if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
        rafRef.current = requestAnimationFrame(tick)
        return
      }
      const w = video.videoWidth, h = video.videoHeight
      canvas.width = w; canvas.height = h
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(video, 0, 0, w, h)
      const imgData = ctx.getImageData(0, 0, w, h)
      const code = jsQR(imgData.data, w, h, { inversionAttempts: 'dontInvert' })
      if (code && code.data) {
        const id = parseTreeId(code.data)
        if (id) { stop(); onResult(id); return }
      }
      rafRef.current = requestAnimationFrame(tick)
    }

    function stop() {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      streamRef.current?.getTracks().forEach(t => t.stop())
    }

    return () => { alive = false; stop() }
  }, [onResult])

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <button className={styles.backBtn} onClick={onCancel}>← 취소</button>
        <span className={styles.title}>수목 QR 스캔</span>
        <span style={{ width: 64 }} />
      </header>
      <div className={styles.viewport}>
        <video ref={videoRef} className={styles.video} playsInline muted />
        <canvas ref={canvasRef} style={{ display: 'none' }} />
        <div className={styles.frame} />
        {error
          ? <div className={styles.error}>{error}</div>
          : <div className={styles.hint}>수목에 붙은 QR 코드를 사각형 안에 맞춰 주세요</div>}
      </div>
    </div>
  )
}

/** QR 내용에서 수목ID 추출 */
function parseTreeId(raw) {
  const s = String(raw).trim()
  // URL 형태면 tree= 파라미터 추출
  const m = s.match(/[?&]tree=([^&]+)/)
  if (m) return decodeURIComponent(m[1])
  // 그 외엔 내용 자체를 수목ID로 (URL이 아닐 때만)
  if (!/^https?:\/\//i.test(s)) return s
  return null
}
