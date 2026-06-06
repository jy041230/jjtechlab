import React from 'react';

export default function MeasurementLoupe({
  loupeCanvasRef,
  loupeSize = 160,
  pixelCoord = { x: 0, y: 0 },
  onNudge,
  onConfirm,
  onCancel,
  pointLabel = '측정점',
}) {
  return (
    <div style={styles.overlay}>
      <div style={styles.card}>

        {/* ── 제목 ── */}
        <p style={styles.title}>
          📍 <strong>{pointLabel}</strong> 선택 중
        </p>

        {/* ── 루페 캔버스 ── */}
        <div style={styles.loupeWrap}>
          <canvas
            ref={loupeCanvasRef}
            width={loupeSize}
            height={loupeSize}
            style={styles.loupeCanvas}
          />
          {/* 범례 */}
          <div style={styles.legend}>
            <span style={{ ...styles.dot, background: 'rgb(255,80,0)' }} />
            <span style={styles.legendText}>경계선</span>
            <span style={{ ...styles.dot, background: 'rgba(0,220,80,1)', marginLeft: 10 }} />
            <span style={styles.legendText}>선택점</span>
          </div>
        </div>

        {/* ── 좌표 표시 ── */}
        <p style={styles.coord}>
          x&nbsp;<strong>{pixelCoord.x}</strong>
          &nbsp;px&nbsp;&nbsp;
          y&nbsp;<strong>{pixelCoord.y}</strong>
          &nbsp;px
        </p>

        {/* ── ±1픽셀 미세 조정 방향키 ── */}
        <p style={styles.nudgeLabel}>픽셀 미세 조정</p>
        <div style={styles.dpad}>
          <div style={styles.dpadRow}>
            <button style={styles.arrow} onPointerDown={() => onNudge(0, -1)}>▲</button>
          </div>
          <div style={styles.dpadRow}>
            <button style={styles.arrow} onPointerDown={() => onNudge(-1, 0)}>◀</button>
            <div style={styles.dpadCenter} />
            <button style={styles.arrow} onPointerDown={() => onNudge(1, 0)}>▶</button>
          </div>
          <div style={styles.dpadRow}>
            <button style={styles.arrow} onPointerDown={() => onNudge(0, 1)}>▼</button>
          </div>
        </div>

        {/* ── 확인 / 취소 ── */}
        <div style={styles.btnRow}>
          <button style={styles.btnCancel} onPointerDown={onCancel}>취소</button>
          <button style={styles.btnConfirm} onPointerDown={onConfirm}>
            ✓ 이 점 선택
          </button>
        </div>

      </div>
    </div>
  );
}

// ── 스타일 ───────────────────────────────────────────────────────
const styles = {
  overlay: {
    position: 'fixed', inset: 0,
    background: 'rgba(0,0,0,0.55)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 9999,
    touchAction: 'none',
  },
  card: {
    background: '#fff',
    borderRadius: 16,
    padding: '18px 20px 14px',
    width: 230,
    boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    gap: 6,
  },
  title: {
    margin: 0, fontSize: 14, color: '#1A3D28',
  },
  loupeWrap: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
  },
  loupeCanvas: {
    border: '2px solid #2E5F3E',
    borderRadius: 8,
    imageRendering: 'pixelated',
    display: 'block',
  },
  legend: {
    display: 'flex', alignItems: 'center', gap: 4,
    fontSize: 11, color: '#555',
  },
  dot: {
    display: 'inline-block',
    width: 10, height: 10, borderRadius: 3,
  },
  legendText: { fontSize: 11 },
  coord: {
    margin: 0, fontSize: 13, color: '#333',
    background: '#F0F7F2', borderRadius: 6,
    padding: '4px 12px',
  },
  nudgeLabel: {
    margin: 0, fontSize: 11, color: '#888',
  },
  dpad: {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
  },
  dpadRow: {
    display: 'flex', alignItems: 'center', gap: 2,
  },
  dpadCenter: { width: 36, height: 36 },
  arrow: {
    width: 36, height: 36,
    fontSize: 16, lineHeight: '36px',
    background: '#EAF3ED', border: '1px solid #B2D4BC',
    borderRadius: 8, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    touchAction: 'manipulation',
  },
  btnRow: {
    display: 'flex', gap: 8, width: '100%', marginTop: 4,
  },
  btnCancel: {
    flex: 1, padding: '9px 0',
    background: '#f5f5f5', border: '1px solid #ccc',
    borderRadius: 8, fontSize: 13, cursor: 'pointer',
  },
  btnConfirm: {
    flex: 2, padding: '9px 0',
    background: '#2E5F3E', color: '#fff', border: 'none',
    borderRadius: 8, fontSize: 13, fontWeight: 'bold', cursor: 'pointer',
  },
};
