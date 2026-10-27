-- Repetição "segunda a sexta" (23/10/2026): o webinar gravado diário não roda sábado e domingo.
alter table agendas drop constraint if exists agendas_repeticao_check;
alter table agendas add constraint agendas_repeticao_check check (repeticao in ('nenhuma', 'diaria', 'dias_uteis', 'semanal'));
