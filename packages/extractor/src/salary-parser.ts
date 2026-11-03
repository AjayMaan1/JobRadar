export interface ParsedSalary {
  min: number
  max: number
  currency: string
  period: 'year' | 'month' | 'hour'
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  '$': 'USD',
  '€': 'EUR',
  '£': 'GBP',
  '₹': 'INR',
  '¥': 'JPY',
  'AED': 'AED',
  'AUD': 'AUD',
  'CAD': 'CAD',
  'SGD': 'SGD',
  'CHF': 'CHF',
}

function normalizeCurrency(raw: string): string {
  const upper = raw.toUpperCase().trim()
  if (CURRENCY_SYMBOLS[upper]) return CURRENCY_SYMBOLS[upper]
  if (CURRENCY_SYMBOLS[raw]) return CURRENCY_SYMBOLS[raw]
  if (/^[A-Z]{3}$/.test(upper)) return upper
  return 'USD'
}

function parseAmount(s: string): number {
  const cleaned = s.replace(/,/g, '').toLowerCase()
  const match = cleaned.match(/([\d.]+)\s*k?/)
  if (!match) return 0
  const val = parseFloat(match[1])
  return cleaned.includes('k') ? val * 1000 : val
}

function detectPeriod(raw: string): 'year' | 'month' | 'hour' {
  const lower = raw.toLowerCase()
  if (lower.includes('/hr') || lower.includes('/hour') || lower.includes('per hour')) return 'hour'
  if (lower.includes('/mo') || lower.includes('/month') || lower.includes('per month')) return 'month'
  return 'year'
}

export function parseSalary(raw: string | undefined | null): ParsedSalary | null {
  if (!raw) return null
  const str = raw.trim()
  if (!str) return null

  // Match patterns like: $80k–$120k, €60,000 - €90,000, USD 72000/yr, £55k-£80k/year
  const rangePattern =
    /([₹$€£¥]|USD|EUR|GBP|AED|AUD|CAD|SGD|CHF|INR)?\s*([\d,]+\.?\d*\s*k?)\s*[-–—to]+\s*([₹$€£¥]|USD|EUR|GBP|AED|AUD|CAD|SGD|CHF|INR)?\s*([\d,]+\.?\d*\s*k?)/i

  const singlePattern =
    /([₹$€£¥]|USD|EUR|GBP|AED|AUD|CAD|SGD|CHF|INR)\s*([\d,]+\.?\d*\s*k?)/i

  const period = detectPeriod(str)

  const rangeMatch = str.match(rangePattern)
  if (rangeMatch) {
    const currencyRaw = rangeMatch[1] || rangeMatch[3] || '$'
    const currency = normalizeCurrency(currencyRaw)
    const min = parseAmount(rangeMatch[2])
    const max = parseAmount(rangeMatch[4])
    if (min > 0 && max > 0) return { min, max, currency, period }
    if (min > 0) return { min, max: min * 1.3, currency, period }
  }

  const singleMatch = str.match(singlePattern)
  if (singleMatch) {
    const currency = normalizeCurrency(singleMatch[1])
    const val = parseAmount(singleMatch[2])
    if (val > 0) return { min: val * 0.9, max: val * 1.1, currency, period }
  }

  return null
}
