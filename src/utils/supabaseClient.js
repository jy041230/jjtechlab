/**
 * supabaseClient.js — 수목 리포트용 Supabase 연결 설정
 *
 * 새 프로젝트(jjsmartfarm2)의 주소와 공개 키를 넣는 곳이다.
 * 토양센서용 sensorApi.js 와 같은 방식(REST 직접 호출, 의존성 추가 없음).
 *
 * ⚠️ 아래 SUPABASE_ANON_KEY 자리에 본인 프로젝트의
 *    "게시 가능한 키"(sb_publishable_... 로 시작) 전체를 붙여넣을 것.
 *    이 키는 브라우저 공개용이라 코드에 넣어도 안전하다.
 */

export const SUPABASE_URL = 'https://qeyzyvsxsxwybswciagu.supabase.co'

// ↓↓↓ 여기에 본인 게시 가능한 키를 붙여넣으세요 (sb_publishable_ 로 시작) ↓↓↓
export const SUPABASE_ANON_KEY = 'sb_publishable_4mQHgJSC74IHomVXbiqbOQ__HqL0J3j'
// ↑↑↑ 따옴표 안의 글자만 바꾸세요. 따옴표는 지우지 마세요. ↑↑↑

export const SB_HEADERS = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
  'Content-Type': 'application/json',
}

/** 키가 채워졌는지 확인 (안내 메시지용) */
export function isSupabaseConfigured() {
  return !SUPABASE_ANON_KEY.includes('여기에_본인_키')
}
