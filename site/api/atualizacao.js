// /atualizacoes/<arquivo> → usado pela atualização automática do app.
//   latest.yml  → descreve a versão mais nova (lido a cada 30 min por cada computador)
//   *.exe       → o instalador da versão nova
//   *.blockmap  → (opcional) permite baixar só o que mudou
const { acharArquivo, linkTemporario, conteudo, redirecionar } = require('./_release')

module.exports = async (req, res) => {
  const nome = String(req.query.arquivo || '')
  if (!/^[\w.\- ]+$/.test(nome)) {
    res.statusCode = 400
    return res.end('Arquivo inválido')
  }
  try {
    const asset = await acharArquivo(nome)
    if (!asset) {
      res.statusCode = 404
      res.setHeader('Cache-Control', 'public, s-maxage=60')
      return res.end('Não encontrado')
    }
    if (nome.endsWith('.yml')) {
      res.setHeader('Content-Type', 'text/yaml; charset=utf-8')
      res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=600')
      return res.end(await conteudo(asset))
    }
    redirecionar(res, await linkTemporario(asset), 'public, s-maxage=60')
  } catch (e) {
    res.statusCode = 502
    res.setHeader('Cache-Control', 'no-store')
    res.end(`Falha ao consultar o GitHub: ${e.message}`)
  }
}
