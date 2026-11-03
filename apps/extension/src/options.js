import { getConfig, setConfig, me } from './api.js'
const $ = (id) => document.getElementById(id)
getConfig().then((c) => { $('baseUrl').value = c.baseUrl; $('token').value = c.token })
$('save').addEventListener('click', async () => {
  const baseUrl = $('baseUrl').value.trim().replace(/\/$/, '')
  const token = $('token').value.trim()
  $('msg').textContent = 'Saving…'; $('msg').className = ''
  try {
    if (!/^https?:\/\//.test(baseUrl)) throw new Error('URL must start with http:// or https://')
    // host permission for the JobRadar origin (optional permission; pre-granted for localhost)
    const origin = new URL(baseUrl).origin + '/*'
    const granted = await chrome.permissions.contains({ origins: [origin] }) || await chrome.permissions.request({ origins: [origin] })
    if (!granted) throw new Error(`Permission for ${origin} was not granted`)
    await setConfig({ baseUrl, token })
    const r = await me()
    $('msg').textContent = `Connected as ${r.user.email} (${r.app.name} ${r.app.version}).`; $('msg').className = 'ok'
  } catch (e) {
    $('msg').textContent = e.message; $('msg').className = 'err'
  }
})
