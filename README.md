# 측정 앱 개발 인수인계서 (Claude Code용) — v1

> 본 문서는 박사논문 시스템의 **스마트폰 통합 측정 화면**을 Claude Code로 개발하기 위한 사양·설계·셋업 문서다. Claude Code를 실행한 뒤 이 파일을 프로젝트 루트에 `CLAUDE.md`로 두면, Claude Code가 이 사양을 읽고 개발을 이어갈 수 있다.

---

## 0. 무엇을 만드는가 (한 문단 요약)

고령 도시농업인이 스마트폰 하나로 조경수(홍매화)를 **측정·외재화**하는 통합 측정 화면을 만든다. 한 화면에서 ① 카메라로 ArUco 기준 마커(30mm)를 함께 비춰 줄기 직경을 비접촉·정량(mm) 계측하고, ② 그 수치를 음성으로 외재화(STT)하여 구조화 저장한다. 측정 결과는 박사논문 제5장 데이터 모델(event_units · measurement_data)로 단말에 오프라인 저장된다. 본 앱은 입력·축적 계층이며, 축적된 자료는 별도의 출력 계층(자산증빙 리포트·세대전이 학습자료)으로 확장된다.

---

## 1. Claude Code 설치·셋업

### 1) 설치 (권장: 네이티브 설치 — Node.js 불필요)
- macOS / Linux / WSL: 터미널에서 `curl -fsSL https://claude.ai/install.sh | bash`
- Windows PowerShell: `irm https://claude.ai/install.ps1 | iex`
- (대안) Homebrew: `brew install --cask claude-code` — 단, 자동 업데이트 안 됨(`brew upgrade claude-code` 수동)
- (대안) npm: `npm install -g @anthropic-ai/claude-code` — 이 방식만 Node.js 18+ 필요. `sudo` 사용 금지(권한 오류 유발).

### 2) 계정
- Claude Pro / Max / Teams / Enterprise 또는 API 크레딧이 있는 Console 계정 필요(무료 플랜은 Claude Code 미지원). 최초 1회 브라우저 OAuth 인증.

### 3) 첫 실행
- 프로젝트 폴더를 만들고 그 안에서 `claude` 실행. 문제 발생 시 `claude doctor`로 진단.
- 공식 문서: https://docs.claude.com/en/docs/claude-code/overview

---

## 2. 기술 스택 결정

본 앱은 **PWA(Progressive Web App) 우선**을 권장한다. 이유:
- 카메라 접근(`getUserMedia`)·음성 인식(Web Speech API 또는 onnx STT)·오프라인 저장(IndexedDB/SQLite WASM)이 모두 브라우저 표준으로 가능.
- 스마트폰에서 별도 스토어 배포 없이 URL로 즉시 시연 가능 → 박사논문 실증·심사에 유리.
- 인수인계서의 Python·Kivy 방침과의 관계: Kivy는 네이티브 패키징에 강하나 카메라+웹표준 STT 통합과 빠른 시연에는 PWA가 유리. **본 측정 화면은 PWA로, 추후 네이티브 패키징이 필요하면 Capacitor로 래핑**하는 경로를 권장.

### 핵심 라이브러리
- **ArUco 마커 인식 / 직경 계측**: OpenCV.js (`cv.aruco`) — 마커 검출, 픽셀↔mm 환산.
- **음성 인식(STT)**: 1차 Web Speech API(브라우저 내장, 한국어 `ko-KR`), 2차 옵션 Whisper onnx 온디바이스(정확도·오프라인 필요 시).
- **오프라인 저장**: IndexedDB(간단) 또는 sql.js / wa-sqlite(제5장 SQLite 스키마 그대로 쓰려면 후자).
- **프레임워크**: React + Vite(PWA 플러그인) 권장. 자산증빙 프로토타입이 이미 React라 재사용 가능.

---

## 3. 측정 화면 사양 (핵심 기능)

### 화면 구성 (고령자 친화 — 제5장 제4절 1. 준수)
- 본문 18pt+, 버튼 라벨 20pt+, 터치 타깃 48dp+, 한 화면 한 과제, 관대한 타임아웃.
- 상단: 카메라 라이브 프리뷰(ArUco 마커 인식 상태 오버레이).
- 중앙: 큰 음성 버튼(80dp), 측정 버튼(64dp).
- 하단: 인식된 측정값 카드(측정유형·수치·단위) + 확정/재측정 버튼.

### 기능 A — 카메라 + ArUco 비접촉 직경 계측
1. `getUserMedia`로 후면 카메라 스트림.
2. 프레임마다 OpenCV.js로 ArUco 마커(30mm, 사전 정의 dict) 검출.
3. 마커 한 변의 픽셀 길이 → 픽셀당 mm(scale) 산출.
4. 사용자가 줄기 양 끝(또는 자동 윤곽)을 지정 → 픽셀 거리 × scale = 직경(mm).
5. 도메인 검증: 매화 줄기 합리적 범위(약 5~30mm) 밖이면 재측정 플래그(제5장 제3절 3. 3)).
6. 결과를 measurement_type="줄기직경"으로 임시 저장.

### 기능 B — 음성 외재화(STT)
1. 음성 버튼 → `ko-KR` 음성 인식 시작.
2. 한국어 숫자·단위 정규화("이십팔"→28, "센치"→cm 등; 제5장 제3절 3. 1)).
3. 측정유형 키워드 매칭(토양수분·흉고직경·수고 등; 제5장 제3절 3. 2)).
4. 결과를 measurement_data 구조로 변환.

### 기능 C — 오프라인 저장 (제5장 제5절)
- 측정 결과를 event_units + measurement_data 스키마로 IndexedDB/SQLite에 저장.
- status: draft → (환경맥락 결합 대기) context_pending → confirmed.
- 온라인 시 기상청·농진청 API로 환경맥락 비동기 결합(후속).

---

## 4. 데이터 모델 (제5장 제5절 1. — 그대로 사용)

```
event_units(event_id PK, timestamp, gps_lat, gps_lon, participant_id,
            event_type[관찰|처치], status[draft|context_pending|confirmed|revised], note)
voice_data(event_id FK, audio_blob_path, transcript_text, transcript_confidence, language_code)
visual_data(event_id FK, image_blob_path, segmentation_result, capture_metadata)
measurement_data(event_id FK, measurement_type, measurement_value, measurement_unit,
                 domain_validation_status)   -- measurement_type: 줄기직경|토양수분|흉고직경|수고|수관폭|가지길이|케이싱관수량 등
environmental_context(event_id FK, air_temp, humidity, sunshine, precipitation, source_station, retrieval_timestamp)
grounding_links(event_id FK, speech_referent, visual_target, grounding_confidence, uncertainty_flag)
```

기존 자산증빙 프로토타입(`조경수_자산증빙_프로토타입.jsx`)이 이 스키마를 읽는 구조이므로, 측정 앱이 같은 스키마로 저장하면 두 모듈이 자동 연결된다.

---

## 5. 개발 순서 (권장 마일스톤)

1. **M1**: Vite + React + PWA 스캐폴딩, 고령자 친화 측정 화면 정적 UI.
2. **M2**: 카메라 프리뷰 + OpenCV.js ArUco 검출(마커 인식 표시까지).
3. **M3**: 직경 계측(픽셀↔mm) + 도메인 검증 + 결과 카드.
4. **M4**: 음성 외재화(ko-KR STT) + 숫자/단위 정규화.
5. **M5**: IndexedDB/SQLite 저장(제5장 스키마) + 측정 이력 리스트.
6. **M6**: 자산증빙 모듈과 데이터 연동 확인, 캘리퍼스 기준값 대조(7장 검증).

각 마일스톤은 스마트폰 브라우저에서 실제로 열어 작동 확인.

---

## 6. 정직성·논문 정합 체크리스트 (§2.6)

- 카메라 계측값은 **캘리퍼스 기준값과 대조 검증**을 거치기 전까지 "검증 완료"로 표기하지 않는다(7장).
- 미구현 기능(환경맥락 결합, 서명·해시, Whisper 온디바이스 등)은 화면·문서에서 "후속"으로 명시.
- 모델 A″ 범위 보존: 스마트폰 단독 + 휴대 측정 도구 + 공인 기상 API. 자체 센서 하드웨어 설계 없음.

---

## 7. 첫 프롬프트 예시 (Claude Code에서)

```
이 CLAUDE.md를 읽고, 섹션 5의 M1을 먼저 구현해줘.
Vite + React + vite-plugin-pwa로 프로젝트를 스캐폴딩하고,
제5장 제4절 고령자 친화 원칙(18pt+, 48dp+ 터치타깃, 한 화면 한 과제)을 지킨
측정 화면 정적 UI를 만들어줘. 카메라/음성 로직은 다음 마일스톤에서 붙인다.
```
