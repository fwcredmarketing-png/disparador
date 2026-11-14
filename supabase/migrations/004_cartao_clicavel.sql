-- =====================================================================
-- Formato "cartão clicável": a mensagem chega com um cartão grande
-- (imagem da campanha + título + descrição) que abre o link de
-- autocontratação ao tocar. Pelo QR Code o WhatsApp não mostra botões;
-- o cartão é a forma confiável de ter algo clicável e chamativo.
-- =====================================================================

alter table public.campanhas
  add column formato text not null default 'imagem' check (formato in ('imagem', 'cartao')),
  add column cartao_titulo text,
  add column cartao_descricao text;

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
