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
import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { useCamera }        from '../hooks/useCamera'
import { useVoice }         from '../hooks/useVoice'
import { detectAruco, preloadOpenCV, avgSidePx } from '../utils/aruco'
import { detectRedTape } from '../utils/detectRedTape'
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
  findLatestCaliperDiameter,
  getResearchDatabaseRows,
  getCaliperValuesByTreeIds,
} from '../utils/db'
import { parseExcelSoil } from '../utils/excelParser'
import LiveCamera     from './LiveCamera'
import FrozenMeasure  from './FrozenMeasure'
import SoilInputPanel from './SoilInputPanel'
import { fetchLatestSensor, formatTime, formatAge, isStale } from '../utils/sensorApi'
import { syncTreesToSupabase } from '../utils/treeSync'
import QrScanner from './QrScanner'
import VoiceScreen    from './VoiceScreen'
import styles from './MeasurementScreen.module.css'

// ── 측정 유형 ─────────────────────────────────────────────────────────────────
const MEASUREMENT_TYPES = [
  { id: '가지직경', label: '가지직경', unit: 'mm', icon: '🌿', usesCamera: true },
  { id: '근원직경', label: '근원직경', unit: 'mm', icon: '🪵', usesCamera: true },
  { id: '수고',     label: '수고',     unit: 'm',  icon: '🌳', usesCamera: true },
  { id: '토양측정', label: '휴대용 토양측정', unit: null, icon: '🌱', usesCamera: false, usesSoilMeasure: true },
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
  PLACING_POINTS:     'placing_points',
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
  CAMERA_METHOD:      'camera_method',
  LIST_VIEW:          'list_view',
}

const SHOW_DEBUG_OVERLAY = false

// ── 직경 도메인 검증 ──────────────────────────────────────────────────────────
const DIAMETER_RANGE = {
  '근원직경': { min: 5,  max: 60 },
  '가지직경': { min: 2,  max: 40 },
}

function validateDiameter(mm, typeId) {
  const { min, max } = DIAMETER_RANGE[typeId] ?? { min: 5, max: 30 }
  const place = typeId === '가지직경' ? '가지' : '줄기'
  if (mm < min) return { valid: false, msg: `${mm.toFixed(1)} mm — 최소(${min} mm) 미만. 마커·${place}가 같은 평면인지 확인 후 재측정.` }
  if (mm > max) return { valid: false, msg: `${mm.toFixed(1)} mm — 최대(${max} mm) 초과. 마커·${place}가 같은 평면인지 확인 후 재측정.` }
  return { valid: true, msg: null }
}

const HEIGHT_RANGE = { min: 0.5, max: 25 }
function validateHeight(m) {
  if (m < HEIGHT_RANGE.min) {
    return { valid: false, msg: `${m.toFixed(2)} m — 최소(${HEIGHT_RANGE.min} m) 미만입니다.` }
  }
  if (m > HEIGHT_RANGE.max) {
    return { valid: false, msg: `${m.toFixed(2)} m — 최대(${HEIGHT_RANGE.max} m) 초과입니다.` }
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
export default function MeasurementScreen({ onGoHistory, onGoResearch, onGoAnalysis, onGoSensor, onGoReport, onExitMode, onRegisterBack }) {
  const [phase, setPhase]               = useState(PHASE.IDLE)
  const [selectedType, setSelectedType] = useState(MEASUREMENT_TYPES[0])
  const selectedTypeRef = useRef(selectedType)
  useEffect(() => { selectedTypeRef.current = selectedType }, [selectedType])
  const [redTapeFound, setRedTapeFound] = useState(null) // null=해당없음, true/false
  const redTapeTimerRef = useRef(null)

  const [frozenSrc,     setFrozenSrc]     = useState(null)
  const [frozenSize,    setFrozenSize]    = useState({ w: 0, h: 0 })
  const [markerCorners, setMarkerCorners] = useState(null)
  const [pixelPerMm,    setPixelPerMm]    = useState(0)
  const [points,        setPoints]        = useState([])
  const [result,        setResult]        = useState(null)
  const [debugInfo,     setDebugInfo]     = useState(null)

  const [soilValues,  setSoilValues]  = useState({})
  const [sensorStatus, setSensorStatus] = useState(null)
  const [excelRows,   setExcelRows]   = useState(null)
  const [excelError,  setExcelError]  = useState('')
  const excelFileRef = useRef(null)
  const soilPhotoFileRef = useRef(null)
  const journalPhotoFileRef = useRef(null)
  const phoneBackupFileRef = useRef(null)
  const researchDbTextRef = useRef(null)
  const cameraMethodFileRef = useRef(null)

  const [markerInfo, setMarkerInfo] = useState(null)
  const pointsRef = useRef([])
  const pixelPerMmRef = useRef(0)
  const [journalPhoto, setJournalPhoto] = useState(null)
  const [caliperDirectMm, setCaliperDirectMm] = useState('')
  const [caliperStatusMap, setCaliperStatusMap] = useState({})
  const [researchDb, setResearchDb] = useState(null)
  const [researchMeta, setResearchMeta] = useState(loadResearchMeta)
  const [showQrScan, setShowQrScan] = useState(false)
  const [syncState, setSyncState] = useState(null) // {kind:'syncing'|'done'|'pending'|'offline'}
  const [caliperMm, setCaliperMm] = useState('')
  const [cvState, setCvState] = useState('loading')
  const [cvError, setCvError] = useState('')
  const [caliperSource, setCaliperSource] = useState(null)
  const [listRows, setListRows] = useState([])
  const [listLoading, setListLoading] = useState(false)
  const histActiveRef = useRef(false)
  const nativeBackRef = useRef(null)

  const voice = useVoice()
  const [voiceContext, setVoiceContext] = useState(null)

  const { stream, cameraError, isActive, start: startCamera, stop: stopCamera } = useCamera()

  function rememberPixelPerMm(value) {
    const numeric = Number(value) || 0
    pixelPerMmRef.current = numeric
    setPixelPerMm(numeric)
  }

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

  useEffect(() => {
    if (phase !== PHASE.CALIPER_INPUT) return
    const treeGroup = normalizeTreeGroup(researchMeta.treeGroup)
    const treeIds = getTreeIdOptions(treeGroup)
    getCaliperValuesByTreeIds(treeIds)
      .then(map => setCaliperStatusMap(map))
      .catch(err => console.error('[캘리퍼스 상태 조회 실패]', err))
  }, [phase, researchMeta.treeGroup])

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

  useEffect(() => {
    onRegisterBack?.(() => nativeBackRef.current?.())
  }, [onRegisterBack])

  nativeBackRef.current = function handleNativeBack() {
    histActiveRef.current = false
    if (isActive) stopCamera()
    voice.stop(); voice.reset()
    setVoiceContext(null)
    setFrozenSrc(null); setMarkerCorners(null); rememberPixelPerMm(0); setJournalPhoto(null)
    setPoints([]); setResult(null); setDebugInfo(null)
    setSoilValues({}); setExcelRows(null); setExcelError('')
    setCaliperMm('')
    setCaliperSource(null)
    setResearchDb(null)
    setListRows([])
    setPhase(PHASE.IDLE)
  }

  function resetAll() {
    if (isActive) stopCamera()
    setFrozenSrc(null); setMarkerCorners(null); rememberPixelPerMm(0); setJournalPhoto(null)
    setPoints([]); setResult(null); setDebugInfo(null); setMarkerInfo(null)
    setSoilValues({})
    setCaliperMm('')
    setCaliperDirectMm('')
    setResearchDb(null)
    setCaliperSource(null)
    setListRows([])
  }

  async function handleTypeAction(t) {
    resetAll()
    setSelectedType(t)
    if (t.usesCamera) {
      setPhase(PHASE.CAMERA_METHOD)
    } else if (t.usesCaliper) {
      setCaliperDirectMm('')
      setPhase(PHASE.CALIPER_INPUT)
    } else if (t.usesSoilMeasure) {
      setExcelRows(null); setExcelError('')
      setPhase(PHASE.SOIL_METHOD)
    } else {
      setPhase(PHASE.HEIGHT_TODO)
    }
  }

  async function handleCameraMethodSelect(method) {
    if (method === '촬영') {
      setPhase(PHASE.LIVE)
      await startCamera()
    } else {
      cameraMethodFileRef.current.value = ''
      cameraMethodFileRef.current.click()
    }
  }

  async function handleCameraMethodFileChange(e) {
    const file = e.target.files[0]
    if (!file) return
    try {
      await handlePhotoFileCapture(file)
    } finally {
      e.target.value = ''
    }
  }

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
      // 가지직경·근원직경이면 파란 테이프를 자동 감지해 두 점 제안 (사용자가 확인·조정)
      const curType = selectedTypeRef.current
      if (curType.id === '가지직경' || curType.id === '근원직경') {
        try {
          const suggested = detectRedTape(canvas, videoW, videoH, detected.corners)
          if (suggested && suggested.length === 2) {
            setPoints(suggested)
            setRedTapeFound(true)
          } else {
            setRedTapeFound(false)
          }
          // 2.5초 뒤 안내 자동으로 사라짐 (화면 가림 방지)
          if (redTapeTimerRef.current) clearTimeout(redTapeTimerRef.current)
          redTapeTimerRef.current = setTimeout(() => setRedTapeFound(null), 2500)
        } catch (e) {
          console.warn('[파란 테이프 자동 제안 건너뜀]', e)
          setRedTapeFound(false)
        }
      }
      setPhase(PHASE.PLACING_POINTS)
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

  async function handleMeasurePoints() {
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
    setRedTapeFound(null)  // 측정값 나오면 위쪽 안내 배지 숨김
    if ((selectedType.id === '근원직경' || selectedType.id === '가지직경') && pxDist > 0) {
      try {
        const latestCaliper = await findLatestCaliperDiameter(getResearchMeta().treeId)
        if (latestCaliper !== null && latestCaliper > 0) {
          setCaliperMm(String(latestCaliper))
          setCaliperSource('auto')
        }
      } catch { /* 조용히 무시 */ }
    }
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

  function handleCaliperChange(value) {
    setCaliperMm(value)
    setCaliperSource('manual')
  }

  async function handleConfirm() {
    const caliperNumber = Number(caliperMm)
    const hasManualCaliper = caliperSource === 'manual' && Number.isFinite(caliperNumber) && caliperNumber > 0
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
        if (hasManualCaliper) {
          const caliperEventId = await saveDiameterMeasurement({
            typeId:           '캘리퍼스직경',
            mm:               caliperNumber,
            validationStatus: true,
            pixelPerMm:       null,
            imageDataUrl:     null,
            meta:             getResearchMeta(),
          })
          await autoSubmitSavedEvents(caliperEventId)
        }
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
        imageDataUrl:     null,
        meta:             getResearchMeta(),
      })
      await autoSubmitSavedEvents(eventId)
    } catch (err) {
      console.error('[캘리퍼스 저장 실패]', err)
      alert('캘리퍼스 값을 저장하지 못했습니다.')
      return
    }
    setCaliperDirectMm('')
    const treeGroup = normalizeTreeGroup(researchMeta.treeGroup)
    const treeIds = getTreeIdOptions(treeGroup)
    getCaliperValuesByTreeIds(treeIds)
      .then(map => setCaliperStatusMap(map))
      .catch(() => {})
  }

  function handleCaliperBack() {
    setCaliperDirectMm('')
    setPhase(PHASE.IDLE)
  }

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

  // ── QR 스캔으로 수목 자동 선택 ──
  function handleQrResult(treeId) {
    setShowQrScan(false)
    if (!treeId) return
    const group = normalizeTreeGroup(treeId)
    const options = getTreeIdOptions(group)
    // QR이 정확히 목록에 있으면 그대로, 아니면 구분만 맞추고 첫 번째
    const matched = options.find(o => o.replace(/\s+/g, '') === String(treeId).replace(/\s+/g, ''))
    setResearchMeta(prev => ({
      ...prev,
      treeGroup: group,
      treeId: matched || options[0],
    }))
    alert(`수목 선택됨: ${matched || treeId}`)
  }

  // ── 저장 직후 자동 업로드 (온라인일 때만, 실패해도 측정엔 영향 없음) ──
  const autoSyncTimerRef = useRef(null)
  function autoSyncAfterSave() {
    // 오프라인이면 시도 안 함 (폰에는 이미 저장됨)
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setSyncState({ kind: 'offline' })
      return
    }
    // 연속 저장 시 과도한 호출 방지: 마지막 저장 1.5초 뒤 한 번만 올림
    if (autoSyncTimerRef.current) clearTimeout(autoSyncTimerRef.current)
    setSyncState({ kind: 'syncing' })
    autoSyncTimerRef.current = setTimeout(async () => {
      try {
        await syncTreesToSupabase()
        setSyncState({ kind: 'done', at: Date.now() })
      } catch (err) {
        // 실패해도 폰에는 저장돼 있으니 조용히 표시만
        console.warn('[자동 업로드 실패 — 폰에는 저장됨]', err)
        setSyncState({ kind: 'pending' })
      }
    }, 1500)
  }

  // ── 수목 이력을 Supabase로 올리기 (고객 리포트 동기화) ──
  async function handleTreeSync() {
    if (!window.confirm('이 휴대폰의 측정 이력을 고객 열람용 서버로 올릴까요?')) return
    try {
      const res = await syncTreesToSupabase()
      alert(`업로드 완료\n수목 ${res.trees}그루 · 기록 ${res.records}건` + (res.weather ? '\n기상 정보도 저장했습니다.' : ''))
    } catch (err) {
      console.error('[수목 동기화 실패]', err)
      alert('업로드에 실패했습니다.\n' + (err?.message || '인터넷 연결을 확인해 주세요.'))
    }
  }

  // ── ESP32 토양센서 최신값 불러오기 → 토양수분·토양온도 자동 채움 ──
  async function handleSensorFetch() {
    setSensorStatus({ loading: true })
    try {
      const latest = await fetchLatestSensor()
      if (!latest) {
        setSensorStatus({ kind: 'warn', message: '저장된 센서 데이터가 없습니다. 센서 전원을 확인해 주세요.' })
        return
      }
      setSoilValues(prev => {
        const next = { ...prev }
        if (latest.soilMoisture !== null) next['토양수분'] = latest.soilMoisture
        if (latest.temperature  !== null) next['토양온도'] = latest.temperature
        return next
      })
      const stale = isStale(latest.createdAt)
      const ecText = latest.ec !== null ? ` · EC ${latest.ec.toFixed(2)} mS/cm (참고)` : ''
      setSensorStatus({
        kind: stale ? 'warn' : 'ok',
        message:
          `센서 측정 ${formatTime(latest.createdAt)} (${formatAge(latest.createdAt)})` + ecText +
          (stale ? '\n⚠️ 오래된 값입니다. 센서 전원이 꺼져 있을 수 있으니 확인 후 사용하세요.' : ''),
      })
    } catch (err) {
      console.error('[센서 불러오기 실패]', err)
      setSensorStatus({ kind: 'error', message: '센서 서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.' })
    }
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
    setSensorStatus(null)
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
    setSensorStatus(null)
    setExcelRows(null)
    setPhase(PHASE.IDLE)
  }

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

  function handleResearchDbSelectAll() {
    const el = researchDbTextRef.current
    if (!el) return
    el.focus()
    el.select()
  }

  async function autoSubmitSavedEvents(eventIds) {
    const ids = Array.isArray(eventIds) ? eventIds.filter(Boolean) : [eventIds].filter(Boolean)
    if (!ids.length) return
    // 1) PC 자동 백업 (기존)
    try {
      const data = await makeResearchDatabaseCsv({ includeImages: false, eventIds: ids })
      if (data.rows.length) {
        await fetch('/api/research-db-export', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ csv: data.csv }),
        })
      }
    } catch (err) {
      console.warn('[PC 자동 백업 실패]', err)
    }
    // 2) 서버(Supabase) 자동 업로드 — 온라인일 때만, 실패해도 무시
    autoSyncAfterSave()
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

  async function handleOpenList() {
    resetAll()
    setListLoading(true)
    setPhase(PHASE.LIST_VIEW)
    try {
      const rows = await getResearchDatabaseRows()
      setListRows(rows)
    } catch (err) {
      console.error('[리스트 로드 실패]', err)
      setListRows([])
    }
    setListLoading(false)
  }

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
  const isListViewScreen = phase === PHASE.LIST_VIEW
  const isCameraMethodScreen = phase === PHASE.CAMERA_METHOD
  const treeIdOptions = getTreeIdOptions(researchMeta.treeGroup)

  const frozenTapPhase = {
    [PHASE.NO_MARKER]:      'no_marker',
    [PHASE.PLACING_POINTS]: 'placing_points',
  }[phase] ?? 'placing_points'

  const isMenuScreen = !isCameraMode && !isSoilInputScreen && !isSoilSubScreen && !isCaliperScreen && !isResearchDbScreen && !isJournalSubScreen && !isListViewScreen && !isCameraMethodScreen

  return (
    <div className={`${styles.screen} ${isMenuScreen ? styles.screenScroll : ''}`}>
      {showQrScan && (
        <QrScanner onResult={handleQrResult} onCancel={() => setShowQrScan(false)} />
      )}

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
            <span className={styles.soilHeaderTitle}>휴대용 토양측정</span>
            <div style={{ width: 72, flexShrink: 0 }} />
          </header>
        ) : isCameraMethodScreen ? (
          <header className={styles.soilHeader}>
            <button className={styles.soilBackBtn} onClick={() => setPhase(PHASE.IDLE)}>
              &larr; 뒤로
            </button>
            <span className={styles.soilHeaderTitle}>{selectedType.label}</span>
            <div style={{ width: 72, flexShrink: 0 }} />
          </header>
        ) : isListViewScreen ? (
          <header className={styles.soilHeader}>
            <button className={styles.soilBackBtn} onClick={() => setPhase(PHASE.IDLE)}>
              &larr; 뒤로
            </button>
            <span className={styles.soilHeaderTitle}>일일입력리스트</span>
            <div style={{ width: 72, flexShrink: 0 }} />
          </header>
        ) : (
          <header className={styles.header}>
            <div className={styles.headerTitle}>
              <span className={styles.appName}>조경수 생산이력관리</span>
              <span className={styles.milestone}>연구자용 — 측정·기록·분석</span>
            </div>
            {syncState && (
              <span style={{
                flexShrink: 0, marginRight: 8, fontSize: 11, fontWeight: 800,
                padding: '3px 8px', borderRadius: 8,
                background: syncState.kind === 'done' ? 'rgba(255,255,255,0.25)'
                  : syncState.kind === 'syncing' ? 'rgba(255,255,255,0.18)'
                  : 'rgba(255,200,80,0.3)',
                color: '#fff',
              }}>
                {syncState.kind === 'syncing' && '⟳ 올리는 중'}
                {syncState.kind === 'done' && '☁ 저장됨'}
                {syncState.kind === 'pending' && '⚠ 대기'}
                {syncState.kind === 'offline' && '⚠ 오프라인'}
              </span>
            )}
            {onExitMode && (
              <button
                onClick={onExitMode}
                style={{
                  flexShrink: 0, minHeight: 36, padding: '0 12px', marginRight: 8,
                  borderRadius: 9, border: 'none', background: 'rgba(255,255,255,0.2)',
                  color: '#fff', fontSize: 13, fontWeight: 800,
                }}
              >
                ⇄ 모드
              </button>
            )}
            {phase !== PHASE.SOIL_LIVE && phase !== PHASE.JOURNAL_LIVE && (
              <MarkerStatus found={markerCorners !== null && phase !== PHASE.NO_MARKER} />
            )}
          </header>
        )
      )}

      {cameraError && <ErrorBanner msg={cameraError} />}

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

      <section className={`${styles.cameraArea} ${isCameraMode ? styles.cameraAreaExpanded : ''} ${(isSoilInputScreen || isJournalSubScreen || isCaliperScreen || isListViewScreen || isCameraMethodScreen) ? styles.cameraAreaSoil : ''}`}>

        {phase === PHASE.CONFIRMED && <ConfirmedBadge />}

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

        {phase === PHASE.CAPTURING && (
          <div className={styles.processingOverlay}>
            <span className={styles.processingSpinner}>⏳</span>
            <p>{cvState === 'loading' ? '마커 모듈 준비 중…' : '마커 인식 중…'}</p>
          </div>
        )}

        {/* 파란 테이프 자동 감지 결과 — 2.5초만 짧게 표시 (화면 가림 최소화) */}
        {phase === PHASE.PLACING_POINTS && !result && redTapeFound === true && (
          <div style={{
            position: 'absolute', top: 10, left: 0, right: 0, zIndex: 20,
            textAlign: 'center', pointerEvents: 'none',
          }}>
            <span style={{
              display: 'inline-block', padding: '5px 12px', borderRadius: 12,
              background: 'rgba(30,80,160,0.85)', color: '#fff',
              fontSize: 12, fontWeight: 800,
            }}>
              🔵 자동 인식됨 — 위치 확인 후 조정
            </span>
          </div>
        )}
        {phase === PHASE.PLACING_POINTS && !result && redTapeFound === false && (
          <div style={{
            position: 'absolute', top: 10, left: 0, right: 0, zIndex: 20,
            textAlign: 'center', pointerEvents: 'none',
          }}>
            <span style={{
              display: 'inline-block', padding: '5px 12px', borderRadius: 12,
              background: 'rgba(180,120,30,0.85)', color: '#fff',
              fontSize: 12, fontWeight: 800,
            }}>
              자동 인식 실패 — 직접 두 점을 찍어 주세요
            </span>
          </div>
        )}

        {[PHASE.NO_MARKER, PHASE.PLACING_POINTS].includes(phase) && (
          <FrozenMeasure
            frozenSrc={frozenSrc} frozenW={frozenSize.w} frozenH={frozenSize.h}
            markerCorners={markerCorners} points={points}
            pixelPerMm={pixelPerMm} tapPhase={frozenTapPhase}
            hasResult={!!result}
            onPointsChange={handlePointsChange} debugInfo={debugInfo}
          />
        )}

        {phase === PHASE.SOIL_METHOD && (
          <div className={styles.soilMethodBox}>
            <ResearchTargetBadge meta={getResearchMeta()} />
            <p className={styles.soilMethodTitle}>휴대용 토양측정 방식 선택</p>
            <div className={styles.soilMethodGrid}>
              <button className={styles.soilMethodBtn} onClick={() => handleSoilMethodSelect('촬영')}>
                <span className={styles.soilMethodIcon}>📷</span>
                <span className={styles.soilMethodLabel}>촬영</span>
                <span className={styles.soilMethodSub}>측정기 화면을 찍고 값 입력</span>
              </button>
              <button className={styles.soilMethodBtn} onClick={() => handleSoilMethodSelect('사진불러오기')}>
                <span className={styles.soilMethodIcon}>🖼️</span>
                <span className={styles.soilMethodLabel}>사진 불러오기</span>
                <span className={styles.soilMethodSub}>찍어 둔 사진 사용 또는 값만 입력</span>
              </button>
            </div>
          </div>
        )}

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
              noMarker={true}
              hint={'측정기 액정이 잘 보이게 촬영하세요'}
            />
          </>
        )}

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
            noMarker={true}
            hint="작업 부위나 수목 상태가 보이도록 촬영하세요"
          />
        )}

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

        {phase === PHASE.RESEARCH_DB && researchDb && (
          <div className={styles.researchDbBox}>
            <p className={styles.researchDbTitle}>
              {researchDb.rows.length}개 사건 단위 연구DB
            </p>
            <p className={styles.researchDbGuide}>
              PC 자동 저장은 계측 저장 때마다 1건씩 처리합니다.
            </p>
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
            onSensorFetch={handleSensorFetch}
            sensorStatus={sensorStatus}
          />
        )}

        {isCaliperScreen && (
          <div className={styles.caliperPanel}>
            <div className={styles.caliperSelects}>
              <label className={styles.caliperSelectLabel}>
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
              <label className={styles.caliperSelectLabel}>
                수목ID
                <select
                  value={researchMeta.treeId}
                  onChange={e => updateResearchMeta('treeId', e.target.value)}
                >
                  {getTreeIdOptions(researchMeta.treeGroup).map(tid => <option key={tid}>{tid}</option>)}
                </select>
              </label>
            </div>
            {caliperStatusMap[researchMeta.treeId] != null && (
              <div className={styles.caliperExistingValue}>
                저장된 값: <strong>{Number(caliperStatusMap[researchMeta.treeId]).toFixed(2)} mm</strong>
              </div>
            )}
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
            <button className={styles.caliperSaveBtn} onClick={handleCaliperSave}>
              저장
            </button>
            <div className={styles.caliperStatusList}>
              <p className={styles.caliperStatusTitle}>측정 현황 — {normalizeTreeGroup(researchMeta.treeGroup)}</p>
              {getTreeIdOptions(researchMeta.treeGroup).map(tid => {
                const val = caliperStatusMap[tid]
                const isSelected = researchMeta.treeId === tid
                return (
                  <button
                    key={tid}
                    className={`${styles.caliperStatusRow}${isSelected ? ` ${styles.caliperStatusRowActive}` : ''}`}
                    onClick={() => updateResearchMeta('treeId', tid)}
                  >
                    <span className={styles.caliperStatusId}>{tid}</span>
                    <span className={val != null ? styles.caliperStatusValue : styles.caliperStatusMissing}>
                      {val != null ? `${Number(val).toFixed(2)} mm` : '누락'}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {phase === PHASE.CAMERA_METHOD && (
          <div className={styles.soilMethodBox}>
            <ResearchTargetBadge meta={getResearchMeta()} />
            <p className={styles.soilMethodTitle}>{selectedType.label} — 측정 방식 선택</p>
            <div className={styles.soilMethodGrid}>
              <button className={styles.soilMethodBtn} onClick={() => handleCameraMethodSelect('촬영')}>
                <span className={styles.soilMethodIcon}>📷</span>
                <span className={styles.soilMethodLabel}>촬영</span>
                <span className={styles.soilMethodSub}>카메라로 직접 촬영</span>
              </button>
              <button className={styles.soilMethodBtn} onClick={() => handleCameraMethodSelect('사진불러오기')}>
                <span className={styles.soilMethodIcon}>🖼️</span>
                <span className={styles.soilMethodLabel}>사진 불러오기</span>
                <span className={styles.soilMethodSub}>갤러리에서 이미 찍은 사진 사용</span>
              </button>
            </div>
          </div>
        )}

        {phase === PHASE.LIST_VIEW && (
          <ListViewPanel rows={listRows} loading={listLoading} />
        )}

        {phase === PHASE.IDLE && (
          <div className={styles.idlePlaceholder}>
            <span style={{ fontSize: 48, opacity: 0.25 }}>👇</span>
            <p className={styles.idleHint}>아래 버튼을 눌러 시작하세요</p>
          </div>
        )}
      </section>

      <input type="file" accept=".csv,text/csv,application/csv,text/plain" ref={excelFileRef} style={{ display: 'none' }} onChange={handleExcelFileChange} />
      <input type="file" accept="image/*" ref={soilPhotoFileRef} style={{ display: 'none' }} onChange={handleSoilPhotoFileChange} />
      <input type="file" accept="image/*" ref={journalPhotoFileRef} style={{ display: 'none' }} onChange={handleJournalPhotoFileChange} />
      <input type="file" accept="image/*" ref={cameraMethodFileRef} style={{ display: 'none' }} onChange={handleCameraMethodFileChange} />
      <input type="file" accept="application/json,.json,text/json,text/plain" ref={phoneBackupFileRef} style={{ display: 'none' }} onChange={handlePhoneBackupImportFileChange} />

      {!isCameraMode && !isSoilInputScreen && !isSoilSubScreen && !isCaliperScreen && !isResearchDbScreen && !isJournalSubScreen && !isListViewScreen && !isCameraMethodScreen && (
        <>
          <section className={styles.researchMetaPanel}>
            <div className={styles.researchMetaHeader}>
              <strong>연구정보</strong>
              <span>{researchMeta.participantId || 'P01'} · {researchMeta.treeGroup}</span>
            </div>
            <div className={styles.researchMetaGrid}>
              <label>
                참여자ID
                <input value={researchMeta.participantId} onChange={e => updateResearchMeta('participantId', e.target.value)} placeholder="P01" />
              </label>
              <label>
                참여자구분
                <select value={researchMeta.participantGroup} onChange={e => updateResearchMeta('participantGroup', e.target.value)}>
                  <option>성인학습자</option>
                  <option>예비 농업인</option>
                  <option>고령 농업인</option>
                  <option>도메인 전문가</option>
                </select>
              </label>
              <label>
                수목구분
                <select value={researchMeta.treeGroup} onChange={e => updateResearchMeta('treeGroup', e.target.value)}>
                  <option>케이싱 1년</option>
                  <option>케이싱 2년</option>
                  <option>직수수목(대조수목)</option>
                </select>
              </label>
              <label>
                수목ID
                <select value={researchMeta.treeId} onChange={e => updateResearchMeta('treeId', e.target.value)}>
                  {treeIdOptions.map(treeId => <option key={treeId}>{treeId}</option>)}
                </select>
              </label>
            </div>
            <button
              type="button"
              onClick={() => setShowQrScan(true)}
              style={{
                marginTop: 8, width: '100%', minHeight: 46, borderRadius: 12,
                border: '1.5px solid #2d6a4f', background: '#eaf4ee', color: '#1b4332',
                fontSize: 16, fontWeight: 900,
              }}
            >
              📷 QR 스캔으로 수목 선택
            </button>
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
            <button className={styles.typeBtn} onClick={handleOpenList}>
              <span className={styles.typeIcon}>📋</span>
              <span className={styles.typeLabel}>일일입력리스트</span>
            </button>
            <button className={styles.typeBtn} onClick={onGoSensor}>
              <span className={styles.typeIcon}>📡</span>
              <span className={styles.typeLabel}>토양센서</span>
            </button>
            <button className={styles.typeBtn} onClick={onGoResearch}>
              <span className={styles.typeIcon}>✅</span>
              <span className={styles.typeLabel}>측정체크리스트</span>
            </button>
            <button className={styles.typeBtn} onClick={onGoAnalysis}>
              <span className={styles.typeIcon}>📊</span>
              <span className={styles.typeLabel}>수목별 통계분석</span>
            </button>
            <button className={styles.typeBtn} onClick={onGoReport}>
              <span className={styles.typeIcon}>🌳</span>
              <span className={styles.typeLabel}>고객 리포트</span>
            </button>
            <button className={styles.typeBtn} onClick={handleTreeSync}>
              <span className={styles.typeIcon}>☁️</span>
              <span className={styles.typeLabel}>이력 올리기</span>
            </button>
            <button className={styles.typeBtn} onClick={onGoHistory}>
              <span className={styles.typeIcon}>🗂️</span>
              <span className={styles.typeLabel}>전체이력</span>
            </button>
            <button className={styles.typeBtn} onClick={handlePhoneBackupDownload}>
              <span className={styles.typeIcon}>💾</span>
              <span className={styles.typeLabel}>스마트폰 백업 저장</span>
            </button>
            <button className={styles.typeBtn} onClick={handlePhoneBackupImportClick}>
              <span className={styles.typeIcon}>📥</span>
              <span className={styles.typeLabel}>백업 가져오기</span>
            </button>
            <button className={styles.typeBtn} onClick={handleCompleteClearPhoneData}>
              <span className={styles.typeIcon}>🗑️</span>
              <span className={styles.typeLabel}>완전삭제</span>
            </button>
          </section>
        </>
      )}

      {isCameraMode && (
        <section className={styles.cameraBottomBar}>
          {phase === PHASE.SOIL_LIVE && (
            <div className={styles.bottomRow}>
              <button className={styles.barBtnClose} onClick={handleCloseSoilCapture} style={{ flex: 1 }}>취소</button>
            </div>
          )}
          {phase === PHASE.JOURNAL_LIVE && (
            <div className={styles.bottomRow}>
              <button className={styles.barBtnClose} onClick={handleJournalClose} style={{ flex: 1 }}>취소</button>
            </div>
          )}
          {phase !== PHASE.SOIL_LIVE && phase !== PHASE.JOURNAL_LIVE && (
            <CameraBottomBar
              phase={phase}
              result={result}
              points={points}
              selectedType={selectedType}
              caliperMm={caliperMm}
              onCaliperChange={handleCaliperChange}
              onMeasure={handleMeasurePoints}
              onRetake={handleRetakePhoto}
              onRemeasure={handleRemeasure}
              onConfirm={handleConfirm}
              onClose={handleCloseAll}
            />
          )}
        </section>
      )}

      <footer className={styles.footer}>
        <StatusBar phase={phase} selectedType={selectedType} points={points} />
      </footer>

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
    [PHASE.CAMERA_METHOD]:      '촬영 또는 사진 불러오기를 선택하세요',
    [PHASE.LIST_VIEW]:          '스마트폰 저장 자료를 표로 확인합니다',
  }
  return (
    <div className={styles.statusBar}>
      <span className={styles.statusText}>{msgs[phase] ?? ''}</span>
    </div>
  )
}

const LIST_TREE_GROUPS = ['케이싱 1년', '케이싱 2년', '직수수목(대조수목)']
const LIST_GROUP_PREFIX = { '케이싱 1년': '케이싱1년', '케이싱 2년': '케이싱2년', '직수수목(대조수목)': '대조수목' }
const LIST_GROUP_SHORT = { '케이싱 1년': '1년', '케이싱 2년': '2년', '직수수목(대조수목)': '대조' }

function ListViewPanel({ rows, loading }) {
  const [filterGroup, setFilterGroup] = useState('전체')
  const [filterDate, setFilterDate] = useState('')

  const tableData = useMemo(() => {
    const filtered = rows.filter(r => {
      if (filterGroup !== '전체' && r.수목구분 !== filterGroup) return false
      if (filterDate && r.날짜 !== filterDate) return false
      return true
    })
    const groupsToShow = filterGroup === '전체' ? LIST_TREE_GROUPS : [filterGroup]

    return groupsToShow.map(group => {
      const prefix = LIST_GROUP_PREFIX[group] ?? group
      const groupRows = filtered.filter(r => r.수목구분 === group)
      const treeIds = Array.from({ length: 10 }, (_, i) => `${prefix}-${String(i + 1).padStart(2, '0')}`)
      const treeData = treeIds.map(treeId => {
        const treeRows = groupRows.filter(r => r.수목ID === treeId)
        const hasDiameter = treeRows.some(r => Number(r.줄기직경mm) > 0 || Number(r.캘리퍼스직경mm) > 0 || Number(r.흉고직경mm) > 0 || Number(r.근원직경mm) > 0 || Number(r.가지직경mm) > 0)
        const hasPH = treeRows.some(r => Number(r.토양PH) > 0)
        const hasHumidity = treeRows.some(r => Number(r.토양수분) > 0)
        const hasTemp = treeRows.some(r => Number(r.토양온도) > 0)
        const count = [hasDiameter, hasPH, hasHumidity, hasTemp].filter(Boolean).length
        const status = count === 4 ? '완료' : count > 0 ? '일부' : '누락'
        return { treeId, hasDiameter, hasPH, hasHumidity, hasTemp, status, count }
      })
      const completedCount = treeData.filter(d => d.status === '완료').length
      return { group, treeData, completedCount }
    })
  }, [rows, filterGroup, filterDate])

  if (loading) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: '#666', fontSize: 16 }}>
        불러오는 중…
      </div>
    )
  }

  const cellStyle = (has) => ({
    padding: '5px 4px',
    textAlign: 'center',
    fontSize: 15,
    color: has ? '#1b5e20' : '#bdbdbd',
  })
  const rowBg = (status) => status === '완료' ? '#e8f5e9' : status === '일부' ? '#fff8e1' : '#fafafa'

  return (
    <div style={{ overflowY: 'auto', height: '100%', paddingBottom: 8 }}>
      <div style={{ padding: '8px 12px', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', background: '#f5f7f2', borderBottom: '1px solid #dde7de' }}>
        <select
          value={filterGroup}
          onChange={e => setFilterGroup(e.target.value)}
          style={{ fontSize: 14, padding: '6px 8px', borderRadius: 6, border: '1px solid #cad8ce' }}
        >
          <option>전체</option>
          {LIST_TREE_GROUPS.map(g => <option key={g}>{g}</option>)}
        </select>
        <input
          type="date"
          value={filterDate}
          onChange={e => setFilterDate(e.target.value)}
          style={{ fontSize: 14, padding: '6px 8px', borderRadius: 6, border: '1px solid #cad8ce' }}
        />
        {filterDate && (
          <button
            onClick={() => setFilterDate('')}
            style={{ fontSize: 13, padding: '6px 10px', borderRadius: 6, background: '#eef4ef', color: '#2d6a4f', fontWeight: 700 }}
          >
            날짜 전체
          </button>
        )}
      </div>

      {!rows.length ? (
        <div style={{ padding: 32, textAlign: 'center', color: '#888', fontSize: 16 }}>
          스마트폰에 저장된 자료가 없습니다.
        </div>
      ) : (
        tableData.map(({ group, treeData, completedCount }) => (
          <div key={group} style={{ marginBottom: 4 }}>
            <div style={{ background: '#e8f4ed', padding: '7px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #c8dfd0' }}>
              <strong style={{ fontSize: 14, color: '#1b4332' }}>{group}</strong>
              <span style={{ fontSize: 13, color: '#2d6a4f', fontWeight: 800 }}>{completedCount}/10 완료</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#f9fbf8' }}>
                    <th style={{ padding: '5px 8px', textAlign: 'left', borderBottom: '1px solid #e0e0e0', fontWeight: 800, color: '#314438' }}>수목</th>
                    <th style={{ padding: '5px 6px', textAlign: 'center', borderBottom: '1px solid #e0e0e0', fontWeight: 800, color: '#314438' }}>줄기</th>
                    <th style={{ padding: '5px 6px', textAlign: 'center', borderBottom: '1px solid #e0e0e0', fontWeight: 800, color: '#314438' }}>pH</th>
                    <th style={{ padding: '5px 6px', textAlign: 'center', borderBottom: '1px solid #e0e0e0', fontWeight: 800, color: '#314438' }}>습도</th>
                    <th style={{ padding: '5px 6px', textAlign: 'center', borderBottom: '1px solid #e0e0e0', fontWeight: 800, color: '#314438' }}>온도</th>
                    <th style={{ padding: '5px 6px', textAlign: 'center', borderBottom: '1px solid #e0e0e0', fontWeight: 800, color: '#314438' }}>상태</th>
                  </tr>
                </thead>
                <tbody>
                  {treeData.map(({ treeId, hasDiameter, hasPH, hasHumidity, hasTemp, status }) => {
                    const serial = treeId.split('-').pop()
                    return (
                      <tr key={treeId} style={{ background: rowBg(status), borderBottom: '1px solid #eee' }}>
                        <td style={{ padding: '5px 8px', fontWeight: 700, color: '#333', fontSize: 13 }}>
                          {LIST_GROUP_SHORT[group] ?? ''}-{serial}
                        </td>
                        <td style={cellStyle(hasDiameter)}>{hasDiameter ? '✅' : '○'}</td>
                        <td style={cellStyle(hasPH)}>{hasPH ? '✅' : '○'}</td>
                        <td style={cellStyle(hasHumidity)}>{hasHumidity ? '✅' : '○'}</td>
                        <td style={cellStyle(hasTemp)}>{hasTemp ? '✅' : '○'}</td>
                        <td style={{ padding: '5px 4px', textAlign: 'center', fontSize: 11, fontWeight: 800, color: status === '완료' ? '#2d6a4f' : status === '일부' ? '#b45309' : '#9e9e9e' }}>
                          {status}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </div>
  )
}
