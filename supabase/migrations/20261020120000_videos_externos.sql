-- Vídeo por link externo (HLS ou MP4 já hospedado), além do enviado ao Bunny.
alter table public.videos
  add column origem text not null default 'bunny' check (origem in ('bunny', 'externo'));
