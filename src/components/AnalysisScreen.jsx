import { useState, useEffect } from 'react'
import { fetchSheetData } from '../utils/sheetData'

export default function AnalysisScreen({ onBack }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('stem')

  useEffect(() => {
    fetchSheetData()
      .then(d => { setData(d); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])

  if (loading) return <div style={styles.center}>데이터 불러오는 중…</div>
  if (error) return <div style={styles.center}>오류: {error}</div>

  const stemRows = (data?.stem ?? []).filter(r => r.treeGroup && r.cameraMm)
  const soilRows = (data?.soil ?? []).filter(r => r.treeId)

  // 케이싱 조건별 줄기굵기 평균
  const groups = ['케이싱 1년', '케이싱 2년', '직수수목(대조수목)']
  const groupLabels = ['1년', '2년', '대조']
  const groupColors = ['#52b788', '#2d6a4f', '#b7b7a4']
  const groupStats = groups.map(g => {
    const rows = stemRows.filter(r => r.treeGroup === g && Number(r.cameraMm) > 0)
    if (!rows.length) return { avg: 0, count: 0 }
    const avg = rows.reduce((s, r) => s + Number(r.cameraMm), 0) / rows.length
    return { avg: parseFloat(avg.toFixed(2)), count: rows.length }
  })
  const maxAvg = Math.max(...groupStats.map(s => s.avg), 1)

  // 카메라 vs 캘리퍼스 오차율 평균
  const errorRows = stemRows.filter(r => Number(r.caliperMm) > 0 && Number(r.cameraMm) > 0)
  const avgErrorRate = errorRows.length
    ? (errorRows.reduce((s, r) => s + Math.abs(Number(r.cameraMm) - Number(r.caliperMm)) / Number(r.caliperMm) * 100, 0) / errorRows.length).toFixed(2)
    : '-'

  // 토양 조건별 pH 평균
  const soilGroups = groups.map((g, i) => {
    const prefix = g.includes('2년') ? '케이싱2년' : g.includes('1년') ? '케이싱1년' : '대조수목'
    const rows = soilRows.filter(r => r.treeId?.startsWith(prefix) && Number(r.ph) > 0)
    const avg = rows.length ? (rows.reduce((s, r) => s + Number(r.ph), 0) / rows.length).toFixed(2) : '-'
    return { label: groupLabels[i], avg, count: rows.length, color: groupColors[i] }
  })

  // 참여자별 측정 수
  const participantMap = {}
  stemRows.forEach(r => {
    if (!r.participantId) return
    participantMap[r.participantId] = (participantMap[r.participantId] || 0) + 1
  })
  const participants = Object.entries(participantMap).sort((a, b) => b[1] - a[1])
  const maxCount = Math.max(...participants.map(p => p[1]), 1)

  return (
    <div style={styles.screen}>
      <header style={styles.header}>
        <button onClick={onBack} style={styles.backBtn}>← 뒤로</button>
        <span style={styles.title}>데이터 분석</span>
        <div style={{ width: 60 }} />
      </header>

      <div style={styles.tabs}>
        {[['stem', '줄기굵기'], ['soil', '토양'], ['accuracy', '정확도'], ['participant', '참여자']].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            style={{ ...styles.tab, ...(tab === key ? styles.tabActive : {}) }}>
            {label}
          </button>
        ))}
      </div>

      <div style={styles.content}>

        {/* 줄기굵기 탭 */}
        {tab === 'stem' && (
          <div>
            <p style={styles.sectionTitle}>케이싱 조건별 줄기굵기 평균 (mm)</p>
            {groupStats.map((s, i) => (
              <div key={i} style={styles.barRow}>
                <span style={styles.barLabel}>{groupLabels[i]}</span>
                <div style={styles.barBg}>
                  <div style={{ ...styles.barFill, width: `${(s.avg / maxAvg) * 100}%`, background: groupColors[i] }} />
                </div>
                <span style={styles.barValue}>{s.avg > 0 ? `${s.avg} mm` : '-'}</span>
                <span style={styles.barCount}>({s.count}건)</span>
              </div>
            ))}
            <div style={styles.summaryBox}>
              <p style={styles.summaryTitle}>전체 측정 현황</p>
              <p>총 측정 건수: <strong>{stemRows.length}건</strong></p>
              <p>캘리퍼스 비교 건수: <strong>{errorRows.length}건</strong></p>
            </div>
          </div>
        )}

        {/* 토양 탭 */}
        {tab === 'soil' && (
          <div>
            <p style={styles.sectionTitle}>조건별 토양 pH 평균</p>
            {soilGroups.map((g, i) => (
              <div key={i} style={styles.barRow}>
                <span style={styles.barLabel}>{g.label}</span>
                <div style={styles.barBg}>
                  <div style={{ ...styles.barFill, width: g.avg !== '-' ? `${(Number(g.avg) / 14) * 100}%` : '0%', background: g.color }} />
                </div>
                <span style={styles.barValue}>{g.avg !== '-' ? `pH ${g.avg}` : '-'}</span>
                <span style={styles.barCount}>({g.count}건)</span>
              </div>
            ))}
            <div style={styles.summaryBox}>
              <p style={styles.summaryTitle}>토양 측정 현황</p>
              <p>총 측정 건수: <strong>{soilRows.length}건</strong></p>
            </div>
          </div>
        )}

        {/* 정확도 탭 */}
        {tab === 'accuracy' && (
          <div>
            <p style={styles.sectionTitle}>카메라 측정 정확도</p>
            <div style={styles.summaryBox}>
              <p>비교 가능 건수: <strong>{errorRows.length}건</strong></p>
              <p>평균 오차율: <strong>{avgErrorRate}%</strong></p>
            </div>
            <p style={styles.sectionTitle}>개별 측정 오차</p>
            <div style={styles.tableWrap}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>수목ID</th>
                    <th style={styles.th}>카메라</th>
                    <th style={styles.th}>캘리퍼스</th>
                    <th style={styles.th}>오차율</th>
                  </tr>
                </thead>
                <tbody>
                  {errorRows.slice(0, 20).map((r, i) => {
                    const err = Math.abs(Number(r.cameraMm) - Number(r.caliperMm))
                    const rate = (err / Number(r.caliperMm) * 100).toFixed(1)
                    return (
                      <tr key={i} style={{ background: i % 2 === 0 ? '#f9f9f9' : '#fff' }}>
                        <td style={styles.td}>{r.treeId}</td>
                        <td style={styles.td}>{Number(r.cameraMm).toFixed(1)}</td>
                        <td style={styles.td}>{Number(r.caliperMm).toFixed(1)}</td>
                        <td style={{ ...styles.td, color: Number(rate) > 5 ? '#e63946' : '#2d6a4f', fontWeight: 700 }}>{rate}%</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 참여자 탭 */}
        {tab === 'participant' && (
          <div>
            <p style={styles.sectionTitle}>참여자별 측정 건수</p>
            {participants.length === 0 && <p style={{ color: '#888', textAlign: 'center', padding: 24 }}>데이터 없음</p>}
            {participants.map(([id, count], i) => (
              <div key={i} style={styles.barRow}>
                <span style={styles.barLabel}>{id}</span>
                <div style={styles.barBg}>
                  <div style={{ ...styles.barFill, width: `${(count / maxCount) * 100}%`, background: '#52b788' }} />
                </div>
                <span style={styles.barValue}>{count}건</span>
              </div>
            ))}
          </div>
        )}

      </div>
    </div>
  )
}

const styles = {
  screen: { display: 'flex', flexDirection: 'column', height: '100vh', background: '#f5f7f2', fontFamily: 'sans-serif' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: '#2d6a4f', color: '#fff' },
  backBtn: { background: 'none', border: 'none', color: '#fff', fontSize: 16, cursor: 'pointer' },
  title: { fontSize: 18, fontWeight: 700 },
  tabs: { display: 'flex', background: '#fff', borderBottom: '2px solid #e0e0e0' },
  tab: { flex: 1, padding: '10px 4px', border: 'none', background: 'none', fontSize: 13, fontWeight: 600, color: '#888', cursor: 'pointer' },
  tabActive: { color: '#2d6a4f', borderBottom: '3px solid #2d6a4f' },
  content: { flex: 1, overflowY: 'auto', padding: '16px' },
  sectionTitle: { fontSize: 14, fontWeight: 700, color: '#2d6a4f', marginBottom: 12 },
  barRow: { display: 'flex', alignItems: 'center', marginBottom: 10, gap: 6 },
  barLabel: { width: 36, fontSize: 12, fontWeight: 700, color: '#333', flexShrink: 0 },
  barBg: { flex: 1, height: 24, background: '#e8f4ed', borderRadius: 4, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 4, transition: 'width 0.4s' },
  barValue: { width: 64, fontSize: 12, fontWeight: 700, color: '#333', textAlign: 'right', flexShrink: 0 },
  barCount: { width: 36, fontSize: 11, color: '#888', flexShrink: 0 },
  summaryBox: { background: '#fff', borderRadius: 8, padding: '12px 16px', marginTop: 16, marginBottom: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' },
  summaryTitle: { fontWeight: 700, color: '#2d6a4f', marginBottom: 8 },
  tableWrap: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: { background: '#2d6a4f', color: '#fff', padding: '8px 6px', textAlign: 'center', fontWeight: 700 },
  td: { padding: '7px 6px', textAlign: 'center', borderBottom: '1px solid #eee' },
  center: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontSize: 16, color: '#666' },
}