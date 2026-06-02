const SHEET_API_URL = 'https://script.google.com/macros/s/AKfycbyURpd6OPBf_goR0cCW4zWZ2tEoiiOc3RL1h6t1_NZIyUmCZU3YfB81MBu7SmsqxhFqKg/exec'

export async function fetchSheetData() {
  const response = await fetch(SHEET_API_URL)
  const data = await response.json()
  return data
}