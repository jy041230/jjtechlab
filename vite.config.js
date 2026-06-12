import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const projectRoot = import.meta.dirname
const require = createRequire(import.meta.url)
const { VitePWA } = require('vite-plugin-pwa')

function researchDbExportPlugin() {
  return {
    name: 'research-db-export',
    configureServer(server) {
      server.middlewares.use('/api/research-db-export', (req, res) => {
        if (req.method === 'GET') {
          try {
            const exportDir = path.join(process.cwd(), 'research_exports')
            fs.mkdirSync(exportDir, { recursive: true })
            const files = fs.readdirSync(exportDir)
              .filter(name => name.toLowerCase().endsWith('.csv'))
              .sort()

            const rows = []
            for (const fileName of files) {
              const filePath = path.join(exportDir, fileName)
              const text = fs.readFileSync(filePath, 'utf8').replace(/^\ufeff/, '')
              const parsed = parseCsv(text)
              for (const row of parsed) rows.push({ ...row, 저장파일: fileName })
            }

            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ ok: true, files, rows }))
          } catch (err) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ ok: false, error: err.message }))
          }
          return
        }

        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('Method Not Allowed')
          return
        }

        let body = ''
        req.setEncoding('utf8')
        req.on('data', chunk => { body += chunk })
        req.on('end', () => {
          try {
            const data = JSON.parse(body || '{}')
            const csv = String(data.csv ?? '')
            if (!csv.trim()) {
              res.statusCode = 400
              res.setHeader('Content-Type', 'application/json; charset=utf-8')
              res.end(JSON.stringify({ ok: false, error: 'CSV 내용이 없습니다.' }))
              return
            }

            const exportDir = path.join(process.cwd(), 'research_exports')
            fs.mkdirSync(exportDir, { recursive: true })
            const stamp = new Date().toISOString().replace(/[:.]/g, '-')
            const fileName = `research_database_${stamp}.csv`
            const filePath = path.join(exportDir, fileName)
            fs.writeFileSync(filePath, '\ufeff' + csv, 'utf8')

            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ ok: true, fileName, filePath }))
          } catch (err) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json; charset=utf-8')
            res.end(JSON.stringify({ ok: false, error: err.message }))
          }
        })
      })
    },
  }
}

function parseCsv(text) {
  const parsedRows = parseCsvRows(String(text || ''))
  if (parsedRows.length < 2) return []
  const headers = parsedRows[0].map(h => h.replace(/^\ufeff/, ''))
  return parsedRows.slice(1).map(cells => {
    const row = {}
    headers.forEach((header, index) => {
      row[header] = cells[index] ?? ''
    })
    return row
  })
}

function parseCsvRows(text) {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    const next = text[i + 1]
    if (ch === '"' && quoted && next === '"') {
      cell += '"'
      i += 1
    } else if (ch === '"') {
      quoted = !quoted
    } else if (ch === ',' && !quoted) {
      row.push(cell)
      cell = ''
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && next === '\n') i += 1
      row.push(cell)
      if (row.some(value => value.trim())) rows.push(row)
      row = []
      cell = ''
    } else {
      cell += ch
    }
  }

  if (cell || row.length) {
    row.push(cell)
    if (row.some(value => value.trim())) rows.push(row)
  }

  return rows
}

export default {
  root: projectRoot,
  
 optimizeDeps: {
    include: ['js-aruco2'],
  },
  build: {
    commonjsOptions: {
      include: [/js-aruco2/, /node_modules/],
    },
  },
  

  
  server: {
    host: true,
    port: 5174,
    https: false,
    allowedHosts: [
      'unearned-lilly-immortal.ngrok-free.dev',
      '.ngrok-free.dev',
      '.ngrok-free.app',
      '.trycloudflare.com',
      '.loca.lt',
    ],
  },
  plugins: [
    basicSsl(),
    researchDbExportPlugin(),
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png'],
      manifest: {
        name: '조경수 생산이력관리',
        short_name: '생산이력',
        description: '스마트팜 기반 조경수 성장·생산 이력 관리 시스템',
        lang: 'ko',
        theme_color: '#2d6a4f',
        background_color: '#2d6a4f',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,wasm}'],
      }
    })
  ]
}
