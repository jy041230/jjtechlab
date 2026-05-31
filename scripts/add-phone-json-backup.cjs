#!/usr/bin/env node
const { existsSync, copyFileSync, readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

function backupOnce(file) {
  const backup = `${file}.phonebackup.bak`
  if (!existsSync(backup)) copyFileSync(file, backup)
}

function restoreBackup(file) {
  const backup = `${file}.phonebackup.bak`
  if (!existsSync(backup)) return false
  copyFileSync(backup, file)
  return true
}

function patchDb(root, options = {}) {
  const file = join(root, 'src', 'utils', 'db.js')
  if (!existsSync(file)) return { file, skipped: true, reason: 'not found' }
  if (options.restore) return { file, restored: restoreBackup(file) }

  backupOnce(file)
  let source = readFileSync(file, 'utf8')
  const before = source
  const changes = []

  if (!source.includes('export async function downloadPhoneBackupJson')) {
    const marker = /export async function makeResearchDatabaseCsv\(options = \{\}\) \{/m
    const insertion = `export async function downloadPhoneBackupJson(meta = {}) {
  const db = await openDB()
  const stores = ['event_units', 'measurement_data', 'voice_data', 'visual_data']
  const payloadStores = {}

  for (const storeName of stores) {
    payloadStores[storeName] = await txGetAll(db, storeName)
  }

  const eventCount = payloadStores.event_units.length
  if (!eventCount) return 0

  const now = new Date()
  const stamp = \`\${formatDate(now).replaceAll('-', '')}_\${formatTime(now).replaceAll(':', '')}\`
  const researcher = safeBackupFilenamePart(
    meta.participantId ?? meta.researcherId ?? meta.subjectId ?? meta.participant_id ?? 'researcher'
  )
  const payload = {
    app: 'plum-measure-app',
    backupType: 'phone-json',
    version: 1,
    exportedAt: now.toISOString(),
    meta,
    stores: payloadStores,
  }

  downloadTextFile(
    \`plum-measure-\${researcher}-\${stamp}.json\`,
    JSON.stringify(payload, null, 2),
    'application/json;charset=utf-8'
  )
  return eventCount
}

export async function importPhoneBackupJson(file) {
  const text = await file.text()
  const payload = JSON.parse(text)
  const stores = payload?.stores
  if (!stores || typeof stores !== 'object') {
    throw new Error('지원하지 않는 백업 파일입니다.')
  }

  const db = await openDB()
  const storeNames = ['event_units', 'measurement_data', 'voice_data', 'visual_data']
  const counts = {}

  for (const storeName of storeNames) {
    const records = Array.isArray(stores[storeName]) ? stores[storeName] : []
    counts[storeName] = 0
    for (const record of records) {
      await txPut(db, storeName, record)
      counts[storeName] += 1
    }
  }

  return {
    eventCount: counts.event_units ?? 0,
    measurementCount: counts.measurement_data ?? 0,
    counts,
  }
}

`
    if (!marker.test(source)) throw new Error('Could not find makeResearchDatabaseCsv insertion point in db.js')
    source = source.replace(marker, `${insertion}export async function makeResearchDatabaseCsv(options = {}) {`)
    changes.push('add JSON phone backup export/import helpers')
  }

  if (!source.includes('function safeBackupFilenamePart')) {
    const marker = /function downloadTextFile\(filename, content, type\) \{/m
    const helper = `function safeBackupFilenamePart(value) {
  const text = String(value ?? '').trim()
  const safe = text.replace(/[^a-zA-Z0-9가-힣_-]+/g, '-').replace(/^-+|-+$/g, '')
  return safe || 'researcher'
}

`
    if (!marker.test(source)) throw new Error('Could not find downloadTextFile insertion point in db.js')
    source = source.replace(marker, `${helper}function downloadTextFile(filename, content, type) {`)
    changes.push('add safe filename helper')
  }

  if (source !== before) writeFileSync(file, source)
  return { file, changed: source !== before, changes }
}

function patchMeasurementScreen(root, options = {}) {
  const file = join(root, 'src', 'components', 'MeasurementScreen.jsx')
  if (!existsSync(file)) return { file, skipped: true, reason: 'not found' }
  if (options.restore) return { file, restored: restoreBackup(file) }

  backupOnce(file)
  let source = readFileSync(file, 'utf8')
  const before = source
  const changes = []

  if (!source.includes('downloadPhoneBackupJson')) {
    source = source.replace(
      /downloadPhoneBackupCsv,/, 
      'downloadPhoneBackupJson,\n  importPhoneBackupJson,'
    )
    changes.push('import JSON backup helpers')
  }

  if (source.includes('const count = await downloadPhoneBackupCsv()')) {
    source = source.replace(
      'const count = await downloadPhoneBackupCsv()',
      'const count = await downloadPhoneBackupJson(getResearchMeta())'
    )
    changes.push('use JSON backup for phone backup button')
  }

  source = source.replace(
    '다운로드 폴더에서 plum_phone_backup 파일을 확인하세요.',
    '다운로드 폴더에서 plum-measure 백업 파일을 확인하세요.'
  )

  if (!source.includes('async function handlePhoneBackupImportClick')) {
    const marker = /\n\s*async function handleCompleteClearPhoneData\(\) \{/m
    const handler = `
  async function handlePhoneBackupImportClick() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      const ok = window.confirm(
        '선택한 백업 파일을 이 스마트폰 앱으로 가져올까요?\\n\\n' +
        '같은 자료는 덮어쓰고, 새 자료는 추가됩니다.'
      )
      if (!ok) return
      try {
        const result = await importPhoneBackupJson(file)
        alert(\`백업 가져오기 완료!\\n측정묶음 \${result.eventCount}건을 가져왔습니다.\`)
      } catch (err) {
        console.error('[폰백업 가져오기 실패]', err)
        alert('백업 파일을 가져오지 못했습니다. JSON 백업 파일인지 확인해 주세요.')
      }
    }
    input.click()
  }
`
    if (!marker.test(source)) throw new Error('Could not find handleCompleteClearPhoneData insertion point')
    source = source.replace(marker, `${handler}\n  async function handleCompleteClearPhoneData() {`)
    changes.push('add backup import click handler')
  }

  if (source.includes('<span className={styles.typeLabel}>자료백업</span>')) {
    source = source.replace(
      '<span className={styles.typeLabel}>자료백업</span>',
      '<span className={styles.typeLabel}>스마트폰 백업 저장</span>'
    )
    changes.push('rename phone backup button')
  }

  if (!source.includes('handlePhoneBackupImportClick')) {
    const buttonMarker = /(<button className=\{styles\.typeBtn\} onClick=\{handleSubmitBackupFileClick\}>)/m
    const button = `            <button className={styles.typeBtn} onClick={handlePhoneBackupImportClick}>
              <span className={styles.typeIcon}>📥</span>
              <span className={styles.typeLabel}>백업 가져오기</span>
            </button>
`
    if (!buttonMarker.test(source)) throw new Error('Could not find file submit button insertion point')
    source = source.replace(buttonMarker, `${button}$1`)
    changes.push('add backup import button')
  } else if (!source.includes('<span className={styles.typeLabel}>백업 가져오기</span>')) {
    const buttonMarker = /(<button className=\{styles\.typeBtn\} onClick=\{handleSubmitBackupFileClick\}>)/m
    const button = `            <button className={styles.typeBtn} onClick={handlePhoneBackupImportClick}>
              <span className={styles.typeIcon}>📥</span>
              <span className={styles.typeLabel}>백업 가져오기</span>
            </button>
`
    if (!buttonMarker.test(source)) throw new Error('Could not find file submit button insertion point')
    source = source.replace(buttonMarker, `${button}$1`)
    changes.push('add backup import button')
  }

  if (source !== before) writeFileSync(file, source)
  return { file, changed: source !== before, changes }
}

function main() {
  const args = process.argv.slice(2)
  const restore = args.includes('--restore')
  const root = args.find(arg => arg !== '--restore') || process.cwd()
  const results = [patchDb(root, { restore }), patchMeasurementScreen(root, { restore })]

  for (const result of results) {
    if (result.skipped) {
      console.log(`SKIP ${result.file}: ${result.reason}`)
      continue
    }
    if (restore) {
      console.log(`${result.restored ? 'RESTORED' : 'NO BACKUP'} ${result.file}`)
      continue
    }
    console.log(`${result.changed ? 'PATCHED' : 'UNCHANGED'} ${result.file}`)
    for (const change of result.changes ?? []) console.log(`  - ${change}`)
  }
}

if (require.main === module) main()

module.exports = { patchDb, patchMeasurementScreen }