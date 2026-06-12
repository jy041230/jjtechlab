/**
 * detectRedTape.js — 사진에서 파란 테이프(줄기에 감긴) 영역을 찾아
 *                     줄기 굵기 양끝(좌·우) 두 점을 제안한다.
 *
 * 반환: [{x,y},{x,y}] (원본 이미지 좌표) 또는 null (못 찾음)
 *
 * 핵심: 화면 전체의 파란 픽셀을 긁지 않고, "연결된 가장 큰 파란 덩어리"
 *       하나만 찾는다. 그 덩어리가 테이프다운 모양일 때만 인정한다.
 *       UI 배지·배경의 흩어진 파랑은 버린다.
 */

/** 선명한 파랑만 (채도·밝기 높게 — 배경의 옅은 파랑 제외) */
function isBlue(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const v = max / 255
  const s = max === 0 ? 0 : (max - min) / max
  if (v < 0.25 || s < 0.45) return false
  let h = 0
  const d = max - min
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return h >= 200 && h <= 250
}

export function detectRedTape(imgEl, imgW, imgH, markerCorners = null) {
  try {
    const scale = Math.min(1, 480 / imgW)
    const w = Math.max(1, Math.round(imgW * scale))
    const h = Math.max(1, Math.round(imgH * scale))
    const cv = document.createElement('canvas')
    cv.width = w; cv.height = h
    const ctx = cv.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(imgEl, 0, 0, w, h)
    const data = ctx.getImageData(0, 0, w, h).data

    const mask = new Uint8Array(w * h)
    let blueTotal = 0
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        if (isBlue(data[i], data[i+1], data[i+2])) { mask[y * w + x] = 1; blueTotal++ }
      }
    }
    if (blueTotal < 8) return null

    const label = new Int32Array(w * h)
    let curLabel = 0
    const comps = []
    const stack = []
    for (let p0 = 0; p0 < w * h; p0++) {
      if (mask[p0] !== 1 || label[p0] !== 0) continue
      curLabel++
      let count = 0, minX = w, maxX = -1, minY = h, maxY = -1, sumX = 0, sumY = 0
      stack.length = 0
      stack.push(p0); label[p0] = curLabel
      while (stack.length) {
        const p = stack.pop()
        const px = p % w, py = (p / w) | 0
        count++
        if (px < minX) minX = px
        if (px > maxX) maxX = px
        if (py < minY) minY = py
        if (py > maxY) maxY = py
        sumX += px; sumY += py
        if (px > 0)     { const q = p - 1; if (mask[q] === 1 && label[q] === 0) { label[q] = curLabel; stack.push(q) } }
        if (px < w - 1) { const q = p + 1; if (mask[q] === 1 && label[q] === 0) { label[q] = curLabel; stack.push(q) } }
        if (py > 0)     { const q = p - w; if (mask[q] === 1 && label[q] === 0) { label[q] = curLabel; stack.push(q) } }
        if (py < h - 1) { const q = p + w; if (mask[q] === 1 && label[q] === 0) { label[q] = curLabel; stack.push(q) } }
      }
      comps.push({ count, minX, maxX, minY, maxY, sumX, sumY })
    }
    if (!comps.length) return null

    let markerCx = null, markerCy = null, markerSide = null
    if (markerCorners && markerCorners.length === 4) {
      let mx = 0, my = 0
      for (const c of markerCorners) { mx += c.x; my += c.y }
      markerCx = (mx / 4) * scale
      markerCy = (my / 4) * scale
      const dx = (markerCorners[0].x - markerCorners[1].x) * scale
      const dy = (markerCorners[0].y - markerCorners[1].y) * scale
      markerSide = Math.hypot(dx, dy)
    }

    const minCount = Math.max(6, Math.round(w * h * 0.0008))
    let best = null, bestScore = -Infinity
    for (const c of comps) {
      if (c.count < minCount) continue
      const bw = c.maxX - c.minX + 1
      const bh = c.maxY - c.minY + 1
      if (bw > w * 0.7) continue
      if (bw < 3) continue
      const fill = c.count / (bw * bh)
      if (fill < 0.25) continue
      const cx = c.sumX / c.count
      const cy = c.sumY / c.count
      let score = c.count * fill
      if (markerCx !== null) {
        const dist = Math.hypot(cx - markerCx, cy - markerCy)
        const near = markerSide ? Math.max(0, 1 - dist / (markerSide * 6)) : 0
        score *= (1 + near * 2)
      }
      if (score > bestScore) { bestScore = score; best = { c, cx, cy } }
    }
    if (!best) return null

    const c = best.c
    // 점 높이: 테이프 위쪽 끝 근처 (캘리퍼스가 재는 위치)
    const topY = Math.round(c.minY + (c.maxY - c.minY) * 0.10)
    // 좌우 폭: 위쪽 좁은 띠만 보면 가장자리를 놓쳐 안쪽으로 들어감.
    // → 테이프 위쪽 절반(0~50%) 구간에서 '가장 넓은 행'의 좌우 끝을 쓴다.
    const yScanLo = c.minY
    const yScanHi = Math.round(c.minY + (c.maxY - c.minY) * 0.50)
    let leftX = w, rightX = -1, bestRowWidth = -1
    for (let y = yScanLo; y <= yScanHi; y++) {
      let rl = w, rr = -1
      for (let x = c.minX; x <= c.maxX; x++) {
        if (mask[y * w + x] === 1 && label[y * w + x]) {
          if (x < rl) rl = x
          if (x > rr) rr = x
        }
      }
      if (rr >= rl && (rr - rl) > bestRowWidth) {
        bestRowWidth = rr - rl
        leftX = rl; rightX = rr
      }
    }
    if (rightX < leftX) { leftX = c.minX; rightX = c.maxX }
    if (rightX - leftX < 4) return null

    const toImg = (vx, vy) => ({ x: vx / scale, y: vy / scale })
    return [toImg(leftX, topY), toImg(rightX, topY)]
  } catch (e) {
    console.warn('[파란 테이프 감지 실패]', e)
    return null
  }
}
