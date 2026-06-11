import { useState, useEffect, useRef } from 'react'
import MeasurementScreen from './components/MeasurementScreen'
import HistoryScreen     from './components/HistoryScreen'
import ResearchScreen    from './components/ResearchScreen'
import AnalysisScreen    from './components/AnalysisScreen'
import SensorDashboard   from './components/SensorDashboard'
import TreeReport        from './components/TreeReport'
import ModeSelect        from './components/ModeSelect'

export default function App() {
  // QR/온라인 단독 진입: 주소에 ?tree=수목ID 가 있으면 모드 선택 건너뛰고 리포트만 표시
  const urlTree = new URLSearchParams(window.location.search).get('tree')
  if (urlTree) {
    return (
      <div style={{ height: '100dvh', overflow: 'hidden' }}>
        <TreeReport initialTreeId={urlTree} onBack={null} />
      </div>
    )
  }

  // mode: null(선택화면) | 'client'(고객용) | 'research'(연구자용)
  const [mode, setMode] = useState(null)

  const [showHistory,  setShowHistory]  = useState(false)
  const [showResearch, setShowResearch] = useState(false)
  const [showAnalysis, setShowAnalysis] = useState(false)
  const [showSensor,   setShowSensor]   = useState(false)
  const [showReport,   setShowReport]   = useState(false)
  const measureBackRef  = useRef(null)
  const showHistoryRef  = useRef(false)
  const showResearchRef = useRef(false)
  const showAnalysisRef = useRef(false)
  const showSensorRef   = useRef(false)
  const showReportRef   = useRef(false)
  showHistoryRef.current  = showHistory
  showResearchRef.current = showResearch
  showAnalysisRef.current = showAnalysis
  showSensorRef.current   = showSensor
  showReportRef.current   = showReport

  useEffect(() => {
    function onPopState() {
      if (showReportRef.current) {
        setShowReport(false)
      } else if (showSensorRef.current) {
        setShowSensor(false)
      } else if (showAnalysisRef.current) {
        setShowAnalysis(false)
      } else if (showResearchRef.current) {
        setShowResearch(false)
      } else if (showHistoryRef.current) {
        setShowHistory(false)
      } else {
        measureBackRef.current?.()
      }
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  function goHistory()  { history.pushState({ screen: 'history' }, '');  setShowHistory(true) }
  function goResearch() { history.pushState({ screen: 'research' }, ''); setShowResearch(true) }
  function goAnalysis() { history.pushState({ screen: 'analysis' }, ''); setShowAnalysis(true) }
  function goSensor()   { history.pushState({ screen: 'sensor' }, '');   setShowSensor(true) }
  function goReport()   { history.pushState({ screen: 'report' }, '');   setShowReport(true) }

  // 모드로 돌아가기 (모드 선택 화면으로)
  function backToModes() {
    setShowHistory(false); setShowResearch(false); setShowAnalysis(false)
    setShowSensor(false); setShowReport(false)
    setMode(null)
  }

  // ── 1) 첫 화면: 모드 선택 ──
  if (mode === null) {
    return (
      <ModeSelect
        onClient={() => setMode('client')}
        onResearch={() => setMode('research')}
      />
    )
  }

  // ── 2) 고객용: 리포트만 ──
  if (mode === 'client') {
    return (
      <div style={{ height: '100dvh', overflow: 'hidden' }}>
        <TreeReport onBack={backToModes} />
      </div>
    )
  }

  // ── 3) 연구자용: 측정·기록·분석 ──
  return (
    <div style={{ height: '100dvh', overflow: 'hidden' }}>
      {showReport ? (
        <TreeReport onBack={() => setShowReport(false)} />
      ) : showSensor ? (
        <SensorDashboard onBack={() => setShowSensor(false)} />
      ) : showAnalysis ? (
        <AnalysisScreen onBack={() => setShowAnalysis(false)} />
      ) : showResearch ? (
        <ResearchScreen onBack={() => setShowResearch(false)} />
      ) : showHistory ? (
        <HistoryScreen onBack={() => setShowHistory(false)} />
      ) : (
        <MeasurementScreen
          onGoHistory={goHistory}
          onGoResearch={goResearch}
          onGoAnalysis={goAnalysis}
          onGoSensor={goSensor}
          onGoReport={goReport}
          onExitMode={backToModes}
          onRegisterBack={cb => { measureBackRef.current = cb }}
        />
      )}
    </div>
  )
}
