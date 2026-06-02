// 구글시트(Apps Script) 전송 유틸
const SHEET_URL = 'https://script.google.com/macros/s/AKfycbx1Tv0T4bhlkmbV6gtMtI-nsWV-EA9_8J_yvGevT8cKL-tkPSSsbGetDp_U4CImUQBT6g/exec'
/**
 * 구글시트로 데이터 전송
 * @param {object} payload - { type, ...fields, photo?, photoName? }
 *   type: 'stem' | 'soil' | 'work'
 */
export async function sendToSheet(payload) {
  try {
    await fetch(SHEET_URL, {
      method: 'POST',
      mode: 'no-cors',                // Apps Script CORS 회피
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload),
    })
    return true
  } catch (err) {
    console.error('[sheetSync] 전송 실패:', err)
    return false
  }
}
