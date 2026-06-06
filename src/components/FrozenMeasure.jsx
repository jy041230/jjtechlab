/**
 * FrozenMeasure — 정지 이미지 위에서 두 점 탭 + 드래그 조정으로 직경 계측
 *
 * 표시: fit-to-width (이미지 전체를 화면 폭에 맞게)
 * 점 없는 상태 시작 → 첫 탭 P1 → 둘째 탭 P2 → 선·mm 표시
 * 2점 확정 후 각 점을 드래그로 미세조정; 드래그 중 루페(3.5×) + 엣지 강조
 * 좌표: 원본 사진 픽셀 좌표계로 환산
 *
 * tapPhase: 'no_marker' | 'placing_points'
 */
import { useRef, useEffect, useState } from 'react'
import styles from './FrozenMeasure.module.css'
import { avgSidePx } from '../utils/aruco'

const HANDLE_VISUAL_R = 8
const HANDLE_ARM      = 22
const HIT_R           = 56
const LOUPE_R         = 80
const LOUPE_ZOOM      = 3.5
const LOUPE_ABOVE     = 165
const TAP_MAX_PX      = 28

// ── 좌표 변환 ──────────────────────────────────────────────────────────────────

function computeLayout(imgW, imgH, cw, ch, view = { zoom: 1, panX: 0, panY: 0 }) {
  const displayW = cw * view.zoom
  const displayH = (imgH / imgW) * cw * view.zoom
  const baseX = displayW <= cw ? (cw - displayW) / 2 : 0
  const baseY = displayH <= ch ? (ch - displayH) / 2 : 0
  const offsetX = baseX + view.panX
  const offsetY = baseY + view.panY
  return { displayW, displayH, offsetX, offsetY, imgW, imgH }
}

function clampView(view, imgW, imgH, cw, ch) {
  const zoom = Math.max(1, Math.min(4, view.zoom))
  const displayW = cw * zoom
  const displayH = (imgH / imgW) * cw * zoom
  const baseX = displayW <= cw ? (cw - displayW) / 2 : 0
  const baseY = displayH <= ch ? (ch - displayH) / 2 : 0

  let minPanX = -baseX, maxPanX = -baseX
  if (displayW > cw) { minPanX = cw - displayW - baseX; maxPanX = -baseX }
  let minPanY = -baseY, maxPanY = -baseY
  if (displayH > ch) { minPanY = ch - displayH - baseY; maxPanY = -baseY }

  return {
    zoom,
    panX: Math.max(minPanX, Math.min(maxPanX, view.panX)),
    panY: Math.max(minPanY, Math.min(maxPanY, view.panY)),
  }
}

function imgToDisp(ix, iy, l) {
  return {
    x: l.offsetX + (ix / l.imgW) * l.displayW,
    y: l.offsetY + (iy / l.imgH) * l.displayH,
  }
}

function dispToImg(dx, dy, l) {
  return {
    x: ((dx - l.offsetX) / l.displayW) * l.imgW,
    y: ((dy - l.offsetY) / l.displayH) * l.imgH,
  }
}

function clampImg(pt, l) {
  return {
    x: Math.max(0, Math.min(l.imgW, pt.x)),
    y: Math.max(0, Math.min(l.imgH, pt.y)),
  }
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function colorDistance(a, b) {
  if (!a || !b) return Infinity
  const dr = a.r - b.r, dg = a.g - b.g, db = a.b - b.b
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

function samplePatchColor(ctx, cx, cy, rx, ry, w, h) {
  const x0 = Math.max(0, Math.floor(cx - rx))
  const y0 = Math.max(0, Math.floor(cy - ry))
  const x1 = Math.min(w - 1, Math.ceil(cx + rx))
  const y1 = Math.min(h - 1, Math.ceil(cy + ry))
  const sw = Math.max(1, x1 - x0 + 1)
  const sh = Math.max(1, y1 - y0 + 1)
  const data = ctx.getImageData(x0, y0, sw, sh).data
  let r = 0, g = 0, b = 0, count = 0
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3]
    if (alpha < 10) continue
    r += data[i]; g += data[i + 1]; b += data[i + 2]; count += 1
  }
  if (!count) return null
  r /= count; g /= count; b /= count
  let spread = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 10) continue
    spread += colorDistance({ r: data[i], g: data[i + 1], b: data[i + 2] }, { r, g, b })
  }
  return { r, g, b, spread: spread / count }
}

function columnColorDistance(ctx, x, y, halfBand, target, w, h) {
  const ix = clampNumber(Math.round(x), 0, w - 1)
  const y0 = clampNumber(Math.round(y - halfBand), 0, h - 1)
  const y1 = clampNumber(Math.round(y + halfBand), 0, h - 1)
  const data = ctx.getImageData(ix, y0, 1, Math.max(1, y1 - y0 + 1)).data
  let dist = 0, count = 0
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 10) continue
    dist += colorDistance({ r: data[i], g: data[i + 1], b: data[i + 2] }, target)
    count += 1
  }
  return count ? dist / count : Infinity
}

function isInsideBox(x, y, box) {
  return box && x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY
}

function getMarkerExcludeBox(markerCorners, w, h) {
  if (!markerCorners?.length) return null
  const xs = markerCorners.map(c => c.x)
  const ys = markerCorners.map(c => c.y)
  const side = avgSidePx(markerCorners)
  const margin = Math.max(32, side * 0.9)
  return {
    minX: clampNumber(Math.min(...xs) - margin, 0, w - 1),
    maxX: clampNumber(Math.max(...xs) + margin, 0, w - 1),
    minY: clampNumber(Math.min(...ys) - margin, 0, h - 1),
    maxY: clampNumber(Math.max(...ys) + margin, 0, h - 1),
  }
}

function isStickerPixel(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  if (max < 95 || max - min < 45) return false
  const sat = (max - min) / Math.max(1, max)
  if (sat < 0.34) return false
  const greenDominant = g > r * 1.18 && g > b * 1.12
  if (greenDominant) return false
  const barkLike = r > 85 && g > 55 && b < 75 && Math.abs(r - g) < 70
  if (barkLike && sat < 0.58) return false
  return true
}

function stickerRole(r, g, b) {
  if (r > 135 && r > g * 1.18 && r > b * 1.05) return 'p1'
  if (b > 115 && b > r * 1.12 && b > g * 0.82) return 'p2'
  return 'any'
}

function findStickerBlobs(ctx, w, h, markerCorners) {
  const image = ctx.getImageData(0, 0, w, h)
  const data = image.data
  const total = w * h
  const mask = new Uint8Array(total)
  const visited = new Uint8Array(total)
  const excludeBox = getMarkerExcludeBox(markerCorners, w, h)

  for (let i = 0; i < total; i += 1) {
    const x = i % w, y = Math.floor(i / w)
    if (isInsideBox(x, y, excludeBox)) continue
    const p = i * 4
    if (isStickerPixel(data[p], data[p + 1], data[p + 2])) mask[i] = 1
  }

  const markerSide = markerCorners?.length === 4 ? avgSidePx(markerCorners) : Math.min(w, h) * 0.1
  const minArea = Math.max(18, Math.round(markerSide * markerSide * 0.002))
  const maxArea = Math.max(900, Math.round(markerSide * markerSide * 0.85))
  const blobs = []
  const stack = []

  for (let start = 0; start < total; start += 1) {
    if (!mask[start] || visited[start]) continue
    visited[start] = 1
    stack.length = 0
    stack.push(start)
    let count = 0, sumX = 0, sumY = 0, sumR = 0, sumG = 0, sumB = 0
    let minX = w, maxX = 0, minY = h, maxY = 0

    while (stack.length) {
      const idx = stack.pop()
      const x = idx % w, y = Math.floor(idx / w)
      const p = idx * 4
      count += 1; sumX += x; sumY += y
      sumR += data[p]; sumG += data[p + 1]; sumB += data[p + 2]
      if (x < minX) minX = x; if (x > maxX) maxX = x
      if (y < minY) minY = y; if (y > maxY) maxY = y

      const neighbors = [idx - 1, idx + 1, idx - w, idx + w]
      for (const next of neighbors) {
        if (next < 0 || next >= total || visited[next] || !mask[next]) continue
        if ((idx % w === 0 && next === idx - 1) || (idx % w === w - 1 && next === idx + 1)) continue
        visited[next] = 1
        stack.push(next)
      }
    }

    const bw = maxX - minX + 1, bh = maxY - minY + 1
    const aspect = bw / Math.max(1, bh)
    if (count < minArea || count > maxArea) continue
    if (aspect < 0.28 || aspect > 3.6) continue
    blobs.push({
      count, minX, maxX, minY, maxY,
      x: sumX / count, y: sumY / count,
      role: stickerRole(sumR / count, sumG / count, sumB / count),
    })
  }

  return blobs.sort((a, b) => b.count - a.count)
}

function pickStickerPair(blobs, w, h, markerCorners) {
  if (blobs.length < 2) return null
  const markerSide = markerCorners?.length === 4 ? avgSidePx(markerCorners) : Math.min(w, h) * 0.1
  const p1Candidates = blobs.filter(blob => blob.role === 'p1').slice(0, 8)
  const p2Candidates = blobs.filter(blob => blob.role === 'p2').slice(0, 8)
  if (p1Candidates.length && p2Candidates.length) {
    let bestColorPair = null, bestColorScore = -Infinity
    for (const p1 of p1Candidates) {
      for (const p2 of p2Candidates) {
        const dx = p2.x - p1.x, dy = Math.abs(p2.y - p1.y)
        if (dx < Math.max(14, markerSide * 0.18)) continue
        if (dy > Math.max(markerSide * 1.45, h * 0.28)) continue
        const score = dx - dy * 0.42 + Math.log(p1.count + p2.count) * 18
        if (score > bestColorScore) { bestColorScore = score; bestColorPair = { left: p1, right: p2 } }
      }
    }
    if (bestColorPair) return bestColorPair
  }

  let best = null, bestScore = -Infinity
  const candidates = blobs.slice(0, 12)
  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const a = candidates[i], b = candidates[j]
      const left = a.x <= b.x ? a : b, right = a.x <= b.x ? b : a
      const dx = right.x - left.x, dy = Math.abs(right.y - left.y)
      if (dx < Math.max(14, markerSide * 0.18)) continue
      if (dy > Math.max(markerSide * 1.45, h * 0.28)) continue
      const score = dx - dy * 0.42 + Math.log(left.count + right.count) * 18
      if (score > bestScore) { bestScore = score; best = { left, right } }
    }
  }
  return best
}

function zoomAtDisplayPoint(currentView, factor, focus, imgW, imgH, cw, ch) {
  const before = computeLayout(imgW, imgH, cw, ch, currentView)
  const imgFocus = dispToImg(focus.x, focus.y, before)
  const nextZoom = Math.max(1, Math.min(4, currentView.zoom * factor))
  const displayW = cw * nextZoom
  const displayH = (imgH / imgW) * cw * nextZoom
  const baseX = displayW <= cw ? (cw - displayW) / 2 : 0
  const baseY = displayH <= ch ? (ch - displayH) / 2 : 0

  return clampView({
    zoom: nextZoom,
    panX: focus.x - baseX - (imgFocus.x / imgW) * displayW,
    panY: focus.y - baseY - (imgFocus.y / imgH) * displayH,
  }, imgW, imgH, cw, ch)
}

// ── 루페 그리기 (엣지 강조 포함) ─────────────────────────────────────────────

function drawLoupe(ctx, img, layout, fingerDisp, imgPt, cw) {
  const { displayW, imgW } = layout
  const scale         = imgW / displayW
  const halfRegionImg = LOUPE_R / LOUPE_ZOOM * scale
  const srcW = halfRegionImg * 2, srcH = halfRegionImg * 2
  const srcX = Math.max(0, Math.min(layout.imgW - srcW, imgPt.x - halfRegionImg))
  const srcY = Math.max(0, Math.min(layout.imgH - srcH, imgPt.y - halfRegionImg))

  const loupeCX = Math.max(LOUPE_R + 10, Math.min(cw - LOUPE_R - 10, fingerDisp.x))
  const loupeCY = Math.max(LOUPE_R + 10, fingerDisp.y - LOUPE_ABOVE)

  // 원형 클립 + 확대 이미지
  ctx.save()
  ctx.beginPath()
  ctx.arc(loupeCX, loupeCY, LOUPE_R, 0, Math.PI * 2)
  ctx.clip()
  ctx.drawImage(img, srcX, srcY, srcW, srcH,
    loupeCX - LOUPE_R, loupeCY - LOUPE_R, LOUPE_R * 2, LOUPE_R * 2)
  ctx.restore()

  // ── 엣지 강조 오버레이 (노란 경계선) ──────────────────────────────────────
  try {
    const id = ctx.getImageData(loupeCX - LOUPE_R, loupeCY - LOUPE_R, LOUPE_R * 2, LOUPE_R * 2)
    const d = id.data, w2 = LOUPE_R * 2, h2 = LOUPE_R * 2
    const gray = new Float32Array(w2 * h2)
    for (let i = 0; i < w2 * h2; i++)
      gray[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]
    const ov = new Uint8ClampedArray(w2 * h2 * 4)
    for (let y = 1; y < h2 - 1; y++) {
      for (let x = 1; x < w2 - 1; x++) {
        const g = (r, c) => gray[(y + r) * w2 + (x + c)]
        const gx = -g(-1,-1)+g(-1,1)-2*g(0,-1)+2*g(0,1)-g(1,-1)+g(1,1)
        const gy = -g(-1,-1)-2*g(-1,0)-g(-1,1)+g(1,-1)+2*g(1,0)+g(1,1)
        const mag = Math.sqrt(gx * gx + gy * gy)
        if (mag > 28) {
          const i = (y * w2 + x) * 4
          ov[i] = 255; ov[i + 1] = 220; ov[i + 2] = 0
          ov[i + 3] = Math.min(210, mag * 2)
        }
      }
    }
    const tmp = document.createElement('canvas')
    tmp.width = w2; tmp.height = h2
    tmp.getContext('2d').putImageData(new ImageData(ov, w2, h2), 0, 0)
    ctx.save()
    ctx.beginPath(); ctx.arc(loupeCX, loupeCY, LOUPE_R, 0, Math.PI * 2); ctx.clip()
    ctx.drawImage(tmp, loupeCX - LOUPE_R, loupeCY - LOUPE_R)
    ctx.restore()
  } catch (e) {}
  // ────────────────────────────────────────────────────────────────────────────

  // 테두리
  ctx.beginPath(); ctx.arc(loupeCX, loupeCY, LOUPE_R, 0, Math.PI * 2)
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.stroke()

  // 십자선
  ctx.strokeStyle = '#ff3b30'; ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(loupeCX - 26, loupeCY); ctx.lineTo(loupeCX + 26, loupeCY)
  ctx.moveTo(loupeCX, loupeCY - 26); ctx.lineTo(loupeCX, loupeCY + 26)
  ctx.stroke()

  // 루페→손가락 연결선
  ctx.beginPath()
  ctx.moveTo(loupeCX, loupeCY + LOUPE_R)
  ctx.lineTo(fingerDisp.x, fingerDisp.y)
  ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1.5
  ctx.setLineDash([4, 3]); ctx.stroke(); ctx.setLineDash([])

  // 배율 배지
  ctx.fillStyle = 'rgba(0,0,0,0.6)'
  ctx.fillRect(loupeCX - LOUPE_R, loupeCY + LOUPE_R - 22, LOUPE_R * 2, 22)
  ctx.font = 'bold 12px sans-serif'; ctx.fillStyle = '#ffd166'; ctx.textAlign = 'center'
  ctx.fillText(`${LOUPE_ZOOM}×`, loupeCX, loupeCY + LOUPE_R - 6)
}

// ── 핸들 그리기 ──────────────────────────────────────────────────────────────

function drawHandle(ctx, dispX, dispY, label, isDragging) {
  const color = isDragging ? '#ff3b30' : '#ff6b35'
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 3
  ctx.strokeStyle = color; ctx.lineWidth = 1.8
  ctx.beginPath()
  ctx.moveTo(dispX - HANDLE_ARM, dispY); ctx.lineTo(dispX + HANDLE_ARM, dispY)
  ctx.moveTo(dispX, dispY - HANDLE_ARM); ctx.lineTo(dispX, dispY + HANDLE_ARM)
  ctx.stroke()
  ctx.beginPath(); ctx.arc(dispX, dispY, HANDLE_VISUAL_R, 0, Math.PI * 2)
  ctx.fillStyle = color; ctx.fill()
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke()
  ctx.shadowBlur = 4
  ctx.font = 'bold 13px sans-serif'
  ctx.fillStyle = '#fff'; ctx.textAlign = 'left'
  ctx.fillText(label, dispX + HANDLE_ARM + 4, dispY - 4)
  ctx.restore()
}

// ── 메인 캔버스 렌더 ─────────────────────────────────────────────────────────

function redraw(canvas, img, layout, markerCorners, pts, pixelPerMm, tapPhase, draggingIdx, loupeImgPt) {
  const cw = canvas.width, ch = canvas.height
  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, cw, ch)
  if (!img || !layout) return

  const { displayW, displayH, offsetX, offsetY, imgW, imgH } = layout
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cw, ch)
  ctx.drawImage(img, 0, 0, imgW, imgH, offsetX, offsetY, displayW, displayH)

  if (markerCorners?.length === 4) {
    const dpts = markerCorners.map(c => imgToDisp(c.x, c.y, layout))
    ctx.beginPath()
    dpts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
    ctx.closePath()
    ctx.strokeStyle = '#00ff88'; ctx.lineWidth = 4; ctx.stroke()
    ctx.fillStyle = 'rgba(0,255,136,0.08)'; ctx.fill()
    dpts.forEach((p, i) => {
      ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, Math.PI * 2)
      ctx.fillStyle = '#00ff88'; ctx.fill()
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.stroke()
      ctx.font = 'bold 14px sans-serif'; ctx.fillStyle = '#000'; ctx.textAlign = 'center'
      ctx.fillText(String(i), p.x, p.y + 5)
    })
    const cx = dpts.reduce((s, p) => s + p.x, 0) / 4
    const cy = dpts.reduce((s, p) => s + p.y, 0) / 4
    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.7)'; ctx.shadowBlur = 4
    ctx.font = 'bold 14px sans-serif'; ctx.fillStyle = '#00ff88'; ctx.textAlign = 'center'
    ctx.fillText('ArUco 40mm', cx, cy + 5)
    ctx.restore()
  }

  if (pts?.length >= 1 && tapPhase === 'placing_points') {
    if (pts.length === 2) {
      const dp = pts.map(p => imgToDisp(p.x, p.y, layout))
      ctx.beginPath()
      ctx.moveTo(dp[0].x, dp[0].y); ctx.lineTo(dp[1].x, dp[1].y)
      ctx.strokeStyle = 'rgba(255,107,53,0.8)'; ctx.lineWidth = 2
      ctx.setLineDash([6, 4]); ctx.stroke(); ctx.setLineDash([])
      if (pixelPerMm > 0) {
        const pxDist = Math.abs(pts[1].x - pts[0].x)
        const mm = pxDist / pixelPerMm
        const midX = (dp[0].x + dp[1].x) / 2, midY = (dp[0].y + dp[1].y) / 2
        ctx.save()
        ctx.font = 'bold 22px sans-serif'; ctx.textAlign = 'center'
        ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 5
        ctx.fillStyle = '#ff6b35'
        ctx.fillText(`${mm.toFixed(1)} mm`, midX, midY - 20)
        ctx.restore()
      }
    }
    const labels = ['P1', 'P2']
    pts.forEach((p, i) => {
      const dp = imgToDisp(p.x, p.y, layout)
      drawHandle(ctx, dp.x, dp.y, labels[i], draggingIdx === i)
    })
  }

  if (loupeImgPt !== null && draggingIdx !== null && tapPhase === 'placing_points') {
    const fingerDisp = imgToDisp(loupeImgPt.x, loupeImgPt.y, layout)
    drawLoupe(ctx, img, layout, fingerDisp, loupeImgPt, cw)
  }
}

// ── FrozenMeasure 컴포넌트 ───────────────────────────────────────────────────

export default function FrozenMeasure({
  frozenSrc,
  frozenW, frozenH,
  markerCorners,
  points,
  pixelPerMm,
  tapPhase,
  onPointsChange,
  debugInfo,
}) {
  const containerRef  = useRef(null)
  const canvasRef     = useRef(null)
  const imgRef        = useRef(null)
  const layoutRef     = useRef(null)
  const draggingRef   = useRef(null)
  const localPtsRef   = useRef(points)
  const tapPhaseRef   = useRef(tapPhase)
  const onChangeRef   = useRef(onPointsChange)
  const touchStartRef = useRef(null)
  const mouseDownRef  = useRef(null)
  const panStartRef   = useRef(null)
  const viewRef       = useRef({ zoom: 1, panX: 0, panY: 0 })
  const sizeRef       = useRef({ w: frozenW, h: frozenH })
  const autoZoomKeyRef = useRef('')

  const [imgReady,    setImgReady]    = useState(false)
  const [draggingIdx, setDraggingIdx] = useState(null)
  const [loupeImgPt,  setLoupeImgPt] = useState(null)
  const [view,        setView]        = useState({ zoom: 1, panX: 0, panY: 0 })

  useEffect(() => { tapPhaseRef.current = tapPhase },       [tapPhase])
  useEffect(() => { onChangeRef.current = onPointsChange }, [onPointsChange])
  useEffect(() => {
    localPtsRef.current = points
    if (!points.length) {
      draggingRef.current = null
      setDraggingIdx(null)
      setLoupeImgPt(null)
    }
  }, [points])
  useEffect(() => { viewRef.current = view },               [view])
  useEffect(() => { sizeRef.current = { w: frozenW, h: frozenH } }, [frozenW, frozenH])

  useEffect(() => {
    if (!frozenSrc) { imgRef.current = null; setImgReady(false); return }
    setImgReady(false)
    autoZoomKeyRef.current = ''
    setView({ zoom: 1, panX: 0, panY: 0 })
    const img = new Image()
    img.onload = () => { imgRef.current = img; setImgReady(true) }
    img.src = frozenSrc
  }, [frozenSrc])

  useEffect(() => {
    const canvas    = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container || !imgRef.current || !frozenW || !frozenH) return
    const cw = container.clientWidth, ch = container.clientHeight
    if (!cw || !ch) return
    canvas.width = cw; canvas.height = ch
    const safeView = clampView(view, frozenW, frozenH, cw, ch)
    if (safeView.zoom !== view.zoom || safeView.panX !== view.panX || safeView.panY !== view.panY) {
      setView(safeView); return
    }
    layoutRef.current = computeLayout(frozenW, frozenH, cw, ch, safeView)
    const displayPts = draggingRef.current !== null ? localPtsRef.current : points
    redraw(canvas, imgRef.current, layoutRef.current, markerCorners,
           displayPts, pixelPerMm, tapPhase, draggingIdx, loupeImgPt)
  }, [imgReady, frozenW, frozenH, markerCorners, points, pixelPerMm, tapPhase, draggingIdx, loupeImgPt, view])

  function updateView(nextView) {
    const canvas = canvasRef.current, container = containerRef.current
    const { w, h } = sizeRef.current
    if (!canvas || !container || !w || !h) return
    const cw = container.clientWidth, ch = container.clientHeight
    const safe = clampView(nextView, w, h, cw, ch)
    viewRef.current = safe; setView(safe)
  }

  function zoomBy(factor) {
    const container = containerRef.current
    const { w, h } = sizeRef.current
    if (!container || !w || !h) return
    const cw = container.clientWidth, ch = container.clientHeight
    updateView(zoomAtDisplayPoint(viewRef.current, factor, { x: cw / 2, y: ch * 0.46 }, w, h, cw, ch))
  }

  function resetZoom() { updateView({ zoom: 1, panX: 0, panY: 0 }) }

  function autoFitStemEdges() {
    const img = imgRef.current, pts = localPtsRef.current
    const { w, h } = sizeRef.current
    if (!img || !w || !h || pts.length !== 2) {
      window.alert?.('P1·P2를 먼저 줄기 위에 찍어 주세요.'); return
    }
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return
    ctx.drawImage(img, 0, 0, w, h)
    const centerX = clampNumber((pts[0].x + pts[1].x) / 2, 0, w - 1)
    const centerY = clampNumber((pts[0].y + pts[1].y) / 2, 0, h - 1)
    const currentDist = Math.max(12, Math.abs(pts[1].x - pts[0].x))
    const markerSide = markerCorners?.length === 4 ? avgSidePx(markerCorners) : 0
    const maxSearch = clampNumber(Math.max(currentDist * 2.8, markerSide * 1.8, 80), 40, Math.min(w * 0.36, 520))
    const sample = samplePatchColor(ctx, centerX, centerY, 5, 12, w, h)
    if (!sample) {
      window.alert?.('줄기 색상 기준을 읽지 못했습니다.'); return
    }
    const halfBand = clampNumber(Math.round((markerSide || currentDist) * 0.035), 4, 12)
    const threshold = clampNumber(sample.spread * 2.15 + 28, 34, 78)
    const leftLimit = Math.max(1, Math.round(centerX - maxSearch))
    const rightLimit = Math.min(w - 2, Math.round(centerX + maxSearch))
    function findEdge(direction) {
      let lastBarkX = Math.round(centerX), misses = 0
      const start = Math.round(centerX), end = direction < 0 ? leftLimit : rightLimit
      for (let x = start; direction < 0 ? x >= end : x <= end; x += direction) {
        const dist = columnColorDistance(ctx, x, centerY, halfBand, sample, w, h)
        if (dist <= threshold) { lastBarkX = x; misses = 0 }
        else { misses += 1; if (misses >= 5) return lastBarkX }
      }
      return lastBarkX
    }
    const leftX = findEdge(-1), rightX = findEdge(1)
    if (!Number.isFinite(leftX) || !Number.isFinite(rightX) || rightX - leftX < 8) {
      window.alert?.('줄기 양쪽 경계를 찾지 못했습니다.'); return
    }
    const nextPts = [{ x: leftX, y: centerY }, { x: rightX, y: centerY }]
    draggingRef.current = null; setDraggingIdx(null); setLoupeImgPt(null)
    localPtsRef.current = nextPts; onChangeRef.current?.(nextPts)
  }

  function autoFindStickerPoints() {
    const img = imgRef.current, { w, h } = sizeRef.current
    if (!img || !w || !h) { window.alert?.('사진을 먼저 촬영해 주세요.'); return }
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return
    ctx.drawImage(img, 0, 0, w, h)
    const blobs = findStickerBlobs(ctx, w, h, markerCorners)
    const pair = pickStickerPair(blobs, w, h, markerCorners)
    if (!pair) {
      window.alert?.('색깔 스티커 2개를 찾지 못했습니다.'); return
    }
    const y = (pair.left.y + pair.right.y) / 2
    const nextPts = [{ x: pair.left.x, y }, { x: pair.right.x, y }]
    draggingRef.current = null; setDraggingIdx(null); setLoupeImgPt(null)
    localPtsRef.current = nextPts; onChangeRef.current?.(nextPts)
  }

  function centerImagePoint(imgPoint, zoom = 2.2) {
    const container = containerRef.current, { w, h } = sizeRef.current
    if (!container || !w || !h) return
    const cw = container.clientWidth, ch = container.clientHeight
    const displayW = cw * zoom, displayH = (h / w) * cw * zoom
    const baseX = displayW <= cw ? (cw - displayW) / 2 : 0
    const baseY = displayH <= ch ? (ch - displayH) / 2 : 0
    updateView({
      zoom,
      panX: cw / 2 - baseX - (imgPoint.x / w) * displayW,
      panY: ch * 0.46 - baseY - (imgPoint.y / h) * displayH,
    })
  }

  useEffect(() => {
    if (!imgReady || !markerCorners?.length || points.length !== 0) return
    const key = `${frozenSrc}-${markerCorners.map(c => `${Math.round(c.x)},${Math.round(c.y)}`).join('|')}`
    if (autoZoomKeyRef.current === key) return
    autoZoomKeyRef.current = key
    const xs = markerCorners.map(c => c.x), ys = markerCorners.map(c => c.y)
    const markerSide = avgSidePx(markerCorners)
    const target = {
      x: Math.max(0, Math.min(...xs) - markerSide * 1.15),
      y: Math.max(0, (Math.min(...ys) + Math.max(...ys)) / 2),
    }
    setTimeout(() => centerImagePoint(target, 2.25), 60)
  }, [imgReady, markerCorners, points.length, frozenSrc])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    function canvasPos(clientX, clientY) {
      const rect = canvas.getBoundingClientRect()
      return {
        x: (clientX - rect.left) * (canvas.width / rect.width),
        y: (clientY - rect.top) * (canvas.height / rect.height),
      }
    }

    function findHandle(cx, cy) {
      const pts = localPtsRef.current, layout = layoutRef.current
      if (!pts?.length || !layout) return null
      let hit = null, minDist = Infinity
      for (let i = 0; i < pts.length; i++) {
        const dp = imgToDisp(pts[i].x, pts[i].y, layout)
        const dist = Math.hypot(cx - dp.x, cy - dp.y)
        if (dist < HIT_R && dist < minDist) { minDist = dist; hit = i }
      }
      return hit
    }

    function onTouchStart(e) {
      if (tapPhaseRef.current !== 'placing_points') return
      e.preventDefault()
      const touch = e.touches[0]
      const cp = canvasPos(touch.clientX, touch.clientY)
      touchStartRef.current = { x: cp.x, y: cp.y, moved: false }
      panStartRef.current = { x: cp.x, y: cp.y, panX: viewRef.current.panX, panY: viewRef.current.panY }
      if (localPtsRef.current.length === 2) {
        const hit = findHandle(cp.x, cp.y)
        if (hit !== null) {
          draggingRef.current = hit; setDraggingIdx(hit)
          const imgPt = localPtsRef.current[hit]
          setLoupeImgPt({ x: imgPt.x, y: imgPt.y })
          panStartRef.current = null
        }
      }
    }

    function onTouchMove(e) {
      if (tapPhaseRef.current !== 'placing_points') return
      e.preventDefault()
      const touch = e.touches[0]
      const cp = canvasPos(touch.clientX, touch.clientY)
      if (touchStartRef.current) {
        const d = Math.hypot(cp.x - touchStartRef.current.x, cp.y - touchStartRef.current.y)
        if (d > TAP_MAX_PX) touchStartRef.current.moved = true
      }
      if (panIfNeeded(cp)) return
      if (draggingRef.current === null) return
      const layout = layoutRef.current
      if (!layout) return
      const imgPt = clampImg(dispToImg(cp.x, cp.y, layout), layout)
      const newPts = [...localPtsRef.current]
      newPts[draggingRef.current] = imgPt
      localPtsRef.current = newPts
      setLoupeImgPt({ x: imgPt.x, y: imgPt.y })
      onChangeRef.current?.(newPts)
    }

    function panIfNeeded(cp) {
      if (draggingRef.current !== null) return false
      if (!touchStartRef.current || !panStartRef.current) return false
      if (!touchStartRef.current.moved) return false
      updateView({
        zoom: viewRef.current.zoom,
        panX: panStartRef.current.panX + (cp.x - panStartRef.current.x),
        panY: panStartRef.current.panY + (cp.y - panStartRef.current.y),
      })
      return true
    }

    function onTouchEnd(e) {
      if (tapPhaseRef.current !== 'placing_points') return
      const startInfo = touchStartRef.current
      touchStartRef.current = null; panStartRef.current = null
      if (draggingRef.current !== null) {
        draggingRef.current = null; setDraggingIdx(null); setLoupeImgPt(null); return
      }
      if (!startInfo || startInfo.moved) return
      const touch = e.changedTouches[0]
      const cp = canvasPos(touch.clientX, touch.clientY)
      const dist = Math.hypot(cp.x - startInfo.x, cp.y - startInfo.y)
      if (dist > TAP_MAX_PX) return
      const layout = layoutRef.current
      if (!layout) return
      const imgPt = clampImg(dispToImg(cp.x, cp.y, layout), layout)
      const currentPts = localPtsRef.current
      if (currentPts.length >= 2) return
      const newPts = [...currentPts, imgPt]
      localPtsRef.current = newPts
      onChangeRef.current?.(newPts)
      // ── 탭 위치 3배 자동 확대 ──────────────────────────────────────────────
      const cnt = containerRef.current
      const { w, h } = sizeRef.current
      if (cnt && w && h) {
        const cw2 = cnt.clientWidth, ch2 = cnt.clientHeight
        const factor = 3 / Math.max(1, viewRef.current.zoom)
        updateView(zoomAtDisplayPoint(viewRef.current, factor, cp, w, h, cw2, ch2))
      }
      // ────────────────────────────────────────────────────────────────────────
    }

    function onMouseDown(e) {
      if (tapPhaseRef.current !== 'placing_points') return
      mouseDownRef.current = { x: e.offsetX, y: e.offsetY }
      if (localPtsRef.current.length === 2) {
        const hit = findHandle(e.offsetX, e.offsetY)
        if (hit !== null) {
          draggingRef.current = hit; setDraggingIdx(hit)
          const imgPt = localPtsRef.current[hit]
          setLoupeImgPt({ x: imgPt.x, y: imgPt.y })
        }
      }
    }

    function onMouseMove(e) {
      if (draggingRef.current === null) return
      const layout = layoutRef.current
      if (!layout) return
      const imgPt = clampImg(dispToImg(e.offsetX, e.offsetY, layout), layout)
      const newPts = [...localPtsRef.current]
      newPts[draggingRef.current] = imgPt
      localPtsRef.current = newPts
      setLoupeImgPt({ x: imgPt.x, y: imgPt.y })
      onChangeRef.current?.(newPts)
    }

    function onMouseUp(e) {
      const startPos = mouseDownRef.current
      mouseDownRef.current = null
      if (draggingRef.current !== null) {
        draggingRef.current = null; setDraggingIdx(null); setLoupeImgPt(null); return
      }
      if (!startPos) return
      const dist = Math.hypot(e.offsetX - startPos.x, e.offsetY - startPos.y)
      if (dist > TAP_MAX_PX) return
      const layout = layoutRef.current
      if (!layout) return
      const imgPt = clampImg(dispToImg(e.offsetX, e.offsetY, layout), layout)
      const currentPts = localPtsRef.current
      if (currentPts.length >= 2) return
      const newPts = [...currentPts, imgPt]
      localPtsRef.current = newPts
      onChangeRef.current?.(newPts)
      // 마우스 탭 3배 자동 확대
      const cnt = containerRef.current
      const { w, h } = sizeRef.current
      if (cnt && w && h) {
        const cw2 = cnt.clientWidth, ch2 = cnt.clientHeight
        const factor = 3 / Math.max(1, viewRef.current.zoom)
        updateView(zoomAtDisplayPoint(viewRef.current, factor, { x: e.offsetX, y: e.offsetY }, w, h, cw2, ch2))
      }
    }

    canvas.addEventListener('touchstart', onTouchStart, { passive: false })
    canvas.addEventListener('touchmove',  onTouchMove,  { passive: false })
    canvas.addEventListener('touchend',   onTouchEnd)
    canvas.addEventListener('mousedown',  onMouseDown)
    canvas.addEventListener('mousemove',  onMouseMove)
    canvas.addEventListener('mouseup',    onMouseUp)

    return () => {
      canvas.removeEventListener('touchstart', onTouchStart)
      canvas.removeEventListener('touchmove',  onTouchMove)
      canvas.removeEventListener('touchend',   onTouchEnd)
      canvas.removeEventListener('mousedown',  onMouseDown)
      canvas.removeEventListener('mousemove',  onMouseMove)
      canvas.removeEventListener('mouseup',    onMouseUp)
    }
  }, [])

  const isPlacing = tapPhase === 'placing_points'

  return (
    <div ref={containerRef} className={styles.container}>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        style={{
          cursor: isPlacing
            ? (draggingIdx !== null ? 'grabbing'
               : points.length < 2  ? 'crosshair' : 'grab')
            : 'default',
        }}
      />

      {isPlacing && (
        <div className={styles.zoomControls}>
          <span className={styles.zoomTitle}>
            {points.length < 2 ? '먼저 확대' : '확대 조정'}
          </span>
          <button type="button" onClick={() => zoomBy(1.6)} aria-label="확대">확대</button>
          <button type="button" onClick={() => zoomBy(1 / 1.6)} aria-label="축소">축소</button>
          <button type="button" onClick={resetZoom} aria-label="원래 크기">1×</button>
          <button
            type="button"
            className={styles.stickerFitBtn}
            hidden aria-hidden="true" onClick={autoFindStickerPoints}
            aria-label="색깔 스티커로 P1 P2 자동찾기"
          >
            스티커<br />찾기
          </button>
          {points.length === 2 && (
            <button
              type="button"
              className={styles.autoFitBtn}
              hidden aria-hidden="true" onClick={autoFitStemEdges}
              aria-label="색상으로 줄기 경계 자동맞춤"
            >
              자동<br />맞춤
            </button>
          )}
        </div>
      )}

      {tapPhase === 'no_marker' && (
        <div className={styles.noMarkerOverlay}>
          <span className={styles.noMarkerIcon}>🔍</span>
          <p>ArUco 마커를 인식하지 못했습니다</p>
          <p className={styles.noMarkerSub}>마커 전체가 보이도록 다시 촬영해 주세요</p>
          {debugInfo && (
            <div className={styles.debugBox}>
              <p>사각형 후보: <strong>{debugInfo.candidates}</strong>개</p>
              <p className={styles.debugDicts}>
                시도 사전: {[...new Set((debugInfo.triedVariants ?? []).map(v => v.split('/')[0]))].join(' · ')}
              </p>
              {debugInfo.candidates === 0 && (
                <p className={styles.debugTip}>→ 마커가 너무 작거나 흐릿합니다. 더 가까이 촬영하세요.</p>
              )}
              {debugInfo.candidates > 0 && (
                <p className={styles.debugTip}>→ 사전 불일치 가능. 마커 ID·사전을 확인하세요.</p>
              )}
            </div>
          )}
        </div>
      )}

      {isPlacing && draggingIdx === null && (
        <div className={`${styles.hint} ${styles.hintTap}`}>
          {points.length === 0
            ? '색깔 스티커를 붙였으면 스티커찾기를 누르세요'
            : points.length === 1
            ? '확대 상태에서 반대쪽 끝(P2)을 탭하세요'
            : 'P1·P2를 줄기 양쪽 끝에 맞춘 뒤 측정을 누르세요'}
        </div>
      )}
    </div>
  )
}
