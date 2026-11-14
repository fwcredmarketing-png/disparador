// /baixar → redireciona para o instalador mais recente.
// Se o GitHub estiver fora do ar, manda para a página de Releases.
const { ultimaVersao, PAGINA_RELEASES } = require('./_release')

module.exports = async (req, res) => {
  let destino = PAGINA_RELEASES
  try {
    destino = (await ultimaVersao()).url
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600')
  } catch {
    res.setHeader('Cache-Control', 'no-store')
  }
  res.statusCode = 302
  res.setHeader('Location', destino)
  res.end()
}
