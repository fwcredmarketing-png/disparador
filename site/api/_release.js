// Busca a última versão publicada no GitHub Releases (repositório público, sem token).
const REPO = 'fwcredmarketing-png/disparador'
const PAGINA_RELEASES = `https://github.com/${REPO}/releases/latest`

async function ultimaVersao() {
  const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'disparador-download' }
  })
  if (!r.ok) throw new Error(`GitHub respondeu ${r.status}`)
  const rel = await r.json()
  const exe = (rel.assets || []).find((a) => a.name.toLowerCase().endsWith('.exe'))
  if (!exe) throw new Error('Release sem instalador')
  return {
    versao: rel.tag_name.replace(/^v/, ''),
    publicadoEm: rel.published_at,
    tamanhoMB: Math.round(exe.size / 1048576),
    url: exe.browser_download_url
  }
}

module.exports = { ultimaVersao, PAGINA_RELEASES }
