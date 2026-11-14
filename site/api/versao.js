// /api/versao → dados da última versão para a página mostrar.
const { ultimaVersao } = require('./_release')

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  try {
    const v = await ultimaVersao()
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600')
    res.end(JSON.stringify({ versao: v.versao, publicadoEm: v.publicadoEm, tamanhoMB: v.tamanhoMB }))
  } catch (e) {
    res.statusCode = 503
    res.setHeader('Cache-Control', 'no-store')
    res.end(JSON.stringify({ erro: e.message }))
  }
}
