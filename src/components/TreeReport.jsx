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
  const [query, setQuery] = useState('')
  const [groupFilter, setGroupFilter] = useState('전체')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

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
    // 날짜 기간으로 기록 거르기
    const inRange = records.filter(r => {
      const d = (r.measured_at || '').slice(0, 10)
      if (fromDate && d < fromDate) return false
      if (toDate && d > toDate) return false
      return true
    })
    const sortedTrees = [...trees].sort((a, b) => (a.tree_id || '').localeCompare(b.tree_id || ''))

    return (
      <div className={styles.screen}>
        <div className={styles.noPrint}>
          <Header onBack={() => setSelected(null)} title="수목 성장 리포트" />
          <div className={styles.controlBar}>
            <div className={styles.ctrlRow}>
              <label className={styles.ctrlLabel}>수목 선택</label>
              <select
                className={styles.ctrlSelect}
                value={selected}
                onChange={e => { setSelected(e.target.value); setFromDate(''); setToDate('') }}
              >
                {sortedTrees.map(t => (
                  <option key={t.tree_id} value={t.tree_id}>
                    {t.tree_id}{t.tree_group ? ` (${t.tree_group})` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.ctrlRow}>
              <label className={styles.ctrlLabel}>기간</label>
              <input type="date" className={styles.ctrlDate} value={fromDate} onChange={e => setFromDate(e.target.value)} />
              <span className={styles.ctrlTilde}>~</span>
              <input type="date" className={styles.ctrlDate} value={toDate} onChange={e => setToDate(e.target.value)} />
              {(fromDate || toDate) && (
                <button className={styles.ctrlReset} onClick={() => { setFromDate(''); setToDate('') }}>전체</button>
              )}
            </div>
          </div>
        </div>
        <div className={styles.report} id="report-area">
          <ReportBody tree={tree} records={inRange} />
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
  const groups = ['전체', ...Array.from(new Set(trees.map(t => t.tree_group).filter(Boolean)))]
  const filtered = trees.filter(t => {
    const okGroup = groupFilter === '전체' || t.tree_group === groupFilter
    const okQuery = !query.trim() || (t.tree_id || '').toLowerCase().includes(query.trim().toLowerCase())
    return okGroup && okQuery
  })

  return (
    <div className={styles.screen}>
      <Header onBack={onBack} title="수목 성장 리포트" />
      <div className={styles.body}>
        {error && <div className={styles.errorBox}>{error}</div>}

        <div className={styles.searchRow}>
          <input
            className={styles.searchInput}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="🔍 수목 번호 검색 (예: 케이싱1년-01)"
          />
        </div>

        {groups.length > 1 && (
          <div className={styles.filterRow}>
            {groups.map(g => (
              <button
                key={g}
                className={`${styles.filterBtn} ${groupFilter === g ? styles.filterBtnActive : ''}`}
                onClick={() => setGroupFilter(g)}
              >
                {g}
              </button>
            ))}
          </div>
        )}

        <p className={styles.galleryHint}>수목을 눌러 성장 이력을 확인하세요. ({filtered.length}그루)</p>
        <div className={styles.gallery}>
          {filtered.map(t => (
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
          {!filtered.length && !error && (
            <div className={styles.empty}>조건에 맞는 수목이 없습니다.</div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── 리포트 본문 (인쇄 영역) ── */
function ReportBody({ tree, records }) {
  // 같은 날짜끼리 묶어 평균으로 합치기 (줄이 여러 개로 흩어지지 않게)
  const daily = groupByDay(records)

  const stemSeries = daily
    .filter(d => d.stem_mm !== null)
    .map(d => ({ t: d.date, v: d.stem_mm }))

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
        <Info label="관찰 일수" value={`${daily.length}일`} />
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
        <Timeline days={daily} />
      </section>

      <section className={styles.block}>
        <h2 className={styles.blockTitle}>기상 정보</h2>
        <WeatherSummary days={daily} />
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
      <text x={PAD.l} y={H - 8} textAnchor="start" fontSize="10" fill="#88998d">{series[0].t}</text>
      <text x={W - PAD.r} y={H - 8} textAnchor="end" fontSize="10" fill="#88998d">{series[last].t}</text>
    </svg>
  )
}

/* ── 관리 이력 타임라인 (날짜별 1줄, 줄기 누르면 개별값 펼침) ── */
function Timeline({ days }) {
  const [openDate, setOpenDate] = useState(null)
  if (!days.length) return <div className={styles.empty}>해당 기간에 관리 이력이 없습니다.</div>
  return (
    <ul className={styles.timeline}>
      {days.map((d, i) => {
        const hasMany = d.stem_values && d.stem_values.length > 1
        const isOpen = openDate === d.date
        return (
          <li key={i} className={styles.tlItem}>
            <div className={styles.tlDate}>
              {d.date}
              {d.count > 1 && <span className={styles.tlCount}> · {d.count}회 측정</span>}
            </div>
            <div className={styles.tlContent}>
              {d.stem_mm != null && (
                <button
                  className={`${styles.tlTag} ${styles.tlTagBtn} ${isOpen ? styles.tlTagOpen : ''}`}
                  onClick={() => setOpenDate(isOpen ? null : d.date)}
                  disabled={!hasMany}
                >
                  줄기 {d.stem_mm.toFixed(1)}mm{hasMany ? (isOpen ? ' ▲' : ' ▼') : ''}
                </button>
              )}
              {d.soil_ph != null && <span className={styles.tlTag}>pH {d.soil_ph.toFixed(1)}</span>}
              {d.soil_moisture != null && <span className={styles.tlTag}>수분 {d.soil_moisture.toFixed(0)}%</span>}
              {d.soil_temp != null && <span className={styles.tlTag}>지온 {d.soil_temp.toFixed(1)}℃</span>}
              {d.air_temp != null && <span className={styles.tlTag}>기온 {d.air_temp.toFixed(1)}℃</span>}
              {d.humidity != null && <span className={styles.tlTag}>습도 {d.humidity.toFixed(0)}%</span>}
              {d.memo && <div className={styles.tlMemo}>{d.memo}</div>}
            </div>
            {isOpen && hasMany && (
              <div className={styles.stemDetail}>
                <div className={styles.stemDetailHead}>
                  이날 측정한 줄기직경 {d.stem_values.length}회
                  (최소 {d.stem_min.toFixed(1)} · 평균 {d.stem_mm.toFixed(1)} · 최대 {d.stem_max.toFixed(1)} mm)
                </div>
                <div className={styles.stemChips}>
                  {d.stem_values.map((v, k) => (
                    <span key={k} className={styles.stemChip}>{Number(v).toFixed(1)}</span>
                  ))}
                </div>
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/* ── 기상 요약 ── */
function WeatherSummary({ days }) {
  const temps = days.map(d => d.air_temp).filter(v => v != null)
  const hums = days.map(d => d.humidity).filter(v => v != null)
  if (!temps.length && !hums.length) {
    return <div className={styles.empty}>기록된 기상 정보가 없습니다. (측정 시 기온·습도가 함께 저장됩니다)</div>
  }
  const mean = arr => arr.reduce((s, x) => s + x, 0) / arr.length
  return (
    <div className={styles.weatherGrid}>
      {temps.length > 0 && (
        <div className={styles.weatherItem}>
          <div className={styles.weatherIcon}>🌡️</div>
          <div className={styles.weatherLabel}>평균 기온</div>
          <div className={styles.weatherValue}>{mean(temps).toFixed(1)}℃</div>
          <div className={styles.weatherRange}>{Math.min(...temps).toFixed(1)} ~ {Math.max(...temps).toFixed(1)}℃</div>
        </div>
      )}
      {hums.length > 0 && (
        <div className={styles.weatherItem}>
          <div className={styles.weatherIcon}>💧</div>
          <div className={styles.weatherLabel}>평균 습도</div>
          <div className={styles.weatherValue}>{mean(hums).toFixed(0)}%</div>
          <div className={styles.weatherRange}>{Math.min(...hums).toFixed(0)} ~ {Math.max(...hums).toFixed(0)}%</div>
        </div>
      )}
    </div>
  )
}

/* 같은 날짜 기록을 묶어 평균으로 합치는 헬퍼 */
function groupByDay(records) {
  const map = new Map()
  for (const r of records) {
    const d = new Date(r.measured_at)
    if (isNaN(d.getTime())) continue
    const key = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
    if (!map.has(key)) {
      map.set(key, {
        key,
        sortAt: d.getTime(),
        date: `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`,
        stem: [], ph: [], moist: [], stemp: [], atemp: [], hum: [],
        memos: [],
      })
    }
    const g = map.get(key)
    push(g.stem, r.stem_mm)
    push(g.ph, r.soil_ph)
    push(g.moist, r.soil_moisture)
    push(g.stemp, r.soil_temp)
    push(g.atemp, r.air_temp)
    push(g.hum, r.humidity)
    if (r.memo) g.memos.push(r.memo)
  }
  return [...map.values()]
    .sort((a, b) => a.sortAt - b.sortAt)
    .map(g => ({
      date: g.date,
      count: Math.max(g.stem.length, g.ph.length, g.moist.length, g.stemp.length, 1),
      stem_mm: avg(g.stem),
      stem_values: g.stem.slice(),
      stem_max: g.stem.length ? Math.max(...g.stem) : null,
      stem_min: g.stem.length ? Math.min(...g.stem) : null,
      soil_ph: avg(g.ph),
      soil_moisture: avg(g.moist),
      soil_temp: avg(g.stemp),
      air_temp: avg(g.atemp),
      humidity: avg(g.hum),
      memo: g.memos.join(' · ') || null,
    }))
}

function push(arr, v) {
  if (v === null || v === undefined || v === '') return
  const n = Number(v)
  if (!isNaN(n)) arr.push(n)
}
function avg(arr) {
  if (!arr.length) return null
  return arr.reduce((s, x) => s + x, 0) / arr.length
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

function today() {
  const d = new Date()
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`
}
