/**
 * TreeReport — 고객용 수목 성장 리포트 화면
 *
 *  ┌ 갤러리: 수목 이미지를 보고 선택 ─────────────┐
 *  │  [수목사진][수목사진][수목사진] ...           │
 *  ├ 선택 시: 한 그루 리포트 ───────────────────┤
 *  │  · 수목 기본정보                              │
 *  │  · 줄기직경 성장 곡선 (SVG 자체 차트)         │
 *  │  · 관리 이력 타임라인 (토양·작업·사진)        │
 *  │  · 측정 신뢰성 근거 (카메라-캘리퍼스 동등성)  │
 *  │  · [🖨️ PDF로 저장·인쇄]                       │
 *  └────────────────────────────────────────────┘
 *
 * 두 가지 진입:
 *   1) 앱 메뉴 → onBack 으로 돌아감
 *   2) 온라인 단독 주소 (?tree=수목ID) → 그 수목 리포트 바로 열림 (QR 대상)
 *
 * 의존성 추가 없음. PDF는 브라우저 인쇄(window.print) 사용.
 */
import { useState, useEffect, useCallback } from 'react'
import { fetchTrees, fetchTreeRecords } from '../utils/treeSync'
import { isSupabaseConfigured } from '../utils/supabaseClient'
import styles from './TreeReport.module.css'

export default function TreeReport({ onBack, initialTreeId = null }) {
  const [trees, setTrees] = useState([])
  const [selected, setSelected] = useState(initialTreeId)
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // 수목 목록 로드
  useEffect(() => {
    let alive = true
    ;(async () => {
      if (!isSupabaseConfigured()) {
        setError('서버 키가 설정되지 않았습니다.')
        setLoading(false)
        return
      }
      try {
        const list = await fetchTrees()
        if (!alive) return
        setTrees(list)
        if (!list.length) setError('아직 등록된 수목이 없습니다.')
      } catch (e) {
        if (alive) setError('수목 목록을 불러오지 못했습니다.')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [])

  // 선택된 수목의 기록 로드
  const loadRecords = useCallback(async (treeId) => {
    setRecords([])
    try {
      const recs = await fetchTreeRecords(treeId)
      setRecords(recs)
    } catch (e) {
      setError('수목 기록을 불러오지 못했습니다.')
    }
  }, [])

  useEffect(() => {
    if (selected) loadRecords(selected)
  }, [selected, loadRecords])

  const tree = trees.find(t => t.tree_id === selected) || null

  if (loading) {
    return (
      <div className={styles.screen}>
        <Header onBack={onBack} title="수목 성장 리포트" />
        <div className={styles.center}>불러오는 중...</div>
      </div>
    )
  }

  // ── 리포트 상세 화면 ──
  if (tree) {
    return (
      <div className={styles.screen}>
        <div className={styles.noPrint}>
          <Header onBack={() => setSelected(null)} title="수목 성장 리포트" />
        </div>
        <div className={styles.report} id="report-area">
          <ReportBody tree={tree} records={records} />
        </div>
        <div className={`${styles.printBar} ${styles.noPrint}`}>
          <button className={styles.printBtn} onClick={() => window.print()}>
            🖨️ PDF로 저장 · 인쇄
          </button>
        </div>
      </div>
    )
  }

  // ── 갤러리 화면 ──
  return (
    <div className={styles.screen}>
      <Header onBack={onBack} title="수목 성장 리포트" />
      <div className={styles.body}>
        {error && <div className={styles.errorBox}>{error}</div>}
        <p className={styles.galleryHint}>수목 사진을 눌러 성장 이력을 확인하세요.</p>
        <div className={styles.gallery}>
          {trees.map(t => (
            <button key={t.tree_id} className={styles.treeCard} onClick={() => setSelected(t.tree_id)}>
              <div className={styles.thumb}>
                {t.thumbnail
                  ? <img src={t.thumbnail} alt={t.tree_id} className={styles.thumbImg} />
                  : <span className={styles.thumbEmpty}>🌳</span>}
              </div>
              <div className={styles.treeName}>{t.tree_id}</div>
              {t.tree_group && <div className={styles.treeGroup}>{t.tree_group}</div>}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ── 리포트 본문 (인쇄 영역) ── */
function ReportBody({ tree, records }) {
  const stemSeries = records
    .filter(r => r.stem_mm !== null && r.stem_mm !== undefined)
    .map(r => ({ t: r.measured_at, v: Number(r.stem_mm) }))

  return (
    <>
      <div className={styles.reportHeader}>
        <h1 className={styles.reportTitle}>수목 성장 리포트</h1>
        <div className={styles.reportSub}>홍매화 (Prunus mume)</div>
      </div>

      <section className={styles.infoGrid}>
        <Info label="수목 번호" value={tree.tree_id} />
        <Info label="수목 구분" value={tree.tree_group || '-'} />
        <Info label="재배 위치" value={tree.location || '영산대학교 양산캠퍼스 농장'} />
        <Info label="기록 건수" value={`${records.length}건`} />
      </section>

      {tree.thumbnail && (
        <section className={styles.photoSection}>
          <img src={tree.thumbnail} alt="수목 사진" className={styles.bigPhoto} />
        </section>
      )}

      <section className={styles.block}>
        <h2 className={styles.blockTitle}>줄기 직경 성장 곡선</h2>
        <GrowthChart series={stemSeries} />
      </section>

      <section className={styles.block}>
        <h2 className={styles.blockTitle}>관리 이력</h2>
        <Timeline records={records} />
      </section>

      <section className={styles.block}>
        <h2 className={styles.blockTitle}>측정 신뢰성</h2>
        <p className={styles.trustText}>
          본 리포트의 줄기 직경은 카메라 측정 방식으로 기록되었으며, 전문 측정 도구(디지털 캘리퍼스)와의
          비교 검증에서 통계적으로 동등한 것으로 확인되었다 (N=300, 평균 오차율 0.37%).
        </p>
      </section>

      <div className={styles.footer}>
        스마트팜 기반 조경수 성장·생산 이력 관리 시스템 · 발급일 {today()}
      </div>
    </>
  )
}

function Info({ label, value }) {
  return (
    <div className={styles.infoItem}>
      <div className={styles.infoLabel}>{label}</div>
      <div className={styles.infoValue}>{value}</div>
    </div>
  )
}

/* ── 성장 곡선 (SVG 자체 그림) ── */
function GrowthChart({ series }) {
  if (series.length < 2) {
    return <div className={styles.empty}>성장 곡선을 그리려면 측정 기록이 2건 이상 필요합니다.</div>
  }
  const W = 320, H = 170, PAD = { l: 40, r: 14, t: 14, b: 30 }
  const vals = series.map(s => s.v)
  const dMin = Math.min(...vals), dMax = Math.max(...vals)
  const span = dMax - dMin || 1
  const yMin = dMin - span * 0.15, yMax = dMax + span * 0.15
  const x = i => PAD.l + (i / (series.length - 1)) * (W - PAD.l - PAD.r)
  const y = v => PAD.t + (1 - (v - yMin) / (yMax - yMin)) * (H - PAD.t - PAD.b)
  const pts = series.map((s, i) => `${x(i).toFixed(1)},${y(s.v).toFixed(1)}`).join(' ')
  const last = series.length - 1

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={styles.chart} role="img" aria-label="줄기 직경 성장 곡선">
      {[0, 0.5, 1].map(tk => {
        const v = yMin + (yMax - yMin) * tk
        const yy = y(v)
        return (
          <g key={tk}>
            <line x1={PAD.l} y1={yy} x2={W - PAD.r} y2={yy} stroke="#d5e2d8" strokeWidth="1" strokeDasharray="3 3" />
            <text x={PAD.l - 5} y={yy + 4} textAnchor="end" fontSize="10" fill="#43624f">{v.toFixed(1)}</text>
          </g>
        )
      })}
      <polyline points={pts} fill="none" stroke="#2d6a4f" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {series.map((s, i) => <circle key={i} cx={x(i)} cy={y(s.v)} r="3" fill="#2d6a4f" />)}
      <text x={Math.min(x(last), W - PAD.r - 28)} y={y(series[last].v) - 8} textAnchor="middle" fontSize="11" fontWeight="700" fill="#1b4332">
        {series[last].v.toFixed(1)}mm
      </text>
      <text x={PAD.l} y={H - 8} textAnchor="start" fontSize="10" fill="#88998d">{fmtDate(series[0].t)}</text>
      <text x={W - PAD.r} y={H - 8} textAnchor="end" fontSize="10" fill="#88998d">{fmtDate(series[last].t)}</text>
    </svg>
  )
}

/* ── 관리 이력 타임라인 ── */
function Timeline({ records }) {
  if (!records.length) return <div className={styles.empty}>관리 이력이 없습니다.</div>
  return (
    <ul className={styles.timeline}>
      {records.map((r, i) => (
        <li key={i} className={styles.tlItem}>
          <div className={styles.tlDate}>{fmtDateTime(r.measured_at)}</div>
          <div className={styles.tlContent}>
            {r.stem_mm != null && <span className={styles.tlTag}>줄기 {Number(r.stem_mm).toFixed(1)}mm</span>}
            {r.soil_ph != null && <span className={styles.tlTag}>pH {r.soil_ph}</span>}
            {r.soil_moisture != null && <span className={styles.tlTag}>수분 {r.soil_moisture}%</span>}
            {r.soil_temp != null && <span className={styles.tlTag}>지온 {r.soil_temp}℃</span>}
            {r.air_temp != null && <span className={styles.tlTag}>기온 {r.air_temp}℃</span>}
            {r.memo && <div className={styles.tlMemo}>{r.memo}</div>}
          </div>
        </li>
      ))}
    </ul>
  )
}

/* ── 공통 ── */
function Header({ onBack, title }) {
  return (
    <header className={styles.header}>
      {onBack && <button className={styles.backBtn} onClick={onBack}>← 뒤로</button>}
      <span className={styles.title}>{title}</span>
      <span style={{ width: 60 }} />
    </header>
  )
}

function fmtDate(s) {
  const d = new Date(s)
  if (isNaN(d.getTime())) return ''
  return `${d.getMonth() + 1}/${d.getDate()}`
}
function fmtDateTime(s) {
  const d = new Date(s)
  if (isNaN(d.getTime())) return ''
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`
}
function today() {
  const d = new Date()
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`
}
