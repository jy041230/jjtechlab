/**
 * detectRedTape.js — 사진에서 빨간 테이프(줄기에 감긴) 영역을 찾아
 *                     줄기 굵기 양끝(좌·우) 두 점을 제안한다.
 *
 * 반환: [{x,y},{x,y}] (원본 이미지 좌표) 또는 null (못 찾음)
 *
 * 원리:
 *  1) 이미지를 적당한 크기로 축소해 빨강 픽셀 마스크 생성 (HSV 기준)
 *  2) 빨강 픽셀이 가장 많이 모인 가로 띠(행 구간)를 찾음
 *  3) 그 띠에서 빨강 영역의 좌·우 가장자리 x를 굵기 양끝으로 제안
 *  4) 양끝의 중간 높이 y를 점의 y로
 *
 * 검증된 측정 로직(FrozenMeasure)은 건드리지 않는다. 이 함수는
 * "두 점을 제안"만 하고, 사용자가 드래그로 확인·조정한다.
 */

/** 파랑 판정 (RGB → 대략적 HSV 파랑 영역) */
function isBlue(r, g, b) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const v = max / 255
  const s = max === 0 ? 0 : (max - min) / max
  if (v < 0.20 || s < 0.30) return false        // 너무 어둡거나 채도 낮으면 제외
  // 색상(Hue) 계산
  let h = 0
  const d = max - min
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  // 파랑: 195~255도 (하늘색~남색 포함)
  return h >= 195 && h <= 255
}

/**
 * @param {HTMLImageElement|HTMLCanvasElement} imgEl  원본 이미지
 * @param {number} imgW, imgH  원본 픽셀 크기
 * @param {Array} markerCorners  마커 코너(있으면 빨강 탐색 높이대 힌트로 사용) — optional
 * @returns {[{x,y},{x,y}]|null}
 */
export function detectRedTape(imgEl, imgW, imgH, markerCorners = null) {
  try {
    // 1) 축소 캔버스 (최대 폭 480px)
    const scale = Math.min(1, 480 / imgW)
    const w = Math.max(1, Math.round(imgW * scale))
    const h = Math.max(1, Math.round(imgH * scale))
    const cv = document.createElement('canvas')
    cv.width = w; cv.height = h
    const ctx = cv.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(imgEl, 0, 0, w, h)
    const data = ctx.getImageData(0, 0, w, h).data

    // 2) 행별 빨강 픽셀 수 + 각 행의 좌우 끝
    const rowCount = new Array(h).fill(0)
    const rowMinX = new Array(h).fill(w)
    const rowMaxX = new Array(h).fill(-1)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        if (isBlue(data[i], data[i+1], data[i+2])) {
          rowCount[y]++
          if (x < rowMinX[y]) rowMinX[y] = x
          if (x > rowMaxX[y]) rowMaxX[y] = x
        }
      }
    }

    // 빨강 픽셀이 너무 적으면 실패
    const totalBlue = rowCount.reduce((a, b) => a + b, 0)
    if (totalBlue < w * h * 0.003) return null   // 전체의 0.3% 미만이면 빨강 없음으로 판단

    // 3) 빨강이 가장 많은 행을 중심으로, 연속된 빨강 띠 구간 찾기
    let peakRow = 0, peakVal = 0
    for (let y = 0; y < h; y++) {
      if (rowCount[y] > peakVal) { peakVal = rowCount[y]; peakRow = y }
    }
    if (peakVal < Math.max(4, w * 0.04)) return null

    // peak 주변에서 빨강이 peak의 30% 이상인 행들을 띠로 모음
    const thr = peakVal * 0.3
    let top = peakRow, bot = peakRow
    while (top > 0 && rowCount[top - 1] >= thr) top--
    while (bot < h - 1 && rowCount[bot + 1] >= thr) bot++

    // 4) 띠 구간에서 좌·우 끝의 중앙값적 추정 (행별 끝의 중앙값)
    const lefts = [], rights = []
    for (let y = top; y <= bot; y++) {
      if (rowMaxX[y] >= rowMinX[y]) {
        lefts.push(rowMinX[y])
        rights.push(rowMaxX[y])
      }
    }
    if (!lefts.length) return null
    lefts.sort((a, b) => a - b)
    rights.sort((a, b) => a - b)
    const leftX = lefts[Math.floor(lefts.length / 2)]
    const rightX = rights[Math.floor(rights.length / 2)]
    const midY = (top + bot) / 2

    // 폭이 비정상(너무 좁음)이면 실패
    if (rightX - leftX < Math.max(6, w * 0.03)) return null

    // 5) 원본 좌표로 환산
    const toImg = (vx, vy) => ({ x: vx / scale, y: vy / scale })
    return [toImg(leftX, midY), toImg(rightX, midY)]
  } catch (e) {
    console.warn('[파란 테이프 감지 실패]', e)
    return null
  }
}
