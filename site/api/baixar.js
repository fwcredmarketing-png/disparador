// /baixar → baixa o instalador mais recente.
// Se o GitHub estiver fora do ar, manda para a página de Releases.
const { ultimaRelease, instalador, linkTemporario, redirecionar, PAGINA_RELEASES } = require('./_release')

module.exports = async (req, res) => {
  try {
    const exe = instalador(await ultimaRelease())
    if (!exe) throw new Error('Versão sem instalador')
    // o link assinado do GitHub expira em poucos minutos: cache curto
    redirecionar(res, await linkTemporario(exe), 'public, s-maxage=60')
  } catch {
    redirecionar(res, PAGINA_RELEASES, 'no-store')
  }
}
