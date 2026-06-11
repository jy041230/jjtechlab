/**
 * treeSync.js — 수목 이력을 Supabase에 올리고, 고객 리포트용으로 다시 읽어오는 유틸
 *
 * 올리기: 농민 앱 IndexedDB(getResearchDatabaseRows) → trees / tree_records 테이블
 * 읽기:   고객 갤러리·리포트 화면이 Supabase에서 수목 목록·기록을 조회
 *
 * sensorApi.js 와 동일하게 REST 직접 호출 방식. 추가 라이브러리 없음.
 */
import { SUPABASE_URL, SB_HEADERS, isSupabaseConfigured } from './supabaseClient'
import { getResearchDatabaseRows } from './db'
import { fetchSheetData } from './sheetData'

const REST = `${SUPABASE_URL}/rest/v1`

function toNum(v) {
  if (v === null || v === undefined || v === '') return null
  const n = parseFloat(v)
  return isNaN(n) ? null : n
}

/** ── 올리기: 농민 앱 이력 + 구글시트 전체를 Supabase로 동기화 ── */
export async function syncTreesToSupabase() {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase 키가 설정되지 않았습니다. supabaseClient.js를 확인하세요.')
  }

  // 1) 이 휴대폰 IndexedDB 이력
  const localRows = await getResearchDatabaseRows()

  // 2) 구글시트의 모든 수목 (다른 폰·다른 측정자 포함)
  let sheetRows = []
  try {
    sheetRows = await fetchSheetRows()
  } catch (e) {
    console.warn('[구글시트 읽기 실패 — 휴대폰 데이터만 올립니다]', e)
  }

  const rows = [...localRows, ...sheetRows]
  if (!rows.length) return { trees: 0, records: 0 }

  // 수목 정보(trees) — 수목ID별 중복 제거, 대표 사진은 첫 이미지
  const treeMap = new Map()
  for (const r of rows) {
    const id = r.수목ID
    if (!id) continue
    if (!treeMap.has(id)) {
      treeMap.set(id, {
        tree_id: id,
        tree_group: r.수목구분 || null,
        thumbnail: firstImage(r.이미지자료),
        location: '영산대학교 양산캠퍼스 농장',
        note: null,
      })
    } else {
      const t = treeMap.get(id)
      if (!t.tree_group && r.수목구분) t.tree_group = r.수목구분
      if (!t.thumbnail) t.thumbnail = firstImage(r.이미지자료)
    }
  }
  const trees = [...treeMap.values()]

  // 측정 이력(tree_records)
  const records = rows
    .filter(r => r.수목ID)
    .map(r => ({
      tree_id: r.수목ID,
      measured_at: r.날짜시간 || r.날짜 || null,
      participant_id: r.참여자ID || null,
      stem_mm: toNum(r.줄기직경mm),
      soil_ph: toNum(r.토양PH),
      soil_moisture: toNum(r.토양수분),
      soil_temp: toNum(r.토양온도),
      photo: firstImage(r.이미지자료),
      memo: r.음성전사 || (r.사건유형 && r.사건유형 !== '관찰' ? r.비고 : null) || null,
      record_type: r.비고 || r.사건유형 || null,
    }))

  await postRows('trees', trees, 'tree_id')
  await postRows('tree_records', records)

  return { trees: trees.length, records: records.length }
}

/** 구글시트 stem/soil 시트를 연구DB 행 형식으로 변환 */
async function fetchSheetRows() {
  const data = await fetchSheetData()
  const rows = []
  for (const r of (data.stem ?? [])) {
    rows.push({
      날짜: String(r.date ?? '').slice(0, 10),
      날짜시간: r.date,
      참여자ID: r.participantId,
      수목ID: r.treeId,
      수목구분: r.treeGroup,
      줄기직경mm: r.cameraMm,
      비고: '줄기측정',
      사건유형: '관찰',
    })
  }
  for (const r of (data.soil ?? [])) {
    rows.push({
      날짜: String(r.date ?? '').slice(0, 10),
      날짜시간: r.date,
      참여자ID: r.participantId,
      수목ID: r.treeId,
      수목구분: r.treeGroup || '',
      토양PH: r.ph,
      토양수분: r.moisture,
      토양온도: r.temp,
      비고: '토양측정',
      사건유형: '관찰',
    })
  }
  return rows
}

/** ── 읽기: 고객 갤러리용 수목 목록 ── */
export async function fetchTrees() {
  const res = await fetch(`${REST}/trees?select=*&order=tree_id.asc`, { headers: SB_HEADERS })
  if (!res.ok) throw new Error(`수목 목록 조회 실패 (${res.status})`)
  return res.json()
}

/** ── 읽기: 특정 수목의 측정 이력 (성장 곡선·타임라인용) ── */
export async function fetchTreeRecords(treeId) {
  const url = `${REST}/tree_records?tree_id=eq.${encodeURIComponent(treeId)}` +
    `&select=*&order=measured_at.asc`
  const res = await fetch(url, { headers: SB_HEADERS })
  if (!res.ok) throw new Error(`수목 기록 조회 실패 (${res.status})`)
  return res.json()
}

/* ── 내부 헬퍼 ── */
function firstImage(imageField) {
  if (!imageField) return null
  const first = String(imageField).split(' | ')[0].trim()
  return first || null
}

async function postRows(table, rows, conflictKey) {
  if (!rows.length) return
  const headers = { ...SB_HEADERS, Prefer: conflictKey ? 'resolution=merge-duplicates' : 'return=minimal' }
  const url = conflictKey
    ? `${REST}/${table}?on_conflict=${conflictKey}`
    : `${REST}/${table}`
  // 200건씩 끊어서 전송 (요청 크기 제한 회피)
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200)
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(chunk) })
    if (!res.ok) {
      const txt = await res.text()
      throw new Error(`${table} 업로드 실패 (${res.status}): ${txt.slice(0, 200)}`)
    }
  }
}
