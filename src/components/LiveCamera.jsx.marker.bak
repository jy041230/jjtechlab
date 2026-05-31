/**
 * LiveCamera — 라이브 카메라 프리뷰 + "촬영" 셔터
 *
 * 라이브 영상은 object-fit:cover로 영역을 꽉 채운다.
 * 셔터 버튼을 탭하면 현재 프레임을 Canvas로 캡처해 onCapture()로 전달.
 */
import { useEffect, useRef, useState } from 'react'
import styles from './LiveCamera.module.css'

export default function LiveCamera({
  stream,
  onCapture,
  onFileCapture,
  onClose,
  onRetry,
  errorMsg = '',
  hint = '마커가 보이도록 놓고 촬영하세요',
}) {
  const videoRef = useRef(null)
  const fileRef = useRef(null)
  const [videoState, setVideoState] = useState({
    ready: false,
    width: 0,
    height: 0,
    error: '',
  })

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    if (stream) {
      video.srcObject = stream
      setVideoState({ ready: false, width: 0, height: 0, error: '' })
      video.play()
        .then(() => {
          setVideoState({
            ready: video.videoWidth > 0 && video.videoHeight > 0,
            width: video.videoWidth,
            height: video.videoHeight,
            error: '',
          })
        })
        .catch(err => {
          setVideoState(prev => ({
            ...prev,
            error: `영상 재생 실패: ${err.name || 'Error'} ${err.message || ''}`.trim(),
          }))
        })
    } else {
      video.srcObject = null
      setVideoState({ ready: false, width: 0, height: 0, error: '' })
    }
  }, [stream])

  async function ensurePlay() {
    const video = videoRef.current
    if (!video) return
    try {
      await video.play()
      setVideoState({
        ready: video.videoWidth > 0 && video.videoHeight > 0,
        width: video.videoWidth,
        height: video.videoHeight,
        error: '',
      })
    } catch (err) {
      setVideoState(prev => ({
        ...prev,
        error: `영상 재생 실패: ${err.name || 'Error'} ${err.message || ''}`.trim(),
      }))
    }
  }

  function updateVideoReady() {
    const video = videoRef.current
    if (!video) return
    setVideoState({
      ready: video.videoWidth > 0 && video.videoHeight > 0,
      width: video.videoWidth,
      height: video.videoHeight,
      error: '',
    })
  }

  function handleShutter() {
    const video = videoRef.current
    if (!video || video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
      setVideoState(prev => ({
        ...prev,
        error: '아직 카메라 영상이 준비되지 않았습니다. 화면을 한 번 터치한 뒤 다시 촬영하세요.',
      }))
      return
    }

    const cap = document.createElement('canvas')
    cap.width  = video.videoWidth
    cap.height = video.videoHeight
    cap.getContext('2d').drawImage(video, 0, 0)

    // JPEG 변환 (표시용 dataURL)
    const dataUrl = cap.toDataURL('image/jpeg', 0.92)
    onCapture({ canvas: cap, dataUrl, videoW: cap.width, videoH: cap.height })
  }

  function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file || !onFileCapture) return
    onFileCapture(file)
    e.target.value = ''
  }

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

      {!stream && (
        <div className={styles.playOverlay}>
          <span>카메라가 시작되지 않았습니다</span>
          <small>
            주소가 https인지 확인하고, 브라우저의 카메라 권한을 허용해 주세요.
          </small>
          {errorMsg && <em>{errorMsg}</em>}
          {onRetry && (
            <button className={styles.retryBtn} onClick={onRetry}>
              카메라 다시 켜기
            </button>
          )}
          {onFileCapture && (
            <button className={styles.fileBtn} onClick={() => fileRef.current?.click()}>
              사진으로 촬영하기
            </button>
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

      {hint && <div className={styles.hint}>{hint}</div>}

      <div className={styles.debugBadge}>
        stream {stream ? 'ON' : 'OFF'} · video {videoState.width}×{videoState.height}
      </div>

      {/* 셔터 버튼 — 중앙 하단 */}
      <button
        className={styles.shutter}
        onClick={stream ? handleShutter : () => fileRef.current?.click()}
        aria-label="사진 촬영"
      >
        <span className={styles.shutterInner} />
      </button>

      {/* 닫기 */}
      <button className={styles.closeBtn} onClick={onClose} aria-label="카메라 닫기">
        ✕
      </button>
    </div>
  )
}
