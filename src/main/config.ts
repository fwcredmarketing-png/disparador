/**
 * Endereço e chave PÚBLICA do Supabase.
 *
 * A chave pública (anon / publishable) foi feita para ficar dentro de apps:
 * sozinha ela não dá acesso a nada. Quem protege os dados é o login + RLS
 * (ver supabase/migrations/001_inicial.sql).
 *
 * NUNCA coloque aqui a senha do banco nem a chave secreta (service_role / sb_secret_...):
 * o código e o instalador são públicos.
 */
export const SUPABASE_URL = 'https://qplrsedwvdxlkiiwkyli.supabase.co'
export const SUPABASE_KEY = ''

/** Bucket privado do Storage com as mídias das campanhas. */
export const MEDIA_BUCKET = 'midias'
