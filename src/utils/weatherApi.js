/**
 * weatherApi.js — 기상청 초단기실황 직접 조회
 *
 * 스마트팜 weather-api 함수가 하던 일을 앱 안으로 옮긴 것.
 * 양산시(연구대상지) 격자 좌표로 기온·습도·강수·풍속·강수형태를 가져온다.
 *
 * ⚠️ 아래 WEATHER_API_KEY 자리에 기상청 공공데이터 인증키(일반 인증키, Decoding)를
 *    붙여넣을 것. 따옴표 안만 바꾸고 따옴표는 지우지 말 것.
 */

// ↓↓↓ 기상청 인증키를 여기에 붙여넣으세요 (공공데이터포털 일반 인증키 Decoding) ↓↓↓
const WEATHER_API_KEY = 'tr9ncEOh7i7MGR8Utm2w+CRRcyYlTtgN+l3pusI3hhAi+oJ43xp7hwXxsRByYC1LfufdhJkqCDJxLzIZkWMfzw=='
// ↑↑↑ 따옴표 안의 글자만 바꾸세요 ↑↑↑

// 양산시청 기상청 격자 좌표
const NX = 91
const NY = 101

const PTY_MAP = {
  '0': '맑음', '1': '비', '2': '비/눈', '3': '눈',
  '5': '빗방울', '6': '빗방울눈날림', '7': '눈날림',
}

export function isWeatherConfigured() {
  return !WEATHER_API_KEY.includes('여기에')
}

/** 양산시 현재 기상 조회 (실패 시 null) */
export async function fetchCurrentWeather() {
  if (!isWeatherConfigured()) {
    throw new Error('기상청 인증키가 설정되지 않았습니다. weatherApi.js를 확인하세요.')
  }

  // 한국시간 기준 가장 최근 정시
  const now = new Date()
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  const baseDate = kst.toISOString().slice(0, 10).replace(/-/g, '')
  const baseTime = String(kst.getUTCHours()).padStart(2, '0') + '00'

  const url =
    `https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst` +
    `?serviceKey=${encodeURIComponent(WEATHER_API_KEY)}` +
    `&numOfRows=10&pageNo=1&dataType=JSON` +
    `&base_date=${baseDate}&base_time=${baseTime}&nx=${NX}&ny=${NY}`

  const res = await fetch(url)
  if (!res.ok) throw new Error(`기상청 응답 오류 (${res.status})`)
  const data = await res.json()

  if (data.response?.header?.resultCode !== '00') {
    throw new Error(`기상청 오류: ${data.response?.header?.resultMsg || '알 수 없음'}`)
  }

  const items = data.response?.body?.items?.item || []
  const w = {}
  items.forEach(it => { w[it.category] = it.obsrValue })

  return {
    temperature: numOrNull(w.T1H),   // 기온(℃)
    humidity: numOrNull(w.REH),      // 습도(%)
    windSpeed: numOrNull(w.WSD),     // 풍속(m/s)
    rainfall: numOrNull(w.RN1),      // 1시간 강수량(mm)
    weather: PTY_MAP[w.PTY || '0'] || '맑음',
    location: '양산시',
    observedAt: `${baseDate.slice(0,4)}-${baseDate.slice(4,6)}-${baseDate.slice(6,8)}T${baseTime.slice(0,2)}:00:00+09:00`,
  }
}

function numOrNull(v) {
  const n = parseFloat(v)
  return isNaN(n) ? null : n
}
