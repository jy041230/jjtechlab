/**
 * ModeSelect — 앱 첫 화면. 고객용 / 연구자용 중 선택.
 * 매번 첫 화면에서 고르는 방식 (모드 기억 안 함).
 */
import styles from './ModeSelect.module.css'

export default function ModeSelect({ onClient, onResearch }) {
  return (
    <div className={styles.screen}>
      <div className={styles.head}>
        <div className={styles.appTitle}>조경수 생산이력관리 앱</div>
        <div className={styles.appSub}>스마트팜 기반 조경수 성장·생산 이력 관리 시스템</div>
      </div>

      <div className={styles.cards}>
        <button className={`${styles.card} ${styles.client}`} onClick={onClient}>
          <span className={styles.icon}>🌳</span>
          <span className={styles.cardTitle}>고객용</span>
          <span className={styles.cardDesc}>수목 성장 리포트 보기</span>
        </button>

        <button className={`${styles.card} ${styles.research}`} onClick={onResearch}>
          <span className={styles.icon}>🔬</span>
          <span className={styles.cardTitle}>연구자용</span>
          <span className={styles.cardDesc}>측정 · 기록 · 분석</span>
        </button>
      </div>

      <div className={styles.foot}>사용 목적을 선택하세요</div>
    </div>
  )
}
