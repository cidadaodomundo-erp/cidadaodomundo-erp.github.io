-- Ponte das anotações "o que foi feito" (27/11/2026): o aviso diário do ponto, que roda fora deste banco, lê quem já foi
-- anotado para não cobrar de novo. Só sai id, dia, nome, texto, autor (parte antes do @) e hora de ponto_feito, no máximo 10 dias.
-- Quem chama precisa da chave guardada em ponto_ponte_chave (tabela fechada, sem política; o valor não fica no repositório).
create table if not exists public.ponto_ponte_chave (id int primary key default 1 check (id = 1), valor text not null check (length(valor) >= 32));
alter table public.ponto_ponte_chave enable row level security;
revoke all on public.ponto_ponte_chave from public, anon, authenticated;
-- insert into public.ponto_ponte_chave (id, valor) values (1, '<chave>') on conflict (id) do update set valor = excluded.valor;

create or replace function public.ponto_feito_respondidos(p_de date, p_ate date, p_chave text)
returns table(id bigint, dia date, nome text, texto text, autor text, em timestamptz)
language plpgsql stable security definer set search_path = public as $f$
declare v_chave text := (select valor from ponto_ponte_chave where ponto_ponte_chave.id = 1);
begin
  if v_chave is null or length(v_chave) < 32 or p_chave is distinct from v_chave then
    raise exception 'chave inválida' using errcode = '42501';
  end if;
  if p_de is null or p_ate is null or p_ate < p_de or p_ate - p_de > 10 then
    raise exception 'período inválido' using errcode = '22023';
  end if;
  return query
    select f.id, f.dia, p.nome, f.texto, split_part(f.autor_email, '@', 1), f.em
      from ponto_feito f join rh_pessoa p on p.id = f.pessoa_id
     where f.dia between p_de and p_ate
     order by f.id;
end $f$;
revoke all on function public.ponto_feito_respondidos(date, date, text) from public;
grant execute on function public.ponto_feito_respondidos(date, date, text) to anon, authenticated;
