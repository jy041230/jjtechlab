import { useState, useCallback, useEffect } from 'react'

const ERROR_MSGS = {
  NotAllowedError:       '카메라 권한이 거부되었습니다.\n브라우저 설정 → 사이트 설정 → 카메라에서 허용해 주세요.',
  PermissionDeniedError: '카메라 권한이 거부되었습니다.\n브라우저 설정 → 사이트 설정 → 카메라에서 허용해 주세요.',
  NotFoundError:         '카메라를 찾을 수 없습니다. 장치에 카메라가 있는지 확인해 주세요.',
  DevicesNotFoundError:  '카메라를 찾을 수 없습니다.',
  NotReadableError:      '카메라가 다른 앱에서 사용 중입니다. 다른 앱을 닫고 다시 시도해 주세요.',
  TrackStartError:       '카메라를 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.',
  OverconstrainedError:  '카메라 해상도 설정 오류입니다. 다시 시도해 주세요.',
  NotSupportedError:     'HTTPS가 필요합니다. https:// 주소로 접속 중인지 확인해 주세요.',
}

const CAMERA_CONSTRAINTS = [
  {
    video: {
      facingMode: { ideal: 'environment' },
      width:  { ideal: 1920 },
      height: { ideal: 1080 },
    },
    audio: false,
  },
  {
    video: {
      facingMode: { ideal: 'environment' },
    },
    audio: false,
  },
  {
    video: true,
    audio: false,
  },
]

export function useCamera() {
  const [stream, setStream] = useState(null)
  const [cameraError, setCameraError] = useState(null)
  const [isActive, setIsActive] = useState(false)

  const start = useCallback(async () => {
    setCameraError(null)

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError(
        '이 브라우저는 카메라를 지원하지 않습니다.\n' +
        'Chrome 또는 Safari(iOS 14.3+)를 사용하고\n' +
        'https:// 주소로 접속해 주세요.\n' +
        `현재 주소: ${location.protocol}//${location.host}`
      )
      return
    }

    try {
      let s = null
      let lastErr = null
      for (const constraints of CAMERA_CONSTRAINTS) {
        try {
          s = await navigator.mediaDevices.getUserMedia(constraints)
          break
        } catch (err) {
          lastErr = err
        }
      }
      if (!s) throw lastErr
      setStream(s)
      setIsActive(true)
    } catch (err) {
      console.error('[camera]', err)
      setCameraError(
        (ERROR_MSGS[err.name] ?? `카메라 오류 (${err.name}): ${err.message}`) +
        `\n현재 주소: ${location.protocol}//${location.host}` +
        `\n보안 컨텍스트: ${window.isSecureContext ? '예' : '아니오'}`
      )
      setIsActive(false)
    }
  }, [])

  const stop = useCallback(() => {
    setStream(prev => {
      prev?.getTracks().forEach(t => t.stop())
      return null
    })
    setIsActive(false)
    setCameraError(null)
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stream?.getTracks().forEach(t => t.stop())
    }
  }, [stream])

  return { stream, cameraError, isActive, start, stop }
}
