/**
 * MeasurementScreen — 통합 측정 화면
 *
 * 버튼 줄: [줄기직경][흉고직경][수고][토양측정][이력][작업일지]
 *   → 버튼 탭 즉시 각 동작 시작 (2단계 없음)
 *
 * 페이즈 흐름:
 *   줄기직경·흉고직경: LIVE → CAPTURING → PLACING_POINTS(P1·P2 드래그) → CONFIRMED
 *   토양측정:          SOIL_LIVE → SOIL_INPUT → CONFIRMED
 *   수고:              HEIGHT_TODO
 */
import { useState, useCallback, useRef, useEffect } from 'react'
import { useCamera }        from '../hooks/useCamera'
import { useVoice }         from '../hooks/useVoice'
import { detectAruco, preloadOpenCV, avgSidePx } from '../utils/aruco'
import { correctPH }        from '../utils/voiceParser'
import {
  saveDiameterMeasurement,
  saveMeasurement,
  saveSoilMeasurements,
  saveJournalEntry,
  saveExcelSoilRows,
  downloadResearchDatabaseCsv,
  downloadPhoneBackupJson,
  importPhoneBackupJson,
  makeResearchDatabaseCsv,
  clearResearchDatabase,
} from '../utils/db'
import { parseExcelSoil } from '../utils/excelParser'
import LiveCamera     from './LiveCamera'
import FrozenMeasure  from './FrozenMeasure'
import SoilInputPanel from './SoilInputPanel'
import VoiceScreen    from './VoiceScreen'
import styles from './MeasurementScreen.module.css'

// ── 측정 유형 ─────────────────────────────────────────────────────────────────
const MEASUREMENT_TYPES = [
  { id: '줄기직경', label: '줄기직경', unit: 'mm', icon: '🌿', usesCamera: true },
  {
    id: '캘리퍼스직경',
    label: '캘리퍼스',
    unit: 'mm',
    icon: '📏',
    usesCaliper: true,
  },
  { id: '수고',     label: '수고',     unit: 'm',  icon: '🌳', usesCamera: true },
  { id: '토양측정', label: '토양측정', unit: null, icon: '🌱', usesCamera: false, usesSoilMeasure: true },
]

// ── 토양 5개 항목 정의 ─────────────────────────────────────────────────────────
const SOIL_FIELDS = [
  {
    id: '토양PH', label: '토양pH', unit: 'pH', icon: '🧪', kind: 'number', correctPh: true,
    prompt: 'pH 값을 말하세요\n예: "육 점 오" → 6.5',
  },
  {
    id: '토양수분', label: '토양수분', unit: '%', icon: '💧', kind: 'number',
    prompt: '수분 값을 숫자로 말하세요\n예: "십이" → 12%',
  },
  {
    id: '토양온도', label: '토양온도', unit: '℃', icon: '🌡️', kind: 'number',
    prompt: '온도 값을 말하세요\n예: "이십오" → 25℃',
  },
  { id: '비옥도', label: '비옥도', unit: null, icon: '🌱', kind: 'grade', grades: ['Low', 'NOR', 'High'] },
  { id: '일조',   label: '일조',   unit: null, icon: '☀️', kind: 'grade', grades: ['Low-', 'Low', 'NOR', 'High', 'High+'] },
]

const DEFAULT_RESEARCH_META = {
  participantId: 'P01',
  participantGroup: '성인학습자',
  treeId: '케이싱1년-01',
  treeGroup: '케이싱 1년',
  sessionLabel: '1회차',
}

function loadResearchMeta() {
  try {
    const saved = localStorage.getItem('plumResearchMeta')
    const meta = saved ? { ...DEFAULT_RESEARCH_META, ...JSON.parse(saved) } : DEFAULT_RESEARCH_META
    return { ...meta, treeGroup: normalizeTreeGroup(meta.treeGroup) }
  } catch {
    return DEFAULT_RESEARCH_META
  }
}

function normalizeTreeGroup(value) {
  const text = String(value || '').replace(/\s+/g, '')
  if (text.includes('2년')) return '케이싱 2년'
  if (text.includes('1년')) return '케이싱 1년'
  if (text.includes('직수') || text.includes('대조')) return '직수수목(대조수목)'
  return value || '케이싱 1년'
}

function getTreeIdOptions(treeGroup) {
  const group = normalizeTreeGroup(treeGroup)
  const prefix = group.includes('2년')
    ? '케이싱2년'
    : group.includes('직수') || group.includes('대조')
      ? '대조수목'
      : '케이싱1년'
  return Array.from({ length: 10 }, (_, i) => `${prefix}-${String(i + 1).padStart(2, '0')}`)
}

// ── 페이즈 ────────────────────────────────────────────────────────────────────
const PHASE = {
  IDLE:               'idle',
  LIVE:               'live',
  CAPTURING:          'capturing',
  NO_MARKER:          'no_marker',
  PLACING_POINTS:     'placing_points',  // 핸들 드래그로 P1·P2 배치
  CONFIRMED:          'confirmed',
  HEIGHT_TODO:        'height_todo',
  SOIL_METHOD:        'soil_method',
  SOIL_LIVE:          'soil_live',
  SOIL_INPUT:         'soil_input',
  SOIL_EXCEL_PREVIEW: 'soil_excel_preview',
  CALIPER_INPUT:      'caliper_input',
  JOURNAL_METHOD:     'journal_method',
  JOURNAL_LIVE:       'journal_live',
  JOURNAL_REVIEW:     'journal_review',
  RESEARCH_DB:        'research_db',
}

const SHOW_DEBUG_OVERLAY = false

// ── 직경 도메인 검증 ──────────────────────────────────────────────────────────
const DIAMETER_RANGE = {
  '줄기직경': { min: 5,  max: 30  },
  '흉고직경': { min: 10, max: 500 },
}

function validateDiameter(mm, typeId) {
  const { min, max } = DIAMETER_RANGE[typeId] ?? { min: 5, max: 30 }
  const place = typeId === '흉고직경' ? '수간' : '줄기'
  if (mm < min) return { valid: false, msg: `${mm.toFixed(1)} mm — 최소(${min} mm) 미만. 마커·${place}가 같은 평면인지 확인 후 재측정.` }
  if (mm > max) return { valid: false, msg: `${mm.toFixed(1)} mm — 최대(${max} mm) 초과. 마커·${place}가 같은 평면인지 확인 후 재측정.` }
  return { valid: true, msg: null }
}

const HEIGHT_RANGE = { min: 0.5, max: 25 }
function validateHeight(m, typeId) {
  if (m < HEIGHT_RANGE.min) {
    return { valid: false, msg: `${m.toFixed(2)} m — 최소(${HEIGHT_RANGE.min} m) 미만입니다. 더 가까이서 촬영하거나 삽입된 마커를 확인하세요.` }
  }
  if (m > HEIGHT_RANGE.max) {
    return { valid: false, msg: `${m.toFixed(2)} m — 최대(${HEIGHT_RANGE.max} m) 초과입니다. 카메라 시야각과 마커 위치를 확인하세요.` }
  }
  return { valid: true, msg: null }
}

function isNearMarker(ix, iy, markerCorners, margin = 30) {
  if (!markerCorners?.length) return false
  const xs = markerCorners.map(c => c.x)
  const ys = markerCorners.map(c => c.y)
  return (
    ix >= Math.min(...xs) - margin && ix <= Math.max(...xs) + margin &&
    iy >= Math.min(...ys) - margin && iy <= Math.max(...ys) + margin
  )
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────────────────
export default function MeasurementScreen({ onGoHistory, onGoResearch, onRegisterBack }) {
  const [phase, setPhase]               = useState(PHASE.IDLE)
  const [selectedType, setSelectedType] = useState(MEASUREMENT_TYPES[0])

  // ArUco 계측 상태
  const [frozenSrc,     setFrozenSrc]     = useState(null)
  const [frozenSize,    setFrozenSize]    = useState({ w: 0, h: 0 })
  const [markerCorners, setMarkerCorners] = useState(null)
  const [pixelPerMm,    setPixelPerMm]    = useState(0)
  const [points,        setPoints]        = useState([])
  const [result,        setResult]        = useState(null)
  const [debugInfo,     setDebugInfo]     = useState(null)

  // 토양 측정 상태
  const [soilValues,  setSoilValues]  = useState({})
  const [excelRows,   setExcelRows]   = useState(null)   // 파싱된 엑셀 행
  const [excelError,  setExcelError]  = useState('')
  const excelFileRef = useRef(null)
  const soilPhotoFileRef = useRef(null)
  const journalPhotoFileRef = useRef(null)
  const caliperCameraFileRef = useRef(null)
  const caliperPhotoFileRef = useRef(null)
  const submitCsvFileRef = useRef(null)
  const phoneBackupFileRef = useRef(null)
  const researchDbTextRef = useRef(null)

  const [markerInfo, setMarkerInfo] = useState(null) // 디버그: 검출 메타데이터
  const pointsRef = useRef([])
  const pixelPerMmRef = useRef(0)
  const [journalPhoto, setJournalPhoto] = useState(null)
  const [caliperPhoto, setCaliperPhoto] = useState(null)
  const [caliperDirectMm, setCaliperDirectMm] = useState('')
  const [researchDb, setResearchDb] = useState(null)
  const [researchMeta, setResearchMeta] = useState(loadResearchMeta)
  const [caliperMm, setCaliperMm] = useState('')
  const [cvState, setCvState] = useState('loading') // 'loading' | 'ready' | 'error'
  const [cvError, setCvError] = useState('')
  const histActiveRef = useRef(false)
  const nativeBackRef = useRef(null)

  // 음성 입력 상태
  const voice = useVoice()
  const [voiceContext, setVoiceContext] = useState(null)

  const { stream, cameraError, isActive, start: startCamera, stop: stopCamera } = useCamera()

  function rememberPixelPerMm(value) {
    const numeric = Number(value) || 0
    pixelPerMmRef.current = numeric
    setPixelPerMm(numeric)
  }

  // OpenCV 사전 로드 (앱 마운트 시 1회)
  useEffect(() => {
    preloadOpenCV()
      .then(() => setCvState('ready'))
      .catch(err => { setCvState('error'); setCvError(err.message) })
  }, [])

  useEffect(() => {
    localStorage.setItem('plumResearchMeta', JSON.stringify(researchMeta))
  }, [researchMeta])

  useEffect(() => { pointsRef.current = points }, [points])
  useEffect(() => { pixelPerMmRef.current = pixelPerMm }, [pixelPerMm])

  useEffect(() => {
    const treeGroup = normalizeTreeGroup(researchMeta.treeGroup)
    const options = getTreeIdOptions(treeGroup)
    if (!options.includes(researchMeta.treeId)) {
      setResearchMeta(prev => ({ ...prev, treeGroup, treeId: options[0] }))
    }
  }, [researchMeta.treeGroup, researchMeta.treeId])

  function updateResearchMeta(key, value) {
    if (key === 'treeGroup') {
      const normalized = normalizeTreeGroup(value)
      setResearchMeta(prev => ({
        ...prev,
        treeGroup: normalized,
        treeId: getTreeIdOptions(normalized)[0],
      }))
      return
    }
    setResearchMeta(prev => ({ ...prev, [key]: value }))
  }

  function getResearchMeta() {
    const treeGroup = normalizeTreeGroup(researchMeta.treeGroup)
    const treeOptions = getTreeIdOptions(treeGroup)
    const treeId = treeOptions.includes(researchMeta.treeId) ? researchMeta.treeId : treeOptions[0]
    return {
      participantId: researchMeta.participantId?.trim() || 'P01',
      participantGroup: researchMeta.participantGroup || '성인학습자',
      treeId,
      treeGroup,
      sessionLabel: researchMeta.sessionLabel?.trim() || '1회차',
    }
  }

  // 하위 화면 진입 시 브라우저 히스토리 항목 추가 (Android 뒤로가기 대응)
  const isActivePhase = phase !== PHASE.IDLE && phase !== PHASE.CONFIRMED
  useEffect(() => {
    const shouldPush = isActivePhase || !!voiceContext
    if (shouldPush && !histActiveRef.current) {
      history.pushState({ screen: 'measure-sub' }, '')
      histActiveRef.current = true
    } else if (!shouldPush) {
      histActiveRef.current = false
    }
  }, [isActivePhase, voiceContext])

  // 뒤로가기 핸들러 등록 (App의 popstate가 호출)
  useEffect(() => {
    onRegisterBack?.(() => nativeBackRef.current?.())
  }, [onRegisterBack])

  // ── 공통 리셋 ─────────────────────────────────────────────────────────────

  // 항상 최신 상태를 참조하도록 렌더마다 ref 갱신
  nativeBackRef.current = function handleNativeBack() {
    histActiveRef.current = false
    if (isActive) stopCamera()
    voice.stop(); voice.reset()
    setVoiceContext(null)
    setFrozenSrc(null); setMarkerCorners(null); rememberPixelPerMm(0); setJournalPhoto(null)
    setPoints([]); setResult(null); setDebugInfo(null)
    setSoilValues({}); setExcelRows(null); setExcelError('')
    setCaliperMm('')
    setResearchDb(null)
    setPhase(PHASE.IDLE)
  }

  function resetAll() {
    if (isActive) stopCamera()
    setFrozenSrc(null); setMarkerCorners(null); rememberPixelPerMm(0); setJournalPhoto(null)
    setPoints([]); setResult(null); setDebugInfo(null); setMarkerInfo(null)
    setSoilValues({})
    setCaliperMm('')
    setCaliperDirectMm('')
    setCaliperPhoto(null)
    setResearchDb(null)
  }

  // ── 타입 버튼: 즉시 동작 ────────────────────────────────────────────────

  async function handleTypeAction(t) {
    resetAll()
    setSelectedType(t)
    if (t.usesCamera) {
      setPhase(PHASE.LIVE)
      await startCamera()
    } else if (t.usesCaliper) {
      setCaliperPhoto(null)
      setCaliperDirectMm('')
      setPhase(PHASE.CALIPER_INPUT)
    } else if (t.usesSoilMeasure) {
      setExcelRows(null); setExcelError('')
      setPhase(PHASE.SOIL_METHOD)
    } else {
      setPhase(PHASE.HEIGHT_TODO)
    }
  }

  // ── ArUco 카메라 계측 ─────────────────────────────────────────────────────

  function handleCloseAll() {
    stopCamera()
    setFrozenSrc(null); setMarkerCorners(null); rememberPixelPerMm(0)
    setPoints([]); setResult(null)
    setPhase(PHASE.IDLE)
  }

  const handleCapture = useCallback(async ({ canvas, dataUrl, videoW, videoH }) => {
    stopCamera()
    setPhase(PHASE.CAPTURING)
    setFrozenSrc(dataUrl)
    setFrozenSize({ w: videoW, h: videoH })
    setPoints([]); setResult(null)

    try {
      const imageData = canvas.getContext('2d').getImageData(0, 0, videoW, videoH)
      const detected  = await detectAruco(imageData)
      if (!detected.found) {
        setMarkerCorners(null); rememberPixelPerMm(0)
        setDebugInfo(detected.debug)
        setPhase(PHASE.NO_MARKER)
        return
      }
      setDebugInfo(null)
      setMarkerCorners(detected.corners)
      rememberPixelPerMm(detected.pixelPerMm)
      setMarkerInfo({
        frameW:        detected.debug.frameW,
        frameH:        detected.debug.frameH,
        markerSidePx:  detected.debug.markerSidePx,
        rawMarkerSidePx: detected.debug.rawMarkerSidePx,
        markerAreaPx2: detected.debug.markerAreaPx2,
        pixelPerMm:    detected.pixelPerMm,
        cornerSource:  detected.debug.cornerSource,
        rawCorners:    detected.debug.rawCorners,
        scaleCorners:  detected.debug.scaleCorners,
      })
      setPhase(PHASE.PLACING_POINTS)  // 점 없는 상태로 시작
    } catch (err) {
      console.error('[capture]', err)
      setMarkerCorners(null)
      setDebugInfo({ candidates: 0, triedVariants: [], error: err.message })
      setPhase(PHASE.NO_MARKER)
    }
  }, [stopCamera])

  const handlePhotoFileCapture = useCallback(async (file) => {
    stopCamera()
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })

    const img = await new Promise((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = reject
      image.src = dataUrl
    })

    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth || img.width
    canvas.height = img.naturalHeight || img.height
    canvas.getContext('2d').drawImage(img, 0, 0)
    await handleCapture({
      canvas,
      dataUrl,
      videoW: canvas.width,
      videoH: canvas.height,
    })
  }, [handleCapture, stopCamera])

  async function handleRetakePhoto() {
    setFrozenSrc(null); setMarkerCorners(null); rememberPixelPerMm(0)
    setPoints([]); setResult(null)
    setPhase(PHASE.LIVE)
    await startCamera()
  }

  function handlePointsChange(newPoints) {
    pointsRef.current = newPoints
    setPoints(newPoints)
    setResult(null)
  }

  function handleMeasurePoints() {
    const measurePoints = pointsRef.current
    let measurePixelPerMm = pixelPerMmRef.current
    if (measurePixelPerMm <= 0 && markerCorners?.length === 4) {
      measurePixelPerMm = avgSidePx(markerCorners) / 40
      rememberPixelPerMm(measurePixelPerMm)
    }
    if (measurePoints.length !== 2) {
      alert('P1·P2를 먼저 줄기 양쪽 끝에 맞춰 주세요.')
      return
    }
    if (measurePixelPerMm <= 0) {
      alert('마커 기준값을 읽지 못했습니다. 새로 촬영해 주세요.')
      return
    }
    const pxDist = Math.abs(measurePoints[1].x - measurePoints[0].x)
    const mm = pxDist / measurePixelPerMm
    const isHeight = selectedType.id === '수고'
    const value = isHeight ? mm / 100 : mm
    const validation = isHeight
      ? validateHeight(value)
      : validateDiameter(mm, selectedType.id)
    setResult({ value, mm, validation, pixelPerMm: measurePixelPerMm, pxDist })
    console.table({
      '검출 프레임(px)': markerInfo ? `${markerInfo.frameW}×${markerInfo.frameH}` : '?',
      '원본 이미지(px)': `${frozenSize.w}×${frozenSize.h}`,
      '마커 변(img px)': markerInfo?.markerSidePx?.toFixed(1) ?? '?',
      'px/mm':           measurePixelPerMm.toFixed(4),
      'P1 (img px)':     `(${measurePoints[0].x.toFixed(0)}, ${measurePoints[0].y.toFixed(0)})`,
      'P2 (img px)':     `(${measurePoints[1].x.toFixed(0)}, ${measurePoints[1].y.toFixed(0)})`,
      'P1-P2 (img px)':  pxDist.toFixed(1),
      '결과':            `${value.toFixed(isHeight ? 2 : 1)} ${selectedType.unit}`,
    })
  }

  function handleRemeasure() {
    if (points.length > 0 && !window.confirm('P1·P2 핸들을 다시 찍을까요?\n\n현재 찍은 위치가 지워집니다.')) {
      return
    }
    setPoints([])
    setResult(null)
  }

  async function handleConfirm() {
    const caliperNumber = Number(caliperMm)
    let savedEventId = null
    try {
      if (selectedType.unit === 'mm') {
        savedEventId = await saveDiameterMeasurement({
          typeId:           selectedType.id,
          mm:               result.mm,
          validationStatus: result.validation.valid,
          pixelPerMm:       result.pixelPerMm,
          imageDataUrl:     frozenSrc,
          meta:             {
            ...getResearchMeta(),
            caliperMm: Number.isFinite(caliperNumber) && caliperNumber > 0 ? caliperNumber : null,
          },
        })
      } else {
        savedEventId = await saveMeasurement({
          typeId:           selectedType.id,
          value:            result.value,
          unit:             selectedType.unit,
          validationStatus: result.validation.valid,
          pixelPerMm:       result.pixelPerMm,
          imageDataUrl:     frozenSrc,
          meta:             getResearchMeta(),
        })
      }
    } catch (err) {
      console.error('[DB 저장 실패]', err)
    }
    await autoSubmitSavedEvents(savedEventId)
    setPhase(PHASE.CONFIRMED)
    setTimeout(() => setPhase(PHASE.IDLE), 2000)
  }

  // ── 캘리퍼스 LCD 사진 + 직접 입력 ─────────────────────────────────────────

  async function handleCaliperPhotoFileChange(e) {
    const file = e.target.files[0]
    if (!file) return
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
    setCaliperPhoto(dataUrl)
    setPhase(PHASE.CALIPER_INPUT)
  }

  function handleCaliperCameraRequest() {
    caliperCameraFileRef.current.value = ''
    caliperCameraFileRef.current.click()
  }

  function handleCaliperPhotoRequest() {
    caliperPhotoFileRef.current.value = ''
    caliperPhotoFileRef.current.click()
  }

  async function handleCaliperSave() {
    const value = Number(caliperDirectMm)
    if (!Number.isFinite(value) || value <= 0) {
      alert('캘리퍼스 값을 mm 단위 숫자로 입력해 주세요.')
      return
    }
    try {
      const eventId = await saveDiameterMeasurement({
        typeId:           '캘리퍼스직경',
        mm:               value,
        validationStatus: true,
        pixelPerMm:       null,
        imageDataUrl:     caliperPhoto,
        meta:             getResearchMeta(),
      })
      await autoSubmitSavedEvents(eventId)
    } catch (err) {
      console.error('[캘리퍼스 저장 실패]', err)
      alert('캘리퍼스 값을 저장하지 못했습니다.')
      return
    }
    setCaliperPhoto(null)
    setCaliperDirectMm('')
    setPhase(PHASE.CONFIRMED)
    setTimeout(() => setPhase(PHASE.IDLE), 2000)
  }

  function handleCaliperBack() {
    setCaliperPhoto(null)
    setCaliperDirectMm('')
    setPhase(PHASE.IDLE)
  }

  // ── 토양 방법 선택 ───────────────────────────────────────────────────────

  async function handleSoilMethodSelect(method) {
    if (method === '촬영') {
      setPhase(PHASE.SOIL_LIVE)
      await startCamera()
    } else if (method === '사진불러오기') {
      soilPhotoFileRef.current.value = ''
      soilPhotoFileRef.current.click()
    } else if (method === '센서파일') {
      excelFileRef.current.value = ''
      excelFileRef.current.click()
    } else {
      setFrozenSrc(null)
      setPhase(PHASE.SOIL_INPUT)
    }
  }

  async function handleSoilPhotoFileChange(e) {
    const file = e.target.files[0]
    if (!file) return
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
    const img = await new Promise((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = reject
      image.src = dataUrl
    })
    setFrozenSrc(dataUrl)
    setFrozenSize({ w: img.naturalWidth || img.width, h: img.naturalHeight || img.height })
    setPhase(PHASE.SOIL_INPUT)
  }

  async function handleExcelFileChange(e) {
    const file = e.target.files[0]
    if (!file) return
    setExcelError('')
    try {
      const rows = await parseExcelSoil(file)
      setExcelRows(rows)
      setPhase(PHASE.SOIL_EXCEL_PREVIEW)
    } catch (err) {
      setExcelError(err.message)
      setExcelRows(null)
    }
  }

  async function handleExcelConfirm() {
    if (!excelRows?.length) return
    try {
      const eventIds = await saveExcelSoilRows(excelRows, getResearchMeta())
      await autoSubmitSavedEvents(eventIds)
    } catch (err) {
      console.error('[DB 저장 실패]', err)
    }
    setExcelRows(null)
    setPhase(PHASE.CONFIRMED)
    setTimeout(() => setPhase(PHASE.IDLE), 2000)
  }

  function handleExcelCancel() {
    setExcelRows(null)
    setExcelError('')
    setPhase(PHASE.SOIL_METHOD)
  }

  // ── 토양 촬영 ────────────────────────────────────────────────────────────

  function handleCloseSoilCapture() {
    stopCamera()
    setFrozenSrc(null)
    setPhase(PHASE.IDLE)
  }

  const handleSoilCameraCapture = useCallback(({ dataUrl, videoW, videoH }) => {
    stopCamera()
    setFrozenSrc(dataUrl)
    setFrozenSize({ w: videoW, h: videoH })
    setPhase(PHASE.SOIL_INPUT)
  }, [stopCamera])

  // ── 토양 항목 입력 ────────────────────────────────────────────────────────

  function handleSoilChange(fieldId, val) {
    const field = SOIL_FIELDS.find(f => f.id === fieldId)
    const corrected = field?.correctPh && typeof val === 'number' ? correctPH(val) : val
    setSoilValues(prev => ({ ...prev, [fieldId]: corrected }))
  }

  function handleSoilVoice(field) {
    const isGrade = field.kind === 'grade'
    openVoiceCtx({
      mode:      isGrade ? 'grade' : 'number',
      fieldType: field.id,
      unit:      field.unit,
      prompt:    isGrade
        ? `${field.label} 등급을 말하세요\n선택 가능: ${field.grades.join(' / ')}`
        : (field.prompt || `${field.label} 값을 말하세요`),
      correctPh: !!field.correctPh,
      grades:    field.grades ?? [],
      isSoil:    true,
    })
  }

  async function handleSoilSaveAll() {
    const records = Object.entries(soilValues)
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([type, value]) => ({
        measurement_type:  type,
        measurement_value: value,
        measurement_unit:  SOIL_FIELDS.find(f => f.id === type)?.unit ?? '',
      }))
    if (!records.length) return
    try {
      const eventId = await saveSoilMeasurements(records, getResearchMeta(), frozenSrc)
      await autoSubmitSavedEvents(eventId)
    } catch (err) {
      console.error('[DB 저장 실패]', err)
    }
    setSoilValues({})
    setFrozenSrc(null)
    setPhase(PHASE.CONFIRMED)
    setTimeout(() => setPhase(PHASE.IDLE), 2000)
  }

  function handleSoilBack() {
    if (phase === PHASE.SOIL_EXCEL_PREVIEW) {
      handleExcelCancel()
      return
    }
    setFrozenSrc(null)
    setSoilValues({})
    setExcelRows(null)
    setPhase(PHASE.IDLE)
  }

  // ── 음성 입력 ─────────────────────────────────────────────────────────────

  function openVoiceCtx(ctx) {
    setVoiceContext(ctx)
    voice.reset()
    voice.start()
  }

  function handleOpenJournal() {
    setJournalPhoto(null)
    setPhase(PHASE.JOURNAL_METHOD)
  }

  async function handleJournalMethodSelect(method) {
    if (method === '촬영') {
      setJournalPhoto(null)
      setPhase(PHASE.JOURNAL_LIVE)
      await startCamera()
      return
    }
    setJournalPhoto(null)
    setPhase(PHASE.JOURNAL_REVIEW)
  }

  async function handleJournalRetake() {
    setPhase(PHASE.JOURNAL_LIVE)
    await startCamera()
  }

  const handleJournalCameraCapture = useCallback(({ dataUrl }) => {
    stopCamera()
    setJournalPhoto(dataUrl)
    setPhase(PHASE.JOURNAL_REVIEW)
  }, [stopCamera])

  async function handleJournalPhotoFileChange(e) {
    const file = e.target.files[0]
    if (!file) return
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
    setJournalPhoto(dataUrl)
    setPhase(PHASE.JOURNAL_REVIEW)
  }

  function handleJournalPhotoImport() {
    journalPhotoFileRef.current.value = ''
    journalPhotoFileRef.current.click()
  }

  function handleJournalVoiceStart() {
    openVoiceCtx({
      mode:      'journal',
      fieldType: '작업일지',
      unit:      null,
      prompt:    '사진을 보면서 조치 내용을 말하세요\n예: "이 가지에 병반이 보여 방제했다"',
      isSoil:    false,
    })
  }

  function handleJournalClose() {
    stopCamera()
    setJournalPhoto(null)
    setPhase(PHASE.IDLE)
  }

  async function handleExportResearchDb() {
    try {
      const data = await makeResearchDatabaseCsv({ includeImages: false })
      if (!data.rows.length) {
        alert('아직 내보낼 연구 데이터가 없습니다.')
        return
      }
      setResearchDb(data)
      setPhase(PHASE.RESEARCH_DB)
    } catch (err) {
      console.error('[연구DB 내보내기 실패]', err)
      alert('연구DB 파일을 만드는 중 오류가 발생했습니다.')
    }
  }

  async function handleSubmitResearchDbToPc() {
    try {
      const data = await makeResearchDatabaseCsv({ includeImages: false })
      if (!data.rows.length) {
        alert('아직 제출할 측정자료가 없습니다.')
        return
      }

      const ok = window.confirm(
        `측정자료 ${data.rows.length}건을 선생님 PC로 제출할까요?\n\n` +
        '제출 후에도 이 휴대폰 이력은 남겨둡니다.'
      )
      if (!ok) return

      const res = await fetch('/api/research-db-export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv: data.csv }),
      })
      const result = await res.json()
      if (!res.ok || !result.ok) throw new Error(result.error || 'PC 저장 실패')

      setResearchDb(null)
      setPhase(PHASE.IDLE)
      alert(`제출 완료!\n${data.rows.length}건이 선생님 PC에 저장되었습니다.\n\n휴대폰 이력은 그대로 남아 있습니다.`)
    } catch (err) {
      console.error('[자료제출 실패]', err)
      alert(
        '자료제출에 실패했습니다.\n\n' +
        '노트북의 서버창과 터널창이 켜져 있는지 확인한 뒤 다시 눌러 주세요.'
      )
    }
  }

  async function handlePhoneBackupDownload() {
    try {
      const count = await downloadPhoneBackupJson(getResearchMeta())
      if (!count) {
        alert('아직 폰에 백업할 측정자료가 없습니다.')
        return
      }
      alert(`폰에 백업파일을 저장했습니다.\n${count}건\n\n다운로드 폴더에서 plum-measure 백업 파일을 확인하세요.`)
    } catch (err) {
      console.error('[폰백업 실패]', err)
      alert('폰백업 파일을 만들지 못했습니다. 다시 시도해 주세요.')
    }
  }
  async function handlePhoneBackupImportClick() {
    // alert 뒤에 input.click()을 호출하면 스마트폰에서 카메라/이미지 선택기가 뜰 수 있다.
    // 지원 브라우저에서는 다운로드 폴더 파일 선택기를 먼저 시도한다.
    if (typeof window.showOpenFilePicker === 'function') {
      try {
        const [fileHandle] = await window.showOpenFilePicker({
          multiple: false,
          startIn: 'downloads',
          excludeAcceptAllOption: false,
          types: [
            {
              description: 'plum-measure 백업 JSON',
              accept: {
                'application/json': ['.json'],
                'text/plain': ['.json'],
              },
            },
          ],
        })
        const file = await fileHandle.getFile()
        await handlePhoneBackupImportFile(file)
        return
      } catch (err) {
        if (err?.name === 'AbortError') return
        console.warn('[다운로드 파일 선택기 실패 — input fallback 사용]', err)
      }
    }

    if (!phoneBackupFileRef.current) return
    phoneBackupFileRef.current.value = ''
    phoneBackupFileRef.current.click()
  }

  async function handlePhoneBackupImportFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      await handlePhoneBackupImportFile(file)
    } finally {
      e.target.value = ''
    }
  }

  async function handlePhoneBackupImportFile(file) {
    const isJsonFile =
      file.type === 'application/json' ||
      file.name.toLowerCase().endsWith('.json')

    if (!isJsonFile) {
      alert(
        '백업 가져오기는 JSON 백업 파일만 사용할 수 있습니다.\n\n' +
        '파일 관리자 또는 내 파일 앱에서 다운로드(Download) 폴더를 열고\n' +
        'plum-measure 이름이 들어간 .json 파일을 선택하세요.'
      )
      return
    }

    const ok = window.confirm(
      '다운로드 폴더에서 선택한 백업 파일을 이 스마트폰 앱으로 가져올까요?\n\n' +
      `${file.name}\n\n` +
      '같은 자료는 덮어쓰고, 새 자료는 추가됩니다.'
    )
    if (!ok) return

    try {
      const result = await importPhoneBackupJson(file)
      alert(`백업 가져오기 완료!\n측정묶음 ${result.eventCount}건을 가져왔습니다.`)
    } catch (err) {
      console.error('[폰백업 가져오기 실패]', err)
      alert(
        '백업 파일을 가져오지 못했습니다.\n\n' +
        '스마트폰 백업 저장으로 만든 plum-measure JSON 파일인지 확인해 주세요.'
      )
    }
  }

  async function handleCompleteClearPhoneData() {
    const data = await makeResearchDatabaseCsv({ includeImages: false })
    if (!data.rows.length) {
      alert('삭제할 측정자료가 없습니다.')
      return
    }

    const first = window.confirm(
      `이 휴대폰 안의 측정 이력 ${data.rows.length}건을 완전히 삭제할까요?\n\n` +
      '자료백업 파일을 다운로드 폴더에 저장했고, 선생님 PC 제출도 끝난 경우에만 삭제하세요.'
    )
    if (!first) return

    const second = window.confirm(
      '정말 완전 삭제할까요?\n\n삭제 후에는 이 휴대폰 앱 이력에서 다시 볼 수 없습니다.'
    )
    if (!second) return

    await clearResearchDatabase()
    setResearchDb(null)
    setPhase(PHASE.IDLE)
    alert('휴대폰 안의 측정자료를 완전히 삭제했습니다.')
  }

  function handleSubmitBackupFileClick() {
    submitCsvFileRef.current.value = ''
    submitCsvFileRef.current.click()
  }

  async function handleSubmitBackupFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const csv = await file.text()
      if (!csv.trim()) {
        alert('비어 있는 파일입니다.')
        return
      }
      const ok = window.confirm(
        `선택한 백업파일을 선생님 PC로 제출할까요?\n\n${file.name}`
      )
      if (!ok) return
      const res = await fetch('/api/research-db-export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv }),
      })
      const result = await res.json()
      if (!res.ok || !result.ok) throw new Error(result.error || 'PC 저장 실패')
      alert('백업파일 제출 완료!')
    } catch (err) {
      console.error('[백업파일 제출 실패]', err)
      alert('백업파일 제출에 실패했습니다. 서버창과 터널창을 확인한 뒤 다시 시도해 주세요.')
    }
  }

  async function handleResearchDbDownload() {
    const count = await downloadResearchDatabaseCsv()
    if (!count) alert('아직 내보낼 연구 데이터가 없습니다.')
  }

  async function handleResearchDbCopy() {
    if (!researchDb?.csv) return
    try {
      await navigator.clipboard.writeText(researchDb.csv)
      alert('CSV 내용을 복사했습니다.')
    } catch {
      const el = researchDbTextRef.current
      if (el) {
        el.focus()
        el.select()
        try {
          const ok = document.execCommand('copy')
          if (ok) {
            alert('CSV 내용을 복사했습니다.')
            return
          }
        } catch {
          // 아래 안내로 처리
        }
      }
      alert('자동 복사가 막혔습니다. 아래 CSV 박스를 길게 눌러 직접 복사해 주세요.')
    }
  }

  async function handleResearchDbShare() {
    if (!researchDb?.csv) return
    const today = new Date().toISOString().slice(0, 10).replaceAll('-', '')
    const fileName = `research_database_${today}.csv`
    const file = new File(['\ufeff' + researchDb.csv], fileName, { type: 'text/csv;charset=utf-8' })

    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          title: '연구DB CSV',
          text: '홍매화 측정 연구DB CSV 파일입니다.',
          files: [file],
        })
        return
      }
      if (navigator.share) {
        await navigator.share({
          title: '연구DB CSV',
          text: researchDb.csv,
        })
        return
      }
      alert('이 브라우저에서는 공유 기능을 지원하지 않습니다. 아래 CSV 박스를 길게 눌러 복사해 주세요.')
    } catch (err) {
      if (err?.name !== 'AbortError') {
        alert('공유가 완료되지 않았습니다. Chrome에서 다시 시도하거나 아래 CSV 박스를 길게 눌러 복사해 주세요.')
      }
    }
  }

  async function handleResearchDbSaveToPc() {
    if (!researchDb?.csv) return
    try {
      const res = await fetch('/api/research-db-export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv: researchDb.csv }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || '저장 실패')
      alert(`PC에 저장했습니다.\n${data.filePath}\n\n앱 안 자료는 삭제하지 않고 그대로 남겨둡니다.`)
    } catch (err) {
      console.error('[PC 저장 실패]', err)
      alert('PC 저장에 실패했습니다. 앱 서버를 다시 켠 뒤 시도해 주세요.')
    }
  }

  function handleResearchDbSelectAll() {
    const el = researchDbTextRef.current
    if (!el) return
    el.focus()
    el.select()
  }

  async function autoSubmitSavedEvents(eventIds) {
    const ids = Array.isArray(eventIds) ? eventIds.filter(Boolean) : [eventIds].filter(Boolean)
    if (!ids.length) return
    try {
      const data = await makeResearchDatabaseCsv({ includeImages: false, eventIds: ids })
      if (!data.rows.length) return
      await fetch('/api/research-db-export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv: data.csv }),
      })
    } catch (err) {
      console.warn('[PC 자동 백업 실패]', err)
    }
  }

  async function handleVoiceSave(rawValue) {
    if (voiceContext?.isSoil) {
      const corrected = (voiceContext.mode === 'number' && voiceContext.correctPh)
        ? correctPH(rawValue)
        : rawValue
      setSoilValues(prev => ({ ...prev, [voiceContext.fieldType]: corrected }))
      voice.reset(); setVoiceContext(null)
    } else {
      try {
        const eventId = await saveJournalEntry({
          transcript_text: rawValue,
          confidence: null,
          imageDataUrl: journalPhoto,
          meta: getResearchMeta(),
        })
        await autoSubmitSavedEvents(eventId)
      } catch (err) {
        console.error('[DB 저장 실패]', err)
      }
      voice.reset(); setVoiceContext(null)
      setPhase(PHASE.CONFIRMED)
      setTimeout(() => setPhase(PHASE.IDLE), 2000)
    }
  }

  function handleVoiceClose() {
    voice.stop(); voice.reset()
    setVoiceContext(null)
  }

  // ── 레이아웃 플래그 ───────────────────────────────────────────────────────

  const isCameraMode = [
    PHASE.LIVE, PHASE.CAPTURING,
    PHASE.NO_MARKER, PHASE.PLACING_POINTS,
    PHASE.SOIL_LIVE,
    PHASE.JOURNAL_LIVE,
  ].includes(phase)

  const isSoilInputScreen = selectedType.usesSoilMeasure && phase === PHASE.SOIL_INPUT
  const isSoilSubScreen   = selectedType.usesSoilMeasure &&
    [PHASE.SOIL_METHOD, PHASE.SOIL_EXCEL_PREVIEW].includes(phase)
  const isCaliperScreen = phase === PHASE.CALIPER_INPUT
  const isResearchDbScreen = phase === PHASE.RESEARCH_DB
  const isJournalSubScreen = [PHASE.JOURNAL_METHOD, PHASE.JOURNAL_REVIEW].includes(phase)
  const treeIdOptions = getTreeIdOptions(researchMeta.treeGroup)

  const frozenTapPhase = {
    [PHASE.NO_MARKER]:      'no_marker',
    [PHASE.PLACING_POINTS]: 'placing_points',
  }[phase] ?? 'placing_points'

  // ── 렌더 ─────────────────────────────────────────────────────────────────

  return (
    <div className={styles.screen}>

      {/* ── 헤더 ── */}
      {!isCameraMode && (
        isResearchDbScreen ? (
          <header className={styles.soilHeader}>
            <button className={styles.soilBackBtn} onClick={() => { setResearchDb(null); setPhase(PHASE.IDLE) }}>
              &larr; 뒤로
            </button>
            <span className={styles.soilHeaderTitle}>연구DB</span>
            <div style={{ width: 72, flexShrink: 0 }} />
          </header>
        ) : isCaliperScreen ? (
          <header className={styles.soilHeader}>
            <button className={styles.soilBackBtn} onClick={handleCaliperBack}>
              &larr; 뒤로
            </button>
            <span className={styles.soilHeaderTitle}>캘리퍼스</span>
            <div style={{ width: 72, flexShrink: 0 }} />
          </header>
        ) : isJournalSubScreen ? (
          <header className={styles.soilHeader}>
            <button className={styles.soilBackBtn} onClick={handleJournalClose}>
              &larr; 뒤로
            </button>
            <span className={styles.soilHeaderTitle}>작업일지</span>
            <div style={{ width: 72, flexShrink: 0 }} />
          </header>
        ) : (isSoilInputScreen || isSoilSubScreen) ? (
          <header className={styles.soilHeader}>
            <button className={styles.soilBackBtn} onClick={handleSoilBack}>
              &larr; 뒤로
            </button>
            <span className={styles.soilHeaderTitle}>토양측정</span>
            <div style={{ width: 72, flexShrink: 0 }} />
          </header>
        ) : (
          <header className={styles.header}>
            <div className={styles.headerTitle}>
              <span className={styles.appName}>홍매화 측정</span>
              <span className={styles.milestone}>M2·M4·M5 — 계측·음성·OCR·저장</span>
            </div>
            <MarkerStatus found={markerCorners !== null && phase !== PHASE.NO_MARKER} />
          </header>
        )
      )}

      {/* ── 에러 배너 ── */}
      {cameraError && <ErrorBanner msg={cameraError} />}

      {/* OpenCV 로드 상태 배너 */}
      {cvState !== 'ready' && !isCameraMode && (
        <div style={{
          background: cvState === 'error' ? '#f8d7da' : '#fff3cd',
          color:      cvState === 'error' ? '#721c24' : '#856404',
          padding: '6px 14px', fontSize: 13, textAlign: 'center',
          lineHeight: 1.4,
        }}>
          {cvState === 'loading'
            ? '마커 모듈 초기화 중…'
            : `마커 모듈 로드 실패 — 카메라 측정 불가\n${cvError}`}
        </div>
      )}

      {/* ── 메인 콘텐츠 영역 ── */}
      <section className={`${styles.cameraArea} ${isCameraMode ? styles.cameraAreaExpanded : ''} ${(isSoilInputScreen || isJournalSubScreen || isCaliperScreen) ? styles.cameraAreaSoil : ''}`}>

        {/* 확정 완료 */}
        {phase === PHASE.CONFIRMED && <ConfirmedBadge />}

        {/* ArUco 라이브 카메라 */}
        {phase === PHASE.LIVE && (
          <LiveCamera
            stream={stream}
            onCapture={handleCapture}
            onFileCapture={handlePhotoFileCapture}
            onClose={handleCloseAll}
            onRetry={startCamera}
            errorMsg={cameraError}
            hint={selectedType.id === '수고'
              ? '나무 전체 높이가 화면에 들어오도록 촬영하세요.'
              : '마커가 보이도록 놓고 촬영하세요.'
            }
          />
        )}

        {/* ArUco 검출 중 */}
        {phase === PHASE.CAPTURING && (
          <div className={styles.processingOverlay}>
            <span className={styles.processingSpinner}>⏳</span>
            <p>{cvState === 'loading' ? '마커 모듈 준비 중…' : '마커 인식 중…'}</p>
          </div>
        )}

        {/* 디버그 패널 — 좌표계 확인용 (배포 전 제거) */}
        {SHOW_DEBUG_OVERLAY && phase === PHASE.PLACING_POINTS && markerInfo && (
          <div style={{
            position: 'absolute', top: 8, left: 8, zIndex: 200,
            background: 'rgba(0,0,0,0.82)', color: '#0f0',
            fontFamily: 'monospace', fontSize: 10, lineHeight: 1.65,
            padding: '6px 10px', borderRadius: 6, pointerEvents: 'none',
            maxWidth: 230,
          }}>
            <div style={{ color: '#8f8', fontWeight: 'bold', marginBottom: 2 }}>
              ▸ 검출 프레임: {markerInfo.frameW}×{markerInfo.frameH}
            </div>
            <div>이미지: {frozenSize.w}×{frozenSize.h}</div>
            <div style={{ borderTop: '1px solid #333', marginTop: 2, paddingTop: 2 }}>
              마커변 {markerInfo.markerSidePx.toFixed(1)}px  px/mm {markerInfo.pixelPerMm.toFixed(3)}
            </div>
            {markerInfo.cornerSource && (
              <div>source: {markerInfo.cornerSource}</div>
            )}
            {markerInfo.rawMarkerSidePx && markerInfo.rawMarkerSidePx !== markerInfo.markerSidePx && (
              <div>raw변 {markerInfo.rawMarkerSidePx.toFixed(1)}px</div>
            )}
            <div>면적 {markerInfo.markerAreaPx2?.toFixed(0) ?? '?'} px²</div>
            {markerInfo.rawCorners && (
              <div style={{ borderTop: '1px solid #333', marginTop: 2, paddingTop: 2, color: '#0cf' }}>
                <div>코너 raw (img px):</div>
                {markerInfo.rawCorners.map((c, i) => (
                  <div key={i}>  [{i}] ({c.x.toFixed(0)}, {c.y.toFixed(0)})</div>
                ))}
              </div>
            )}
            {markerInfo.scaleCorners && markerInfo.scaleCorners !== markerInfo.rawCorners && (
              <div style={{ borderTop: '1px solid #333', marginTop: 2, paddingTop: 2, color: '#ffd166' }}>
                <div>스케일 코너:</div>
                {markerInfo.scaleCorners.map((c, i) => (
                  <div key={i}>  [{i}] ({c.x.toFixed(0)}, {c.y.toFixed(0)})</div>
                ))}
              </div>
            )}
            {result && points.length === 2 && (() => {
              const d = Math.abs(points[1].x - points[0].x)
              return (
                <div style={{ borderTop: '1px solid #333', marginTop: 2, paddingTop: 2 }}>
                  <div>P1 ({points[0].x.toFixed(0)},{points[0].y.toFixed(0)})</div>
                  <div>P2 ({points[1].x.toFixed(0)},{points[1].y.toFixed(0)})</div>
                  <div>거리 {d.toFixed(1)}px</div>
                  <div style={{ color: '#ff0', fontWeight: 'bold' }}>→ {result.mm.toFixed(1)} mm</div>
                </div>
              )
            })()}
          </div>
        )}

        {/* 정지 이미지 계측 */}
        {[PHASE.NO_MARKER, PHASE.PLACING_POINTS].includes(phase) && (
          <FrozenMeasure
            frozenSrc={frozenSrc} frozenW={frozenSize.w} frozenH={frozenSize.h}
            markerCorners={markerCorners} points={points}
            pixelPerMm={pixelPerMm} tapPhase={frozenTapPhase}
            onPointsChange={handlePointsChange} debugInfo={debugInfo}
          />
        )}

        {/* 토양 측정 방법 선택 */}
        {phase === PHASE.SOIL_METHOD && (
          <div className={styles.soilMethodBox}>
            <ResearchTargetBadge meta={getResearchMeta()} />
            <p className={styles.soilMethodTitle}>토양 측정 방식 선택</p>
            <div className={styles.soilMethodGrid}>
              <button className={styles.soilMethodBtn} onClick={() => handleSoilMethodSelect('센서파일')}>
                <span className={styles.soilMethodIcon}>📄</span>
                <span className={styles.soilMethodLabel}>센서 CSV 불러오기</span>
                <span className={styles.soilMethodSub}>현재 선택한 수목에 센서값 저장</span>
              </button>
              <button className={styles.soilMethodBtn} onClick={() => handleSoilMethodSelect('촬영')}>
                <span className={styles.soilMethodIcon}>📷</span>
                <span className={styles.soilMethodLabel}>촬영</span>
                <span className={styles.soilMethodSub}>측정기 화면을 찍고 값 입력</span>
              </button>
              <button className={styles.soilMethodBtn} onClick={() => handleSoilMethodSelect('사진불러오기')}>
                <span className={styles.soilMethodIcon}>🖼️</span>
                <span className={styles.soilMethodLabel}>사진 불러오기</span>
                <span className={styles.soilMethodSub}>이미 찍어 둔 측정기 사진 사용</span>
              </button>
            </div>
            {excelError && <p className={styles.soilMethodError}>⚠️ {excelError}</p>}
          </div>
        )}

        {/* 엑셀 미리보기 */}
        {phase === PHASE.SOIL_EXCEL_PREVIEW && excelRows && (
          <div className={styles.excelPreviewBox}>
            <ResearchTargetBadge meta={getResearchMeta()} />
            <p className={styles.excelPreviewTitle}>
              {excelRows.length}개 측정 행을 불러옵니다
            </p>
            <ul className={styles.excelPreviewList}>
              {excelRows.map((row, i) => (
                <li key={i} className={styles.excelPreviewItem}>
                  <span className={styles.excelPreviewTime}>
                    {new Date(row.timestamp).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className={styles.excelPreviewMeas}>
                    {row.measurements.map(m => `${m.measurement_type} ${m.measurement_value}${m.measurement_unit}`).join(' · ')}
                  </span>
                </li>
              ))}
            </ul>
            <div className={styles.excelPreviewActions}>
              <button className={styles.excelCancelBtn} onClick={handleExcelCancel}>취소</button>
              <button className={styles.excelConfirmBtn} onClick={handleExcelConfirm}>
                저장 ({excelRows.length}개)
              </button>
            </div>
          </div>
        )}

        {/* 토양 OCR 라이브 카메라 + 가이드 박스 */}
        {phase === PHASE.SOIL_LIVE && (
          <>
            <LiveCamera
              stream={stream}
              onCapture={handleSoilCameraCapture}
              onFileCapture={async (file) => {
                const dataUrl = await new Promise((resolve, reject) => {
                  const reader = new FileReader()
                  reader.onload = () => resolve(reader.result)
                  reader.onerror = reject
                  reader.readAsDataURL(file)
                })
                const img = await new Promise((resolve, reject) => {
                  const image = new Image()
                  image.onload = () => resolve(image)
                  image.onerror = reject
                  image.src = dataUrl
                })
                handleSoilCameraCapture({
                  dataUrl,
                  videoW: img.naturalWidth || img.width,
                  videoH: img.naturalHeight || img.height,
                })
              }}
              onClose={handleCloseSoilCapture}
              onRetry={startCamera}
              errorMsg={cameraError}
              hint={null}
            />
            <div className={styles.soilGuideOverlay}>
              <div className={styles.soilGuideBox}>
                <span className={styles.soilGuideText}>
                  {'측정기 액정 전체를\n이 안에 맞추세요'}
                </span>
              </div>
            </div>
          </>
        )}

        {/* 작업일지 방법 선택 */}
        {phase === PHASE.JOURNAL_METHOD && (
          <div className={styles.soilMethodBox}>
            <ResearchTargetBadge meta={getResearchMeta()} />
            <p className={styles.soilMethodTitle}>작업일지 기록 방식</p>
            <div className={styles.soilMethodGrid}>
              <button className={styles.soilMethodBtn} onClick={() => handleJournalMethodSelect('촬영')}>
                <span className={styles.soilMethodIcon}>📷</span>
                <span className={styles.soilMethodLabel}>촬영</span>
                <span className={styles.soilMethodSub}>현장에서 사진을 찍고 기록</span>
              </button>
              <button className={styles.soilMethodBtn} onClick={() => handleJournalMethodSelect('음성')}>
                <span className={styles.soilMethodIcon}>🎤</span>
                <span className={styles.soilMethodLabel}>음성기록</span>
                <span className={styles.soilMethodSub}>갤러리 사진을 보며 기록 가능</span>
              </button>
            </div>
          </div>
        )}

        {/* 작업일지 사진 촬영 */}
        {phase === PHASE.JOURNAL_LIVE && (
          <LiveCamera
            stream={stream}
            onCapture={handleJournalCameraCapture}
            onFileCapture={async (file) => {
              const dataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader()
                reader.onload = () => resolve(reader.result)
                reader.onerror = reject
                reader.readAsDataURL(file)
              })
              handleJournalCameraCapture({ dataUrl })
            }}
            onClose={handleJournalClose}
            onRetry={startCamera}
            errorMsg={cameraError}
            hint="작업 부위나 수목 상태가 보이도록 촬영하세요"
          />
        )}

        {/* 작업일지 사진 확인 후 음성 기록 */}
        {phase === PHASE.JOURNAL_REVIEW && (
          <div className={styles.journalReview}>
            <ResearchTargetBadge meta={getResearchMeta()} />
            {journalPhoto ? (
              <div className={styles.journalPhotoBox}>
                <img src={journalPhoto} className={styles.journalPhoto} alt="작업일지 사진" />
                <span>사진을 보고 조치 내용을 음성으로 남기세요</span>
              </div>
            ) : (
              <div className={styles.journalEmptyBox}>
                <span className={styles.journalEmptyIcon}>🖼️</span>
                <p>갤러리에서 사진을 불러오거나, 사진 없이 음성기록을 남길 수 있습니다.</p>
              </div>
            )}
            <div className={styles.journalActions}>
              <button className={styles.journalSecondaryBtn} onClick={handleJournalRetake}>
                다시 촬영
              </button>
              <button className={styles.journalSecondaryBtn} onClick={handleJournalPhotoImport}>
                이미지 불러오기
              </button>
              {journalPhoto && (
                <a className={styles.journalSecondaryBtn} href={journalPhoto} download={`journal-photo-${Date.now()}.jpg`}>
                  사진 저장
                </a>
              )}
              <button className={styles.journalPrimaryBtn} onClick={handleJournalVoiceStart}>
                🎤 녹음
              </button>
            </div>
          </div>
        )}

        {/* 연구DB 내보내기 화면 */}
        {phase === PHASE.RESEARCH_DB && researchDb && (
          <div className={styles.researchDbBox}>
            <p className={styles.researchDbTitle}>
              {researchDb.rows.length}개 사건 단위 연구DB
            </p>
            <p className={styles.researchDbGuide}>
              다운로드가 안 되면 CSV 복사를 눌러 메모장, 카카오톡, 메일에 붙여넣어 보관하세요.
            </p>
            <div className={styles.researchDbActions}>
              <button className={styles.excelConfirmBtn} onClick={handleResearchDbSaveToPc}>
                PC에 저장
              </button>
            </div>
            <div className={styles.researchDbActions}>
              <button className={styles.excelConfirmBtn} onClick={handleResearchDbDownload}>
                CSV 다운로드
              </button>
              <button className={styles.excelCancelBtn} onClick={handleResearchDbCopy}>
                CSV 복사
              </button>
            </div>
            <div className={styles.researchDbActions}>
              <button className={styles.excelConfirmBtn} onClick={handleResearchDbShare}>
                공유/보내기
              </button>
              <button className={styles.excelCancelBtn} onClick={handleResearchDbSelectAll}>
                전체 선택
              </button>
            </div>
            <textarea
              ref={researchDbTextRef}
              className={styles.researchDbText}
              value={researchDb.csv}
              readOnly
              onFocus={e => e.currentTarget.select()}
            />
          </div>
        )}

        {/* 토양 입력 화면 */}
        {isSoilInputScreen && (
          <SoilInputPanel
            frozenSrc={frozenSrc}
            targetLabel={`${getResearchMeta().treeId} · ${getResearchMeta().treeGroup}`}
            fields={SOIL_FIELDS}
            values={soilValues}
            onChange={handleSoilChange}
            onVoice={handleSoilVoice}
            onPhotoRequest={async () => {
              setPhase(PHASE.SOIL_LIVE)
              await startCamera()
            }}
            onPhotoImportRequest={() => {
              soilPhotoFileRef.current.value = ''
              soilPhotoFileRef.current.click()
            }}
            onSave={handleSoilSaveAll}
          />
        )}

        {/* 캘리퍼스 LCD 사진 + 직접 입력 */}
        {isCaliperScreen && (
          <div className={styles.caliperPanel}>
            <div className={styles.caliperMetaBadge}>
              <strong>{getResearchMeta().treeId}</strong>
              <span>{getResearchMeta().treeGroup} · {getResearchMeta().participantId}</span>
            </div>
            <div className={styles.caliperPhotoBox}>
              {caliperPhoto ? (
                <img src={caliperPhoto} className={styles.caliperPhoto} alt="캘리퍼스 LCD 사진" />
              ) : (
                <div className={styles.caliperEmpty}>
                  <span>📏</span>
                  <p>캘리퍼스 LCD가 보이도록 사진을 남긴 뒤 값을 입력하세요.</p>
                </div>
              )}
            </div>
            <div className={styles.caliperActions}>
              <button className={styles.journalSecondaryBtn} onClick={handleCaliperCameraRequest}>
                촬영
              </button>
              <button className={styles.journalSecondaryBtn} onClick={handleCaliperPhotoRequest}>
                사진 불러오기
              </button>
            </div>
            <label className={styles.caliperDirectInput}>
              캘리퍼스 측정값
              <div>
                <input
                  type="number"
                  inputMode="decimal"
                  placeholder="예: 12.6"
                  value={caliperDirectMm}
                  onChange={e => setCaliperDirectMm(e.target.value)}
                />
                <span>mm</span>
              </div>
            </label>
            <p className={styles.caliperGuide}>
              LCD 사진은 증거자료로 남기고, 현재 단계에서는 값을 직접 입력합니다. OCR 판독은 이후 확장 기능으로 붙일 수 있습니다.
            </p>
            <button className={styles.caliperSaveBtn} onClick={handleCaliperSave}>
              저장
            </button>
          </div>
        )}

        {/* IDLE 안내 */}
        {phase === PHASE.IDLE && (
          <div className={styles.idlePlaceholder}>
            <span style={{ fontSize: 48, opacity: 0.25 }}>👇</span>
            <p className={styles.idleHint}>아래 버튼을 눌러 시작하세요</p>
          </div>
        )}
      </section>

      {/* 숨겨진 파일 입력 (엑셀 불러오기) */}
      <input
        type="file"
        accept=".csv,text/csv,application/csv,text/plain"
        ref={excelFileRef}
        style={{ display: 'none' }}
        onChange={handleExcelFileChange}
      />
      <input
        type="file"
        accept="image/*"
        ref={soilPhotoFileRef}
        style={{ display: 'none' }}
        onChange={handleSoilPhotoFileChange}
      />
      <input
        type="file"
        accept="image/*"
        ref={journalPhotoFileRef}
        style={{ display: 'none' }}
        onChange={handleJournalPhotoFileChange}
      />
      <input
        type="file"
        accept="image/*"
        capture="environment"
        ref={caliperCameraFileRef}
        style={{ display: 'none' }}
        onChange={handleCaliperPhotoFileChange}
      />
      <input
        type="file"
        accept="image/*"
        ref={caliperPhotoFileRef}
        style={{ display: 'none' }}
        onChange={handleCaliperPhotoFileChange}
      />

      {/* ── 버튼 줄: 카메라 모드·토양 입력·토양 서브화면에서 숨김 ── */}
      <input
        type="file"
        accept=".csv,text/csv"
        ref={submitCsvFileRef}
        style={{ display: 'none' }}
        onChange={handleSubmitBackupFileChange}
      />
      <input
        type="file"
        accept="application/json,.json,text/json,text/plain"
        ref={phoneBackupFileRef}
        style={{ display: 'none' }}
        onChange={handlePhoneBackupImportFileChange}
      />
      {!isCameraMode && !isSoilInputScreen && !isSoilSubScreen && !isCaliperScreen && !isResearchDbScreen && !isJournalSubScreen && (
        <>
          <section className={styles.researchMetaPanel}>
            <div className={styles.researchMetaHeader}>
              <strong>연구정보</strong>
              <span>{researchMeta.participantId || 'P01'} · {researchMeta.treeGroup}</span>
            </div>
            <div className={styles.researchMetaGrid}>
              <label>
                참여자ID
                <input
                  value={researchMeta.participantId}
                  onChange={e => updateResearchMeta('participantId', e.target.value)}
                  placeholder="P01"
                />
              </label>
              <label>
                참여자구분
                <select
                  value={researchMeta.participantGroup}
                  onChange={e => updateResearchMeta('participantGroup', e.target.value)}
                >
                  <option>성인학습자</option>
                  <option>예비 농업인</option>
                  <option>고령 농업인</option>
                  <option>도메인 전문가</option>
                </select>
              </label>
              <label>
                수목구분
                <select
                  value={researchMeta.treeGroup}
                  onChange={e => updateResearchMeta('treeGroup', e.target.value)}
                >
                  <option>케이싱 1년</option>
                  <option>케이싱 2년</option>
                  <option>직수수목(대조수목)</option>
                </select>
              </label>
              <label>
                수목ID
                <select
                  value={researchMeta.treeId}
                  onChange={e => updateResearchMeta('treeId', e.target.value)}
                >
                  {treeIdOptions.map(treeId => <option key={treeId}>{treeId}</option>)}
                </select>
              </label>
              <label>
                실험회차
                <input
                  value={researchMeta.sessionLabel}
                  onChange={e => updateResearchMeta('sessionLabel', e.target.value)}
                  placeholder="1회차"
                />
              </label>
            </div>
          </section>
          <section className={styles.typeSelector}>
            {MEASUREMENT_TYPES.map(t => (
              <button
                key={t.id}
                className={`${styles.typeBtn} ${selectedType.id === t.id && phase !== PHASE.IDLE && phase !== PHASE.CONFIRMED ? styles.typeBtnActive : ''}`}
                onClick={() => handleTypeAction(t)}
              >
                <span className={styles.typeIcon}>{t.icon}</span>
                <span className={styles.typeLabel}>{t.label}</span>
              </button>
            ))}
            <button className={styles.typeBtn} onClick={handleOpenJournal}>
              <span className={styles.typeIcon}>📝</span>
              <span className={styles.typeLabel}>작업일지</span>
            </button>
            <button className={styles.typeBtn} onClick={onGoHistory}>
              <span className={styles.typeIcon}>📋</span>
              <span className={styles.typeLabel}>이력</span>
            </button>
            <button className={styles.typeBtn} onClick={handleSubmitResearchDbToPc}>
              <span className={styles.typeIcon}>📤</span>
              <span className={styles.typeLabel}>자료제출</span>
            </button>
            <button className={styles.typeBtn} onClick={handlePhoneBackupDownload}>
              <span className={styles.typeIcon}>💾</span>
              <span className={styles.typeLabel}>스마트폰 백업 저장</span>
            </button>
                        <button className={styles.typeBtn} onClick={handlePhoneBackupImportClick}>
              <span className={styles.typeIcon}>📥</span>
              <span className={styles.typeLabel}>백업 가져오기</span>
            </button>
<button className={styles.typeBtn} onClick={handleSubmitBackupFileClick}>
              <span className={styles.typeIcon}>📁</span>
              <span className={styles.typeLabel}>파일제출</span>
            </button>
            <button className={styles.typeBtn} onClick={handleCompleteClearPhoneData}>
              <span className={styles.typeIcon}>🗑️</span>
              <span className={styles.typeLabel}>완전삭제</span>
            </button>
            <button className={styles.typeBtn} onClick={onGoResearch}>
              <span className={styles.typeIcon}>📈</span>
              <span className={styles.typeLabel}>연구앱</span>
            </button>
          </section>
        </>
      )}

      {/* ── 카메라 모드 하단 바 ── */}
      {isCameraMode && (
        <section className={styles.cameraBottomBar}>
          {phase === PHASE.SOIL_LIVE && (
            <div className={styles.bottomRow}>
              <button className={styles.barBtnClose} onClick={handleCloseSoilCapture} style={{ flex: 1 }}>
                취소
              </button>
            </div>
          )}
          {phase === PHASE.JOURNAL_LIVE && (
            <div className={styles.bottomRow}>
              <button className={styles.barBtnClose} onClick={handleJournalClose} style={{ flex: 1 }}>
                취소
              </button>
            </div>
          )}
          {phase !== PHASE.SOIL_LIVE && phase !== PHASE.JOURNAL_LIVE && (
            <CameraBottomBar
              phase={phase}
              result={result}
              points={points}
              selectedType={selectedType}
              caliperMm={caliperMm}
              onCaliperChange={setCaliperMm}
              onMeasure={handleMeasurePoints}
              onRetake={handleRetakePhoto}
              onRemeasure={handleRemeasure}
              onConfirm={handleConfirm}
              onClose={handleCloseAll}
            />
          )}
        </section>
      )}

      {/* ── 상태 바 ── */}
      <footer className={styles.footer}>
        <StatusBar phase={phase} selectedType={selectedType} points={points} />
      </footer>

      {/* ── 음성 입력 오버레이 ── */}
      {voiceContext && (
        <VoiceScreen
          voice={voice}
          context={voiceContext}
          onSave={handleVoiceSave}
          onClose={handleVoiceClose}
        />
      )}
    </div>
  )
}

// ── 하위 컴포넌트 ─────────────────────────────────────────────────────────────

function MarkerStatus({ found }) {
  return (
    <div className={`${styles.markerStatus} ${found ? styles.markerDetected : styles.markerMissing}`}>
      <span className={styles.markerDot} />
      <span>{found ? '마커 인식됨' : '마커 없음'}</span>
    </div>
  )
}

function ResearchTargetBadge({ meta }) {
  return (
    <div className={styles.targetBadge}>
      <strong>{meta.treeId}</strong>
      <span>{meta.treeGroup} · {meta.participantId}</span>
    </div>
  )
}

function ErrorBanner({ msg }) {
  return (
    <div className={styles.errorBanner} role="alert">
      <span>⚠️</span>
      <span className={styles.errorText}>{msg}</span>
    </div>
  )
}

function HeightTodoInfo() {
  return (
    <div className={styles.cameraPlaceholder}>
      <div style={{ fontSize: 56, opacity: 0.4 }}>📏</div>
      <p className={styles.cameraHint}><strong>수고 측정</strong></p>
      <div className={styles.measureHintBox} style={{ borderColor: '#adb5bd', background: '#f8f9fa' }}>
        <p className={styles.measureHintText} style={{ color: '#495057', textAlign: 'center' }}>
          {'수고 측정 기능은 후속 구현 예정입니다.\n현재 버전에서는 사용할 수 없습니다.'}
        </p>
      </div>
    </div>
  )
}

function ConfirmedBadge() {
  return (
    <div className={styles.confirmedBadge}>
      <span style={{ fontSize: 48 }}>✅</span>
      <span>저장 완료</span>
    </div>
  )
}

function CameraBottomBar({ phase, result, points, selectedType, caliperMm, onCaliperChange, onMeasure, onRetake, onRemeasure, onConfirm, onClose }) {
  if (phase === PHASE.NO_MARKER) {
    return (
      <div className={styles.bottomRow}>
        <button className={styles.barBtnSecondary} onClick={onRetake}>📷 새로 촬영</button>
        <button className={styles.barBtnClose} onClick={onClose}>닫기</button>
      </div>
    )
  }
  if (phase === PHASE.PLACING_POINTS) {
    if (!result) {
      return (
        <div className={styles.bottomRow}>
          <button className={styles.barBtnSecondary} onClick={onRemeasure}>P1·P2 다시찍기</button>
          <button className={styles.barBtnConfirm} onClick={onMeasure}>측정</button>
          <button className={styles.barBtnClose} onClick={onClose}>닫기</button>
        </div>
      )
    }
    const { value, mm, validation } = result
    const unit = selectedType.unit ?? 'mm'
    const formattedValue = unit === 'm' ? value.toFixed(2) : value.toFixed(1)
    const showCaliper = unit === 'mm'
    const caliperNumber = Number(caliperMm)
    const hasCaliper = showCaliper && Number.isFinite(caliperNumber) && caliperNumber > 0
    const absError = hasCaliper ? Math.abs(value - caliperNumber) : null
    const errorRate = hasCaliper ? (absError / caliperNumber) * 100 : null
    return (
      <div className={styles.resultBar}>
        <div className={styles.resultBarValue}>
          <span className={styles.resultBarMm}>{formattedValue}</span>
          <span className={styles.resultBarUnit}>{unit}</span>
          <span className={styles.unvalidatedBadge}>측정 완료</span>
          <button className={styles.resultQuickSaveBtn} onClick={onConfirm} disabled={!validation.valid}>저장</button>
        </div>
        {!validation.valid && <p className={styles.validationWarn}>⚠️ {validation.msg}</p>}
        {showCaliper ? (
          <>
            <label className={styles.caliperInputWrap}>
              캘리퍼스 기준값
              <div>
                <input
                  type="number"
                  inputMode="decimal"
                  value={caliperMm}
                  onChange={e => onCaliperChange(e.target.value)}
                  placeholder="예: 12.6"
                />
                <span>mm</span>
              </div>
            </label>
            {hasCaliper ? (
              <p className={styles.errorNote}>
                오차 {absError.toFixed(1)} mm · 오차율 {errorRate.toFixed(1)}%
              </p>
            ) : (
              <p className={styles.resultNote}>※ 캘리퍼스 기준값을 입력하면 오차가 함께 저장됩니다.</p>
            )}
          </>
        ) : (
          <p className={styles.resultNote}>
            ※ 수고 측정은 m 단위로 저장됩니다. P1은 나무 밑동, P2는 꼭대기 방향으로 찍어주세요.
          </p>
        )}
        <div className={styles.resultBarActions}>
          <button className={styles.barBtnSecondary} onClick={onRemeasure}>P1·P2 다시찍기</button>
          <button className={styles.barBtnSecondary} onClick={onRetake}>새로 촬영</button>
          <button className={styles.barBtnConfirm} onClick={onConfirm} disabled={!validation.valid}>저장</button>
        </div>
      </div>
    )
  }
  return (
    <div className={styles.bottomRow}>
      <button className={styles.barBtnClose} onClick={onRetake}>📷 새로 촬영</button>
      <button className={styles.barBtnClose} onClick={onClose}>닫기</button>
    </div>
  )
}

function StatusBar({ phase, selectedType, points }) {
  const placingMsg =
    points.length === 0 ? (selectedType.id === '수고'
      ? '수고 측정: 나무 아랫부분에서 시작하여 윗부분까지 첫 점을 찍으세요.'
      : '줄기 한쪽 끝(P1)을 탭하세요') :
    points.length === 1 ? (selectedType.id === '수고'
      ? '수고 측정: 반대쪽 꼭대기 위치를 두 번째 점으로 찍으세요.'
      : '반대쪽 끝(P2)을 탭하세요') :
    (selectedType.id === '수고'
      ? 'P1은 밑동, P2는 꼭대기 방향으로 위치를 조정하고 저장하세요.'
      : 'P1·P2를 줄기 양쪽 끝에 맞춘 뒤 측정을 누르세요')
  const msgs = {
    [PHASE.IDLE]:               '버튼을 눌러 측정을 시작하세요',
    [PHASE.LIVE]:               '마커가 보이도록 놓고 촬영 버튼을 누르세요',
    [PHASE.CAPTURING]:          'ArUco 마커 인식 중…',
    [PHASE.NO_MARKER]:          '마커를 인식하지 못했습니다 — 새로 촬영해 주세요',
    [PHASE.PLACING_POINTS]:     placingMsg,
    [PHASE.CONFIRMED]:          '저장 완료',
    [PHASE.HEIGHT_TODO]:        '수고 측정 기능은 추후 구현 예정입니다',
    [PHASE.SOIL_METHOD]:        '측정기 사진을 촬영하거나 불러오세요',
    [PHASE.SOIL_LIVE]:          '측정기 액정 전체를 가이드 안에 맞추고 촬영하세요',
    [PHASE.SOIL_INPUT]:         '각 칸에 값을 입력한 뒤 저장하세요',
    [PHASE.SOIL_EXCEL_PREVIEW]: '내용을 확인하고 저장하세요',
    [PHASE.CALIPER_INPUT]:      '캘리퍼스 LCD 사진을 남기고 값을 입력하세요',
    [PHASE.JOURNAL_METHOD]:     '촬영 또는 음성기록을 선택하세요',
    [PHASE.JOURNAL_LIVE]:       '작업 부위나 수목 상태가 보이도록 촬영하세요',
    [PHASE.JOURNAL_REVIEW]:     '이미지를 불러오거나 녹음을 시작하세요',
  }
  return (
    <div className={styles.statusBar}>
      <span className={styles.statusText}>{msgs[phase] ?? ''}</span>
    </div>
  )
}

