/**
 * soilOcr -- 캔버스 기반 7-세그먼트 LCD 숫자 인식
 *
 * 의존성 없음 (순수 Canvas 2D API).
 * ocrSoilDisplay : 가이드 전체에서 숫자 1개 추출 (기존 호환)
 * ocrSoilAll     : 가이드를 3등분해 수분/pH/온도 각 1개씩 시도 (새 흐름)
 */

// 가이드 박스 비율 (넓게: 92% 폭, 45% 높이)
const GUIDE = { xr: 0.03, yr: 0.10, wr: 0.94, hr: 0.62 }

export function getGuideRect(cw, ch) {
  return {
    x: Math.round(cw * GUIDE.xr),
    y: Math.round(ch * GUIDE.yr),
    w: Math.round(cw * GUIDE.wr),
    h: Math.round(ch * GUIDE.hr),
  }
}

// -- 단일 숫자 추출 (기존 API) --
export function ocrSoilDisplay(srcCanvas) {
  try {
    const cw = srcCanvas.width, ch = srcCanvas.height
    return ocrZone(srcCanvas, getGuideRect(cw, ch))
  } catch {
    return { value: null, confidence: 'low', rawText: '' }
  }
}

// -- 3구역 병렬 추출 (수분 / pH / 온도 순서로 가이드 3등분) --
export function ocrSoilAll(srcCanvas) {
  const cw = srcCanvas.width, ch = srcCanvas.height
  const g  = getGuideRect(cw, ch)
  const h3 = Math.floor(g.h / 3)
  return [0, 1, 2].map(i => {
    try {
      return ocrZone(srcCanvas, { x: g.x, y: g.y + i * h3, w: g.w, h: h3 })
    } catch {
      return { value: null, confidence: 'low', rawText: '' }
    }
  })
}

// -- 주어진 영역에서 숫자 1개 추출 --
function ocrZone(srcCanvas, zone) {
  if (zone.w < 4 || zone.h < 4) return { value: null, confidence: 'low', rawText: '' }

  const SCALE = 3
  const cw2 = zone.w * SCALE, ch2 = zone.h * SCALE
  const crop = mk(cw2, ch2)
  const ctx2 = crop.getContext('2d')
  ctx2.imageSmoothingEnabled = false
  ctx2.drawImage(srcCanvas, zone.x, zone.y, zone.w, zone.h, 0, 0, cw2, ch2)

  const id   = ctx2.getImageData(0, 0, cw2, ch2)
  const gray = new Float32Array(cw2 * ch2)
  for (let i = 0; i < gray.length; i++) {
    const p = i * 4
    gray[i] = 0.299*id.data[p] + 0.587*id.data[p+1] + 0.114*id.data[p+2]
  }

  let lo = 255, hi = 0
  for (const v of gray) { if (v < lo) lo = v; if (v > hi) hi = v }
  const rng = hi - lo || 1
  const leveled = gray.map(v => (v - lo) / rng * 255)

  const t = otsu(leveled, cw2 * ch2)
  let binary = leveled.map(v => v < t)

  const cx0 = Math.round(cw2 * 0.35), cy0 = Math.round(ch2 * 0.35)
  const cx1 = Math.round(cw2 * 0.65), cy1 = Math.round(ch2 * 0.65)
  let darkCnt = 0, centerPx = 0
  for (let y = cy0; y < cy1; y++) for (let x = cx0; x < cx1; x++) {
    if (binary[y * cw2 + x]) darkCnt++
    centerPx++
  }
  if (darkCnt / centerPx > 0.6) binary = binary.map(v => !v)

  const hProj = new Array(ch2).fill(0)
  for (let y = 0; y < ch2; y++) for (let x = 0; x < cw2; x++) {
    if (binary[y * cw2 + x]) hProj[y]++
  }
  const maxH = Math.max(...hProj)
  const hThr = maxH * 0.1
  const activeRows = hProj.map((v, i) => (v > hThr ? i : -1)).filter(i => i >= 0)
  if (activeRows.length === 0) return { value: null, confidence: 'low', rawText: '' }

  const { r0, r1 } = largestRun(activeRows)

  const vProj = new Array(cw2).fill(0)
  for (let y = r0; y < r1; y++) for (let x = 0; x < cw2; x++) {
    if (binary[y * cw2 + x]) vProj[x]++
  }
  const digitH = r1 - r0
  const digitCols = findCols(vProj, cw2)
  if (digitCols.length === 0) return { value: null, confidence: 'low', rawText: '' }

  const results = digitCols.map(([c0, c1]) => {
    const dw = c1 - c0
    if (dw < digitH * 0.18) return { char: '.', conf: 0.75 }
    if (dw < digitH * 0.45) {
      const mid = sampleAt(binary, cw2, c0 + dw / 2, r0 + digitH * 0.5)
      const top = sampleAt(binary, cw2, c0 + dw / 2, r0 + digitH * 0.1)
      if (mid && !top) return { char: '-', conf: 0.65 }
    }
    return classify(sampleSegs(binary, cw2, c0, r0, dw, digitH))
  })

  const rawText = results.map(r => r.char).join('')
  const avgConf = results.reduce((s, r) => s + r.conf, 0) / results.length
  const parsed  = parseFloat(rawText.replace(/[^\-0-9.]/g, ''))

  return {
    value:      (isNaN(parsed) || !isFinite(parsed)) ? null : parsed,
    confidence: avgConf > 0.78 ? 'high' : avgConf > 0.55 ? 'medium' : 'low',
    rawText,
  }
}

// -- 헬퍼 --

function mk(w, h) {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  return c
}

function otsu(gray, n) {
  const hist = new Array(256).fill(0)
  for (const v of gray) hist[Math.min(255, Math.round(v))]++
  let sum = 0
  for (let i = 0; i < 256; i++) sum += i * hist[i]
  let sumB = 0, wB = 0, max = 0, t = 128
  for (let i = 0; i < 256; i++) {
    wB += hist[i]; if (!wB) continue
    const wF = n - wB; if (!wF) break
    sumB += i * hist[i]
    const mB = sumB / wB, mF = (sum - sumB) / wF
    const b = wB * wF * (mB - mF) ** 2
    if (b > max) { max = b; t = i }
  }
  return t
}

function largestRun(rows) {
  let bestLen = 0, bestStart = rows[0], start = rows[0]
  for (let i = 1; i <= rows.length; i++) {
    const gap = i < rows.length ? rows[i] - rows[i-1] : 9999
    if (gap > 4) {
      const len = rows[i-1] - start + 1
      if (len > bestLen) { bestLen = len; bestStart = start }
      if (i < rows.length) start = rows[i]
    }
  }
  return { r0: bestStart, r1: bestStart + bestLen }
}

function findCols(vProj, w) {
  const maxV = Math.max(...vProj)
  const t    = maxV * 0.08
  const cols = []
  let inSeg = false, segStart = 0
  for (let x = 0; x < w; x++) {
    if (!inSeg && vProj[x] > t) { inSeg = true; segStart = x }
    else if (inSeg && (vProj[x] <= t || x === w - 1)) {
      inSeg = false
      if (x - segStart > 2) cols.push([segStart, x])
    }
  }
  return cols
}

function sampleAt(binary, W, cx, cy) {
  const x = Math.round(cx), y = Math.round(cy)
  let sum = 0, cnt = 0
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const nx = x + dx, ny = y + dy
    if (nx >= 0 && nx < W && ny >= 0) { sum += binary[ny * W + nx] ? 1 : 0; cnt++ }
  }
  return cnt > 0 && sum / cnt > 0.4
}

function sampleSegs(binary, W, col0, row0, dw, dh) {
  const s = (rx, ry) => sampleAt(binary, W, col0 + rx * dw, row0 + ry * dh)
  return [
    s(0.50, 0.06), s(0.90, 0.27), s(0.90, 0.73),
    s(0.50, 0.94), s(0.10, 0.73), s(0.10, 0.27), s(0.50, 0.50),
  ]
}

const PATTERNS = {
  '1111110': '0', '0110000': '1', '1101101': '2',
  '1111001': '3', '0110011': '4', '1011011': '5',
  '1011111': '6', '1110000': '7', '1111111': '8', '1111011': '9',
}

function classify(segs) {
  const key = segs.map(s => s ? '1' : '0').join('')
  if (PATTERNS[key]) return { char: PATTERNS[key], conf: 0.92 }
  let bestChar = '?', bestConf = 0
  for (const [pat, ch] of Object.entries(PATTERNS)) {
    let match = 0
    for (let i = 0; i < 7; i++) if (pat[i] === key[i]) match++
    const conf = match / 7
    if (conf > bestConf) { bestConf = conf; bestChar = ch }
  }
  return { char: bestChar, conf: bestConf * 0.85 }
}
