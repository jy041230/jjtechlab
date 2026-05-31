/**
 * db.js — IndexedDB 래퍼 (제5장 스키마)
 *
 * 스토어:
 *   event_units       — 이벤트 단위 (PK: event_id)
 *   measurement_data  — 측정값 (event_id FK)
 *   voice_data        — 음성 전사 (event_id FK)
 *   visual_data       — 이미지·세그멘테이션 (event_id FK)
 */

const DB_NAME    = 'plum-measure-db'
const DB_VERSION = 1

let _db = null

function openDB() {
  if (_db) return Promise.resolve(_db)
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)

    req.onupgradeneeded = e => {
      const db = e.target.result

      // event_units
      if (!db.objectStoreNames.contains('event_units')) {
        const eu = db.createObjectStore('event_units', { keyPath: 'event_id' })
        eu.createIndex('by_timestamp', 'timestamp')
        eu.createIndex('by_status',    'status')
      }

      // measurement_data
      if (!db.objectStoreNames.contains('measurement_data')) {
        const md = db.createObjectStore('measurement_data', { keyPath: 'id', autoIncrement: true })
        md.createIndex('by_event', 'event_id')
      }

      // voice_data
      if (!db.objectStoreNames.contains('voice_data')) {
        const vd = db.createObjectStore('voice_data', { keyPath: 'id', autoIncrement: true })
        vd.createIndex('by_event', 'event_id')
      }

      // visual_data
      if (!db.objectStoreNames.contains('visual_data')) {
        const vs = db.createObjectStore('visual_data', { keyPath: 'id', autoIncrement: true })
        vs.createIndex('by_event', 'event_id')
      }
    }

    req.onsuccess = e => { _db = e.target.result; resolve(_db) }
    req.onerror   = e => reject(e.target.error)
  })
}

function txPut(db, storeName, record) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(storeName, 'readwrite')
    const req = tx.objectStore(storeName).put(record)
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

function txAdd(db, storeName, record) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(storeName, 'readwrite')
    const req = tx.objectStore(storeName).add(record)
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

function txGetAll(db, storeName) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(storeName, 'readonly')
    const req = tx.objectStore(storeName).getAll()
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

function txGetByIndex(db, storeName, indexName, key) {
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(storeName, 'readonly')
    const store = tx.objectStore(storeName)
    const req   = store.index(indexName).getAll(key)
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

function txDeleteByKey(db, storeName, key) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(storeName, 'readwrite')
    const req = tx.objectStore(storeName).delete(key)
    req.onsuccess = () => resolve()
    req.onerror   = () => reject(req.error)
  })
}

function txDeleteByEvent(db, storeName, eventId) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    const store = tx.objectStore(storeName)
    const index = store.index('by_event')
    const req = index.openCursor(IDBKeyRange.only(eventId))

    req.onsuccess = e => {
      const cursor = e.target.result
      if (!cursor) return
      cursor.delete()
      cursor.continue()
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

function txGet(db, storeName, key) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(storeName, 'readonly')
    const req = tx.objectStore(storeName).get(key)
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

// ── 공개 API ──────────────────────────────────────────────────────────────────

/**
 * 직경 계측 이벤트 저장 (ArUco)
 * @param {{ typeId, mm, validationStatus, pixelPerMm, imageDataUrl? }} opts
 * @returns {Promise<string>} event_id
 */
export async function saveMeasurement({ typeId, value, unit = 'mm', validationStatus = true, pixelPerMm = null, imageDataUrl = null, meta = {}, note = null }) {
  const db       = await openDB()
  const event_id = crypto.randomUUID()
  const timestamp = new Date().toISOString()

  await txPut(db, 'event_units', {
    event_id,
    timestamp,
    gps_lat:        null,
    gps_lon:        null,
    participant_id: meta.participantId ?? 'user',
    participant_group: meta.participantGroup ?? '',
    tree_id: meta.treeId ?? '',
    tree_group: meta.treeGroup ?? '',
    session_label: meta.sessionLabel ?? '',
    event_type:     '관찰',
    status:         'confirmed',
    note:           note ?? typeId,
  })

  await txAdd(db, 'measurement_data', {
    event_id,
    measurement_type:             typeId,
    measurement_value:            parseFloat(Number(value).toFixed(2)),
    measurement_unit:             unit,
    domain_validation_status:     validationStatus ? 'pass' : 'fail',
    pixel_per_mm:                 pixelPerMm,
    timestamp,
  })

  if (imageDataUrl) {
    await txAdd(db, 'visual_data', {
      event_id,
      image_blob_path:    imageDataUrl,
      segmentation_result: null,
      capture_metadata:   JSON.stringify({ typeId, pixelPerMm }),
      timestamp,
    })
  }

  return event_id
}

export async function saveDiameterMeasurement({ typeId, mm, validationStatus, pixelPerMm, imageDataUrl, meta = {} }) {
  const eventId = await saveMeasurement({
    typeId,
    value: mm,
    unit: 'mm',
    validationStatus,
    pixelPerMm,
    imageDataUrl,
    meta,
    note: typeId,
  })

  const caliperMm = Number(meta.caliperMm)
  if (Number.isFinite(caliperMm) && caliperMm > 0) {
    const appMm = parseFloat(mm.toFixed(2))
    const absError = Math.abs(appMm - caliperMm)
    const errorRate = caliperMm > 0 ? (absError / caliperMm) * 100 : null
    const extraRecords = [
      { measurement_type: `${typeId}_캘리퍼스기준`, measurement_value: parseFloat(caliperMm.toFixed(2)), measurement_unit: 'mm' },
      { measurement_type: `${typeId}_절대오차`, measurement_value: parseFloat(absError.toFixed(2)), measurement_unit: 'mm' },
      { measurement_type: `${typeId}_오차율`, measurement_value: parseFloat(errorRate.toFixed(2)), measurement_unit: '%' },
    ]
    for (const rec of extraRecords) {
      await txAdd(db, 'measurement_data', {
        event_id,
        measurement_type:         rec.measurement_type,
        measurement_value:        rec.measurement_value,
        measurement_unit:         rec.measurement_unit,
        domain_validation_status: 'pass',
        timestamp,
      })
    }
  }

  return eventId
}

/**
 * 토양 측정 전체 저장
 * @param {Array<{ measurement_type, measurement_value, measurement_unit }>} records
 * @returns {Promise<string>} event_id
 */
export async function saveSoilMeasurements(records, meta = {}, imageDataUrl = null) {
  if (!records.length) return null
  const db        = await openDB()
  const event_id  = crypto.randomUUID()
  const timestamp = new Date().toISOString()

  await txPut(db, 'event_units', {
    event_id,
    timestamp,
    gps_lat:        null,
    gps_lon:        null,
    participant_id: meta.participantId ?? 'user',
    participant_group: meta.participantGroup ?? '',
    tree_id: meta.treeId ?? '',
    tree_group: meta.treeGroup ?? '',
    session_label: meta.sessionLabel ?? '',
    event_type:     '관찰',
    status:         'confirmed',
    note:           '토양측정',
  })

  for (const rec of records) {
    await txAdd(db, 'measurement_data', {
      event_id,
      measurement_type:         rec.measurement_type,
      measurement_value:        rec.measurement_value,
      measurement_unit:         rec.measurement_unit ?? '',
      domain_validation_status: 'pass',
      timestamp,
    })
  }

  if (imageDataUrl) {
    await txAdd(db, 'visual_data', {
      event_id,
      image_blob_path:    imageDataUrl,
      segmentation_result: null,
      capture_metadata:   JSON.stringify({ typeId: '토양측정' }),
      timestamp,
    })
  }

  return event_id
}

/**
 * 작업일지(음성) 저장
 * @param {{ transcript_text, confidence?, imageDataUrl? }} opts
 * @returns {Promise<string>} event_id
 */
export async function saveJournalEntry({ transcript_text, confidence, imageDataUrl, meta = {} }) {
  const db        = await openDB()
  const event_id  = crypto.randomUUID()
  const timestamp = new Date().toISOString()

  await txPut(db, 'event_units', {
    event_id,
    timestamp,
    gps_lat:        null,
    gps_lon:        null,
    participant_id: meta.participantId ?? 'user',
    participant_group: meta.participantGroup ?? '',
    tree_id: meta.treeId ?? '',
    tree_group: meta.treeGroup ?? '',
    session_label: meta.sessionLabel ?? '',
    event_type:     '행위',
    status:         'confirmed',
    note:           '작업일지',
  })

  await txAdd(db, 'voice_data', {
    event_id,
    audio_blob_path:        null,
    transcript_text,
    transcript_confidence:  confidence ?? null,
    language_code:          'ko-KR',
    timestamp,
  })

  if (imageDataUrl) {
    await txAdd(db, 'visual_data', {
      event_id,
      image_blob_path:    imageDataUrl,
      segmentation_result: null,
      capture_metadata:   JSON.stringify({ typeId: '작업일지' }),
      timestamp,
    })
  }

  return event_id
}

/**
 * 엑셀 토양 행 일괄 저장 — 행마다 별도 event_units
 * @param {Array<{note, timestamp, measurements}>} rows
 * @returns {Promise<string[]>} event_id 배열
 */
export async function saveExcelSoilRows(rows, meta = {}) {
  if (!rows.length) return []
  const db = await openDB()
  const eventIds = []

  for (const row of rows) {
    const event_id  = crypto.randomUUID()
    const timestamp = row.timestamp ?? new Date().toISOString()

    await txPut(db, 'event_units', {
      event_id,
      timestamp,
      gps_lat:        null,
      gps_lon:        null,
      participant_id: meta.participantId ?? 'user',
      participant_group: meta.participantGroup ?? '',
      tree_id: meta.treeId ?? '',
      tree_group: meta.treeGroup ?? '',
      session_label: meta.sessionLabel ?? '',
      event_type:     '관찰',
      status:         'confirmed',
      note:           row.note ? `토양측정(엑셀) — ${row.note}` : '토양측정(엑셀)',
    })

    for (const rec of row.measurements) {
      await txAdd(db, 'measurement_data', {
        event_id,
        measurement_type:         rec.measurement_type,
        measurement_value:        rec.measurement_value,
        measurement_unit:         rec.measurement_unit ?? '',
        domain_validation_status: 'pass',
        timestamp,
      })
    }

    eventIds.push(event_id)
  }

  return eventIds
}

/**
 * 저장된 모든 이벤트 조회 (최신순)
 */
export async function getAllEvents() {
  const db     = await openDB()
  const events = await txGetAll(db, 'event_units')
  return events.sort((a, b) => b.timestamp.localeCompare(a.timestamp))
}

/**
 * 특정 이벤트의 측정값 조회
 */
export async function getMeasurementsByEvent(event_id) {
  const db = await openDB()
  return txGetByIndex(db, 'measurement_data', 'by_event', event_id)
}

export async function updateHistoryEvent(event_id, eventPatch = {}, measurements = []) {
  const db = await openDB()
  const event = await txGet(db, 'event_units', event_id)
  if (!event) throw new Error('수정할 이력 항목을 찾지 못했습니다.')

  await txPut(db, 'event_units', {
    ...event,
    participant_id: eventPatch.participant_id ?? event.participant_id ?? '',
    participant_group: eventPatch.participant_group ?? event.participant_group ?? '',
    tree_id: eventPatch.tree_id ?? event.tree_id ?? '',
    tree_group: eventPatch.tree_group ?? event.tree_group ?? '',
    session_label: eventPatch.session_label ?? event.session_label ?? '',
    note: eventPatch.note ?? event.note ?? '',
    updated_at: new Date().toISOString(),
  })

  for (const measurement of measurements) {
    if (measurement.id === undefined || measurement.id === null) continue
    await txPut(db, 'measurement_data', {
      ...measurement,
      measurement_value: normalizeEditedMeasurementValue(measurement.measurement_value),
      measurement_unit: measurement.measurement_unit ?? '',
      updated_at: new Date().toISOString(),
    })
  }

  return true
}

export async function deleteHistoryEvent(event_id) {
  const db = await openDB()
  await Promise.all([
    txDeleteByEvent(db, 'measurement_data', event_id),
    txDeleteByEvent(db, 'voice_data', event_id),
    txDeleteByEvent(db, 'visual_data', event_id),
  ])
  await txDeleteByKey(db, 'event_units', event_id)
  return true
}

/**
 * 연구 데이터베이스용 사건 단위 행 조회
 * 줄기/흉고 측정, 토양 측정, 작업일지를 event_id 기준으로 한 행에 묶는다.
 */
export async function getResearchDatabaseRows() {
  const db = await openDB()
  const events = await txGetAll(db, 'event_units')
  const measurements = await txGetAll(db, 'measurement_data')
  const voices = await txGetAll(db, 'voice_data')
  const visuals = await txGetAll(db, 'visual_data')

  const measurementMap = groupByEvent(measurements)
  const voiceMap = groupByEvent(voices)
  const visualMap = groupByEvent(visuals)

  return events
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .map(event => {
      const dateObj = new Date(event.timestamp)
      const mList = measurementMap.get(event.event_id) ?? []
      const vList = voiceMap.get(event.event_id) ?? []
      const imgList = visualMap.get(event.event_id) ?? []
      const byType = Object.fromEntries(mList.map(m => [m.measurement_type, m]))

      return {
        event_id: event.event_id,
        날짜: formatDate(dateObj),
        시간: formatTime(dateObj),
        날짜시간: event.timestamp,
        참여자ID: event.participant_id ?? '',
        참여자구분: event.participant_group ?? '',
        수목ID: event.tree_id ?? '',
        수목구분: event.tree_group ?? '',
        실험회차: event.session_label ?? '',
        사건유형: event.event_type ?? '',
        비고: event.note ?? '',
        줄기직경mm: valueOf(byType, '줄기직경'),
        캘리퍼스줄기직경mm: valueOf(byType, '줄기직경_캘리퍼스기준'),
        줄기직경오차mm: valueOf(byType, '줄기직경_절대오차'),
        줄기직경오차율: valueOf(byType, '줄기직경_오차율'),
        캘리퍼스직경mm: valueOf(byType, '캘리퍼스직경'),
        흉고직경mm: valueOf(byType, '흉고직경'),
        캘리퍼스흉고직경mm: valueOf(byType, '흉고직경_캘리퍼스기준'),
        흉고직경오차mm: valueOf(byType, '흉고직경_절대오차'),
        흉고직경오차율: valueOf(byType, '흉고직경_오차율'),
        토양PH: valueOf(byType, '토양PH'),
        토양수분: valueOf(byType, '토양수분'),
        토양온도: valueOf(byType, '토양온도'),
        EC: valueOf(byType, 'EC'),
        비옥도: valueOf(byType, '비옥도'),
        일조: valueOf(byType, '일조'),
        전체측정값: mList.map(m => `${m.measurement_type}:${m.measurement_value}${m.measurement_unit ?? ''}`).join(' | '),
        음성전사: vList.map(v => v.transcript_text).filter(Boolean).join(' | '),
        이미지여부: imgList.length ? 'Y' : 'N',
        이미지자료: imgList.map(v => v.image_blob_path).filter(Boolean).join(' | '),
        상태: event.status ?? '',
      }
    })
}

export async function downloadResearchDatabaseCsv() {
  const { rows, csv } = await makeResearchDatabaseCsv()
  if (!rows.length) return 0

  const today = formatDate(new Date()).replaceAll('-', '')
  downloadTextFile(`research_database_${today}.csv`, '\ufeff' + csv, 'text/csv;charset=utf-8')
  return rows.length
}

export async function downloadPhoneBackupCsv() {
  const { rows, csv } = await makeResearchDatabaseCsv({ includeImages: false })
  if (!rows.length) return 0

  const now = new Date()
  const stamp = `${formatDate(now).replaceAll('-', '')}_${formatTime(now).replaceAll(':', '')}`
  downloadTextFile(`plum_phone_backup_${stamp}.csv`, '\ufeff' + csv, 'text/csv;charset=utf-8')
  return rows.length
}

export async function makeResearchDatabaseCsv(options = {}) {
  let rows = await getResearchDatabaseRows()
  if (Array.isArray(options.eventIds) && options.eventIds.length) {
    const wanted = new Set(options.eventIds)
    rows = rows.filter(row => wanted.has(row.event_id))
  }
  const headers = [
    'event_id', '날짜', '시간', '날짜시간', '참여자ID', '참여자구분', '수목ID', '수목구분', '실험회차',
    '사건유형', '비고', '줄기직경mm', '캘리퍼스줄기직경mm', '줄기직경오차mm', '줄기직경오차율',
    '캘리퍼스직경mm', '흉고직경mm', '캘리퍼스흉고직경mm', '흉고직경오차mm', '흉고직경오차율', '토양PH', '토양수분',
    '토양온도', 'EC', '비옥도', '일조', '전체측정값', '음성전사',
    '이미지여부', '이미지자료', '상태',
  ]
  const csv = [
    headers.join(','),
    ...rows.map(row => headers.map(h => csvCell(csvExportValue(row[h], options))).join(',')),
  ].join('\r\n')
  return { rows, headers, csv }
}

export async function clearResearchDatabase() {
  const db = await openDB()
  const stores = ['event_units', 'measurement_data', 'voice_data', 'visual_data']
  await Promise.all(stores.map(storeName => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite')
    const req = tx.objectStore(storeName).clear()
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })))
  return true
}

function groupByEvent(records) {
  const map = new Map()
  for (const rec of records) {
    const list = map.get(rec.event_id) ?? []
    list.push(rec)
    map.set(rec.event_id, list)
  }
  return map
}

function valueOf(byType, key) {
  const rec = byType[key]
  return rec?.measurement_value ?? ''
}

function normalizeEditedMeasurementValue(value) {
  if (value === '' || value === null || value === undefined) return ''
  const num = Number(value)
  if (Number.isFinite(num) && String(value).trim() !== '') {
    return parseFloat(num.toFixed(2))
  }
  return value
}

function formatDate(date) {
  if (isNaN(date)) return ''
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function formatTime(date) {
  if (isNaN(date)) return ''
  const h = String(date.getHours()).padStart(2, '0')
  const m = String(date.getMinutes()).padStart(2, '0')
  const s = String(date.getSeconds()).padStart(2, '0')
  return `${h}:${m}:${s}`
}

function csvCell(value) {
  const text = String(value ?? '')
  return `"${text.replaceAll('"', '""')}"`
}

function csvExportValue(value, options = {}) {
  if (options.includeImages !== false) return value
  const text = String(value ?? '')
  return text.includes('data:image') ? '' : value
}

function downloadTextFile(filename, content, type) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
