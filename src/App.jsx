import { useState, useEffect, useRef } from 'react'
import MeasurementScreen from './components/MeasurementScreen'
import HistoryScreen     from './components/HistoryScreen'
import ResearchScreen    from './components/ResearchScreen'
import AnalysisScreen    from './components/AnalysisScreen'
import SensorDashboard   from './components/SensorDashboard'

export default function App() {
  const [showHistory,  setShowHistory]  = useState(false)
  const [showResearch, setShowResearch] = useState(false)
  const [showAnalysis, setShowAnalysis] = useState(false)
  const [showSensor,   setShowSensor]   = useState(false)
  const measureBackRef  = useRef(null)
  const showHistoryRef  = useRef(false)
  const showResearchRef = useRef(false)
  const showAnalysisRef = useRef(false)
  const showSensorRef   = useRef(false)
  showHistoryRef.current  = showHistory
  showResearchRef.current = showResearch
  showAnalysisRef.current = showAnalysis
  showSensorRef.current   = showSensor

  useEffect(() => {
    function onPopState() {
      if (showSensorRef.current) {
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

  function goHistory() {
    history.pushState({ screen: 'history' }, '')
    setShowHistory(true)
  }

  function goResearch() {
    history.pushState({ screen: 'research' }, '')
    setShowResearch(true)
  }

  function goAnalysis() {
    history.pushState({ screen: 'analysis' }, '')
    setShowAnalysis(true)
  }

  function goSensor() {
    history.pushState({ screen: 'sensor' }, '')
    setShowSensor(true)
  }

  return (
    <div style={{ height: '100dvh', overflow: 'hidden' }}>
      {showSensor ? (
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
          onRegisterBack={cb => { measureBackRef.current = cb }}
        />
      )}
    </div>
  )
}