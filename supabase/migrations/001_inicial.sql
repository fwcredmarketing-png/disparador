-- =====================================================================
-- Sistema de Disparo: estrutura do banco (Supabase / Postgres)
--
-- Segurança: todas as tabelas usam RLS. Só quem está LOGADO e tem o
-- e-mail cadastrado na tabela "membros" consegue ler ou alterar dados.
-- A chave pública (anon/publishable) que vai dentro do app sozinha não
-- dá acesso a nada.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Equipe
-- ---------------------------------------------------------------------
create table public.membros (
  email      text primary key check (email = lower(btrim(email)) and email like '%_@_%'),
  nome       text not null default '',
  admin      boolean not null default false,
  criado_em  timestamptz not null default now()
);

create function public.email_atual() returns text
language sql stable set search_path = '' as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

create function public.sou_membro() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.membros m where m.email = public.email_atual())
$$;

create function public.sou_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.membros m where m.email = public.email_atual() and m.admin)
$$;

-- O app chama ao logar para saber se o usuário foi liberado.
create function public.meu_acesso() returns json
language sql stable security definer set search_path = '' as $$
  select json_build_object(
    'email',  public.email_atual(),
    'membro', m.email is not null,
    'admin',  coalesce(m.admin, false),
    'nome',   coalesce(m.nome, '')
  )
  from (select 1) x
  left join public.membros m on m.email = public.email_atual()
$$;

alter table public.membros enable row level security;
create policy "membros: membros leem" on public.membros
  for select to authenticated using (public.sou_membro());
create policy "membros: admin inclui" on public.membros
  for insert to authenticated with check (public.sou_admin());
create policy "membros: admin altera outros" on public.membros
  for update to authenticated
  using (public.sou_admin() and email <> public.email_atual())
  with check (public.sou_admin());
create policy "membros: admin remove outros" on public.membros
  for delete to authenticated using (public.sou_admin() and email <> public.email_atual());

-- ---------------------------------------------------------------------
-- Contatos
-- ---------------------------------------------------------------------
create table public.contatos (
  id             uuid primary key default gen_random_uuid(),
  nome           text not null default '',
  telefone       text not null unique check (telefone ~ '^[0-9]{11,15}$'),
  tags           text[] not null default '{}',
  descadastrado  boolean not null default false,
  criado_em      timestamptz not null default now(),
  criado_por     text default public.email_atual()
);
create index contatos_tags_idx on public.contatos using gin (tags);
create index contatos_criado_idx on public.contatos (criado_em desc);

alter table public.contatos enable row level security;
create policy "contatos: membros" on public.contatos
  for all to authenticated using (public.sou_membro()) with check (public.sou_membro());

-- ---------------------------------------------------------------------
-- Configurações compartilhadas (uma única linha)
-- A conexão do WhatsApp e o token da API da Meta NÃO ficam aqui:
-- são de cada computador e ficam criptografados localmente.
-- ---------------------------------------------------------------------
create table public.configuracoes (
  id                    int primary key default 1 check (id = 1),
  limite_diario         int not null default 300 check (limite_diario > 0),
  palavras_descadastro  text[] not null default '{SAIR,PARAR,STOP,CANCELAR,DESCADASTRAR}',
  adicionar_aviso       boolean not null default true,
  texto_aviso           text not null default 'Responda SAIR para não receber mais mensagens.',
  simular_digitando     boolean not null default true,
  atualizado_em         timestamptz not null default now()
);
insert into public.configuracoes (id) values (1);

alter table public.configuracoes enable row level security;
create policy "configuracoes: membros leem" on public.configuracoes
  for select to authenticated using (public.sou_membro());
create policy "configuracoes: admin altera" on public.configuracoes
  for update to authenticated using (public.sou_admin()) with check (public.sou_admin());

-- ---------------------------------------------------------------------
-- Campanhas e envios
-- ---------------------------------------------------------------------
create table public.campanhas (
  id                uuid primary key default gen_random_uuid(),
  nome              text not null check (btrim(nome) <> ''),
  mensagem          text not null default '',
  midia_caminho     text,          -- arquivo no Storage (bucket "midias")
  midia_nome        text,
  etiqueta          text,
  intervalo_min     int not null default 20 check (intervalo_min >= 3),
  intervalo_max     int not null default 45 check (intervalo_max >= intervalo_min),
  lote_tamanho      int not null default 0 check (lote_tamanho >= 0),
  lote_pausa        numeric not null default 0 check (lote_pausa >= 0),
  template          jsonb,         -- só API oficial: {"name": "...", "language": "pt_BR"}
  status            text not null default 'draft'
                    check (status in ('draft', 'running', 'paused', 'done', 'cancelled')),
  observacao        text,
  -- Trava de execução: só um computador envia cada campanha por vez.
  executor          text,          -- id do computador que está enviando
  executor_nome     text,          -- "operador (NOME-DO-PC)"
  sinal_em          timestamptz,   -- último "estou vivo" desse computador
  comando           text check (comando in ('pause', 'cancel')), -- pedido vindo de outro computador
  proximo_envio_em  timestamptz,
  criado_em         timestamptz not null default now(),
  criado_por        text default public.email_atual(),
  iniciado_em       timestamptz,
  finalizado_em     timestamptz
);
create index campanhas_criado_idx on public.campanhas (criado_em desc);

create table public.envios (
  id           bigint generated always as identity primary key,
  campanha_id  uuid not null references public.campanhas (id) on delete cascade,
  contato_id   uuid references public.contatos (id) on delete set null,
  telefone     text not null,
  nome         text not null default '',
  status       text not null default 'pending'
               check (status in ('pending', 'sent', 'failed', 'invalid', 'skipped')),
  erro         text,
  remetente    text,          -- número do WhatsApp que enviou
  enviado_por  text,          -- e-mail do operador
  feito_em     timestamptz
);
create index envios_campanha_idx on public.envios (campanha_id, status, id);
create index envios_enviados_idx on public.envios (feito_em) where status = 'sent';
create index envios_contato_idx on public.envios (contato_id);

alter table public.campanhas enable row level security;
create policy "campanhas: membros" on public.campanhas
  for all to authenticated using (public.sou_membro()) with check (public.sou_membro());

alter table public.envios enable row level security;
create policy "envios: membros" on public.envios
  for all to authenticated using (public.sou_membro()) with check (public.sou_membro());

-- Lista de campanhas com os totais (respeita o RLS de quem consulta).
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

-- ---------------------------------------------------------------------
-- Funções usadas pelo app (todas respeitam o RLS de quem chama)
-- ---------------------------------------------------------------------

-- Etiquetas existentes nos contatos
create function public.etiquetas() returns setof text
language sql stable set search_path = '' as $$
  select distinct unnest(tags) as t from public.contatos order by 1
$$;

-- Assume a execução de uma campanha (trava contra dois computadores ao mesmo tempo).
-- Também permite assumir uma campanha cujo computador ficou sem sinal por 3 min.
create function public.assumir_campanha(p_id uuid, p_executor text, p_executor_nome text)
returns boolean language plpgsql set search_path = '' as $$
begin
  update public.campanhas set
    status = 'running',
    executor = p_executor,
    executor_nome = p_executor_nome,
    sinal_em = now(),
    comando = null,
    observacao = null,
    iniciado_em = coalesce(iniciado_em, now())
  where id = p_id
    and (status in ('draft', 'paused')
         or (status = 'running'
             and (executor = p_executor or sinal_em is null or sinal_em < now() - interval '3 minutes')));
  return found;
end $$;

-- "Estou vivo" do computador que envia. Devolve um comando pendente
-- ('pause' / 'cancel'), '' se nada, ou 'lost' se perdeu a campanha.
create function public.sinal_campanha(p_id uuid, p_executor text, p_proximo timestamptz)
returns text language plpgsql set search_path = '' as $$
declare v_cmd text;
begin
  update public.campanhas set sinal_em = now(), proximo_envio_em = p_proximo
  where id = p_id and executor = p_executor and status = 'running'
  returning comando into v_cmd;
  if not found then return 'lost'; end if;
  return coalesce(v_cmd, '');
end $$;

-- Pausar/cancelar uma campanha que está rodando em OUTRO computador.
-- Se esse computador estiver sem sinal, aplica direto.
create function public.controlar_campanha(p_id uuid, p_acao text)
returns void language plpgsql set search_path = '' as $$
begin
  if p_acao not in ('pause', 'cancel') then
    raise exception 'Ação inválida';
  end if;
  update public.campanhas set comando = p_acao
  where id = p_id and status = 'running' and sinal_em >= now() - interval '3 minutes';
  if found then return; end if;

  update public.campanhas set
    status = case when p_acao = 'cancel' then 'cancelled' else 'paused' end,
    finalizado_em = case when p_acao = 'cancel' then now() else finalizado_em end,
    observacao = case when status = 'running' then 'O computador que enviava ficou sem sinal' else observacao end,
    executor = null, comando = null, proximo_envio_em = null
  where id = p_id and status in ('draft', 'running', 'paused');
end $$;

-- Quantas mensagens um número já enviou hoje (fuso do computador).
create function public.enviados_hoje(p_remetente text, p_tz text default 'America/Sao_Paulo')
returns int language sql stable set search_path = '' as $$
  select count(*)::int from public.envios
  where status = 'sent'
    and remetente = p_remetente
    and feito_em >= ((now() at time zone p_tz)::date)::timestamp at time zone p_tz
$$;

-- Números do painel.
create function public.estatisticas(p_remetente text default null, p_tz text default 'America/Sao_Paulo')
returns json language sql stable set search_path = '' as $$
  with hoje as (select (now() at time zone p_tz)::date as d),
  dias as (
    select generate_series((select d from hoje) - 6, (select d from hoje), interval '1 day')::date as d
  ),
  env as (
    select (e.feito_em at time zone p_tz)::date as d, e.remetente
    from public.envios e
    where e.status = 'sent'
      and e.feito_em >= (((select d from hoje) - 6)::timestamp at time zone p_tz)
  )
  select json_build_object(
    'totalContacts', (select count(*) from public.contatos),
    'optOuts',       (select count(*) from public.contatos where descadastrado),
    'sentToday',     (select count(*) from env where d = (select d from hoje)
                        and (p_remetente is null or remetente = p_remetente)),
    'totalSent',     (select count(*) from public.envios where status = 'sent'),
    'dailyLimit',    (select limite_diario from public.configuracoes where id = 1),
    'history',       (select json_agg(json_build_object(
                         'date', to_char(dias.d, 'YYYY-MM-DD'),
                         'count', (select count(*) from env where env.d = dias.d)) order by dias.d)
                      from dias)
  )
$$;

-- Descadastro automático quando o contato responde "SAIR".
-- Para números do Brasil, compara DDD + 8 últimos dígitos (resolve o 9º dígito).
create function public.descadastrar_telefone(p_telefone text)
returns int language plpgsql set search_path = '' as $$
declare
  t text := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g');
  n int;
begin
  if length(t) < 10 then return 0; end if;
  update public.contatos set descadastrado = true
  where not descadastrado
    and (telefone = t
         or (left(t, 2) = '55' and left(telefone, 4) = left(t, 4) and right(telefone, 8) = right(t, 8)));
  get diagnostics n = row_count;
  return n;
end $$;

-- Apagar todos os contatos (somente administradores, sem campanha rodando).
create function public.limpar_contatos()
returns int language plpgsql set search_path = '' as $$
declare n int;
begin
  if not public.sou_admin() then
    raise exception 'Somente administradores podem apagar todos os contatos';
  end if;
  if exists (select 1 from public.campanhas
             where status = 'running' and sinal_em >= now() - interval '3 minutes') then
    raise exception 'Pause as campanhas em andamento antes de limpar os contatos';
  end if;
  delete from public.contatos where true;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- Permissões: nada para visitantes anônimos; RLS decide o resto.
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from public, anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
