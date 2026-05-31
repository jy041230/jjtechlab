import fs from 'node:fs'
import path from 'node:path'

const outDir = path.join(process.cwd(), 'printables')
fs.mkdirSync(outDir, { recursive: true })

const MM = 72 / 25.4
const pageW = 210 * MM
const pageH = 297 * MM
const stickerD = 14 * MM
const r = stickerD / 2
const pairGap = 20 * MM
const colGap = 10 * MM
const rowGap = 9 * MM
const marginX = 12 * MM
const topY = pageH - 32 * MM
const pairW = stickerD * 2 + pairGap
const rowH = stickerD + rowGap
const cols = 4
const rows = 9

function esc(text) {
  return String(text).replace(/[\\()]/g, '\\$&')
}

function circle(x, y, radius) {
  const k = 0.5522847498
  const c = radius * k
  return [
    `${(x + radius).toFixed(3)} ${y.toFixed(3)} m`,
    `${(x + radius).toFixed(3)} ${(y + c).toFixed(3)} ${(x + c).toFixed(3)} ${(y + radius).toFixed(3)} ${x.toFixed(3)} ${(y + radius).toFixed(3)} c`,
    `${(x - c).toFixed(3)} ${(y + radius).toFixed(3)} ${(x - radius).toFixed(3)} ${(y + c).toFixed(3)} ${(x - radius).toFixed(3)} ${y.toFixed(3)} c`,
    `${(x - radius).toFixed(3)} ${(y - c).toFixed(3)} ${(x - c).toFixed(3)} ${(y - radius).toFixed(3)} ${x.toFixed(3)} ${(y - radius).toFixed(3)} c`,
    `${(x + c).toFixed(3)} ${(y - radius).toFixed(3)} ${(x + radius).toFixed(3)} ${(y - c).toFixed(3)} ${(x + radius).toFixed(3)} ${y.toFixed(3)} c`,
  ].join('\n')
}

function drawSticker(lines, x, y, label, rgb) {
  lines.push('q')
  lines.push(`${rgb.join(' ')} rg`)
  lines.push(circle(x, y, r))
  lines.push('f')
  lines.push('0 0 0 RG 1.2 w')
  lines.push(circle(x, y, r))
  lines.push('S')
  lines.push('1 1 1 rg')
  lines.push(`BT /F2 14 Tf 1 0 0 1 ${(x - 9).toFixed(3)} ${(y - 5).toFixed(3)} Tm (${esc(label)}) Tj ET`)
  lines.push('0 0 0 rg')
  lines.push(`BT /F1 5.5 Tf 1 0 0 1 ${(x - 12).toFixed(3)} ${(y - r - 9).toFixed(3)} Tm (${esc(label === 'P1' ? 'LEFT' : 'RIGHT')}) Tj ET`)
  lines.push('Q')
}

const lines = []
lines.push('0 0 0 rg')
lines.push(`BT /F2 14 Tf 1 0 0 1 ${marginX.toFixed(3)} ${(pageH - 17 * MM).toFixed(3)} Tm (P1/P2 Stem Edge Stickers) Tj ET`)
lines.push(`BT /F1 8 Tf 1 0 0 1 ${marginX.toFixed(3)} ${(pageH - 23 * MM).toFixed(3)} Tm (Print A4 at 100%. Put P1 center on the left stem edge, P2 center on the right stem edge.) Tj ET`)

for (let row = 0; row < rows; row += 1) {
  for (let col = 0; col < cols; col += 1) {
    const baseX = marginX + col * (pairW + colGap) + r
    const y = topY - row * rowH
    drawSticker(lines, baseX, y, 'P1', [1, 0.02, 0.24])
    drawSticker(lines, baseX + stickerD + pairGap, y, 'P2', [0.05, 0.39, 1])
  }
}

lines.push(`BT /F1 7 Tf 1 0 0 1 ${marginX.toFixed(3)} ${(11 * MM).toFixed(3)} Tm (Use bright P1/P2 sticker mode in the app. Avoid green stickers.) Tj ET`)

const content = lines.join('\n')
const objects = []
objects.push('<< /Type /Catalog /Pages 2 0 R >>')
objects.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW.toFixed(3)} ${pageH.toFixed(3)}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`)
objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>')
objects.push(`<< /Length ${Buffer.byteLength(content, 'utf8')} >>\nstream\n${content}\nendstream`)

let pdf = '%PDF-1.4\n'
const offsets = [0]
for (let i = 0; i < objects.length; i += 1) {
  offsets.push(Buffer.byteLength(pdf, 'utf8'))
  pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`
}
const xref = Buffer.byteLength(pdf, 'utf8')
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
for (let i = 1; i < offsets.length; i += 1) {
  pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
}
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`

fs.writeFileSync(path.join(outDir, 'p1_p2_stem_edge_stickers_14mm.pdf'), pdf)

const html = `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <title>P1/P2 Stem Edge Stickers</title>
  <style>
    @page { size: A4; margin: 12mm; }
    body { font-family: Arial, sans-serif; margin: 0; color: #111; }
    h1 { font-size: 18px; margin: 0 0 4mm; }
    p { font-size: 10px; margin: 0 0 8mm; }
    .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 9mm 10mm; }
    .pair { display: flex; gap: 20mm; align-items: center; }
    .sticker { width: 14mm; height: 14mm; border-radius: 50%; color: white; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 14pt; border: 0.4mm solid #111; position: relative; }
    .sticker::after { position: absolute; bottom: -5mm; color: #111; font-size: 5pt; font-weight: 500; }
    .p1 { background: #ff063d; }
    .p2 { background: #0d63ff; }
    .p1::after { content: "LEFT"; }
    .p2::after { content: "RIGHT"; }
  </style>
</head>
<body>
  <h1>P1/P2 Stem Edge Stickers</h1>
  <p>Print A4 at 100%. P1 center = left stem edge, P2 center = right stem edge.</p>
  <div class="grid">
    ${Array.from({ length: rows * cols }, () => '<div class="pair"><div class="sticker p1">P1</div><div class="sticker p2">P2</div></div>').join('\n    ')}
  </div>
</body>
</html>`
fs.writeFileSync(path.join(outDir, 'p1_p2_stem_edge_stickers_14mm.html'), html, 'utf8')
