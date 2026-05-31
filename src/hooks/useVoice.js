import { useState, useRef, useCallback } from 'react'

function cleanSpeechText(text) {
  const tokens = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  if (!tokens.length) return ''

  const compact = []
  for (const token of tokens) {
    if (compact[compact.length - 1] !== token) compact.push(token)
  }

  let changed = true
  while (changed) {
    changed = false
    for (let size = Math.min(6, Math.floor(compact.length / 2)); size >= 1; size--) {
      for (let i = 0; i <= compact.length - size * 2; i++) {
        const first = compact.slice(i, i + size).join(' ')
        const second = compact.slice(i + size, i + size * 2).join(' ')
        if (first && first === second) {
          compact.splice(i, size)
          changed = true
          break
        }
      }
      if (changed) break
    }
  }

  return compact.join(' ')
}

function mergeSpeechText(prev, next) {
  const a = cleanSpeechText(prev)
  const b = cleanSpeechText(next)
  if (!a) return b
  if (!b) return a
  if (b.includes(a)) return cleanSpeechText(b)
  if (a.includes(b)) return cleanSpeechText(a)

  const aTokens = a.split(' ')
  const bTokens = b.split(' ')
  const max = Math.min(aTokens.length, bTokens.length)
  for (let size = max; size >= 1; size--) {
    const suffix = aTokens.slice(-size).join(' ')
    const prefix = bTokens.slice(0, size).join(' ')
    if (suffix === prefix) {
      return cleanSpeechText([...aTokens, ...bTokens.slice(size)].join(' '))
    }
  }

  return cleanSpeechText(`${a} ${b}`)
}

/**
 * useVoice — SpeechRecognition 래퍼
 *
 * 수정사항:
 * - e.resultIndex 기준으로 신규 결과만 누적 (중복 방지)
 * - finalsRef: final 텍스트 ref 보관 (재시작 시에도 유지)
 * - 모바일에서 조기 종료되면 자동 재시작하되, 같은 최종 문장은 중복 저장하지 않음
 * - 수동 종료: stop() 호출(완료 버튼) 후에만 'done' 상태 전환
 */
export function useVoice() {
  const [state,      setState]      = useState('idle')
  const [transcript, setTranscript] = useState('')
  const [interim,    setInterim]    = useState('')
  const [errorMsg,   setErrorMsg]   = useState('')

  const recRef     = useRef(null)
  const genRef     = useRef(0)
  const stoppedRef = useRef(false)  // 사용자가 명시적으로 종료했는지
  const finalsRef  = useRef('')     // 재시작에 걸쳐 누적되는 최종 텍스트
  const lastFinalRef = useRef('')

  const supported = typeof window !== 'undefined' &&
    ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)

  const stop = useCallback(() => {
    stoppedRef.current = true
    recRef.current?.stop()
  }, [])

  const reset = useCallback(() => {
    genRef.current++
    stoppedRef.current = true   // abort 후 onend에서 재시작 방지
    finalsRef.current = ''
    lastFinalRef.current = ''
    recRef.current?.abort()
    recRef.current = null
    setState('idle')
    setTranscript('')
    setInterim('')
    setErrorMsg('')
  }, [])

  const start = useCallback(() => {
    if (!supported) {
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
      setErrorMsg(isIOS
        ? 'iOS Safari는 음성 인식 지원이 제한적입니다.\n안드로이드 Chrome 사용을 권장합니다.'
        : '이 브라우저는 음성 인식을 지원하지 않습니다.\nChrome 브라우저를 사용해 주세요.'
      )
      setState('error')
      return
    }

    stoppedRef.current = false
    finalsRef.current  = ''
    lastFinalRef.current = ''
    const gen = ++genRef.current
    const SR  = window.SpeechRecognition || window.webkitSpeechRecognition

    // 인식 인스턴스를 만들고 반환 (시작은 호출부에서)
    function makeRec() {
      const rec = new SR()
      rec.lang           = 'ko-KR'
      rec.continuous     = true   // 사용자가 완료 버튼을 누를 때까지 계속 듣기
      rec.interimResults = true

      rec.onstart = () => {
        if (genRef.current === gen) setState('listening')
      }

      rec.onresult = e => {
        if (genRef.current !== gen) return
        // e.resultIndex: 이번 이벤트에서 처음 추가된 결과 인덱스
        // → 이전 이벤트에서 이미 처리한 결과를 다시 누적하지 않음 (반복 방지)
        let tmp = ''
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) {
            const finalText = e.results[i][0].transcript.trim()
            if (finalText && finalText !== lastFinalRef.current) {
              finalsRef.current = mergeSpeechText(finalsRef.current, finalText)
              lastFinalRef.current = cleanSpeechText(finalText)
            }
          } else {
            tmp = cleanSpeechText(e.results[i][0].transcript)   // 최신 interim만 표시
          }
        }
        setTranscript(cleanSpeechText(finalsRef.current))
        setInterim(tmp)
      }

      rec.onerror = e => {
        if (genRef.current !== gen) return
        if (e.error === 'no-speech') return   // 비치명적, onend에서 재시작
        if (e.error === 'aborted') return
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
        const MSGS = {
          'not-allowed': isIOS
            ? '마이크 권한이 거부되었습니다.\nSafari 설정 → 마이크를 허용해 주세요.'
            : '마이크 권한이 거부되었습니다.\n주소창 왼쪽 아이콘에서 마이크를 허용해 주세요.',
          'network':       '네트워크 오류입니다. 연결 상태를 확인해 주세요.',
          'audio-capture': '마이크를 찾을 수 없습니다.',
        }
        stoppedRef.current = true
        setErrorMsg(MSGS[e.error] ?? `오류가 발생했습니다 (${e.error}).`)
        setState('error')
      }

      rec.onend = () => {
        if (genRef.current !== gen) return
        setInterim('')
        if (stoppedRef.current) {
          // 사용자가 완료 버튼을 누른 경우 → done 상태
          setState('done')
        } else {
          setTimeout(() => {
            if (genRef.current === gen && !stoppedRef.current) {
              const newRec = makeRec()
              recRef.current = newRec
              try { newRec.start() } catch { /* 재시작 실패 시 무시 */ }
            }
          }, 180)
        }
      }

      return rec
    }

    const rec = makeRec()
    recRef.current = rec
    rec.start()
  }, [supported])

  return { supported, state, transcript, interim, errorMsg, start, stop, reset }
}
