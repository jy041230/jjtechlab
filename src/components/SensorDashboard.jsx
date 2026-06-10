/**
 * SensorDashboard — ESP32 토양센서 모니터링 화면
 *
 * 스마트팜 관리 시스템(project-5870640)의 대시보드를
 * 홍매화 앱 구조(React JS + CSS Module, 의존성 추가 없음)에 맞게 이식.
 *
 * 구성:
 *   ┌ ← 뒤로  📡 토양센서 모니터링  [새로고침] ┐
 *   │ ⚠️ 측정 시각 안내 (오래된 값 경고)        │
 *   ├ 🌡️ 토양온도 카드 ─ 💧 토양수분 카드 ─ ⚡ EC 카드 ┤
 *   └ 최근 20건 추이 차트 (SVG 직접 그림)      ┘
 */
import { useState, useEffect, useCallback } from 'react'
import { fetchRecentSensors, formatAge, formatTime, isStale } from '../utils/sensorApi'
import styles from './SensorDashboard.module.css'

// 항목별 정상 범위 (스마트팜 대시보드 기준값 이식)
const METRICS = [
  {
    key: 'temperature', label: '토양온도', icon: '🌡️', unit: '℃',
    min: 15, max: 35, lowMsg: '낮음 (보온 필요)', highMsg: '높음 (차광 필요)',
  },
  {
    key: 'soilMoisture', label: '토양수분', icon: '💧', unit: '%',
    min: 30, max: 50, lowMsg: '건조 (급수 필요)', highMsg: '과습 (배수 확인)',
  },
  {
    key: 'ec', label: '전기전도도(EC)', icon: '⚡', unit: 'mS/cm',
    min: 0.5, max: 2.0, lowMsg: '양분 부족 (비료 필요)', highMsg: '양분 과다 (희석 필요)',
  },
]

export default function SensorDashboard({ onBack }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [chartKey, setChartKey] = useState('soilMoisture')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await fetchRecentSensors(20)
      setRows(data)
      if (!data.length) setError('아직 저장된 센서 데이터가 없습니다.')
    } catch (err) {
      console.error('[센서 조회 실패]', err)
      setError('센서 서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.')
    } finally {
      setLoading(false)
    }
  }, [])

  // 화면이 열려 있는 동안 60초마다 자동 새로고침
  useEffect(() => {
    load()
    const timer = setInterval(load, 60000)
    return () => clearInterval(timer)
  }, [load])

  const latest = rows[0] ?? null
  const stale = latest ? isStale(latest.createdAt) : false

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <button className={styles.backBtn} onClick={onBack}>← 뒤로</button>
        <span className={styles.title}>📡 토양센서 모니터링</span>
        <button className={styles.refreshBtn} onClick={load} disabled={loading}>
          {loading ? '⏳' : '🔄 새로고침'}
        </button>
      </header>

      <div className={styles.body}>
        {latest && (
          <div className={`${styles.timeBadge} ${stale ? styles.timeBadgeStale : ''}`}>
            {stale ? '⚠️ ' : '🟢 '}
            마지막 측정: {formatTime(latest.createdAt)} ({formatAge(latest.createdAt)})
            {stale && (
              <div className={styles.staleNote}>
                측정값이 오래되었습니다. 센서 전원이 꺼져 있을 수 있습니다.
              </div>
            )}
          </div>
        )}

        {error && <div className={styles.errorBox}>{error}</div>}

        <div className={styles.cards}>
          {METRICS.map(m => (
            <MetricCard key={m.key} metric={m} value={latest ? latest[m.key] : null} />
          ))}
        </div>

        {rows.length > 1 && (
          <div className={styles.chartWrap}>
            <div className={styles.chartTabs}>
              {METRICS.map(m => (
                <button
                  key={m.key}
                  className={`${styles.chartTab} ${chartKey === m.key ? styles.chartTabActive : ''}`}
                  onClick={() => setChartKey(m.key)}
                >
                  {m.icon} {m.label}
                </button>
              ))}
            </div>
            <TrendChart
              rows={rows}
              metric={METRICS.find(m => m.key === chartKey)}
            />
            <div className={styles.chartHint}>최근 {rows.length}건 추이 (오른쪽이 최신)</div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ── 최신값 카드 ────────────────────────────────────────────── */
function MetricCard({ metric, value }) {
  const hasVal = value !== null && value !== undefined
  let statusCls = styles.statusOk
  let statusMsg = '정상 범위'
  if (!hasVal) {
    statusCls = styles.statusNone
    statusMsg = '데이터 없음'
  } else if (value < metric.min) {
    statusCls = styles.statusWarn
    statusMsg = metric.lowMsg
  } else if (value > metric.max) {
    statusCls = styles.statusWarn
    statusMsg = metric.highMsg
  }

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <span className={styles.cardIcon}>{metric.icon}</span>
        <span className={styles.cardLabel}>{metric.label}</span>
      </div>
      <div className={styles.cardValue}>
        {hasVal ? value.toFixed(1) : '--'}
        <span className={styles.cardUnit}>{metric.unit}</span>
      </div>
      <div className={`${styles.cardStatus} ${statusCls}`}>{statusMsg}</div>
      <div className={styles.cardRange}>
        정상: {metric.min} ~ {metric.max} {metric.unit}
      </div>
    </div>
  )
}

/* ── 추이 차트 (SVG 직접 그림 — 라이브러리 불필요) ─────────────── */
function TrendChart({ rows, metric }) {
  const W = 340, H = 150, PAD = { l: 38, r: 10, t: 12, b: 22 }

  // 시간 순서(과거 → 최신)로 뒤집기
  const series = [...rows].reverse()
    .map(r => r[metric.key])
    .filter(v => v !== null && v !== undefined)

  if (series.length < 2) {
    return <div className={styles.chartEmpty}>차트를 그릴 데이터가 부족합니다.</div>
  }

  const dataMin = Math.min(...series)
  const dataMax = Math.max(...series)
  const span = dataMax - dataMin || 1
  const yMin = dataMin - span * 0.15
  const yMax = dataMax + span * 0.15

  const x = i => PAD.l + (i / (series.length - 1)) * (W - PAD.l - PAD.r)
  const y = v => PAD.t + (1 - (v - yMin) / (yMax - yMin)) * (H - PAD.t - PAD.b)

  const points = series.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const lastIdx = series.length - 1

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={styles.chartSvg} role="img"
      aria-label={`${metric.label} 추이 차트`}>
      {/* 눈금선 3개 + 값 라벨 */}
      {[0, 0.5, 1].map(t => {
        const v = yMin + (yMax - yMin) * t
        const yy = y(v)
        return (
          <g key={t}>
            <line x1={PAD.l} y1={yy} x2={W - PAD.r} y2={yy}
              stroke="#d5e2d8" strokeWidth="1" strokeDasharray="3 3" />
            <text x={PAD.l - 5} y={yy + 4} textAnchor="end"
              fontSize="10" fill="#43624f">{v.toFixed(1)}</text>
          </g>
        )
      })}
      {/* 추이선 */}
      <polyline points={points} fill="none" stroke="#2d6a4f" strokeWidth="2.5"
        strokeLinejoin="round" strokeLinecap="round" />
      {/* 최신 점 강조 */}
      <circle cx={x(lastIdx)} cy={y(series[lastIdx])} r="5" fill="#2d6a4f" />
      <text x={Math.min(x(lastIdx), W - PAD.r - 30)} y={y(series[lastIdx]) - 9}
        textAnchor="middle" fontSize="11" fontWeight="800" fill="#1b4332">
        {series[lastIdx].toFixed(1)}
      </text>
      <text x={W - PAD.r} y={H - 6} textAnchor="end" fontSize="10" fill="#43624f">최신 →</text>
    </svg>
  )
}
