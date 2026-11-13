import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Contact } from '@shared/types'
import { fmtPhone, useAction, useToast } from '../lib'

const PAGE = 200

export default function Contatos() {
  const run = useAction()
  const toast = useToast()
  const [list, setList] = useState<Contact[]>([])
  const [q, setQ] = useState('')
  const [tagFilter, setTagFilter] = useState('')
  const [form, setForm] = useState({ name: '', phone: '', tags: '' })
  const [importTags, setImportTags] = useState('')
  const [limit, setLimit] = useState(PAGE)

  const load = useCallback(() => window.api.contacts.list().then(setList), [])
  useEffect(() => {
    load()
    return window.api.contacts.onChanged(load)
  }, [load])

  const tags = useMemo(() => [...new Set(list.flatMap((c) => c.tags))].sort(), [list])
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    const digits = s.replace(/\D/g, '')
    return list.filter(
      (c) =>
        (!tagFilter || c.tags.includes(tagFilter)) &&
        (!s || c.name.toLowerCase().includes(s) || (digits && c.phone.includes(digits)))
    )
  }, [list, q, tagFilter])

  const add = async () => {
    const r = await run(
      () =>
        window.api.contacts.add({
          name: form.name,
          phone: form.phone,
          tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean)
        }),
      'Contato adicionado'
    )
    if (r) {
      setForm({ name: '', phone: '', tags: form.tags })
      load()
    }
  }

  const importFile = async () => {
    const r = await run(() =>
      window.api.contacts.importFile(importTags.split(',').map((t) => t.trim()).filter(Boolean))
    )
    if (r) {
      toast(`${r.added} importados • ${r.duplicates} duplicados • ${r.invalid} inválidos`, 'ok')
      load()
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Contatos</h1>
          <p>
            {list.length} contatos • {list.filter((c) => c.optOut).length} descadastrados
          </p>
        </div>
        <button
          className="btn danger ghost"
          disabled={!list.length}
          onClick={() =>
            confirm('Apagar TODOS os contatos? Essa ação não pode ser desfeita.') &&
            run(() => window.api.contacts.clear(), 'Contatos apagados').then(load)
          }
        >
          Limpar tudo
        </button>
      </header>

      <div className="grid-2">
        <section className="card glass">
          <h3>Importar planilha</h3>
          <p className="muted">
            Arquivo <b>.csv</b> ou <b>.txt</b>. Colunas aceitas: <code>nome; telefone; tags</code> — ou apenas um
            telefone por linha. Números sem DDI recebem +55 automaticamente.
          </p>
          <label>
            Etiquetas para os importados (opcional, separadas por vírgula)
            <input value={importTags} onChange={(e) => setImportTags(e.target.value)} placeholder="clientes, sp" />
          </label>
          <button className="btn primary" onClick={importFile}>
            ⇪ Escolher arquivo
          </button>
        </section>
        <section className="card glass">
          <h3>Adicionar manualmente</h3>
          <div className="form-row">
            <input placeholder="Nome" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input
              placeholder="(11) 99999-9999"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && add()}
            />
          </div>
          <input placeholder="Etiquetas (vírgula)" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
          <button className="btn" onClick={add}>
            + Adicionar
          </button>
        </section>
      </div>

      <section className="card glass">
        <div className="toolbar">
          <input className="search" placeholder="Buscar por nome ou número…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={tagFilter} onChange={(e) => setTagFilter(e.target.value)}>
            <option value="">Todas as etiquetas</option>
            {tags.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <span className="muted">{filtered.length} resultado(s)</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>Telefone</th>
                <th>Etiquetas</th>
                <th>Recebe?</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, limit).map((c) => (
                <tr key={c.id} className={c.optOut ? 'dim' : ''}>
                  <td>{c.name || <span className="muted">—</span>}</td>
                  <td className="mono">{fmtPhone(c.phone)}</td>
                  <td>
                    {c.tags.map((t) => (
                      <span key={t} className="tag">
                        {t}
                      </span>
                    ))}
                  </td>
                  <td>
                    <label className="switch">
                      <input
                        type="checkbox"
                        checked={!c.optOut}
                        onChange={(e) => run(() => window.api.contacts.setOptOut(c.id, !e.target.checked)).then(load)}
                      />
                      <span />
                    </label>
                  </td>
                  <td className="right">
                    <button className="icon-btn" title="Excluir" onClick={() => run(() => window.api.contacts.remove(c.id)).then(load)}>
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length && <div className="empty">Nenhum contato por aqui ainda.</div>}
        </div>
        {filtered.length > limit && (
          <button className="btn ghost block" onClick={() => setLimit(limit + PAGE)}>
            Mostrar mais ({filtered.length - limit} restantes)
          </button>
        )}
      </section>
    </div>
  )
}
