-- Cores padrão das telas novas: a barra de vagas do login usa a cor de marca (verde) e os botões do login e da oferta
-- usam os verdes do tema. Só muda o default de linhas novas: as já salvas continuam com a cor escolhida.
alter table public.telas_login
  alter column barra_cor set default '#0a8452',
  alter column botao_cor set default '#007509';

alter table public.ofertas
  alter column botao_cor set default '#02890b';
