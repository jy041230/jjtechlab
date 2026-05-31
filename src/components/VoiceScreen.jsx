/**
 * VoiceScreen — 음성 입력 바텀 시트 오버레이
 *
 * mode='number' : 숫자만 추출 (토양수분·pH·온도)
 * mode='grade'  : 등급 키워드 추출 (비옥도·일조) — context.grades 배열 필요
 * mode='journal': 발화 전체를 작업일지로 저장
 *
 * continuous: true이므로 "완료" 버튼 탭 전까지 인식 계속 진행.
 */
import { useEffect, useState } from 'react'
import { extractNumber, correctPH, extractGrade } from '../utils/voiceParser'
import styles from './VoiceScreen.module.css'

export default function VoiceScreen({ voice, context, onSave, onClose }) {
  const { state, transcript, interim, errorMsg, start, stop, reset } = voice
  const { mode, prompt, fieldType, unit, correctPh, grades } = context
  const [editedJournal, setEditedJournal] = useState('')

  useEffect(() => {
    if (mode === 'journal' && transcript) setEditedJournal(transcript)
  }, [mode, transcript])

  // 숫자 파싱 (display용 보정 적용)
  const rawNum   = mode === 'number' && transcript ? extractNumber(transcript) : null
  const parsed   = rawNum !== null && correctPh ? correctPH(rawNum) : rawNum
  const validNum = parsed !== null && !isNaN(parsed) && isFinite(parsed) && parsed >= 0

  // 등급 파싱
  const rawGrade  = mode === 'grade' && transcript ? extractGrade(transcript, grades) : null
  const validGrade = rawGrade !== null

  const isSaveDisabled =
    mode === 'number' ? !validNum :
    mode === 'grade'  ? !validGrade :
    !editedJournal.trim()

  function handleRetry() { reset(); start() }

  function handleSave() {
    if (mode === 'number' && validNum)         onSave(rawNum)
    else if (mode === 'grade' && validGrade)   onSave(rawGrade)
    else if (mode === 'journal' && editedJournal.trim()) onSave(editedJournal.trim())
  }

  function handleOverlayClick(e) {
    if (e.target === e.currentTarget) onClose()
  }

  const fmtNum = n => (n % 1 === 0) ? String(n) : n.toFixed(1)

  const showResult = transcript && (state === 'listening' || state === 'done')

  return (
    <div className={styles.overlay} onClick={handleOverlayClick}>
      <div className={styles.sheet}>

        {/* 헤더 */}
        <div className={styles.sheetHeader}>
          <span className={styles.fieldLabel}>{fieldType}</span>
          <button className={styles.xBtn} onClick={onClose} aria-label="닫기">✕</button>
        </div>

        {/* 안내 문구 */}
        <p className={styles.prompt}>{prompt}</p>

        {/* 마이크 애니메이션 */}
        <div className={styles.micArea}>
          {state === 'listening' ? (
            <div className={styles.rippleWrap}>
              <span className={styles.ripple} style={{ animationDelay: '0s' }} />
              <span className={styles.ripple} style={{ animationDelay: '0.6s' }} />
              <span className={styles.ripple} style={{ animationDelay: '1.2s' }} />
              <div className={styles.micActive}>🎙️</div>
            </div>
          ) : (
            <div className={`${styles.micIdle} ${state === 'error' ? styles.micError : ''}`}>
              {state === 'error' ? '🚫' : '🎙️'}
            </div>
          )}
        </div>

        {/* 상태 텍스트 */}
        {state === 'idle' && <p className={styles.statusText} style={{ color: '#aaa' }}>준비 중...</p>}
        {state === 'listening' && !transcript && !interim && (
          <p className={styles.statusText}>듣고 있어요...</p>
        )}
        {state === 'listening' && interim && !transcript && (
          <p className={styles.interimText}>{interim}</p>
        )}

        {/* 오류 */}
        {state === 'error' && <p className={styles.errorText}>{errorMsg}</p>}

        {/* 인식 결과 (리스닝 중 + 완료 후 공용) */}
        {showResult && (
          <div className={styles.resultBox}>
            <p className={styles.transcriptLine}>"{transcript}"</p>
            {interim && state === 'listening' && (
              <p className={styles.interimText}>{interim}</p>
            )}

            {mode === 'number' && (
              validNum ? (
                <div className={styles.bigNumber}>
                  <span className={styles.bigVal}>{fmtNum(parsed)}</span>
                  <span className={styles.bigUnit}>{unit}</span>
                </div>
              ) : (
                <p className={styles.parseWarn}>숫자를 인식하지 못했습니다.</p>
              )
            )}

            {mode === 'grade' && (
              validGrade ? (
                <div className={styles.bigNumber}>
                  <span className={styles.bigVal}>{rawGrade}</span>
                </div>
              ) : (
                <p className={styles.parseWarn}>
                  {'등급을 인식하지 못했습니다.\n'}
                  {grades?.join(' / ')} 중 하나로 말해보세요.
                </p>
              )
            )}

            {mode === 'journal' && (
              <label className={styles.journalEditWrap}>
                <span>틀린 글자는 고쳐서 저장하세요</span>
                <textarea
                  className={styles.journalEdit}
                  value={editedJournal}
                  onChange={e => setEditedJournal(e.target.value)}
                  rows={4}
                />
              </label>
            )}
          </div>
        )}

        {/* 인식 실패 (done이고 transcript 없음) */}
        {state === 'done' && !transcript && (
          <p className={styles.parseWarn}>음성이 인식되지 않았습니다.</p>
        )}

        {/* 액션 버튼 */}
        <div className={styles.actionRow}>
          {state === 'listening' && (
            <button className={styles.stopBtn} onClick={stop}>녹음 끝</button>
          )}

          {state === 'done' && (
            <>
              <button className={styles.retryBtn} onClick={handleRetry}>다시 말하기</button>
              <button className={styles.saveBtn} onClick={handleSave} disabled={isSaveDisabled}>
                저장
              </button>
            </>
          )}

          {state === 'error' && (
            <>
              <button className={styles.retryBtn} onClick={handleRetry}>다시 시도</button>
              <button className={styles.cancelBtn} onClick={onClose}>닫기</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
