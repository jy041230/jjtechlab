import { useEffect, useMemo, useState } from 'react'
import { clearResearchDatabase, makeResearchDatabaseCsv } from '../utils/db'
import styles from './ResearchScreen.module.css'

const ALL = '전체'
const TREE_GROUP_OPTIONS = ['케이싱 1년', '케이싱 2년', '직수수목(대조수목)']
export default function ResearchScreen({ onBack }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [sourceInfo, setSourceInfo] = useState('')
  const [filters, setFilters] = useState({
    participantId: ALL,
    treeGroup: ALL,
    treeId: ALL,
    eventNote: ALL,
    startDate: '',
    endDate: '',
  })

  useEffect(() => {
    loadRows()
  }, [])

  async function loadRows() {
    setLoading(true)
    setMessage('')
    try {
      const pcData = await loadPcExportRows()
      const appData = await makeResearchDatabaseCsv()
      const mergedRows = normalizeResearchRows([...pcData.rows, ...appData.rows])
      setRows(mergedRows)
      setSourceInfo(
        `PC 저장자료 ${pcData.files.length}개 파일, ${pcData.rows.length}건 · ` +
        `앱 임시자료 ${appData.rows.length}건 · 통합 ${mergedRows.length}건`
      )
    } catch (err) {
      console.error('[연구 앱 로드 실패]', err)
      setMessage('연구 데이터를 불러오지 못했습니다.')
    } finally {
      setLoading(false)
    }
  }

  const options = useMemo(() => ({
    participantIds: unique(rows.map(r => r.참여자ID || '미지정')),
    treeIds: unique(rows
      .filter(r => filters.treeGroup === ALL || r.수목구분 === filters.treeGroup)
      .map(r => r.수목ID || '미지정')),
    eventNotes: unique(rows.map(r => r.비고 || r.사건유형 || '미지정')),
  }), [rows, filters.treeGroup])

  const filteredRows = useMemo(() => rows.filter(row => {
    const rowDate = String(row.날짜 || '')
    if (filters.participantId !== ALL && (row.참여자ID || '미지정') !== filters.participantId) return false
    if (filters.treeGroup !== ALL && normalizeTreeGroup(row.수목구분) !== filters.treeGroup) return false
    if (filters.treeId !== ALL && (row.수목ID || '미지정') !== filters.treeId) return false
    if (filters.eventNote !== ALL && (row.비고 || row.사건유형 || '미지정') !== filters.eventNote) return false
    if (filters.startDate && rowDate < filters.startDate) return false
    if (filters.endDate && rowDate > filters.endDate) return false
    return true
  }), [rows, filters])

  const summary = useMemo(() => {
    const participants = new Set(filteredRows.map(r => r.참여자ID).filter(Boolean))
    const trees = new Set(filteredRows.map(r => r.수목ID).filter(Boolean))
    const voiceCount = filteredRows.filter(r => String(r.음성전사 || '').trim()).length
    const imageCount = filteredRows.filter(r => r.이미지여부 === 'Y').length
    return {
      total: filteredRows.length,
      participants: participants.size,
      trees: trees.size,
      voiceCount,
      imageCount,
    }
  }, [filteredRows])

  const participantSummary = useMemo(
    () => summarize(filteredRows, row => row.참여자ID || '미지정'),
    [filteredRows],
  )

  const treeSummary = useMemo(
    () => summarize(filteredRows, row => normalizeTreeGroup(row.수목구분)),
    [filteredRows],
  )

  const diameterSeries = useMemo(
    () => makeDiameterSeries(filteredRows),
    [filteredRows],
  )

  const errorSeries = useMemo(
    () => makeCameraCaliperComparisonSeries(filteredRows),
    [filteredRows],
  )

  const growthTemperatureComparison = useMemo(
    () => makeGrowthTemperatureComparison(filteredRows),
    [filteredRows],
  )

  const showDataList = filters.treeGroup !== ALL || filters.treeId !== ALL || filters.participantId !== ALL || filters.eventNote !== ALL

  function updateFilter(key, value) {
    setFilters(prev => ({
      ...prev,
      [key]: value,
      ...(key === 'treeGroup' ? { treeId: ALL } : {}),
    }))
  }

  function resetFilters() {
    setFilters({ participantId: ALL, treeGroup: ALL, treeId: ALL, eventNote: ALL, startDate: '', endDate: '' })
  }

  async function saveAppDataBackupToPc() {
    const data = await makeResearchDatabaseCsv()
    if (!data.rows.length) {
      alert('백업할 앱 안 자료가 없습니다.')
      return null
    }

    const res = await fetch('/api/research-db-export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csv: data.csv }),
    })
    const result = await res.json()
    if (!res.ok || !result.ok) throw new Error(result.error || 'PC 저장 실패')
    return { ...result, count: data.rows.length }
  }

  async function handleBackupAppData() {
    try {
      const result = await saveAppDataBackupToPc()
      if (!result) return
      alert(`앱 안 자료 ${result.count}건을 PC에 백업했습니다.\n${result.filePath}`)
      await loadRows()
    } catch (err) {
      console.error('[앱 자료 백업 실패]', err)
      alert('백업에 실패했습니다. 앱 서버와 ngrok 연결을 확인한 뒤 다시 시도해 주세요.')
    }
  }

  async function handleBackupAndClearAppData() {
    const ok = window.confirm(
      '앱 안의 임시 측정자료를 PC에 백업한 뒤 초기화할까요?\n\n' +
      'PC에 이미 저장된 전체 연구자료는 지우지 않습니다.'
    )
    if (!ok) return

    try {
      const result = await saveAppDataBackupToPc()
      if (!result) return
      await clearResearchDatabase()
      alert(`PC 백업 후 앱 안 자료 ${result.count}건을 초기화했습니다.\n${result.filePath}`)
      await loadRows()
    } catch (err) {
      console.error('[백업 후 초기화 실패]', err)
      alert('백업 또는 초기화에 실패했습니다. 자료 보호를 위해 완료되지 않은 단계는 중단했습니다.')
    }
  }

  async function handleClearAppDataOnly() {
    const first = window.confirm(
      '앱 안의 임시 측정자료만 초기화할까요?\n\n' +
      'PC에 저장된 전체 연구자료는 지우지 않습니다.'
    )
    if (!first) return
    const second = window.confirm('백업 없이 앱 안 자료를 비웁니다. 정말 초기화할까요?')
    if (!second) return

    try {
      await clearResearchDatabase()
      alert('앱 안의 임시 측정자료를 초기화했습니다.')
      await loadRows()
    } catch (err) {
      console.error('[앱 자료 초기화 실패]', err)
      alert('초기화에 실패했습니다. 다시 시도해 주세요.')
    }
  }

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <button className={styles.backBtn} onClick={onBack}>&larr; 뒤로</button>
        <div>
          <h1>연구 앱</h1>
          <p>PC 저장자료 기준 변화량 확인</p>
        </div>
        <button className={styles.refreshBtn} onClick={loadRows}>새로고침</button>
      </header>

      {loading ? (
        <main className={styles.emptyBox}>연구 데이터를 불러오는 중입니다.</main>
      ) : (
        <main className={styles.content}>
          {sourceInfo && <p className={styles.sourceInfo}>{sourceInfo}</p>}

          <section className={styles.backupPanel}>
            <div>
              <strong>측정 시작 전 자료 관리</strong>
              <p>PC 저장자료는 보존하고, 현재 앱 안에 쌓인 임시 측정자료만 백업하거나 초기화합니다.</p>
            </div>
            <div className={styles.backupActions}>
              <button className={styles.secondaryActionBtn} onClick={handleBackupAppData}>
                앱자료 백업
              </button>
              <button className={styles.primaryActionBtn} onClick={handleBackupAndClearAppData}>
                백업 후 초기화
              </button>
              <button className={styles.dangerActionBtn} onClick={handleClearAppDataOnly}>
                초기화만
              </button>
            </div>
          </section>

          <section className={styles.summaryGrid}>
            <SummaryCard label="사건 단위" value={summary.total} />
            <SummaryCard label="참여자" value={summary.participants} />
            <SummaryCard label="수목" value={summary.trees} />
            <SummaryCard label="음성기록" value={summary.voiceCount} />
            <SummaryCard label="이미지" value={summary.imageCount} />
          </section>

          <section className={styles.filterPanel}>
            <div className={styles.filterHeader}>
              <strong>자료 걸러보기</strong>
              <button onClick={resetFilters}>전체 보기</button>
            </div>
            <div className={styles.filterGrid}>
              <SelectBox label="참여자ID" value={filters.participantId} options={options.participantIds} onChange={v => updateFilter('participantId', v)} />
              <SelectBox label="수목구분" value={filters.treeGroup} options={TREE_GROUP_OPTIONS} onChange={v => updateFilter('treeGroup', v)} />
              <SelectBox label="수목ID" value={filters.treeId} options={options.treeIds} onChange={v => updateFilter('treeId', v)} />
              <SelectBox label="자료유형" value={filters.eventNote} options={options.eventNotes} onChange={v => updateFilter('eventNote', v)} />
              <DateInput label="시작일" value={filters.startDate} onChange={v => updateFilter('startDate', v)} />
              <DateInput label="종료일" value={filters.endDate} onChange={v => updateFilter('endDate', v)} />
            </div>
          </section>

          {message && <p className={styles.message}>{message}</p>}

          <section className={styles.twoColumns}>
            <SummaryTable title="참여자별 자료 수" rows={participantSummary} />
            <SummaryTable title="수목구분별 자료 수" rows={treeSummary} />
          </section>

          <DiameterChart
            title="날짜별 수목 크기 변화"
            rows={diameterSeries}
            sourceRows={filteredRows}
            activeGroup={filters.treeGroup}
          />

          <ErrorRateChart rows={errorSeries} />

          <GrowthTemperatureChart data={growthTemperatureComparison} />

          {showDataList && (
            <section className={styles.listPanel}>
              <div className={styles.listHeader}>
                <strong>최근 자료</strong>
                <span>{filteredRows.length}건</span>
              </div>
              {filteredRows.length ? (
                <div className={styles.rowList}>
                  {filteredRows.slice().reverse().slice(0, 40).map(row => (
                    <article className={styles.dataRow} key={row.event_id}>
                      <div className={styles.rowTop}>
                        <strong>{row.참여자ID || '미지정'} · {row.수목구분 || '수목구분 없음'}</strong>
                        <span>{row.날짜} {row.시간}</span>
                      </div>
                      <div className={styles.rowMeta}>
                        <span>{row.비고 || row.사건유형}</span>
                        <span>{row.수목ID}</span>
                        <span>{row.이미지여부 === 'Y' ? '이미지 있음' : '이미지 없음'}</span>
                      </div>
                      <p className={styles.rowMeasurements}>{makeRowText(row)}</p>
                      {row.음성전사 && <p className={styles.voiceText}>{row.음성전사}</p>}
                    </article>
                  ))}
                </div>
              ) : (
                <div className={styles.emptyBox}>조건에 맞는 자료가 없습니다.</div>
              )}
            </section>
          )}
        </main>
      )}
    </div>
  )
}

function SummaryCard({ label, value }) {
  return (
    <div className={styles.summaryCard}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function SelectBox({ label, value, options, onChange }) {
  return (
    <label className={styles.selectBox}>
      {label}
      <select value={value} onChange={e => onChange(e.target.value)}>
        <option>{ALL}</option>
        {options.map(option => <option key={option}>{option}</option>)}
      </select>
    </label>
  )
}

function DateInput({ label, value, onChange }) {
  return (
    <label className={styles.selectBox}>
      {label}
      <input
        type="date"
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    </label>
  )
}

async function loadPcExportRows() {
  const res = await fetch('/api/research-db-export')
  if (!res.ok) throw new Error('PC 저장자료를 읽지 못했습니다.')
  const data = await res.json()
  if (!data.ok) throw new Error(data.error || 'PC 저장자료를 읽지 못했습니다.')
  return {
    files: data.files ?? [],
    rows: dedupeRows(data.rows ?? []),
  }
}

function normalizeResearchRows(rows) {
  return dedupeRows((rows ?? []).map(normalizeResearchRow))
}

function normalizeResearchRow(row) {
  const treeGroup = normalizeTreeGroup(row.수목구분)
  return {
    ...row,
    수목구분: treeGroup,
    수목ID: normalizeTreeId(row.수목ID, treeGroup),
  }
}

function dedupeRows(rows) {
  const map = new Map()
  rows.forEach((row, index) => {
    const key = row.event_id || `${row.날짜시간 || ''}-${row.참여자ID || ''}-${row.수목ID || ''}-${row.비고 || ''}-${index}`
    map.set(key, row)
  })
  return [...map.values()].sort((a, b) => String(a.날짜시간 || '').localeCompare(String(b.날짜시간 || '')))
}

function SummaryTable({ title, rows }) {
  return (
    <section className={styles.tablePanel}>
      <h2>{title}</h2>
      {rows.length ? rows.map(row => (
        <div className={styles.summaryRow} key={row.key}>
          <span>{row.key}</span>
          <strong>{row.count}건</strong>
        </div>
      )) : <p className={styles.tableEmpty}>자료 없음</p>}
    </section>
  )
}

function DiameterChart({ title, rows, sourceRows, activeGroup }) {
  if (activeGroup === ALL) {
    return <TreeIdGroupChart title={title} rows={makeTreeGroupByIdSeries(sourceRows ?? rows)} />
  }

  const width = 640
  const height = 260
  const pad = { left: 44, right: 18, top: 18, bottom: 44 }
  const plotW = width - pad.left - pad.right
  const plotH = height - pad.top - pad.bottom
  const values = rows.map(r => r.value).filter(v => Number.isFinite(v))
  const treeCount = new Set(rows.map(r => r.treeId).filter(Boolean)).size
  const minRaw = values.length ? Math.min(...values) : 0
  const maxRaw = values.length ? Math.max(...values) : 1
  const span = Math.max(1, maxRaw - minRaw)
  const min = Math.max(0, minRaw - span * 0.15)
  const max = maxRaw + span * 0.15
  const point = (row, index) => {
    const x = pad.left + (rows.length <= 1 ? plotW / 2 : (plotW * index) / (rows.length - 1))
    const y = pad.top + plotH - ((row.value - min) / (max - min || 1)) * plotH
    return { x, y }
  }
  const polyline = rows.map((row, i) => {
    const p = point(row, i)
    return `${p.x},${p.y}`
  }).join(' ')
  const showLine = rows.length > 1 && treeCount <= 1
  const first = rows[0]
  const last = rows[rows.length - 1]
  const delta = first && last ? last.value - first.value : 0
  const deltaRate = first?.value ? (delta / first.value) * 100 : 0

  return (
    <section className={styles.chartPanel}>
      <div className={styles.chartHeader}>
        <h2>{title}</h2>
        <span>{activeGroup === ALL ? '전체 수목구분' : activeGroup} · {rows.length}건</span>
      </div>
      {rows.length ? (
        <>
          <div className={styles.deltaBox}>
            <div>
              <span>시작</span>
              <strong>{first.value.toFixed(1)} mm</strong>
            </div>
            <div>
              <span>마지막</span>
              <strong>{last.value.toFixed(1)} mm</strong>
            </div>
            <div className={delta >= 0 ? styles.deltaUp : styles.deltaDown}>
              <span>변화량</span>
              <strong>{delta >= 0 ? '+' : ''}{delta.toFixed(1)} mm</strong>
              <em>{delta >= 0 ? '+' : ''}{deltaRate.toFixed(1)}%</em>
            </div>
          </div>
          <div className={styles.chartWrap}>
            <svg viewBox={`0 0 ${width} ${height}`} className={styles.chartSvg} role="img" aria-label="날짜별 줄기직경 변화 그래프">
              <line x1={pad.left} y1={pad.top} x2={pad.left} y2={height - pad.bottom} className={styles.axisLine} />
              <line x1={pad.left} y1={height - pad.bottom} x2={width - pad.right} y2={height - pad.bottom} className={styles.axisLine} />
              <text x={8} y={pad.top + 8} className={styles.axisText}>{max.toFixed(1)}mm</text>
              <text x={8} y={height - pad.bottom} className={styles.axisText}>{min.toFixed(1)}mm</text>
              {showLine && <polyline points={polyline} fill="none" className={styles.chartLine} />}
              {rows.map((row, i) => {
                const p = point(row, i)
                return (
                  <g key={`${row.date}-${row.treeId}-${i}`}>
                    <circle cx={p.x} cy={p.y} r="6" className={styles.chartPoint} />
                    <text x={p.x} y={p.y - 11} textAnchor="middle" className={styles.pointLabel}>{row.value.toFixed(1)}</text>
                    <text x={p.x} y={height - 16} textAnchor="middle" className={styles.dateLabel}>{shortTreeId(row.treeId) || shortDate(row.date)}</text>
                  </g>
                )
              })}
            </svg>
          </div>
          <div className={styles.chartTable}>
            {rows.map(row => (
              <div key={`${row.date}-${row.treeId}-${row.value}`} className={styles.chartTableRow}>
                <span>{row.date} · {row.treeId || '수목ID 없음'}</span>
                <strong>{row.value.toFixed(1)} mm</strong>
                <em>{row.source}</em>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className={styles.emptyChart}>
          날짜별 줄기직경 자료가 아직 없습니다.
        </div>
      )}
    </section>
  )
}

function TreeIdGroupChart({ title, rows }) {
  const counts = TREE_GROUP_OPTIONS.map(group => rows.series[group] ?? [])
    .flat()
    .reduce((sum, item) => sum + (item.count || 0), 0)

  return (
    <section className={styles.chartPanel}>
      <div className={styles.chartHeader}>
        <h2>{title}</h2>
        <span>전체 참여자 · 날짜별 평균 · 캘리퍼스 우선</span>
      </div>
      {counts ? (
        <>
          <div className={styles.legendRow}>
            {TREE_GROUP_OPTIONS.map(group => (
              <span key={group}>
                <i style={{ background: groupColor(group) }} />
                {shortGroupLabel(group)}
              </span>
            ))}
          </div>
          <TreeIdLineChart data={rows} />
          <div className={styles.groupSummaryGrid}>
            {TREE_GROUP_OPTIONS.map(group => {
              const values = rows.series[group] ?? []
              const measured = values.filter(item => Number.isFinite(item.value))
              const avg = measured.length
                ? measured.reduce((sum, item) => sum + item.value, 0) / measured.length
                : null
              return (
                <div key={group} className={styles.groupSummaryCard}>
                  <span>{shortGroupLabel(group)}</span>
                  <strong>{avg === null ? '-' : `${avg.toFixed(1)} mm`}</strong>
                  <em>{measured.length ? `${measured.length}개 수목 표시` : '자료 없음'}</em>
                </div>
              )
            })}
          </div>
        </>
      ) : (
        <div className={styles.emptyChart}>
          수목ID별로 비교할 직경 자료가 아직 없습니다.
        </div>
      )}
    </section>
  )
}

function ErrorRateChart({ rows }) {
  const allRows = TREE_GROUP_OPTIONS.flatMap(group => rows.series[group] ?? [])
  const measuredRows = allRows.filter(row => Number.isFinite(row.errorRate))
  const avg = measuredRows.length ? measuredRows.reduce((sum, row) => sum + row.errorRate, 0) / measuredRows.length : 0
  return (
    <section className={styles.chartPanel}>
      <div className={styles.chartHeader}>
        <h2>캘리퍼스 vs 카메라 계측 비교</h2>
        <span>{measuredRows.length ? `평균 오차율 ${avg.toFixed(1)}%` : '자료 없음'}</span>
      </div>
      {measuredRows.length ? (
        <>
          <div className={styles.legendRow}>
            <span><i style={{ background: '#2563eb' }} />카메라</span>
            <span><i style={{ background: '#d97706' }} />캘리퍼스</span>
          </div>
          <div className={styles.comparisonGrid}>
            {TREE_GROUP_OPTIONS.map(group => (
              <ComparisonChart key={group} title={shortGroupLabel(group)} rows={rows.series[group] ?? []} />
            ))}
          </div>
        </>
      ) : (
        <div className={styles.emptyChart}>
          카메라 줄기측정값과 캘리퍼스 기준값이 함께 저장된 자료가 아직 없습니다.
        </div>
      )}
    </section>
  )
}

function ComparisonChart({ title, rows }) {
  const width = 700
  const height = 280
  const pad = { left: 46, right: 18, top: 22, bottom: 74 }
  const plotW = width - pad.left - pad.right
  const plotH = height - pad.top - pad.bottom
  const values = rows.flatMap(row => [row.camera, row.caliper]).filter(Number.isFinite)
  const hasValues = values.length > 0
  const max = Math.max(1, ...values) * 1.12
  const groupW = rows.length ? plotW / rows.length : plotW
  const barW = Math.min(18, Math.max(7, groupW * 0.22))
  const y = value => pad.top + plotH - (value / max) * plotH

  return (
    <div className={styles.comparisonPanel}>
      <h3>{title}</h3>
      {hasValues ? (
        <svg viewBox={`0 0 ${width} ${height}`} className={styles.chartSvg} role="img" aria-label="캘리퍼스와 카메라 계측 비교 그래프">
          <line x1={pad.left} y1={pad.top} x2={pad.left} y2={height - pad.bottom} className={styles.axisLine} />
          <line x1={pad.left} y1={height - pad.bottom} x2={width - pad.right} y2={height - pad.bottom} className={styles.axisLine} />
          <text x={6} y={pad.top + 8} className={styles.axisText}>{max.toFixed(1)}mm</text>
          <text x={6} y={height - pad.bottom} className={styles.axisText}>0mm</text>
          {rows.map((row, index) => {
            const center = pad.left + groupW * index + groupW / 2
            const hasPair = Number.isFinite(row.camera) && Number.isFinite(row.caliper)
            const cameraY = hasPair ? y(row.camera) : height - pad.bottom
            const caliperY = hasPair ? y(row.caliper) : height - pad.bottom
            return (
              <g key={row.key}>
                {hasPair && (
                  <>
                    <rect x={center - barW - 2} y={cameraY} width={barW} height={height - pad.bottom - cameraY} rx="4" fill="#2563eb" />
                    <rect x={center + 2} y={caliperY} width={barW} height={height - pad.bottom - caliperY} rx="4" fill="#d97706" />
                    <text x={center} y={Math.min(cameraY, caliperY) - 9} textAnchor="middle" className={styles.pointLabel}>{row.errorRate.toFixed(1)}%</text>
                  </>
                )}
                <text x={center} y={height - 42} textAnchor="middle" className={styles.dateLabel}>{row.shortLabel}</text>
                <text x={center} y={height - 24} textAnchor="middle" className={styles.axisText}>{hasPair ? `${row.count}건` : '-'}</text>
              </g>
            )
          })}
        </svg>
      ) : (
        <div className={styles.emptyChart}>자료 없음</div>
      )}
    </div>
  )
}

function GrowthTemperatureChart({ data }) {
  const hasData = data.dates.length && (
    data.temperatures.some(item => Number.isFinite(item.value)) ||
    TREE_GROUP_OPTIONS.some(group => (data.growthSeries[group] ?? []).some(item => Number.isFinite(item.value)))
  )
  return (
    <section className={styles.chartPanel}>
      <div className={styles.chartHeader}>
        <h2>온도와 줄기 생장 비교</h2>
        <span>일자별 온도 · 수목구분별 변화</span>
      </div>
      {hasData ? (
        <>
          <div className={styles.legendRow}>
            <span><i style={{ background: '#f59e0b' }} />토양온도</span>
            {TREE_GROUP_OPTIONS.map(group => (
              <span key={group}>
                <i style={{ background: groupColor(group) }} />
                {shortGroupLabel(group)}
              </span>
            ))}
          </div>
          <GrowthTemperatureComboChart data={data} />
        </>
      ) : (
        <div className={styles.emptyChart}>
          비교할 온도 또는 줄기 생장 자료가 아직 없습니다.
        </div>
      )}
    </section>
  )
}

function MiniBarChart({ rows, unit, maxHint }) {
  const width = 640
  const height = 220
  const pad = { left: 36, right: 16, top: 18, bottom: 42 }
  const plotW = width - pad.left - pad.right
  const plotH = height - pad.top - pad.bottom
  const max = Math.max(1, maxHint)
  const barW = rows.length ? Math.max(18, plotW / rows.length - 12) : 18

  return (
    <div className={styles.chartWrap}>
      <svg viewBox={`0 0 ${width} ${height}`} className={styles.chartSvg} role="img" aria-label="오차율 막대그래프">
        <line x1={pad.left} y1={pad.top} x2={pad.left} y2={height - pad.bottom} className={styles.axisLine} />
        <line x1={pad.left} y1={height - pad.bottom} x2={width - pad.right} y2={height - pad.bottom} className={styles.axisLine} />
        <text x={4} y={pad.top + 10} className={styles.axisText}>{max.toFixed(1)}{unit}</text>
        {rows.map((row, index) => {
          const x = pad.left + (plotW * index) / rows.length + 6
          const h = (row.value / max) * plotH
          const y = height - pad.bottom - h
          return (
            <g key={row.date}>
              <rect x={x} y={y} width={barW} height={h} rx="6" className={styles.errorBar} />
              <text x={x + barW / 2} y={y - 7} textAnchor="middle" className={styles.pointLabel}>{row.value.toFixed(1)}</text>
              <text x={x + barW / 2} y={height - 16} textAnchor="middle" className={styles.dateLabel}>{shortDate(row.date)}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function TreeIdLineChart({ data }) {
  const width = 700
  const height = 300
  const pad = { left: 46, right: 18, top: 22, bottom: 48 }
  const plotW = width - pad.left - pad.right
  const plotH = height - pad.top - pad.bottom
  const allValues = TREE_GROUP_OPTIONS.flatMap(group => (data.series[group] ?? []).map(v => v.value).filter(Number.isFinite))
  const minRaw = allValues.length ? Math.min(...allValues) : 0
  const maxRaw = allValues.length ? Math.max(...allValues) : 1
  const span = Math.max(1, maxRaw - minRaw)
  const min = Math.max(0, minRaw - span * 0.15)
  const max = maxRaw + span * 0.15
  const point = (item, index) => {
    const x = pad.left + (data.treeIds.length <= 1 ? plotW / 2 : (plotW * index) / (data.treeIds.length - 1))
    const y = pad.top + plotH - ((item.value - min) / (max - min || 1)) * plotH
    return { x, y }
  }

  return (
    <div className={styles.chartWrap}>
      <svg viewBox={`0 0 ${width} ${height}`} className={styles.chartSvg} role="img" aria-label="수목ID별 수목구분 비교 선그래프">
        <line x1={pad.left} y1={pad.top} x2={pad.left} y2={height - pad.bottom} className={styles.axisLine} />
        <line x1={pad.left} y1={height - pad.bottom} x2={width - pad.right} y2={height - pad.bottom} className={styles.axisLine} />
        <text x={6} y={pad.top + 8} className={styles.axisText}>{max.toFixed(1)}mm</text>
        <text x={6} y={height - pad.bottom} className={styles.axisText}>{min.toFixed(1)}mm</text>
        {data.treeIds.map((treeId, index) => {
          const x = pad.left + (data.treeIds.length <= 1 ? plotW / 2 : (plotW * index) / (data.treeIds.length - 1))
          return <text key={treeId} x={x} y={height - 18} textAnchor="middle" className={styles.dateLabel}>{treeId}</text>
        })}
        {TREE_GROUP_OPTIONS.map(group => {
          const items = data.series[group] ?? []
          const points = items
            .map((item, index) => Number.isFinite(item.value) ? point(item, index) : null)
            .filter(Boolean)
          const polyline = points.map(p => `${p.x},${p.y}`).join(' ')
          return (
            <g key={group}>
              {points.length > 1 && (
                <polyline points={polyline} fill="none" stroke={groupColor(group)} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
              )}
              {items.map((item, index) => {
                if (!Number.isFinite(item.value)) return null
                const p = point(item, index)
                return (
                  <g key={`${group}-${item.treeId}`}>
                    <circle cx={p.x} cy={p.y} r="5" fill={groupColor(group)} stroke="#fff" strokeWidth="2" />
                    <text x={p.x} y={p.y - 10} textAnchor="middle" className={styles.pointLabel}>{item.value.toFixed(1)}</text>
                  </g>
                )
              })}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function MultiLineChart({ data }) {
  const width = 700
  const height = 280
  const pad = { left: 46, right: 18, top: 20, bottom: 44 }
  const plotW = width - pad.left - pad.right
  const plotH = height - pad.top - pad.bottom
  const allValues = TREE_GROUP_OPTIONS.flatMap(group => (data.series[group] ?? []).map(v => v.value).filter(Number.isFinite))
  const minRaw = allValues.length ? Math.min(...allValues) : 0
  const maxRaw = allValues.length ? Math.max(...allValues) : 1
  const span = Math.max(1, maxRaw - minRaw)
  const min = Math.max(0, minRaw - span * 0.15)
  const max = maxRaw + span * 0.15
  const point = (item, index) => {
    const x = pad.left + (data.dates.length <= 1 ? plotW / 2 : (plotW * index) / (data.dates.length - 1))
    const y = pad.top + plotH - ((item.value - min) / (max - min || 1)) * plotH
    return { x, y }
  }

  return (
    <div className={styles.chartWrap}>
      <svg viewBox={`0 0 ${width} ${height}`} className={styles.chartSvg} role="img" aria-label="케이싱 비교 선그래프">
        <line x1={pad.left} y1={pad.top} x2={pad.left} y2={height - pad.bottom} className={styles.axisLine} />
        <line x1={pad.left} y1={height - pad.bottom} x2={width - pad.right} y2={height - pad.bottom} className={styles.axisLine} />
        <text x={6} y={pad.top + 8} className={styles.axisText}>{max.toFixed(1)}mm</text>
        <text x={6} y={height - pad.bottom} className={styles.axisText}>{min.toFixed(1)}mm</text>
        {data.dates.map((date, index) => {
          const x = pad.left + (data.dates.length <= 1 ? plotW / 2 : (plotW * index) / (data.dates.length - 1))
          return <text key={date} x={x} y={height - 16} textAnchor="middle" className={styles.dateLabel}>{shortDate(date)}</text>
        })}
        {TREE_GROUP_OPTIONS.map(group => {
          const items = data.series[group] ?? []
          const points = items
            .map((item, index) => Number.isFinite(item.value) ? point(item, index) : null)
            .filter(Boolean)
          const polyline = points.map(p => `${p.x},${p.y}`).join(' ')
          return (
            <g key={group}>
              {points.length > 1 && (
                <polyline points={polyline} fill="none" stroke={groupColor(group)} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
              )}
              {items.map((item, index) => {
                if (!Number.isFinite(item.value)) return null
                const p = point(item, index)
                return (
                  <g key={`${group}-${item.date}`}>
                    <circle cx={p.x} cy={p.y} r="5" fill={groupColor(group)} stroke="#fff" strokeWidth="2" />
                    <text x={p.x} y={p.y - 10} textAnchor="middle" className={styles.pointLabel}>{item.value.toFixed(1)}</text>
                  </g>
                )
              })}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function GrowthTemperatureComboChart({ data }) {
  const width = 760
  const height = 320
  const pad = { left: 52, right: 54, top: 24, bottom: 48 }
  const plotW = width - pad.left - pad.right
  const plotH = height - pad.top - pad.bottom
  const temperatureValues = data.temperatures.map(item => item.value).filter(Number.isFinite)
  const growthValues = TREE_GROUP_OPTIONS.flatMap(group => (data.growthSeries[group] ?? []).map(v => v.value).filter(Number.isFinite))
  const tempMax = Math.max(1, ...temperatureValues) * 1.12
  const growthMinRaw = growthValues.length ? Math.min(...growthValues) : 0
  const growthMaxRaw = growthValues.length ? Math.max(...growthValues) : 1
  const growthSpan = Math.max(1, growthMaxRaw - growthMinRaw)
  const growthMin = Math.min(0, growthMinRaw - growthSpan * 0.15)
  const growthMax = growthMaxRaw + growthSpan * 0.15
  const xFor = index => pad.left + (data.dates.length <= 1 ? plotW / 2 : (plotW * index) / (data.dates.length - 1))
  const tempY = value => pad.top + plotH - (value / tempMax) * plotH
  const growthY = value => pad.top + plotH - ((value - growthMin) / (growthMax - growthMin || 1)) * plotH
  const growthPoint = (item, index) => {
    const x = pad.left + (data.dates.length <= 1 ? plotW / 2 : (plotW * index) / (data.dates.length - 1))
    const y = growthY(item.value)
    return { x, y }
  }

  return (
    <div className={styles.chartWrap}>
    <svg viewBox={`0 0 ${width} ${height}`} className={styles.chartSvg} role="img" aria-label="온도와 줄기 생장 비교 조합 그래프">
      <line x1={pad.left} y1={pad.top} x2={pad.left} y2={height - pad.bottom} className={styles.axisLine} />
      <line x1={pad.left} y1={height - pad.bottom} x2={width - pad.right} y2={height - pad.bottom} className={styles.axisLine} />
      <line x1={width - pad.right} y1={pad.top} x2={width - pad.right} y2={height - pad.bottom} className={styles.axisLine} />
      <text x={pad.left} y={14} className={styles.axisText}>줄기 변화량(mm)</text>
      <text x={width - pad.right - 72} y={14} className={styles.axisText}>토양온도(℃)</text>
      <text x={6} y={pad.top + 8} className={styles.axisText}>{growthMax.toFixed(1)}mm</text>
      <text x={6} y={height - pad.bottom} className={styles.axisText}>{growthMin.toFixed(1)}mm</text>
      <text x={width - 44} y={pad.top + 8} className={styles.axisText}>{tempMax.toFixed(1)}℃</text>
      <text x={width - 32} y={height - pad.bottom} className={styles.axisText}>0℃</text>
      {(() => {
        const tempPoints = data.temperatures
          .map((item, index) => Number.isFinite(item.value) ? { x: xFor(index), y: tempY(item.value), item } : null)
          .filter(Boolean)
        return (
          <g>
            {tempPoints.length > 1 && (
              <polyline
                points={tempPoints.map(p => `${p.x},${p.y}`).join(' ')}
                fill="none"
                stroke="#f59e0b"
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity="0.9"
              />
            )}
            {tempPoints.map(p => (
              <circle key={`temp-${p.item.date}`} cx={p.x} cy={p.y} r="5" fill="#f59e0b" stroke="#fff" strokeWidth="2" />
            ))}
          </g>
        )
      })()}
      {data.dates.map((date, index) => {
        const x = xFor(index)
        return <text key={date} x={x} y={height - 16} textAnchor="middle" className={styles.dateLabel}>{shortDate(date)}</text>
      })}
      {TREE_GROUP_OPTIONS.map(group => {
        const items = data.growthSeries[group] ?? []
        const points = items
          .map((item, index) => Number.isFinite(item.value) ? growthPoint(item, index) : null)
          .filter(Boolean)
        const polyline = points.map(p => `${p.x},${p.y}`).join(' ')
        return (
          <g key={group}>
            {points.length > 1 && (
              <polyline points={polyline} fill="none" stroke={groupColor(group)} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
            )}
            {items.map((item, index) => {
              if (!Number.isFinite(item.value)) return null
              const p = growthPoint(item, index)
              return (
                <g key={`${group}-${item.date}`}>
                  <circle cx={p.x} cy={p.y} r="5" fill={groupColor(group)} stroke="#fff" strokeWidth="2" />
                  <text x={p.x} y={p.y - 10} textAnchor="middle" className={styles.pointLabel}>{item.value.toFixed(1)}</text>
                </g>
              )
            })}
          </g>
        )
      })}
    </svg>
    </div>
  )
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'ko-KR'))
}

function normalizeTreeGroup(value) {
  const text = String(value || '').replace(/\s+/g, '')
  if (!text) return '미지정'
  if (text.includes('2년')) return '케이싱 2년'
  if (text.includes('1년')) return '케이싱 1년'
  if (text.includes('직수') || text.includes('대조')) return '직수수목(대조수목)'
  return value || '미지정'
}

function normalizeTreeId(value, treeGroup) {
  const group = normalizeTreeGroup(treeGroup)
  const raw = String(value || '').trim()
  if (!raw) return '미지정'

  const matches = [...raw.matchAll(/(\d{1,2})/g)]
  const lastMatch = matches[matches.length - 1]
  const number = lastMatch ? Math.min(10, Math.max(1, Number(lastMatch[1]))) : 1
  const serial = String(number).padStart(2, '0')

  if (group === '케이싱 2년') return `케이싱2년-${serial}`
  if (group === '직수수목(대조수목)') return `대조수목-${serial}`
  if (group === '케이싱 1년') return `케이싱1년-${serial}`

  return raw
}

function makeDiameterSeries(rows) {
  return rows
    .map(row => {
      const diameter = getDiameterValueWithSource(row)
      if (!diameter || !Number.isFinite(diameter.value) || diameter.value <= 0 || !row.날짜) return null
      return {
        date: row.날짜,
        treeId: row.수목ID || '',
        group: normalizeTreeGroup(row.수목구분),
        value: diameter.value,
        source: diameter.source,
      }
    })
    .filter(Boolean)
    .sort((a, b) => (
      a.date.localeCompare(b.date) ||
      String(a.treeId).localeCompare(String(b.treeId), 'ko-KR') ||
      a.value - b.value
    ))
}

function makeCameraCaliperComparisonSeries(rows) {
  const treeIds = Array.from({ length: 10 }, (_, index) => String(index + 1).padStart(2, '0'))
  const buckets = new Map()
  for (const row of rows) {
    const group = normalizeTreeGroup(row.수목구분 || row.group)
    const normalizedTreeId = normalizeTreeId(row.수목ID || row.treeId, group)
    const treeId = shortTreeId(normalizedTreeId)
    if (!TREE_GROUP_OPTIONS.includes(group) || !treeIds.includes(treeId)) continue
    const key = `${group}__${treeId}`
    const item = buckets.get(key) ?? {
      key,
      group,
      treeId,
      cameraSum: 0,
      cameraCount: 0,
      caliperSum: 0,
      caliperCount: 0,
    }

    const camera = Number(row.줄기직경mm)
    if (Number.isFinite(camera) && camera > 0) {
      item.cameraSum += camera
      item.cameraCount += 1
    }

    const sameEventCaliper = Number(row.캘리퍼스줄기직경mm)
    const separateCaliper = Number(row.캘리퍼스직경mm)
    const caliper = Number.isFinite(sameEventCaliper) && sameEventCaliper > 0 ? sameEventCaliper : separateCaliper
    if (Number.isFinite(caliper) && caliper > 0) {
      item.caliperSum += caliper
      item.caliperCount += 1
    }

    buckets.set(key, item)
  }

  const series = {}
  TREE_GROUP_OPTIONS.forEach(group => {
    series[group] = treeIds.map(treeId => {
      const item = buckets.get(`${group}__${treeId}`)
      if (!item?.cameraCount || !item?.caliperCount) {
        return { key: `${group}__${treeId}`, group, treeId, shortLabel: treeId, camera: null, caliper: null, errorRate: null, count: 0 }
      }
      const camera = item.cameraSum / item.cameraCount
      const caliper = item.caliperSum / item.caliperCount
      return {
        ...item,
        camera,
        caliper,
        errorMm: Math.abs(camera - caliper),
        errorRate: Math.abs(camera - caliper) / caliper * 100,
        shortLabel: treeId,
        count: item.cameraCount + item.caliperCount,
      }
    })
  })

  return { treeIds, series }
}

function makeCaliperAverageMap(rows) {
  const buckets = new Map()
  for (const row of rows) {
    const value = Number(row.캘리퍼스직경mm)
    if (!Number.isFinite(value) || value <= 0 || !row.날짜) continue
    const key = treeDateKey(row)
    if (!key) continue
    const item = buckets.get(key) ?? { sum: 0, count: 0 }
    item.sum += value
    item.count += 1
    buckets.set(key, item)
  }

  return new Map([...buckets.entries()].map(([key, item]) => [key, item.sum / item.count]))
}

function makeGrowthTemperatureComparison(rows) {
  const dateSet = new Set()
  const temperatureByDate = new Map()
  const diameterByGroupDate = {}
  TREE_GROUP_OPTIONS.forEach(group => { diameterByGroupDate[group] = new Map() })

  for (const row of rows) {
    const date = row.날짜
    if (!date) continue

    const temperature = Number(row.토양온도)
    if (Number.isFinite(temperature)) {
      dateSet.add(date)
      const item = temperatureByDate.get(date) ?? { sum: 0, count: 0 }
      item.sum += temperature
      item.count += 1
      temperatureByDate.set(date, item)
    }

    const group = normalizeTreeGroup(row.수목구분)
    const diameter = getCaliperPreferredDiameterValue(row)
    if (TREE_GROUP_OPTIONS.includes(group) && Number.isFinite(diameter) && diameter > 0) {
      dateSet.add(date)
      const item = diameterByGroupDate[group].get(date) ?? { sum: 0, count: 0 }
      item.sum += diameter
      item.count += 1
      diameterByGroupDate[group].set(date, item)
    }
  }

  const dates = [...dateSet].sort((a, b) => a.localeCompare(b))
  const temperatures = dates.map(date => {
    const item = temperatureByDate.get(date)
    return { date, value: item ? item.sum / item.count : null, count: item?.count ?? 0 }
  })

  const averageByGroup = {}
  TREE_GROUP_OPTIONS.forEach(group => {
    const values = [...diameterByGroupDate[group].values()]
      .map(item => item.sum / item.count)
      .filter(Number.isFinite)
    averageByGroup[group] = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
  })

  const growthSeries = {}
  TREE_GROUP_OPTIONS.forEach(group => {
    growthSeries[group] = dates.map(date => {
      const item = diameterByGroupDate[group].get(date)
      const diameter = item ? item.sum / item.count : null
      const base = averageByGroup[group]
      return {
        date,
        value: Number.isFinite(diameter) && Number.isFinite(base) ? diameter - base : null,
        diameter,
        count: item?.count ?? 0,
      }
    })
  })

  return { dates, temperatures, growthSeries }
}

function makeTreeGroupByIdSeries(rows) {
  const treeIds = Array.from({ length: 10 }, (_, index) => String(index + 1).padStart(2, '0'))
  const dailyBuckets = {}
  TREE_GROUP_OPTIONS.forEach(group => { dailyBuckets[group] = new Map() })

  for (const row of rows) {
    const group = normalizeTreeGroup(row.group || row.수목구분)
    const treeId = shortTreeId(row.treeId || row.수목ID)
    const date = row.date || row.날짜 || '전체'
    const value = getCaliperPreferredDiameterValue(row)
    if (!TREE_GROUP_OPTIONS.includes(group) || !treeIds.includes(treeId) || !Number.isFinite(value) || value <= 0) continue
    const key = `${treeId}__${date}`
    const item = dailyBuckets[group].get(key) ?? { treeId, date, sum: 0, count: 0 }
    item.sum += value
    item.count += 1
    dailyBuckets[group].set(key, item)
  }

  const series = {}
  TREE_GROUP_OPTIONS.forEach(group => {
    const treeBuckets = new Map()
    for (const item of dailyBuckets[group].values()) {
      const dailyAverage = item.sum / item.count
      const treeItem = treeBuckets.get(item.treeId) ?? { sum: 0, dayCount: 0, count: 0 }
      treeItem.sum += dailyAverage
      treeItem.dayCount += 1
      treeItem.count += item.count
      treeBuckets.set(item.treeId, treeItem)
    }

    series[group] = treeIds.map(treeId => {
      const item = treeBuckets.get(treeId)
      return {
        treeId,
        value: item ? item.sum / item.dayCount : null,
        count: item?.count ?? 0,
        dayCount: item?.dayCount ?? 0,
      }
    })
  })

  return { treeIds, series }
}

function getCaliperPreferredDiameterValue(row) {
  const candidates = [
    row.캘리퍼스직경mm,
    row.캘리퍼스줄기직경mm,
    row.캘리퍼스흉고직경mm,
    row.value,
    row.줄기직경mm,
    row.흉고직경mm,
  ]
  for (const candidate of candidates) {
    const value = Number(candidate)
    if (Number.isFinite(value) && value > 0) return value
  }
  return null
}

function getDiameterValue(row) {
  return getDiameterValueWithSource(row)?.value ?? null
}

function getDiameterValueWithSource(row) {
  const candidates = [
    { value: row.줄기직경mm, source: '카메라 줄기직경' },
    { value: row.캘리퍼스직경mm, source: '캘리퍼스 직경' },
    { value: row.흉고직경mm, source: '흉고직경' },
  ]
  for (const candidate of candidates) {
    const value = Number(candidate)
    const parsed = Number(candidate.value)
    if (Number.isFinite(parsed) && parsed > 0) return { value: parsed, source: candidate.source }
  }
  return null
}

function getErrorRateValue(row, caliperByTreeDate = new Map()) {
  const savedRate = Number(row.줄기직경오차율)
  if (Number.isFinite(savedRate) && savedRate >= 0) return savedRate

  const camera = Number(row.줄기직경mm)
  const sameEventCaliper = Number(row.캘리퍼스줄기직경mm)
  const separateCaliper = caliperByTreeDate.get(treeDateKey(row))
  const caliper = Number.isFinite(sameEventCaliper) && sameEventCaliper > 0
    ? sameEventCaliper
    : separateCaliper
  if (Number.isFinite(camera) && Number.isFinite(caliper) && caliper > 0) {
    return Math.abs(camera - caliper) / caliper * 100
  }
  return null
}

function treeDateKey(row) {
  const date = row.날짜 || row.date
  const group = normalizeTreeGroup(row.수목구분 || row.group)
  const treeId = normalizeTreeId(row.수목ID || row.treeId, group)
  if (!date || !treeId || treeId === '미지정') return ''
  return `${date}__${group}__${treeId}`
}

function groupColor(group) {
  if (group.includes('2년')) return '#d97706'
  if (group.includes('직수') || group.includes('대조')) return '#2563eb'
  return '#2d6a4f'
}

function shortGroupLabel(group) {
  if (group.includes('2년')) return '케이싱 2년'
  if (group.includes('직수') || group.includes('대조')) return '대조군'
  return '케이싱 1년'
}

function shortDate(date) {
  const parts = String(date || '').split('-')
  return parts.length === 3 ? `${Number(parts[1])}/${Number(parts[2])}` : date
}

function shortTreeId(treeId) {
  const match = String(treeId || '').match(/(\d{1,2})$/)
  return match ? match[1].padStart(2, '0') : treeId
}

function summarize(rows, keyFn) {
  const map = new Map()
  for (const row of rows) {
    const key = keyFn(row)
    map.set(key, (map.get(key) ?? 0) + 1)
  }
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key, 'ko-KR'))
}

function makeRowText(row) {
  const parts = [
    row.줄기직경mm && `줄기 ${row.줄기직경mm}mm`,
    row.캘리퍼스줄기직경mm && `캘리퍼스 ${row.캘리퍼스줄기직경mm}mm`,
    row.줄기직경오차mm && `줄기오차 ${row.줄기직경오차mm}mm(${row.줄기직경오차율}%)`,
    row.캘리퍼스직경mm && `캘리퍼스직경 ${row.캘리퍼스직경mm}mm`,
    row.흉고직경mm && `흉고 ${row.흉고직경mm}mm`,
    row.캘리퍼스흉고직경mm && `캘리퍼스흉고 ${row.캘리퍼스흉고직경mm}mm`,
    row.흉고직경오차mm && `흉고오차 ${row.흉고직경오차mm}mm(${row.흉고직경오차율}%)`,
    row.토양PH && `pH ${row.토양PH}`,
    row.토양수분 && `수분 ${row.토양수분}`,
    row.토양온도 && `온도 ${row.토양온도}`,
    row.EC && `EC ${row.EC}`,
    row.비옥도 && `비옥도 ${row.비옥도}`,
    row.일조 && `일조 ${row.일조}`,
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : (row.전체측정값 || '측정값 없음')
}
