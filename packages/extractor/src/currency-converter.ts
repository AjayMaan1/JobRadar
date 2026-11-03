// Static FX rates to INR — update weekly
// Base: INR
const FX_TO_INR: Record<string, number> = {
  USD: 84.5,
  EUR: 91.0,
  GBP: 106.5,
  AED: 23.0,
  SGD: 62.5,
  AUD: 54.0,
  CAD: 61.5,
  CHF: 96.0,
  JPY: 0.56,
  INR: 1,
}

export function toINR(amount: number, currency: string): number {
  const rate = FX_TO_INR[currency.toUpperCase()]
  if (!rate) return 0
  return Math.round(amount * rate)
}

export function annualize(amount: number, period: 'year' | 'month' | 'hour'): number {
  if (period === 'month') return amount * 12
  if (period === 'hour') return amount * 40 * 52
  return amount
}

/** USD pivot (HLD dynamic preferences §6): per-user currencies convert through USD. INR columns are kept for compatibility. */
const FX_TO_USD: Record<string, number> = {
  USD: 1, INR: 1 / 84.5, EUR: 1.08, GBP: 1.26, AED: 0.272, SGD: 0.74, AUD: 0.64, CAD: 0.73, CHF: 1.14, JPY: 0.0066,
  PLN: 0.25, SEK: 0.093, DKK: 0.145, NOK: 0.092, CZK: 0.043, BRL: 0.18, MXN: 0.05, ILS: 0.27, NZD: 0.59, HKD: 0.128,
  PHP: 0.0175, IDR: 0.000063, MYR: 0.22, THB: 0.029, VND: 0.00004, KRW: 0.00072, CNY: 0.138, ZAR: 0.055, NGN: 0.00065, TRY: 0.03, SAR: 0.267, PKR: 0.0036, BDT: 0.0084, LKR: 0.0034,
}

export function toUSD(amount: number, currency: string): number {
  const rate = FX_TO_USD[currency.toUpperCase()]
  if (!rate) return 0
  return Math.round(amount * rate)
}

export function fromUSD(amountUsd: number, currency: string): number {
  const rate = FX_TO_USD[currency.toUpperCase()]
  if (!rate) return 0
  return Math.round(amountUsd / rate)
}

export const SUPPORTED_CURRENCIES = Object.keys(FX_TO_USD)
