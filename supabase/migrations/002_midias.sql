-- =====================================================================
-- Mídias das campanhas (imagem, vídeo, áudio, PDF) no Supabase Storage.
-- Bucket privado: só membros da equipe logados conseguem enviar e baixar.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit)
values ('midias', 'midias', false, 52428800) -- 50 MB por arquivo
on conflict (id) do nothing;

create policy "midias: membros leem" on storage.objects
  for select to authenticated using (bucket_id = 'midias' and public.sou_membro());
create policy "midias: membros enviam" on storage.objects
  for insert to authenticated with check (bucket_id = 'midias' and public.sou_membro());
create policy "midias: membros removem" on storage.objects
  for delete to authenticated using (bucket_id = 'midias' and public.sou_membro());
