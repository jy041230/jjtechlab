/**
 * SoilInputPanel — 사진 1장 + 5개 항목 입력 칸
 *
 * 레이아웃:
 *   ┌ 촬영 사진 (상단 고정) ──────────────────┐
 *   │  (OCR 인식 결과 미리 채워짐)              │
 *   ├ 🧪 토양pH   [input] pH [🎙️]  ─────────┤
 *   ├ 💧 토양수분  [input] %  [🎙️]  ─────────┤
 *   ├ 🌡️ 토양온도  [input] ℃  [🎙️]  ─────────┤
 *   ├ 🌱 비옥도   [Low] [NOR] [High]  [🎙️] ──┤
 *   ├ ☀️ 일조  [Low-][Low][NOR][High][High+] ─┤
 *   └ [           저장           ] ──────────┘
 */
import { useState, useEffect } from 'react'
import styles from './SoilInputPanel.module.css'

export default function SoilInputPanel({
  frozenSrc,
  targetLabel,
  fields,
  values,
  onChange,
  onVoice,
  onPhotoRequest,
  onPhotoImportRequest,
  onSave,
  onSensorFetch,
  sensorStatus,
}) {
  const [photoExpanded, setPhotoExpanded] = useState(false)
  const [editingField, setEditingField] = useState(null)
  const [saveLocked, setSaveLocked] = useState(false)
  const hasAnyValue = fields.some(f => {
    const v = values[f.id]
    return v !== null && v !== undefined && v !== ''
  })

  function handleEditStart(fieldId) {
    setSaveLocked(true)
    setEditingField(fieldId)
  }

  function handleEditEnd() {
    setEditingField(null)
    setTimeout(() => setSaveLocked(false), 800)
  }

  function handleSaveClick() {
    if (editingField || saveLocked || !hasAnyValue) return
    onSave()
  }

  return (
    <div className={`${styles.panel} ${editingField ? styles.panelEditing : ''}`}>
      {targetLabel && (
        <div className={styles.targetBadge}>
          <strong>{targetLabel}</strong>
          <span>이 수목 주변 토양 측정</span>
        </div>
      )}

      {frozenSrc && (
        <div className={styles.photoWrap}>
          <button type="button" className={styles.photoBox} onClick={() => setPhotoExpanded(true)}>
            <img src={frozenSrc} className={styles.photo} alt="측정기 촬영" />
            <span className={styles.photoLabel}>사진을 누르면 크게 볼 수 있습니다</span>
          </button>
          <div className={styles.photoActions}>
            <button type="button" className={styles.photoSmallBtn} onClick={onPhotoRequest}>
              다시 촬영
            </button>
            <button type="button" className={styles.photoSmallBtn} onClick={onPhotoImportRequest}>
              사진 불러오기
            </button>
            <a className={styles.photoSmallBtn} href={frozenSrc} download={`soil-meter-${Date.now()}.jpg`}>
              사진 저장
            </a>
          </div>
        </div>
      )}

      {photoExpanded && (
        <div className={styles.photoModal} onClick={() => setPhotoExpanded(false)}>
          <img src={frozenSrc} className={styles.photoModalImg} alt="측정기 화면 크게 보기" />
          <button type="button" className={styles.photoModalClose}>닫기</button>
        </div>
      )}

      {!frozenSrc && (onPhotoRequest || onPhotoImportRequest) && (
        <div className={styles.photoPrompt}>
          <p>측정기 화면을 먼저 촬영하면, 사진을 보면서 직접 입력하거나 음성으로 값을 넣을 수 있습니다.</p>
          <div className={styles.photoPromptActions}>
            {onPhotoRequest && (
              <button type="button" className={styles.photoBtn} onClick={onPhotoRequest}>
                📷 촬영
              </button>
            )}
            {onPhotoImportRequest && (
              <button type="button" className={styles.photoBtnSecondary} onClick={onPhotoImportRequest}>
                🖼️ 사진 불러오기
              </button>
            )}
          </div>
        </div>
      )}

      {onSensorFetch && (
        <div className={styles.sensorRow}>
          <button
            type="button"
            className={styles.sensorBtn}
            onClick={onSensorFetch}
            disabled={sensorStatus?.loading}
          >
            {sensorStatus?.loading ? '⏳ 불러오는 중...' : '📡 센서값 자동으로 불러오기'}
          </button>
          {sensorStatus?.message && (
            <div
              className={`${styles.sensorMsg} ${
                sensorStatus.kind === 'warn'
                  ? styles.sensorMsgWarn
                  : sensorStatus.kind === 'error'
                    ? styles.sensorMsgError
                    : ''
              }`}
            >
              {sensorStatus.message}
            </div>
          )}
        </div>
      )}

      <div className={styles.fieldsScroll}>
        {fields.map(field => (
          <SoilFieldRow
            key={field.id}
            field={field}
            value={values[field.id] ?? null}
            onChange={val => onChange(field.id, val)}
            onVoice={() => onVoice(field)}
            onEditStart={() => handleEditStart(field.id)}
            onEditEnd={handleEditEnd}
          />
        ))}
      </div>

      <div className={styles.saveRow}>
        <button
          className={styles.saveBtn}
          onClick={handleSaveClick}
          disabled={!!editingField || saveLocked || !hasAnyValue}
          aria-label="입력된 항목 저장"
        >
          {editingField || saveLocked ? '입력 중' : '💾 저장'}
        </button>
      </div>
    </div>
  )
}

function SoilFieldRow({ field, value, onChange, onVoice, onEditStart, onEditEnd }) {
  const hasVal = value !== null && value !== undefined

  const [inputStr, setInputStr] = useState('')
  useEffect(() => {
    if (field.kind !== 'number') return
    setInputStr(
      hasVal ? (value % 1 === 0 ? String(value) : value.toFixed(1)) : ''
    )
  }, [value, field.kind, hasVal])

  function handleNumberSave() {
    const num = parseFloat(inputStr.trim())
    if (!isNaN(num)) onChange(num)
  }

  function handleFocus(e) {
    onEditStart?.()
    setTimeout(() => {
      e.currentTarget.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }, 250)
  }

  const fmtVal = () => {
    if (!hasVal) return '--'
    if (field.kind === 'grade') return value
    const n = value % 1 === 0 ? value : value.toFixed(1)
    return `${n}${field.unit ? ' ' + field.unit : ''}`
  }

  return (
    <div className={styles.row}>
      <div className={styles.rowHeader}>
        <span className={styles.icon}>{field.icon}</span>
        <span className={styles.label}>{field.label}</span>
        <span className={`${styles.valBadge} ${hasVal ? styles.valBadgeFilled : ''}`}>
          {fmtVal()}
        </span>
      </div>

      {field.kind === 'number' && (
        <div className={styles.inputRow}>
          <input
            type="number"
            inputMode="decimal"
            className={styles.numInput}
            value={inputStr}
            placeholder="직접 입력"
            onChange={e => setInputStr(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleNumberSave()}
            onFocus={handleFocus}
            onBlur={() => {
              handleNumberSave()
              setTimeout(() => onEditEnd?.(), 120)
            }}
            aria-label={`${field.label} 직접 입력`}
          />
          {field.unit && <span className={styles.unit}>{field.unit}</span>}
          <button className={styles.voiceBtn} onClick={onVoice} aria-label={`${field.label} 음성 입력`}>
            🎙️
          </button>
        </div>
      )}

      {field.kind === 'grade' && (
        <div className={styles.gradeRow}>
          {field.grades.map(g => (
            <button
              key={g}
              className={`${styles.gradeBtn} ${value === g ? styles.gradeBtnActive : ''}`}
              onClick={() => onChange(g)}
              aria-pressed={value === g}
            >
              {g}
            </button>
          ))}
          <button className={styles.voiceBtn} onClick={onVoice} aria-label={`${field.label} 음성 선택`}>
            🎙️
          </button>
        </div>
      )}
    </div>
  )
}
