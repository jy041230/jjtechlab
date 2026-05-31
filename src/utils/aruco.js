/**
 * ArUco 검출 — js-aruco2 엔진 + 커스텀 DICT_4X4_50 코드북
 *
 * 코드북: DICT_4X4_50, ID 0만 등록 (기준 마커).
 * ID 0 비트 패턴 (행-우선 MSB): 1011 0101 0011 0010 = 0xB532.
 */

import jsAruco from 'js-aruco2'

const AR = jsAruco.AR ?? jsAruco
const MARKER_REAL_MM = 40   // 물리 마커 한 변 40mm

AR.DICTIONARIES['DICT_4X4_50'] = {
  nBits: 16,
  tau: 0,
  codeList: [
    0xB532,  // ID 0 (1011/0101/0011/0010)
  ],
}

let _detector = null
function getDetector() {
  if (!_detector) _detector = new AR.Detector({ dictionaryName: 'DICT_4X4_50' })
  return _detector
}

// Shoelace 공식 — 4코너 면적 (px²)
function shoelaceArea(corners) {
  let area = 0
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4
    area += corners[i].x * corners[j].y - corners[j].x * corners[i].y
  }
  return Math.abs(area) / 2
}

function cloneCorners(corners) {
  return corners.map(c => ({ x: c.x, y: c.y }))
}

function centerOf(corners) {
  const sum = corners.reduce((acc, c) => ({ x: acc.x + c.x, y: acc.y + c.y }), { x: 0, y: 0 })
  return { x: sum.x / corners.length, y: sum.y / corners.length }
}

function pointInPolygon(point, polygon) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y
    const xj = polygon[j].x, yj = polygon[j].y
    const intersects = ((yi > point.y) !== (yj > point.y)) &&
      (point.x < ((xj - xi) * (point.y - yi)) / ((yj - yi) || 1e-9) + xi)
    if (intersects) inside = !inside
  }
  return inside
}

function sideStats(corners) {
  const sides = []
  for (let i = 0; i < 4; i++) {
    const a = corners[i], b = corners[(i + 1) % 4]
    sides.push(Math.hypot(b.x - a.x, b.y - a.y))
  }
  const avg = sides.reduce((a, b) => a + b, 0) / sides.length
  const min = Math.min(...sides)
  const max = Math.max(...sides)
  return { avg, min, max, ratio: max / Math.max(min, 1e-9) }
}

function selectOuterCandidate(candidates, markerCorners) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null

  const markerCenter = centerOf(markerCorners)
  const markerSide = avgSidePx(markerCorners)
  let best = null
  let bestArea = 0

  for (const candidate of candidates) {
    if (!candidate || candidate.length !== 4) continue
    const candidateCorners = cloneCorners(candidate)
    const stats = sideStats(candidateCorners)
    const area = shoelaceArea(candidateCorners)

    if (stats.avg < markerSide * 2.2) continue
    if (stats.ratio > 1.65) continue
    if (!pointInPolygon(markerCenter, candidateCorners)) continue

    if (area > bestArea) {
      best = candidateCorners
      bestArea = area
    }
  }

  if (!best) return null
  return {
    corners: best,
    side: avgSidePx(best),
    area: bestArea,
  }
}

function isDarkPixel(data, offset) {
  const r = data[offset]
  const g = data[offset + 1]
  const b = data[offset + 2]
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return luma < 92
}

function findBlackSquareFallback(imageData) {
  const { width: w, height: h, data } = imageData
  const stride = 2
  const gw = Math.floor(w / stride)
  const gh = Math.floor(h / stride)
  const visited = new Uint8Array(gw * gh)
  const minSide = Math.max(36, Math.min(w, h) * 0.035)
  const maxSide = Math.min(w, h) * 0.42
  let best = null

  function idx(gx, gy) {
    return gy * gw + gx
  }

  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const start = idx(gx, gy)
      if (visited[start]) continue

      const x = gx * stride
      const y = gy * stride
      const offset = (y * w + x) * 4
      if (!isDarkPixel(data, offset)) {
        visited[start] = 1
        continue
      }

      const stack = [start]
      visited[start] = 1
      let count = 0
      let minGx = gx, maxGx = gx, minGy = gy, maxGy = gy

      while (stack.length) {
        const cur = stack.pop()
        const cx = cur % gw
        const cy = Math.floor(cur / gw)
        count++
        if (cx < minGx) minGx = cx
        if (cx > maxGx) maxGx = cx
        if (cy < minGy) minGy = cy
        if (cy > maxGy) maxGy = cy

        const neighbors = [
          [cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1],
        ]
        for (const [nx, ny] of neighbors) {
          if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue
          const ni = idx(nx, ny)
          if (visited[ni]) continue
          visited[ni] = 1
          const px = nx * stride
          const py = ny * stride
          const no = (py * w + px) * 4
          if (isDarkPixel(data, no)) stack.push(ni)
        }
      }

      const bw = (maxGx - minGx + 1) * stride
      const bh = (maxGy - minGy + 1) * stride
      const side = (bw + bh) / 2
      const aspect = Math.max(bw, bh) / Math.max(Math.min(bw, bh), 1)
      const density = (count * stride * stride) / Math.max(bw * bh, 1)

      if (side < minSide || side > maxSide) continue
      if (aspect > 1.5) continue
      if (density < 0.24 || density > 0.92) continue

      const x1 = Math.max(0, minGx * stride - 1)
      const y1 = Math.max(0, minGy * stride - 1)
      const x2 = Math.min(w - 1, (maxGx + 1) * stride + 1)
      const y2 = Math.min(h - 1, (maxGy + 1) * stride + 1)
      const area = bw * bh
      const score = area * (1 - Math.min(Math.abs(1 - aspect), 0.5)) * Math.min(density / 0.45, 1.2)

      if (!best || score > best.score) {
        const corners = [
          { x: x1, y: y1 },
          { x: x2, y: y1 },
          { x: x2, y: y2 },
          { x: x1, y: y2 },
        ]
        best = { corners, side: avgSidePx(corners), area, density, aspect, score }
      }
    }
  }

  return best
}

function findBlackSquareAroundMarker(imageData, markerCorners) {
  const { width: w, height: h, data } = imageData
  const center = centerOf(markerCorners)
  const markerSide = avgSidePx(markerCorners)
  const radius = Math.max(140, markerSide * 4.2)
  const xMin = Math.max(0, Math.floor(center.x - radius))
  const xMax = Math.min(w - 1, Math.ceil(center.x + radius))
  const yMin = Math.max(0, Math.floor(center.y - radius))
  const yMax = Math.min(h - 1, Math.ceil(center.y + radius))
  const stride = 2

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  let darkCount = 0

  for (let y = yMin; y <= yMax; y += stride) {
    for (let x = xMin; x <= xMax; x += stride) {
      const offset = (y * w + x) * 4
      if (!isDarkPixel(data, offset)) continue
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
      darkCount++
    }
  }

  if (!Number.isFinite(minX)) return null

  const bw = maxX - minX + stride
  const bh = maxY - minY + stride
  const aspect = Math.max(bw, bh) / Math.max(Math.min(bw, bh), 1)
  const side = (bw + bh) / 2
  const density = (darkCount * stride * stride) / Math.max(bw * bh, 1)

  if (side < markerSide * 2.5) return null
  if (aspect > 1.8) return null
  if (density < 0.12) return null

  const corners = [
    { x: Math.max(0, minX - 2), y: Math.max(0, minY - 2) },
    { x: Math.min(w - 1, maxX + 2), y: Math.max(0, minY - 2) },
    { x: Math.min(w - 1, maxX + 2), y: Math.min(h - 1, maxY + 2) },
    { x: Math.max(0, minX - 2), y: Math.min(h - 1, maxY + 2) },
  ]

  return {
    corners,
    side: avgSidePx(corners),
    area: shoelaceArea(corners),
    density,
    aspect,
  }
}

function expandCornersFromCenter(corners, factor) {
  const center = centerOf(corners)
  return corners.map(c => ({
    x: center.x + (c.x - center.x) * factor,
    y: center.y + (c.y - center.y) * factor,
  }))
}

export function preloadOpenCV() {
  try { getDetector(); return Promise.resolve() }
  catch (err) { return Promise.reject(err) }
}

/**
 * ImageData에서 DICT_4X4_50 ID 0 마커 검출
 * @returns {{ found, markerId?, corners?, pixelPerMm?, debug }}
 */
export async function detectAruco(imageData) {
  const detector = getDetector()
  const markers  = detector.detect(imageData)
  const detectorCandidates = detector.candidates || []

  // ── 디버그: 전체 마커 목록 ─────────────────────────────────────────────────
  console.group(`[ArUco] detect() 반환: ${markers.length}개`)
  console.log('버퍼 크기 (imageData.width/height):', imageData.width, '×', imageData.height)
  console.log('검출 후보 수(detector.candidates):', detectorCandidates.length)
  markers.forEach((m, idx) => {
    const area = shoelaceArea(m.corners)
    console.group(`  [${idx}] id=${m.id}  면적=${area.toFixed(0)}px²  hammingDist=${m.hammingDistance}`)
    console.log('  corners:',
      m.corners.map((c, i) => `[${i}](${c.x.toFixed(1)},${c.y.toFixed(1)})`).join('  '))
    console.dir(m)   // 속성 전체 확인
    console.groupEnd()
  })
  console.groupEnd()
  // ──────────────────────────────────────────────────────────────────────────

  const debug = {
    candidates:    markers.length,
    triedVariants: ['js-aruco2/DICT_4X4_50'],
    frameW:        imageData.width,
    frameH:        imageData.height,
    detectorCandidates: detectorCandidates.length,
  }

  if (markers.length === 0) {
    const fallback = findBlackSquareFallback(imageData)
    if (fallback) {
      const pixelPerMm = fallback.side / MARKER_REAL_MM
      console.warn(
        `[ArUco] ID 검출 실패 → 검은 외곽 사각형 fallback 사용 ` +
        `변≈${fallback.side.toFixed(1)}px px/mm=${pixelPerMm.toFixed(4)}`
      )
      return {
        found: true,
        markerId: 'fallback',
        corners: fallback.corners,
        pixelPerMm,
        debug: {
          ...debug,
          markerSidePx: fallback.side,
          markerAreaPx2: fallback.area,
          cornerSource: 'fallback black square',
          fallbackDensity: fallback.density,
          fallbackAspect: fallback.aspect,
          rawCorners: fallback.corners,
          scaleCorners: fallback.corners,
        },
      }
    }
    console.warn('[ArUco] 검출 실패')
    return { found: false, debug }
  }

  // ID 0 필터 → 없으면 전체 후보 중 최대
  const id0 = markers.filter(m => m.id === 0)
  const pool = id0.length > 0 ? id0 : markers

  // 면적이 가장 큰 마커 선택
  let best = pool[0]
  let bestArea = shoelaceArea(best.corners)
  for (let i = 1; i < pool.length; i++) {
    const a = shoelaceArea(pool[i].corners)
    if (a > bestArea) { bestArea = a; best = pool[i] }
  }

  const rawCorners = cloneCorners(best.corners)
  const rawSide = avgSidePx(rawCorners)
  const rawArea = shoelaceArea(rawCorners)
  const outerCandidate = selectOuterCandidate(detectorCandidates, rawCorners)
  const localBlackSquare = rawSide < Math.min(imageData.width, imageData.height) * 0.09
    ? findBlackSquareAroundMarker(imageData, rawCorners)
    : null
  const expandedFromInner = rawSide < Math.min(imageData.width, imageData.height) * 0.09
    ? expandCornersFromCenter(rawCorners, 5.6)
    : null
  const expandedSide = expandedFromInner ? avgSidePx(expandedFromInner) : 0
  const useLocalSquare = localBlackSquare && localBlackSquare.side > rawSide * 2.5
  const finalCorners = outerCandidate?.corners
    ?? (useLocalSquare ? localBlackSquare.corners : null)
    ?? expandedFromInner
    ?? rawCorners
  const bestSide = outerCandidate?.side
    ?? (useLocalSquare ? localBlackSquare.side : null)
    ?? expandedSide
    ?? rawSide
  const bestAreaFinal = outerCandidate?.area
    ?? (useLocalSquare ? localBlackSquare.area : null)
    ?? (expandedFromInner ? shoelaceArea(expandedFromInner) : null)
    ?? rawArea
  const cornerSource = outerCandidate
    ? 'detector.candidates outer square'
    : useLocalSquare
      ? 'local black square around marker'
      : expandedFromInner
        ? 'expanded from inner marker'
        : 'marker.corners raw'
  const pixelPerMm  = bestSide / MARKER_REAL_MM

  console.log(
    `[ArUco] 선택: id=${best.id}  source=${cornerSource}  면적=${bestAreaFinal.toFixed(0)}px²  ` +
    `변≈${bestSide.toFixed(1)}px  px/mm=${pixelPerMm.toFixed(4)}`
  )
  console.log('[ArUco] marker.corners 원본:',
    rawCorners.map((c, i) => `[${i}](${c.x.toFixed(0)},${c.y.toFixed(0)})`).join('  '))
  console.log('[ArUco] 스케일 사용 코너:',
    finalCorners.map((c, i) => `[${i}](${c.x.toFixed(0)},${c.y.toFixed(0)})`).join('  '))

  return {
    found: true, markerId: best.id, corners: finalCorners, pixelPerMm,
    debug: {
      ...debug,
      markerSidePx: bestSide,
      markerAreaPx2: bestAreaFinal,
      cornerSource,
      rawMarkerSidePx: rawSide,
      rawMarkerAreaPx2: rawArea,
      rawCorners,
      scaleCorners: finalCorners,
      localBlackSquare,
    },
  }
}

// ── 좌표 유틸 ────────────────────────────────────────────────────────────────

export function avgSidePx(corners) {
  let total = 0
  for (let i = 0; i < 4; i++) {
    const a = corners[i], b = corners[(i + 1) % 4]
    total += Math.hypot(b.x - a.x, b.y - a.y)
  }
  return total / 4
}

export function getDisplayRect(imgW, imgH, contW, contH) {
  const imgAR  = imgW / imgH
  const contAR = contW / contH
  let displayW, displayH, offsetX, offsetY
  if (imgAR > contAR) {
    displayW = contW;  displayH = contW / imgAR
    offsetX  = 0;      offsetY  = (contH - displayH) / 2
  } else {
    displayH = contH;  displayW = contH * imgAR
    offsetX  = (contW - displayW) / 2; offsetY = 0
  }
  return { displayW, displayH, offsetX, offsetY }
}
