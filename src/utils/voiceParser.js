// 한국어 숫자 발화 → 실수 변환
// "십이" → 12 / "십이 점 오" → 12.5 / "육 점 오" → 6.5

const KOR_DIGITS = { 영:0, 일:1, 이:2, 삼:3, 사:4, 오:5, 육:6, 칠:7, 팔:8, 구:9 }
const KOR_PLACE  = { 십:10, 백:100, 천:1000, 만:10000 }

function korToInt(str) {
  str = str.replace(/\s/g, '')
  if (!str) return 0
  // 아라비아 숫자만 있는 경우
  if (/^[\d]+$/.test(str)) return parseInt(str, 10)

  let total = 0, current = 0
  for (const ch of str) {
    if (ch >= '0' && ch <= '9') {
      current = current * 10 + Number(ch)
    } else if (KOR_DIGITS[ch] !== undefined) {
      current = KOR_DIGITS[ch]
    } else if (KOR_PLACE[ch]) {
      total += (current === 0 ? 1 : current) * KOR_PLACE[ch]
      current = 0
    }
  }
  return total + current
}

// PH 자동 보정: 기기가 소수점 없이 10배 표시하는 경우 보정
// 예: 30→3.0, 65→6.5, 6.5→6.5(그대로), 14→14(그대로)
export function correctPH(raw) {
  return raw > 14 ? +(raw / 10).toFixed(1) : raw
}

// rawText에서 첫 번째 숫자(정수 또는 소수)를 추출해 반환
// 인식 불가 시 NaN 반환
export function extractNumber(rawText) {
  const text = rawText.trim()
  if (!text) return NaN

  // "점" 기준 소수 분리 처리
  const dotIdx = text.indexOf('점')
  if (dotIdx !== -1) {
    const intPart  = korToInt(text.slice(0, dotIdx))
    const fracStr  = text.slice(dotIdx + 1).replace(/\s/g, '')
    const fracDigits = [...fracStr].map(ch =>
      KOR_DIGITS[ch] !== undefined ? KOR_DIGITS[ch] :
      (ch >= '0' && ch <= '9' ? Number(ch) : null)
    ).filter(d => d !== null).join('')
    return intPart + (fracDigits ? parseFloat('0.' + fracDigits) : 0)
  }

  // 아라비아 소수점 포함 숫자 직접 매칭
  const arabicMatch = text.replace(/\s/g, '').match(/^[\d.]+$/)
  if (arabicMatch) return parseFloat(arabicMatch[0])

  // 순수 한국어 정수
  const n = korToInt(text)
  return n === 0 && !text.includes('영') && !text.includes('0') ? NaN : n
}

// 발화에서 등급 키워드 추출 — grades 배열 중 하나를 반환 (없으면 null)
export function extractGrade(text, grades) {
  if (!text || !grades?.length) return null
  const norm = text.trim().toLowerCase()

  // 직접 매칭 (대소문자 무시, 예: 'Low', 'NOR', 'High+')
  for (const g of grades) {
    if (norm.includes(g.toLowerCase())) return g
  }

  // 한국어 별칭 → 영문 등급 (긴 표현 우선)
  const aliases = [
    ['로우마이너스', 'Low-'], ['매우낮음', 'Low-'],
    ['하이플러스',   'High+'], ['매우높음', 'High+'],
    ['로우',   'Low'],  ['낮음', 'Low'], ['낮은', 'Low'],
    ['하이',   'High'], ['높음', 'High'], ['높은', 'High'],
    ['노멀',   'NOR'],  ['노말', 'NOR'],  ['보통', 'NOR'], ['정상', 'NOR'],
  ]
  for (const [ko, grade] of aliases) {
    if (norm.includes(ko) && grades.includes(grade)) return grade
  }

  return null
}
