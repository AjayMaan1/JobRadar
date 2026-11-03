const $ = (id) => document.getElementById(id)
const send = (msg) => new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve))
let tabId = null, kit = null

document.getElementById('options').addEventListener('click', (e) => { e.preventDefault(); chrome.runtime.openOptionsPage() })

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  tabId = tab.id
  const r = await send({ type: 'kit', tabId })
  if (!r.ok) { $('status').textContent = ''; $('error').textContent = r.code === 'unpaired' ? 'Not paired yet — open options and paste your JobRadar URL + token.' : r.error; return }
  kit = r.data
  $('status').hidden = true
  $('job').hidden = false
  if (kit.job) {
    $('job-title').textContent = `${kit.job.title} — ${kit.job.company}`
    $('job-meta').innerHTML = `${kit.job.ats} · matched by ${kit.job.matchedBy}` + (kit.resume ? ` · <span class="pill">${kit.resume.kind === 'tailored' ? 'tailored resume ready' : 'master resume'}</span>` : ' · no resume uploaded') + (kit.application ? ` · already applied (${kit.application.status})` : '')
    $('applied').disabled = Boolean(kit.application)
  } else {
    $('job-title').textContent = 'No matching JobRadar job for this page'
    $('job-meta').textContent = `Profile-only fill (${kit.ats}). Open the job in JobRadar first to get the tailored resume, answers and cover note.`
  }
  $('fill').disabled = false
  renderAnswers()
}

function renderAnswers() {
  const box = $('answers')
  box.innerHTML = ''
  const items = [...(kit.coverNote ? [{ question: 'Cover note', answer: kit.coverNote }] : []), ...(kit.answers || [])]
  if (!items.length) return
  const h = document.createElement('div'); h.className = 'muted'; h.textContent = 'Drafted answers (copy if a field was not matched):'; box.appendChild(h)
  for (const a of items) {
    const d = document.createElement('div'); d.className = 'answer'
    d.innerHTML = `<div class="q"></div><div class="a"></div><button>Copy</button>`
    d.querySelector('.q').textContent = a.question + (a.flagged ? ' ⚠ check facts' : '')
    d.querySelector('.a').textContent = a.answer
    d.querySelector('button').addEventListener('click', () => navigator.clipboard.writeText(a.answer))
    box.appendChild(d)
  }
}

$('fill').addEventListener('click', async () => {
  $('fill').disabled = true; $('error').textContent = ''; $('report').textContent = 'Filling…'
  const r = await send({ type: 'fill', tabId, onlyEmpty: $('onlyEmpty').checked, attach: $('attach').checked })
  $('fill').disabled = false
  if (!r.ok) { $('report').textContent = ''; $('error').textContent = r.error; return }
  const rep = r.data
  const ul = document.createElement('ul')
  for (const f of rep.filled) { const li = document.createElement('li'); li.textContent = `✓ ${f.key}${f.question ? `: ${f.question.slice(0, 50)}` : ''}${f.filename ? ` (${f.filename})` : ''}`; ul.appendChild(li) }
  for (const s of rep.skipped) { const li = document.createElement('li'); li.className = 'skip'; li.textContent = `– ${s.key}${s.question ? `: ${s.question.slice(0, 50)}` : ''} — ${s.reason}`; ul.appendChild(li) }
  $('report').innerHTML = `<div class="muted">${rep.ats} form · ${rep.filled.length} filled · ${rep.skipped.length} skipped</div>`
  $('report').appendChild(ul)
})

$('applied').addEventListener('click', async () => {
  $('applied').disabled = true; $('error').textContent = ''
  const r = await send({ type: 'applied', tabId, followUpInDays: Number($('followup').value) })
  if (!r.ok) { $('error').textContent = r.error; $('applied').disabled = false; return }
  $('job-meta').textContent += ' · marked applied ✓'
})

init().catch((e) => { $('status').textContent = ''; $('error').textContent = e.message })
