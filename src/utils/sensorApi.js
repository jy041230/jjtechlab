/**
 * sensorApi.js — ESP32 토양센서 데이터 조회 유틸
 *
 * 데이터 흐름:
 *   ESP32 + RS485 토양센서 (토양온도·토양수분(VWC)·전기전도도(EC))
 *     → WiFi → Supabase 함수(sensor-data)
 *     → single_sensor_data 테이블
 *     → 이 파일의 함수들이 테이블에서 읽어 옴
 *
 * 주의: 아래 키는 Supabase의 "공개용(publishable)" 키로,
 *       브라우저 앱에 넣도록 설계된 키이다. (비밀 키 아님)
 */

const SUPABASE_URL = 'https://bszzvrijybktsfycjnuj.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_iDs9wXBxtwO18O6ucxKjhQ_-vliYxYj'

const HEADERS = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
}

/** 최근 센서 측정값 N건 조회 (최신순) */
export async function fetchRecentSensors(limit = 20) {
  const url =
    `${SUPABASE_URL}/rest/v1/single_sensor_data` +
    `?select=id,temperature,soil_moisture,ec_level,created_at` +
    `&order=created_at.desc&limit=${limit}`

  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) {
    throw new Error(`센서 서버 응답 오류 (${res.status})`)
  }
  const rows = await res.json()
  return rows.map(r => ({
    id: r.id,
    temperature: numOrNull(r.temperature),
    soilMoisture: numOrNull(r.soil_moisture),
    ec: numOrNull(r.ec_level),
    createdAt: r.created_at,
  }))
}

/** 최신 센서 측정값 1건 조회 (없으면 null) */
export async function fetchLatestSensor() {
  const rows = await fetchRecentSensors(1)
  return rows.length ? rows[0] : null
}

/** 측정 시각이 얼마나 오래됐는지 한국어 문구로 변환 */
export function formatAge(createdAt) {
  const t = new Date(createdAt).getTime()
  if (isNaN(t)) return ''
  const diffMin = Math.floor((Date.now() - t) / 60000)
  if (diffMin < 1) return '방금 전'
  if (diffMin < 60) return `${diffMin}분 전`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour}시간 전`
  const diffDay = Math.floor(diffHour / 24)
  return `${diffDay}일 전`
}

/** 측정값이 오래되었는지 여부 (기본: 1시간 이상이면 오래됨) */
export function isStale(createdAt, maxMinutes = 60) {
  const t = new Date(createdAt).getTime()
  if (isNaN(t)) return true
  return (Date.now() - t) / 60000 > maxMinutes
}

/** 측정 시각을 "6월 10일 14:30" 형식으로 변환 */
export function formatTime(createdAt) {
  const d = new Date(createdAt)
  if (isNaN(d.getTime())) return ''
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ` +
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function numOrNull(v) {
  const n = parseFloat(v)
  return isNaN(n) ? null : n
}
