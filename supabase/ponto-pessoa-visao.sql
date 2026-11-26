-- Cadastro mínimo para o ponto (26/11/2026): quem tem só a chave do ponto (pode_ver_ponto) lê nome, loja, datas e
-- vínculo Flash das pessoas, sem enxergar o resto de rh_pessoa (salário, VT, observações). Usada pelo leitor fabio-ponto-leitura.
create or replace view public.ponto_pessoa with (security_barrier = true) as
  select id, nome, unidade, admissao, desligamento, flash_id, usa_ponto, cargo_confianca
    from public.rh_pessoa
   where coalesce(public.pode_ver_ponto(), false);
revoke all on public.ponto_pessoa from public, anon, authenticated;
grant select on public.ponto_pessoa to authenticated;
