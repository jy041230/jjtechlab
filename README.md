# 조경수 이력관리를 위한 모바일 다중 양식 인터랙션 시스템

**신라대학교 디자인과학연구(DSR) 공학박사 논문 구현 저장소**

> 고령 농업인의 조경수 재배 지식을 스마트폰 기반 다중 양식 인터랙션으로 기록하는 참여형 이력관리 시스템

---

## 개요

본 저장소는 박사논문 실증 구현물로, 영산대학교 양산캠퍼스 농장의 홍매화(Prunus mume) 재배 현장에서 고령 농업인의 관찰·발화·촬영·측정 행위를 하나의 통합 이력단위로 외재화하는 스마트폰 기반 PWA(점진적 웹 앱)이다.

---

## 기술 스택

| 항목 | 내용 |
|---|---|
| 프레임워크 | React + Vite + PWA (vite-plugin-pwa + Workbox) |
| 저장소 | 브라우저 IndexedDB + CSV(xlsx) |
| 마커 측정 | js-aruco2 (ArUco DICT_4X4_50, ID 0, 40mm) |
| 음성 인식 | Web Speech API (ko-KR) |
| 배포 | Cloudflare Tunnel HTTPS → QR → 스마트폰 브라우저 |
| 권장 환경 | 안드로이드 Chrome |

---

## 주요 기능

### 구현 완료

- **카메라 기반 가지 굵기 측정** — ArUco 마커 자동검출 → px/mm 환산 → P1·P2 두 점 지정 → 굵기(mm) 산출
- **토양 측정값 입력** — pH·수분·온도 직접 입력 또는 음성 발화 입력
- **음성 기록** — Web Speech API(ko-KR) 기반 현장 발화 전사
- **통합 이력단위 저장** — event_id 기반 IndexedDB 저장 (voice_data / measurement_data / visual_data / event_units)
- **CSV 내보내기** — 측정시각·카메라측정값·마커보정값·캘리퍼스실측값·오차·오차율
- **단말 백업 및 복원** — JSON 백업 파일 생성·불러오기

### 향후 구현 예정

- 기상 API 자동 연계 (environmental_context)
- 토양수분 센서 회로 및 캘리브레이션
- 부위 자동 인식 모델

---

## 데이터 구조
