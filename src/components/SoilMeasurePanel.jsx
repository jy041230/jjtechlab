/**
 * SoilMeasurePanel — iDEAER 5-in-1 토양측정기 5개 항목 입력 패널
 *
 * 숫자 항목(수분·PH·온도): [촬영] [음성] + 직접 입력 칸
 * 등급 항목(비옥도·일조): [음성으로 선택] + 등급 버튼 직접 선택
 */
import { useState, useEffect } from 'react'
import styles from './SoilMeasurePanel.module.css'

export default function SoilMeasurePanel({ fields, values, onCapture, onVoice, onGradeSelect, onManualInput }) {
  return (
    <div className={styles.panel}>
      <p className={styles.title}>iDEAER 5-in-1 토양측정기</p>
      {fields.map(field => (
        <SoilItem
          key={field.id}
          field={field}
          value={values[field.id] ?? null}
          onCapture={() => onCapture(field)}
          onVoice={() => onVoice(field)}
          onGrade={grade => onGradeSelect(field.id, grade)}
          onManualInput={onManualInput}
        />
      ))}
    </div>
  )
}

function SoilItem({ field, value, onCapture, onVoice, onGrade, onManualInput }) {
  const hasVal = value !== null && value !== undefined

  const fmtValue = () => {
    if (!hasVal) return '--'
    if (field.kind === 'grade') return value
    return `${value % 1 === 0 ? value : value.toFixed(1)}${field.unit ? ' ' + field.unit : ''}`
  }

  // 숫자 항목: 직접 입력 로컬 상태 — 외부 값(OCR·음성) 변경 시 자동 동기화
  const [inputStr, setInputStr] = useState('')
  useEffect(() => {
    if (field.kind !== 'number') return
    setInputStr(
      value !== null && value !== undefined
        ? (value % 1 === 0 ? String(value) : value.toFixed(1))
        : ''
    )
  }, [value, field.kind])

  function handleDirectSave() {
    const trimmed = inputStr.trim()
    if (!trimmed) return
    const num = parseFloat(trimmed)
    if (!isNaN(num)) onManualInput(field.id, num)
  }

  return (
    <div className={styles.item}>
      {/* 항목 헤더: 아이콘 + 이름 + 현재값 */}
      <div className={styles.itemHeader}>
        <span className={styles.itemIcon}>{field.icon}</span>
        <span className={styles.itemLabel}>{field.label}</span>
        <span className={`${styles.itemValue} ${hasVal ? styles.itemValueFilled : ''}`}>
          {fmtValue()}
        </span>
      </div>

      {/* 숫자 항목: 촬영 / 음성 / 직접 입력 */}
      {field.kind === 'number' && (
        <>
          <div className={styles.numActions}>
            <button className={styles.cameraBtn} onClick={onCapture} aria-label={`${field.label} 촬영`}>
              촬영
            </button>
            <button className={styles.voiceBtn} onClick={onVoice} aria-label={`${field.label} 음성 입력`}>
              음성
            </button>
          </div>
          <div className={styles.directRow}>
            <input
              type="number"
              inputMode="decimal"
              className={styles.directInput}
              placeholder="직접 입력"
              value={inputStr}
              onChange={e => setInputStr(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleDirectSave()}
              aria-label={`${field.label} 직접 입력`}
            />
            {field.unit && <span className={styles.directUnit}>{field.unit}</span>}
            <button className={styles.directConfirmBtn} onClick={handleDirectSave}>확인</button>
          </div>
        </>
      )}

      {/* 등급 항목: 음성 선택 / 버튼 직접 선택 */}
      {field.kind === 'grade' && (
        <>
          <button className={styles.gradeVoiceBtn} onClick={onVoice} aria-label={`${field.label} 음성 선택`}>
            음성으로 선택
          </button>
          <div className={styles.gradeRow}>
            {field.grades.map(grade => (
              <button
                key={grade}
                className={`${styles.gradeBtn} ${value === grade ? styles.gradeBtnActive : ''}`}
                onClick={() => onGrade(grade)}
                aria-pressed={value === grade}
              >
                {grade}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
