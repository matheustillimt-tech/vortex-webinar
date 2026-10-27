-- O editor de páginas aceita GIF (além de JPG/PNG/WEBP) nas imagens enviadas para `midias/paginas/...`.
-- Só a lista de tipos do bucket muda; o teto continua 3 MB e a escrita continua só pelo servidor (service role).
update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
where id = 'midias';
