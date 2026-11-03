/** Content script: receives { type:'fill'|'inventory' } from the service worker and runs the engine on this page. */
;(function () {
  if (window.__jobradarContentLoaded) return
  window.__jobradarContentLoaded = true
  chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
    try {
      if (msg.type === 'inventory') return respond(window.JobRadarFill.inventory(document)), undefined
      if (msg.type === 'fill') {
        let file = null
        if (msg.file && msg.file.bytes) file = new File([new Uint8Array(msg.file.bytes)], msg.file.name, { type: msg.file.type })
        const report = window.JobRadarFill.fill(document, msg.kit, { file, onlyEmpty: msg.onlyEmpty })
        toast(`JobRadar filled ${report.filled.length} field(s)${report.attached ? ` · attached ${report.attached}` : ''}. Review, then click Submit yourself.`)
        return respond(report), undefined
      }
    } catch (e) {
      return respond({ ats: 'unknown', filled: [], skipped: [{ key: 'page', reason: e.message }], attached: null }), undefined
    }
  })
  function toast(text) {
    const n = document.createElement('div')
    n.textContent = text
    n.setAttribute('data-jobradar-toast', '1')
    n.style.cssText = 'position:fixed;z-index:2147483647;right:16px;bottom:16px;background:#111827;color:#fff;padding:10px 14px;border-radius:8px;font:13px system-ui;box-shadow:0 4px 16px rgba(0,0,0,.3)'
    document.body.appendChild(n)
    setTimeout(() => n.remove(), 6000)
  }
})()
