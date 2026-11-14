-- =====================================================================
-- Link de autocontratação da equipe.
-- Um único link para todos, cadastrado pelo administrador em Configurações.
-- Nas campanhas, a variável {link} da mensagem é trocada por ele.
-- =====================================================================

alter table public.configuracoes
  add column link_autocontratacao text not null default ''
  check (link_autocontratacao = '' or link_autocontratacao ~* '^https?://[^\s]+$');
