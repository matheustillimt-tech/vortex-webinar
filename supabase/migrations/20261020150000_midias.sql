-- Imagens do webinar (logo, avatar, banners, imagens do chatbot). Leitura pública (a sala exibe); escrita só pelo
-- servidor com a service role, que ignora RLS. Nenhuma política de escrita para usuários.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('midias', 'midias', true, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
