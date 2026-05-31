import { useState, useEffect, useRef } from 'react'
import MeasurementScreen from './components/MeasurementScreen'
import HistoryScreen     from './components/HistoryScreen'
import ResearchScreen    from './components/ResearchScreen'

export default function App() {
  const [showHistory, setShowHistory] = useState(false)
  const [showResearch, setShowResearch] = useState(false)
  const measureBackRef  = useRef(null)
  const showHistoryRef  = useRef(false)
  const showResearchRef = useRef(false)
  showHistoryRef.current = showHistory
  showResearchRef.current = showResearch

  // 안드로이드 뒤로가기 — popstate 수신
  useEffect(() => {
    function onPopState() {
      if (showResearchRef.current) {
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

  function goHistory() {
    history.pushState({ screen: 'history' }, '')
    setShowHistory(true)
  }

  function goResearch() {
    history.pushState({ screen: 'research' }, '')
    setShowResearch(true)
  }

  return (
    <div style={{ height: '100dvh', overflow: 'hidden' }}>
      {showResearch ? (
        <ResearchScreen onBack={() => setShowResearch(false)} />
      ) : showHistory ? (
        <HistoryScreen onBack={() => setShowHistory(false)} />
      ) : (
        <MeasurementScreen
          onGoHistory={goHistory}
          onGoResearch={goResearch}
          onRegisterBack={cb => { measureBackRef.current = cb }}
        />
      )}
    </div>
  )
}
