/**
 * JobRadar autofill engine — runs inside the employer's application page (content script) and in Node tests.
 * Pure DOM logic: find the form fields an ATS uses, fill them from the kit, attach a file, report what happened.
 * It NEVER submits a form.
 *
 * Exposed as `globalThis.JobRadarFill` so the content script, the popup (via messaging) and tests share one
 * implementation. No framework, no build step.
 */
;(function (root) {
  'use strict'

  // ── ATS detection ────────────────────────────────────────────────────────────────────────────────────────
  function detectAts(href, doc) {
    const h = (href || '').toLowerCase()
    if (h.includes('greenhouse.io')) return 'greenhouse'
    if (h.includes('lever.co')) return 'lever'
    if (h.includes('ashbyhq.com')) return 'ashby'
    if (h.includes('workable.com')) return 'workable'
    if (doc) {
      if (doc.querySelector('#application_form, #application-form, form[action*="greenhouse"]')) return 'greenhouse'
      if (doc.querySelector('.application-form .lever-form, form[action*="lever.co"]')) return 'lever'
      if (doc.querySelector('[class*="ashby-application-form"], form[action*="ashbyhq"]')) return 'ashby'
      if (doc.querySelector('form[action*="workable"], [data-ui="application-form"]')) return 'workable'
    }
    return 'generic'
  }

  // ── Field specs ──────────────────────────────────────────────────────────────────────────────────────────
  // key → value from the kit; selectors are tried in order; `labels` are fuzzy label/placeholder/aria matches
  // used by the generic strategy and as a fallback on every ATS.
  const SPECS = [
    { key: 'firstName', kind: 'text', selectors: ['#first_name', 'input[name="job_application[first_name]"]', 'input[name="firstName"]', 'input[name="first_name"]', 'input[autocomplete="given-name"]', 'input[name="candidate[firstname]"]', 'input[name="firstname"]'], labels: ['first name', 'given name', 'forename'] },
    { key: 'lastName', kind: 'text', selectors: ['#last_name', 'input[name="job_application[last_name]"]', 'input[name="lastName"]', 'input[name="last_name"]', 'input[autocomplete="family-name"]', 'input[name="candidate[lastname]"]', 'input[name="lastname"]'], labels: ['last name', 'family name', 'surname'] },
    { key: 'fullName', kind: 'text', selectors: ['input[name="name"]', 'input[autocomplete="name"]', 'input[name="fullName"]', 'input[name="full_name"]', 'input[name="_systemfield_name"]'], labels: ['full name', 'your name', 'name'] },
    { key: 'email', kind: 'email', selectors: ['#email', 'input[name="job_application[email]"]', 'input[type="email"]', 'input[name="email"]', 'input[autocomplete="email"]', 'input[name="_systemfield_email"]'], labels: ['email', 'e-mail'] },
    { key: 'phone', kind: 'tel', selectors: ['#phone', 'input[name="job_application[phone]"]', 'input[type="tel"]', 'input[name="phone"]', 'input[autocomplete="tel"]', 'input[name="_systemfield_phone"]'], labels: ['phone', 'mobile', 'telephone'] },
    { key: 'location', kind: 'text', selectors: ['#job_application_location', 'input[name="job_application[location]"]', 'input[name="location"]', 'input[name="candidate_location"]', 'input[name="address"]', 'input[autocomplete="street-address"]'], labels: ['location', 'current location', 'city', 'where are you based', 'address'] },
    { key: 'linkedin', kind: 'url', selectors: ['input[name="urls[LinkedIn]"]', 'input[name="linkedin"]', 'input[name*="linkedin" i]', 'input[id*="linkedin" i]', 'input[name="_systemfield_linkedin"]'], labels: ['linkedin'] },
    { key: 'github', kind: 'url', selectors: ['input[name="urls[GitHub]"]', 'input[name="github"]', 'input[name*="github" i]', 'input[id*="github" i]'], labels: ['github'] },
    { key: 'portfolio', kind: 'url', selectors: ['input[name="urls[Portfolio]"]', 'input[name="urls[Other]"]', 'input[name="website"]', 'input[name*="portfolio" i]', 'input[name*="website" i]', 'input[id*="portfolio" i]', 'input[id*="website" i]'], labels: ['portfolio', 'website', 'personal site', 'other website'] },
    { key: 'currentCompany', kind: 'text', selectors: ['input[name="org"]', 'input[name="company"]', 'input[name*="current_company" i]', 'input[name*="currentCompany" i]'], labels: ['current company', 'company', 'employer'] },
    { key: 'currentTitle', kind: 'text', selectors: ['input[name*="current_title" i]', 'input[name*="currentTitle" i]', 'input[name="title"]'], labels: ['current title', 'job title', 'current role'] },
    { key: 'coverNote', kind: 'textarea', selectors: ['#cover_letter_text', 'textarea[name="job_application[cover_letter_text]"]', 'textarea[name="comments"]', 'textarea[name="cover_letter"]', 'textarea[name*="cover" i]', 'textarea[name*="additional" i]', 'textarea[id*="cover" i]'], labels: ['cover letter', 'additional information', 'anything else', 'message', 'why do you want', 'tell us'] },
    { key: 'resume', kind: 'file', selectors: ['#resume', 'input[type="file"][name="resume"]', 'input[type="file"][name="job_application[resume]"]', 'input[type="file"][name*="resume" i]', 'input[type="file"][id*="resume" i]', 'input[type="file"][name*="cv" i]', 'input[type="file"][accept*="pdf"]', 'input[type="file"]'], labels: ['resume', 'cv', 'résumé'] },
  ]

  const DEFAULT_LABELS = {
    noticePeriod: ['notice period', 'earliest start', 'availability', 'when can you start', 'start date'],
    workAuthorization: ['authorized to work', 'authorised to work', 'work authorization', 'work permit', 'right to work', 'sponsorship', 'visa'],
    salaryExpectation: ['salary', 'compensation', 'expected ctc', 'rate expectation'],
  }

  // ── DOM helpers ──────────────────────────────────────────────────────────────────────────────────────────
  function visible(el) {
    if (!el || el.disabled || el.readOnly) return false
    if (el.type === 'hidden') return false
    const cs = el.ownerDocument.defaultView && el.ownerDocument.defaultView.getComputedStyle ? el.ownerDocument.defaultView.getComputedStyle(el) : null
    if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return false
    return true
  }

  function labelTextFor(el) {
    const doc = el.ownerDocument
    const parts = []
    if (el.id) doc.querySelectorAll(`label[for="${CSS.escape(el.id)}"]`).forEach((l) => parts.push(l.textContent))
    const wrap = el.closest('label')
    if (wrap) parts.push(wrap.textContent)
    const labelled = el.getAttribute('aria-labelledby')
    if (labelled) labelled.split(/\s+/).forEach((id) => { const n = doc.getElementById(id); if (n) parts.push(n.textContent) })
    parts.push(el.getAttribute('aria-label') || '', el.getAttribute('placeholder') || '', el.getAttribute('name') || '', el.id || '')
    // common ATS layouts: label is a previous sibling or the field wrapper's first text node
    const field = el.closest('.field, .application-question, .form-group, [class*="field"], [class*="Field"], li, div')
    if (field) { const l = field.querySelector('label, .application-label, .field-label, legend, [class*="label" i]'); if (l) parts.push(l.textContent) }
    return parts.join(' | ').replace(/\s+/g, ' ').trim().toLowerCase()
  }

  function matchesLabel(el, labels) {
    const t = labelTextFor(el)
    return labels.some((l) => t.includes(l))
  }

  function findField(doc, spec, used, selectorsOnly) {
    for (const sel of spec.selectors) {
      let list
      try { list = doc.querySelectorAll(sel) } catch { continue }
      for (const el of list) if (!used.has(el) && visible(el) && (spec.kind !== 'file' || el.type === 'file')) return el
    }
    if (selectorsOnly) return null
    // label heuristics
    const candidates = spec.kind === 'file' ? doc.querySelectorAll('input[type="file"]') : spec.kind === 'textarea' ? doc.querySelectorAll('textarea') : doc.querySelectorAll('input:not([type="hidden"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"]), textarea')
    for (const el of candidates) if (!used.has(el) && visible(el) && matchesLabel(el, spec.labels)) return el
    return null
  }

  /** React/Vue/Angular-safe value set: native setter + input/change events. */
  function setValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? root.HTMLTextAreaElement.prototype : root.HTMLInputElement.prototype
    const desc = Object.getOwnPropertyDescriptor(proto, 'value')
    if (desc && desc.set) desc.set.call(el, value)
    else el.value = value
    el.dispatchEvent(new root.Event('input', { bubbles: true }))
    el.dispatchEvent(new root.Event('change', { bubbles: true }))
    el.dispatchEvent(new root.Event('blur', { bubbles: true }))
  }

  function setSelect(el, value) {
    const v = String(value).toLowerCase()
    const opt = [...el.options].find((o) => o.value.toLowerCase() === v || o.textContent.trim().toLowerCase() === v) || [...el.options].find((o) => o.textContent.trim().toLowerCase().includes(v))
    if (!opt) return false
    el.value = opt.value
    el.dispatchEvent(new root.Event('input', { bubbles: true }))
    el.dispatchEvent(new root.Event('change', { bubbles: true }))
    return true
  }

  function attachFile(el, file) {
    try {
      const dt = new root.DataTransfer()
      dt.items.add(file)
      el.files = dt.files
      el.dispatchEvent(new root.Event('input', { bubbles: true }))
      el.dispatchEvent(new root.Event('change', { bubbles: true }))
      return el.files && el.files.length === 1
    } catch (e) {
      return false
    }
  }

  function highlight(el) {
    try {
      el.style.outline = '2px solid #10b981'
      el.style.outlineOffset = '1px'
      el.setAttribute('data-jobradar-filled', '1')
    } catch { /* ignore */ }
  }

  // ── Answers: fuzzy question ↔ label ─────────────────────────────────────────────────────────────────────
  function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim() }
  function similarity(a, b) {
    const A = new Set(norm(a).split(' ').filter((w) => w.length > 2)), B = new Set(norm(b).split(' ').filter((w) => w.length > 2))
    if (!A.size || !B.size) return 0
    let n = 0
    for (const w of A) if (B.has(w)) n++
    return n / Math.min(A.size, B.size)
  }

  function fillAnswers(doc, answers, used, report) {
    const fields = [...doc.querySelectorAll('textarea, input[type="text"], select')].filter((el) => !used.has(el) && visible(el))
    for (const a of answers || []) {
      if (!a.answer) continue
      let best = null, score = 0
      for (const el of fields) { const s = similarity(a.question, labelTextFor(el)); if (s > score) { score = s; best = el } }
      if (best && score >= 0.5) {
        used.add(best)
        if (best.tagName === 'SELECT') { if (setSelect(best, a.answer)) { highlight(best); report.filled.push({ key: 'answer', question: a.question, label: labelTextFor(best).slice(0, 60) }) } else report.skipped.push({ key: 'answer', question: a.question, reason: 'no matching option' }) }
        else { setValue(best, a.answer); highlight(best); report.filled.push({ key: 'answer', question: a.question, label: labelTextFor(best).slice(0, 60) }) }
      } else report.skipped.push({ key: 'answer', question: a.question, reason: 'no matching field — copy from the popup' })
    }
  }

  // ── Main ─────────────────────────────────────────────────────────────────────────────────────────────────
  /**
   * fill(doc, kit, opts) → report. `kit.profile` fields, `kit.coverNote`, `kit.answers`, and `opts.file`
   * (a File for the resume input). Never touches submit buttons.
   */
  function fill(doc, kit, opts) {
    opts = opts || {}
    const ats = detectAts(doc.location ? doc.location.href : '', doc)
    const used = new Set()
    const report = { ats, filled: [], skipped: [], attached: null }
    const p = kit.profile || {}
    const values = {
      firstName: p.firstName, lastName: p.lastName, fullName: p.fullName, email: p.email, phone: p.phone, location: p.location,
      linkedin: p.linkedin, github: p.github, portfolio: p.portfolio, currentCompany: p.currentCompany, currentTitle: p.currentTitle,
      coverNote: kit.coverNote,
    }
    // Pass 1: explicit selectors for every key, and label heuristics for everything except the cover note
    // (its labels — "why do you want…", "tell us…" — are also how custom questions are phrased; those are
    // matched against the drafted answers first, pass 3).
    let coverPending = false
    for (const spec of SPECS) {
      if (spec.kind === 'file') continue
      const value = values[spec.key]
      if (!value) continue
      // full name only when there is no first/last pair on the page
      if (spec.key === 'fullName' && report.filled.some((f) => f.key === 'firstName')) continue
      const el = findField(doc, spec, used, spec.key === 'coverNote')
      if (!el) { if (spec.key === 'coverNote') coverPending = true; else report.skipped.push({ key: spec.key, reason: 'field not found' }); continue }
      used.add(el)
      if (el.tagName === 'SELECT') { if (setSelect(el, value)) { highlight(el); report.filled.push({ key: spec.key }) } else report.skipped.push({ key: spec.key, reason: 'no matching option' }); continue }
      if (opts.onlyEmpty && el.value && el.value.trim()) { report.skipped.push({ key: spec.key, reason: 'already filled' }); continue }
      setValue(el, value)
      highlight(el)
      report.filled.push({ key: spec.key })
    }
    // profile defaults by label (notice period, work authorisation, salary)
    const defaults = p.applyDefaults || {}
    for (const key of Object.keys(DEFAULT_LABELS)) {
      if (!defaults[key]) continue
      const candidates = [...doc.querySelectorAll('input:not([type="hidden"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]), textarea, select')].filter((el) => !used.has(el) && visible(el) && matchesLabel(el, DEFAULT_LABELS[key]))
      const el = candidates[0]
      if (!el) continue
      used.add(el)
      if (el.tagName === 'SELECT') { if (setSelect(el, defaults[key])) { highlight(el); report.filled.push({ key }) } }
      else { setValue(el, defaults[key]); highlight(el); report.filled.push({ key }) }
    }
    fillAnswers(doc, kit.answers, used, report)
    // Pass 3: cover note by label, only into a field no answer claimed
    if (coverPending) {
      const el = findField(doc, SPECS.find((s) => s.key === 'coverNote'), used, false)
      if (el && !(opts.onlyEmpty && el.value && el.value.trim())) { used.add(el); setValue(el, values.coverNote); highlight(el); report.filled.push({ key: 'coverNote' }) }
      else report.skipped.push({ key: 'coverNote', reason: el ? 'already filled' : 'field not found — copy from the popup' })
    }
    // resume attach
    if (opts.file) {
      const el = findField(doc, SPECS.find((s) => s.key === 'resume'), used)
      if (!el) report.skipped.push({ key: 'resume', reason: 'no file input found — attach manually' })
      else if (attachFile(el, opts.file)) { highlight(el); report.attached = opts.file.name; report.filled.push({ key: 'resume', filename: opts.file.name }) }
      else report.skipped.push({ key: 'resume', reason: 'browser refused programmatic attach — attach manually' })
    }
    return report
  }

  /** Inventory for the popup: which of the known fields exist on this page. */
  function inventory(doc) {
    const used = new Set()
    const found = []
    for (const spec of SPECS) { const el = findField(doc, spec, used); if (el) { used.add(el); found.push(spec.key) } }
    return { ats: detectAts(doc.location ? doc.location.href : '', doc), fields: found, questions: [...doc.querySelectorAll('textarea')].filter(visible).map((t) => labelTextFor(t).slice(0, 80)) }
  }

  root.JobRadarFill = { fill, inventory, detectAts, setValue, attachFile, labelTextFor, similarity, SPECS }
})(typeof window !== 'undefined' ? window : globalThis)
