-- Chave só do ponto (26/11/2026): quem está em rmb_config.emails_ponto lê o ponto (batidas, ausências, avisos e
-- correções do ponto) sem ganhar o RH inteiro (pode_ver_pessoal). Quem já vê pessoal continua vendo igual.
create or replace function public.pode_ver_ponto() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.pode_ver_pessoal(), false)
      or lower(coalesce(auth.jwt() ->> 'email', '')) in (
           select lower(btrim(e)) from regexp_split_to_table(
                  coalesce((select valor from rmb_config where chave = 'emails_ponto'), ''), ',') as e
            where btrim(e) <> '')
$$;
revoke all on function public.pode_ver_ponto() from public, anon;
grant execute on function public.pode_ver_ponto() to authenticated;

create policy ponto_ler on public.rh_flash_batida for select to authenticated using (coalesce(public.pode_ver_ponto(), false));
create policy ponto_ler on public.rh_flash_ausencia for select to authenticated using (coalesce(public.pode_ver_ponto(), false));
create policy ponto_ler on public.ponto_aviso for select to authenticated using (coalesce(public.pode_ver_ponto(), false));
create policy ponto_ler on public.ponto_correcao for select to authenticated using (coalesce(public.pode_ver_ponto(), false));

insert into rmb_config (chave, valor) values ('emails_ponto', '') on conflict (chave) do nothing;
