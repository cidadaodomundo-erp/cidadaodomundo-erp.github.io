drop policy if exists ponto_ler on public.rh_flash_batida;
drop policy if exists ponto_ler on public.rh_flash_ausencia;
drop policy if exists ponto_ler on public.ponto_aviso;
drop policy if exists ponto_ler on public.ponto_correcao;
drop function if exists public.pode_ver_ponto();
delete from rmb_config where chave = 'emails_ponto';
