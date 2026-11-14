-- =====================================================================
-- 1) Formato "botão" (EXPERIMENTAL): imagem + texto + um botão de verdade
--    ("Simular agora") que abre o link de autocontratação.
--    Pelo QR Code isso usa um recurso não oficial do WhatsApp: pode não
--    aparecer em alguns aparelhos e aumenta o risco de bloqueio do número.
-- 2) Canal da campanha: WhatsApp ou SMS (API externa).
-- Rode uma vez no SQL Editor do Supabase.
-- =====================================================================

alter table public.campanhas drop constraint if exists campanhas_formato_check;
alter table public.campanhas
  add constraint campanhas_formato_check check (formato in ('imagem', 'cartao', 'botao'));
alter table public.campanhas add column if not exists botao_texto text;
alter table public.campanhas
  add column if not exists canal text not null default 'whatsapp' check (canal in ('whatsapp', 'sms'));

-- A view usa c.*: precisa ser recriada para incluir as colunas novas.
drop view public.campanhas_resumo;
create view public.campanhas_resumo with (security_invoker = true) as
select
  c.*,
  coalesce(e.total, 0)      as total,
  coalesce(e.enviados, 0)   as enviados,
  coalesce(e.falhas, 0)     as falhas,
  coalesce(e.invalidos, 0)  as invalidos,
  coalesce(e.ignorados, 0)  as ignorados,
  coalesce(e.pendentes, 0)  as pendentes,
  (c.status = 'running' and (c.sinal_em is null or c.sinal_em < now() - interval '3 minutes')) as sem_sinal
from public.campanhas c
left join lateral (
  select
    count(*)                                     as total,
    count(*) filter (where x.status = 'sent')    as enviados,
    count(*) filter (where x.status = 'failed')  as falhas,
    count(*) filter (where x.status = 'invalid') as invalidos,
    count(*) filter (where x.status = 'skipped') as ignorados,
    count(*) filter (where x.status = 'pending') as pendentes
  from public.envios x
  where x.campanha_id = c.id
) e on true;

revoke all on public.campanhas_resumo from anon;
grant select on public.campanhas_resumo to authenticated;
