// /api/versao → dados da última versão para a página mostrar.
const { ultimaRelease, instalador } = require('./_release')

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  try {
    const rel = await ultimaRelease()
    const exe = instalador(rel)
    if (!exe) throw new Error('Versão sem instalador')
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600')
    res.end(
      JSON.stringify({
        versao: rel.tag_name.replace(/^v/, ''),
        publicadoEm: rel.published_at,
        tamanhoMB: Math.round(exe.size / 1048576)
      })
    )
  } catch (e) {
    res.statusCode = 503
    res.setHeader('Cache-Control', 'no-store')
    res.end(JSON.stringify({ erro: e.message }))
  }
}
