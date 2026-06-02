const SHEET_URL = 'https://script.google.com/macros/s/AKfycbys01qg2UvYNRFtrVtQinZzVvmjR1slrjWZUkhUFeO5mwXm_Fw3GzitKJ4OY8vaHlA50Q/exec'

export async function sendToSheet(payload) {
  try {
    const response = await fetch(SHEET_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload),
    })
    const result = await response.json()
    return result
  } catch (err) {
    console.error('[sheetSync] 전송 실패:', err)
    return false
  }
}
