import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

/** Remove o prefixo técnico do Electron das mensagens de erro. */
export const errMsg = (e: unknown): string =>
  String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export const fmtPhone = (p: string): string => {
  const m = p.match(/^55(\d{2})(\d{4,5})(\d{4})$/)
  return m ? `+55 (${m[1]}) ${m[2]}-${m[3]}` : `+${p}`
}

export const fmtDate = (t?: number): string => (t ? new Date(t).toLocaleString('pt-BR') : '—')

type Toast = { id: number; text: string; kind: 'ok' | 'err' | 'info' }
type ToastFn = (text: string, kind?: Toast['kind']) => void

const ToastCtx = createContext<ToastFn>(() => {})
export const useToast = (): ToastFn => useContext(ToastCtx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([])
  const push = useCallback<ToastFn>((text, kind = 'info') => {
    const id = Date.now() + Math.random()
    setList((l) => [...l, { id, text, kind }])
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), 4500)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts">
        {list.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

/** Executa uma ação assíncrona mostrando erro em toast. */
export function useAction() {
  const toast = useToast()
  return useCallback(
    async <T,>(fn: () => Promise<T>, ok?: string): Promise<T | undefined> => {
      try {
        const r = await fn()
        if (ok) toast(ok, 'ok')
        return r
      } catch (e) {
        toast(errMsg(e), 'err')
        return undefined
      }
    },
    [toast]
  )
}
