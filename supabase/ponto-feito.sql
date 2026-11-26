-- "O que foi feito" no ponto (26/11/2026): quem tem a chave do ponto (pode_ver_ponto) anota, por pessoa e dia,
-- o que resolveu no apontamento (ex.: "folga combinada", "lançado atestado na Flash"). Tabela própria: não mexe em
-- ponto_correcao nem nos avisos do WhatsApp. Só acrescenta; quem escreveu e quando ficam gravados pelo banco.
create table if not exists public.ponto_feito (
  id          bigserial primary key,
  dia         date    not null,
  pessoa_id   integer not null references public.rh_pessoa(id),
  unidade     text,
  texto       text    not null check (char_length(btrim(texto)) between 1 and 500),
  autor_email text    not null,
  em          timestamptz not null default now()
);
create index if not exists ponto_feito_dia_idx on public.ponto_feito (dia, unidade);
alter table public.ponto_feito enable row level security;
revoke all on public.ponto_feito from anon, authenticated;
grant select on public.ponto_feito to authenticated;
create policy ponto_feito_ler on public.ponto_feito for select to authenticated using (coalesce(public.pode_ver_ponto(), false));

-- único caminho de escrita: confere a chave, o dia (até 8 dias para trás) e grava o e-mail de quem está logado
create or replace function public.ponto_feito_gravar(p_dia date, p_pessoa_id integer, p_unidade text, p_texto text)
returns public.ponto_feito
language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_texto text := btrim(coalesce(p_texto, ''));
  v_linha public.ponto_feito;
begin
  if v_email = '' or not coalesce(public.pode_ver_ponto(), false) then
    raise exception 'sem acesso ao ponto' using errcode = '42501';
  end if;
  if p_dia is null or p_dia > (now() at time zone 'America/Sao_Paulo')::date
     or p_dia < (now() at time zone 'America/Sao_Paulo')::date - 8 then
    raise exception 'dia fora da janela do ponto' using errcode = '22023';
  end if;
  if char_length(v_texto) < 1 or char_length(v_texto) > 500 then
    raise exception 'escreva de 1 a 500 letras' using errcode = '22023';
  end if;
  if not exists (select 1 from rh_pessoa where id = p_pessoa_id) then
    raise exception 'pessoa não encontrada' using errcode = '22023';
  end if;
  insert into ponto_feito (dia, pessoa_id, unidade, texto, autor_email)
  values (p_dia, p_pessoa_id, nullif(btrim(coalesce(p_unidade, '')), ''), v_texto, v_email)
  returning * into v_linha;
  return v_linha;
end $$;
revoke all on function public.ponto_feito_gravar(date, integer, text, text) from public, anon;
grant execute on function public.ponto_feito_gravar(date, integer, text, text) to authenticated;
