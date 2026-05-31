import { useState, useEffect, useCallback } from 'react'
import { getAllEvents, getMeasurementsByEvent, updateHistoryEvent, deleteHistoryEvent } from '../utils/db'

const TYPE_ICONS = {
  '줄기직경': '🌳',
  '흉고직경': '📏',
  '캘리퍼스직경': '📐',
  '토양수분': '💧',
  '토양PH': '🧪',
  '토양온도': '🌡️',
  'EC': '⚡',
  '비옥도': '🌱',
  '일조': '☀️',
}

export default function HistoryScreen({ onBack }) {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const evs = await getAllEvents()
      setEvents(evs)
    } catch (err) {
      console.error('[이력 조회 실패]', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function toggle(eventId) {
    setExpanded(prev => ({ ...prev, [eventId]: !prev[eventId] }))
  }

  const fmtTs = ts => {
    const d = new Date(ts)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#888', fontSize: 18 }}>
        이력 불러오는 중
      </div>
    )
  }

  if (!events.length) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#f7f9f7' }}>
        <HistoryHeader onBack={onBack} title="측정 이력" />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#aaa', gap: 12 }}>
          <span style={{ fontSize: 56 }}>📋</span>
          <p style={{ fontSize: 18, fontWeight: 700 }}>저장된 측정 이력이 없습니다</p>
          <p style={{ fontSize: 14 }}>측정 화면에서 값을 저장하면 여기에 표시됩니다</p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', background: '#f7f9f7' }}>
      <HistoryHeader onBack={onBack} title={`측정 이력 (${events.length}건)`} sticky />
      {events.map(ev => (
        <EventCard
          key={ev.event_id}
          event={ev}
          expanded={!!expanded[ev.event_id]}
          onToggle={() => toggle(ev.event_id)}
          fmtTs={fmtTs}
          onSaved={load}
        />
      ))}
    </div>
  )
}

function HistoryHeader({ onBack, title, sticky = false }) {
  return (
    <header style={{
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '10px 16px',
      background: '#2d6a4f',
      color: '#fff',
      position: sticky ? 'sticky' : 'static',
      top: 0,
      zIndex: 1,
    }}>
      {onBack && (
        <button onClick={onBack} style={{
          background: 'rgba(255,255,255,0.2)',
          border: 'none',
          color: '#fff',
          borderRadius: 20,
          padding: '6px 14px',
          fontSize: 14,
          fontWeight: 700,
          flexShrink: 0,
        }}>
          ← 뒤로
        </button>
      )}
      <span style={{ fontSize: 17, fontWeight: 800 }}>{title}</span>
    </header>
  )
}

function EventCard({ event, expanded, onToggle, fmtTs, onSaved }) {
  const [measures, setMeasures] = useState(null)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [eventDraft, setEventDraft] = useState(() => makeEventDraft(event))
  const [measureDrafts, setMeasureDrafts] = useState([])

  useEffect(() => {
    setEventDraft(makeEventDraft(event))
  }, [event])

  async function handleExpand() {
    if (!measures) {
      try {
        const data = await getMeasurementsByEvent(event.event_id)
        setMeasures(data)
        setMeasureDrafts(data.map(makeMeasureDraft))
      } catch {
        setMeasures([])
        setMeasureDrafts([])
      }
    }
    onToggle()
  }

  function startEdit() {
    setEventDraft(makeEventDraft(event))
    setMeasureDrafts((measures ?? []).map(makeMeasureDraft))
    setEditing(true)
  }

  function cancelEdit() {
    setEventDraft(makeEventDraft(event))
    setMeasureDrafts((measures ?? []).map(makeMeasureDraft))
    setEditing(false)
  }

  async function saveEdit() {
    if (saving) return
    setSaving(true)
    try {
      await updateHistoryEvent(event.event_id, eventDraft, measureDrafts.map(draft => ({
        ...draft.original,
        measurement_value: draft.value,
        measurement_unit: draft.unit,
      })))
      const data = await getMeasurementsByEvent(event.event_id)
      setMeasures(data)
      setMeasureDrafts(data.map(makeMeasureDraft))
      setEditing(false)
      await onSaved?.()
      alert('수정했습니다.')
    } catch (err) {
      console.error('[이력 수정 실패]', err)
      alert('수정 저장에 실패했습니다. 다시 시도해 주세요.')
    } finally {
      setSaving(false)
    }
  }

  async function deleteEvent() {
    if (deleting) return
    const ok = window.confirm(
      '이 이력 기록을 삭제할까요?\n\n' +
      '측정값, 사진, 음성기록이 함께 삭제됩니다. 삭제 후에는 되돌릴 수 없습니다.'
    )
    if (!ok) return

    setDeleting(true)
    try {
      await deleteHistoryEvent(event.event_id)
      setEditing(false)
      await onSaved?.()
      alert('삭제했습니다.')
    } catch (err) {
      console.error('[이력 삭제 실패]', err)
      alert('삭제에 실패했습니다. 다시 시도해 주세요.')
    } finally {
      setDeleting(false)
    }
  }

  function updateEventDraft(key, value) {
    setEventDraft(prev => ({ ...prev, [key]: value }))
  }

  function updateMeasureDraft(index, key, value) {
    setMeasureDrafts(prev => prev.map((item, i) => i === index ? { ...item, [key]: value } : item))
  }

  const noteIcon = event.note === '작업일지' ? '📝'
    : event.note === '토양측정' ? '🌱'
      : event.event_type === '관찰' ? '📏' : '📋'

  return (
    <div style={{
      margin: '8px 12px',
      background: '#fff',
      borderRadius: 12,
      border: '1px solid #e0e8e0',
      overflow: 'hidden',
    }}>
      <button
        onClick={handleExpand}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '12px 14px',
          background: 'none',
          border: 'none',
          textAlign: 'left',
        }}
      >
        <span style={{ fontSize: 24, flexShrink: 0 }}>{noteIcon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#1a3c2a' }}>
            {event.note ?? event.event_type}
          </div>
          <div style={{ fontSize: 13, color: '#888', marginTop: 2 }}>{fmtTs(event.timestamp)}</div>
          {(event.tree_id || event.participant_id) && (
            <div style={{ fontSize: 12, color: '#668474', marginTop: 3 }}>
              {event.participant_id || '-'} · {event.tree_id || '-'}
            </div>
          )}
        </div>
        <span style={{ fontSize: 18, color: '#aaa', flexShrink: 0 }}>{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div style={{ borderTop: '1px solid #eee', padding: '10px 14px' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 10 }}>
            {editing ? (
              <>
                <button onClick={cancelEdit} disabled={saving} style={secondaryBtnStyle}>취소</button>
                <button onClick={saveEdit} disabled={saving} style={primaryBtnStyle}>
                  {saving ? '저장 중' : '수정 저장'}
                </button>
              </>
            ) : (
              <>
                <button onClick={deleteEvent} disabled={deleting} style={dangerBtnStyle}>
                  {deleting ? '삭제 중' : '삭제'}
                </button>
                <button onClick={startEdit} style={primaryBtnStyle}>수정</button>
              </>
            )}
          </div>

          {editing && (
            <div style={editGridStyle}>
              <EditField label="참여자ID" value={eventDraft.participant_id} onChange={v => updateEventDraft('participant_id', v)} />
              <EditField label="수목구분" value={eventDraft.tree_group} onChange={v => updateEventDraft('tree_group', v)} />
              <EditField label="수목ID" value={eventDraft.tree_id} onChange={v => updateEventDraft('tree_id', v)} />
              <EditField label="회차" value={eventDraft.session_label} onChange={v => updateEventDraft('session_label', v)} />
              <div style={{ gridColumn: '1 / -1' }}>
                <EditField label="비고" value={eventDraft.note} onChange={v => updateEventDraft('note', v)} />
              </div>
            </div>
          )}

          {measures === null ? (
            <p style={{ color: '#aaa', fontSize: 14 }}>불러오는 중</p>
          ) : measures.length === 0 ? (
            <p style={{ color: '#aaa', fontSize: 14 }}>측정값 없음</p>
          ) : (
            measures.map((m, i) => (
              <div key={m.id ?? i} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '7px 0',
                borderBottom: i < measures.length - 1 ? '1px solid #f0f0f0' : 'none',
              }}>
                <span style={{ fontSize: 20 }}>{TYPE_ICONS[m.measurement_type] ?? '🔎'}</span>
                <span style={{ flex: 1, fontSize: 15, color: '#333' }}>{m.measurement_type}</span>
                {editing ? (
                  <>
                    <input
                      value={measureDrafts[i]?.value ?? ''}
                      onChange={e => updateMeasureDraft(i, 'value', e.target.value)}
                      style={measureInputStyle}
                    />
                    <input
                      value={measureDrafts[i]?.unit ?? ''}
                      onChange={e => updateMeasureDraft(i, 'unit', e.target.value)}
                      style={unitInputStyle}
                    />
                  </>
                ) : (
                  <>
                    <span style={{ fontSize: 18, fontWeight: 800, color: '#2d6a4f' }}>
                      {formatMeasureValue(m.measurement_value)}
                    </span>
                    {m.measurement_unit && (
                      <span style={{ fontSize: 13, color: '#888', minWidth: 28 }}>{m.measurement_unit}</span>
                    )}
                  </>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

function makeEventDraft(event) {
  return {
    participant_id: event.participant_id ?? '',
    participant_group: event.participant_group ?? '',
    tree_id: event.tree_id ?? '',
    tree_group: event.tree_group ?? '',
    session_label: event.session_label ?? '',
    note: event.note ?? '',
  }
}

function makeMeasureDraft(measurement) {
  return {
    original: measurement,
    value: measurement.measurement_value ?? '',
    unit: measurement.measurement_unit ?? '',
  }
}

function formatMeasureValue(value) {
  return typeof value === 'number'
    ? (value % 1 === 0 ? value : value.toFixed(1))
    : value
}

function EditField({ label, value, onChange }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, fontWeight: 800, color: '#466454' }}>
      {label}
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          minHeight: 38,
          border: '1px solid #b7d2bf',
          borderRadius: 8,
          padding: '6px 8px',
          fontSize: 15,
          fontWeight: 800,
          color: '#1b4332',
          background: '#fff',
          minWidth: 0,
        }}
      />
    </label>
  )
}

const editGridStyle = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 8,
  padding: 10,
  marginBottom: 10,
  background: '#f6fbf7',
  border: '1px solid #d7e8dc',
  borderRadius: 10,
}

const primaryBtnStyle = {
  minHeight: 38,
  padding: '6px 14px',
  border: 'none',
  borderRadius: 10,
  background: '#2d6a4f',
  color: '#fff',
  fontSize: 14,
  fontWeight: 800,
}

const secondaryBtnStyle = {
  ...primaryBtnStyle,
  background: '#eef4ef',
  color: '#1b4332',
  border: '1px solid #b7d2bf',
}

const dangerBtnStyle = {
  ...primaryBtnStyle,
  background: '#fff1f0',
  color: '#b42318',
  border: '1px solid #f0b8b4',
}

const measureInputStyle = {
  width: 96,
  minHeight: 38,
  border: '1px solid #b7d2bf',
  borderRadius: 8,
  padding: '5px 8px',
  fontSize: 17,
  fontWeight: 800,
  color: '#1b4332',
  textAlign: 'right',
}

const unitInputStyle = {
  width: 48,
  minHeight: 38,
  border: '1px solid #d5ded8',
  borderRadius: 8,
  padding: '5px 6px',
  fontSize: 13,
  color: '#555',
}
