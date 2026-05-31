/**
 * excelParser.js — 전문 토양센서 .xlsx 파일 파서
 *
 * 시트명: "soil value" (없으면 첫 번째 시트)
 * 헤더: description / time / temp(℃) / hum(%) / moist(%) / conductivity(us/cm) / ec / ph / light /
 *        n(mg/kg) / p(mg/kg) / k(mg/kg) / fertility(mg/kg)
 * 반환: [{ note, timestamp, measurements: [{measurement_type, measurement_value, measurement_unit}] }]
 */
import * as XLSX from 'xlsx'

// 센서 앱마다 CSV 헤더가 조금씩 달라서 공백·대소문자·단위 표기를 정규화해 읽는다.
const RAW_COLUMN_MAP = {
  'temp':                 { type: '토양온도', unit: '℃'     },
  'temperature':          { type: '토양온도', unit: '℃'     },
  'soil temp':            { type: '토양온도', unit: '℃'     },
  'soil temperature':     { type: '토양온도', unit: '℃'     },
  'temp(℃)':             { type: '토양온도', unit: '℃'     },
  'temp(c)':              { type: '토양온도', unit: '℃'     },
  'temp(°c)':             { type: '토양온도', unit: '℃'     },
  '온도':                 { type: '토양온도', unit: '℃'     },
  '토양온도':             { type: '토양온도', unit: '℃'     },
  'hum':                  { type: '토양수분', unit: '%'      },
  'hum(%)':               { type: '토양수분', unit: '%'      },
  'humidity':             { type: '토양수분', unit: '%'      },
  'humidity(%)':          { type: '토양수분', unit: '%'      },
  'moist':                { type: '토양수분', unit: '%'      },
  'moist(%)':             { type: '토양수분', unit: '%'      },
  'moisture':             { type: '토양수분', unit: '%'      },
  'moisture(%)':          { type: '토양수분', unit: '%'      },
  'soil moisture':        { type: '토양수분', unit: '%'      },
  '수분':                 { type: '토양수분', unit: '%'      },
  '토양수분':             { type: '토양수분', unit: '%'      },
  'conductivity':         { type: 'EC',       unit: 'us/cm' },
  'conductivity(us/cm)':  { type: 'EC',       unit: 'us/cm' },
  'conductivity(μs/cm)':  { type: 'EC',       unit: 'us/cm' },
  'conductivity(µs/cm)':  { type: 'EC',       unit: 'us/cm' },
  'ec':                   { type: 'EC',       unit: 'us/cm' },
  'ec(us/cm)':            { type: 'EC',       unit: 'us/cm' },
  'ec(μs/cm)':            { type: 'EC',       unit: 'us/cm' },
  'ec(µs/cm)':            { type: 'EC',       unit: 'us/cm' },
  '전기전도도':           { type: 'EC',       unit: 'us/cm' },
  'ph':                   { type: '토양PH',   unit: 'pH'    },
  'p h':                  { type: '토양PH',   unit: 'pH'    },
  'ph value':             { type: '토양PH',   unit: 'pH'    },
  'soil ph':              { type: '토양PH',   unit: 'pH'    },
  'soilph':               { type: '토양PH',   unit: 'pH'    },
  '토양ph':               { type: '토양PH',   unit: 'pH'    },
  'light':                { type: '일조',     unit: ''      },
  'light(lux)':           { type: '일조',     unit: 'lux'   },
  'lux':                  { type: '일조',     unit: 'lux'   },
  '조도':                 { type: '일조',     unit: 'lux'   },
  '일조':                 { type: '일조',     unit: 'lux'   },
  'n':                    { type: '질소N',    unit: 'mg/kg' },
  'n(mg/kg)':             { type: '질소N',    unit: 'mg/kg' },
  'p':                    { type: '인P',      unit: 'mg/kg' },
  'p(mg/kg)':             { type: '인P',      unit: 'mg/kg' },
  'k':                    { type: '칼륨K',    unit: 'mg/kg' },
  'k(mg/kg)':             { type: '칼륨K',    unit: 'mg/kg' },
  'fertility':            { type: '비옥도',   unit: 'mg/kg' },
  'fertility(mg/kg)':     { type: '비옥도',   unit: 'mg/kg' },
  'fert':                 { type: '비옥도',   unit: 'mg/kg' },
  'fertility(%)':         { type: '비옥도',   unit: ''      },
  '비옥도':               { type: '비옥도',   unit: 'mg/kg' },
}

const COLUMN_MAP = Object.fromEntries(
  Object.entries(RAW_COLUMN_MAP).map(([key, value]) => [normalizeHeader(key), value]),
)

/**
 * @param {File} file
 * @returns {Promise<Array<{note: string, timestamp: string, measurements: Array}>>}
 */
export function parseExcelSoil(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true })

        const ws = wb.Sheets['soil value'] ?? wb.Sheets[wb.SheetNames[0]]
        if (!ws) { reject(new Error('시트를 찾을 수 없습니다.')); return }

        const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false })
        if (raw.length < 2) { reject(new Error('데이터 행이 없습니다.')); return }

        const headerInfo = findHeaderRow(raw)
        if (!headerInfo) {
          reject(new Error('PH, MOIST, TEMP 같은 센서 헤더를 찾지 못했습니다. CSV 첫 줄 또는 열 이름을 확인해 주세요.'))
          return
        }

        const { headers, headerRowIndex } = headerInfo
        const descIdx = findHeaderIndex(headers, ['description', 'desc', 'note', 'memo', '메모', '비고'])
        const dateIdx = findHeaderIndex(headers, ['date', '날짜'])
        const timeIdx = findHeaderIndex(headers, ['time', 'timestamp', 'datetime', 'date time', 'created at', '시간', '측정시간'])

        const rows = raw.slice(headerRowIndex + 1)
          .filter(r => r.some(c => c !== ''))
          .map(row => {
            const note = descIdx >= 0 ? String(row[descIdx] ?? '').trim() : ''
            const timeRaw = timeIdx >= 0 ? row[timeIdx] : ''
            const dateRaw = dateIdx >= 0 ? row[dateIdx] : ''
            const timestamp = resolveTimestamp(timeRaw, dateRaw)

            const measurements = []
            headers.forEach((h, i) => {
              const mapped = COLUMN_MAP[h]
              if (!mapped) return
              let val = parseFloat(row[i])
              if (isNaN(val)) return
              // pH 센서가 raw 값(×10 배율)으로 저장하는 경우 보정
              if (mapped.type === '토양PH' && val > 14) val = val / 10
              measurements.push({
                measurement_type:  mapped.type,
                measurement_value: val,
                measurement_unit:  mapped.unit,
              })
            })

            return { note, timestamp, measurements }
          })
          .filter(r => r.measurements.length > 0)

        if (rows.length === 0) {
          reject(new Error('측정값을 찾지 못했습니다. 센서 CSV에 PH, MOIST, TEMP 값이 들어 있는지 확인해 주세요.'))
          return
        }
        resolve(rows)
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = () => reject(new Error('파일을 읽을 수 없습니다.'))
    reader.readAsArrayBuffer(file)
  })
}

function normalizeHeader(value) {
  return String(value ?? '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[％]/g, '%')
    .replace(/[℃]/g, '℃')
    .replace(/\s+/g, ' ')
}

function findHeaderRow(rawRows) {
  let best = null
  rawRows.slice(0, 30).forEach((row, index) => {
    const headers = row.map(normalizeHeader)
    const matchCount = headers.filter(h => COLUMN_MAP[h]).length
    if (matchCount > 0 && (!best || matchCount > best.matchCount)) {
      best = { headers, headerRowIndex: index, matchCount }
    }
  })
  return best
}

function findHeaderIndex(headers, aliases) {
  const normalized = aliases.map(normalizeHeader)
  return headers.findIndex(h => normalized.includes(h))
}

function resolveTimestamp(timeRaw, dateRaw = '') {
  const raw = [dateRaw, timeRaw].filter(Boolean).join(' ').trim()
  if (!raw) return new Date().toISOString()
  const d = new Date(raw)
  return isNaN(d) ? new Date().toISOString() : d.toISOString()
}
