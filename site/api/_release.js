// Acesso às versões publicadas no GitHub Releases.
//
// Usa a API do GitHub (e não o link github.com/.../releases/download), porque
// o link direto pode ficar bloqueado para contas novas. Se a variável
// GITHUB_TOKEN estiver configurada na Vercel (token só de leitura), ela é usada
// para ter um limite maior de consultas — e permitiria até um repositório privado,
// sem nunca colocar o token dentro do app.
const REPO = 'fwcredmarketing-png/disparador'
const API = `https://api.github.com/repos/${REPO}`
const PAGINA_RELEASES = `https://github.com/${REPO}/releases/latest`

function headers(accept = 'application/vnd.github+json') {
  const h = { Accept: accept, 'User-Agent': 'disparador-download', 'X-GitHub-Api-Version': '2022-11-28' }
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  return h
}

async function json(url) {
  const r = await fetch(url, { headers: headers() })
  if (!r.ok) throw new Error(`GitHub respondeu ${r.status}`)
  return r.json()
}

/** Versões publicadas (sem rascunhos), da mais nova para a mais antiga. */
async function releases() {
  const todas = await json(`${API}/releases?per_page=30`)
  return todas
    .filter((r) => !r.draft && !r.prerelease)
    .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))
}

/** Versão mais nova que tem instalador (ignora releases incompletas). */
async function ultimaRelease() {
  const rel = (await releases()).find((r) => instalador(r))
  if (!rel) throw new Error('Nenhuma versão com instalador')
  return rel
}

/** Procura um arquivo pelo nome, da versão mais nova para a mais antiga. */
async function acharArquivo(nome) {
  for (const rel of await releases()) {
    const asset = (rel.assets || []).find((a) => a.name === nome)
    if (asset) return asset
  }
  return null
}

/** Link temporário (assinado pelo GitHub, válido por alguns minutos) para baixar o arquivo. */
async function linkTemporario(asset) {
  const r = await fetch(`${API}/releases/assets/${asset.id}`, {
    headers: headers('application/octet-stream'),
    redirect: 'manual'
  })
  const destino = r.headers.get('location')
  if (!destino) throw new Error(`GitHub não devolveu o link do arquivo (${r.status})`)
  return destino
}

/** Conteúdo de um arquivo pequeno (ex.: latest.yml). */
async function conteudo(asset) {
  const r = await fetch(await linkTemporario(asset))
  if (!r.ok) throw new Error(`Falha ao ler ${asset.name} (${r.status})`)
  return r.text()
}

function instalador(release) {
  return (release.assets || []).find((a) => a.name.toLowerCase().endsWith('.exe')) || null
}

function redirecionar(res, url, cache) {
  res.statusCode = 302
  res.setHeader('Location', url)
  res.setHeader('Cache-Control', cache)
  res.end()
}

module.exports = { ultimaRelease, acharArquivo, linkTemporario, conteudo, instalador, redirecionar, PAGINA_RELEASES }
