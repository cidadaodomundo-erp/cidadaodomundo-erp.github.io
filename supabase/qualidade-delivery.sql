-- 22/11/2026 (pedido do Fábio): Qualidade e avaliações do Delivery no portal novo (delivery/qualidade.html). Só leitura.
-- Adaptação da tela "Como fomos · Qualidade do Delivery" do portal antigo, só com o que JÁ ESTÁ no banco do ERP:
--   ifood_pedidos_api   (pedidos do iFood pela API: cancelamentos com motivo, disputas/acordos)
--   ifood_avaliacoes_api (avaliações do iFood pela API)
--   dim_lojas            (marca -> unidade)
-- NÃO tem no ERP (e esta função não inventa): horário prometido ao cliente (no prazo / atrasos), chamados,
-- taxa de resposta do chat, maquininha e análise dos entregadores. Nada foi copiado do banco pessoal.
-- Acesso: só os donos (eh_dono(): Neto e Fábio).
CREATE OR REPLACE FUNCTION public.erp_qualidade_delivery(p_ini date, p_fim date, p_unidade text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_u text := nullif(p_unidade, '');
  v_res jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'não autenticado' USING ERRCODE = '28000'; END IF;
  IF NOT public.eh_dono() THEN RAISE EXCEPTION 'sem acesso a esta consulta' USING ERRCODE = '42501'; END IF;
  IF p_ini IS NULL OR p_fim IS NULL OR p_fim < p_ini OR p_fim > v_hoje OR p_fim - p_ini > 62 THEN
    RAISE EXCEPTION 'período inválido (até 63 dias, sem datas futuras)' USING ERRCODE = '22023'; END IF;
  IF v_u IS NOT NULL AND v_u NOT IN ('AGUA VERDE', 'SÃO BRAZ', 'AHU', 'BOQUEIRAO') THEN
    RAISE EXCEPTION 'unidade inválida' USING ERRCODE = '22023'; END IF;

  WITH p AS (
    SELECT a.data dia, d.unidade, d.nome_loja marca, a.id_curto, a.criado_em,
           (a.cancelamento_tipo IS NOT NULL OR a.status = 'CANCELLED') cancelou,
           CASE WHEN a.cancelamento_tipo = 'PARCIAL' THEN 'PARCIAL' WHEN a.cancelamento_tipo IS NOT NULL OR a.status = 'CANCELLED' THEN 'TOTAL' END tipo,
           coalesce(a.exp_motivo_cancelamento, a.ev_cancel_motivo, CASE WHEN a.codigo_cancelamento IS NOT NULL THEN 'código ' || a.codigo_cancelamento END, 'sem motivo informado') motivo,
           CASE WHEN a.cancelamento_tipo = 'PARCIAL' THEN coalesce(a.reembolso_valor, 0)
                WHEN a.cancelamento_tipo IS NOT NULL OR a.status = 'CANCELLED' THEN coalesce(a.total_pago_cliente, 0) ELSE 0 END valor_cancel,
           coalesce(a.teve_disputa, false) disputa, coalesce(a.teve_acordo, false) acordo
    FROM public.ifood_pedidos_api a JOIN public.dim_lojas d ON d.id_loja = a.id_loja
    WHERE a.status IS NOT NULL AND a.data BETWEEN p_ini AND p_fim AND (v_u IS NULL OR d.unidade = v_u)
  ), av AS (
    SELECT i.data_avaliacao dia, d.unidade, d.nome_loja marca, i.nota, i.comentario, i.id_pedido_curto pedido, i.avaliado_em,
           (i.resposta_em IS NOT NULL OR coalesce(i.respostas_qtd, 0) > 0 OR i.situacao = 'REPLIED') respondida
    FROM public.ifood_avaliacoes_api i JOIN public.dim_lojas d ON d.id_loja = i.id_loja
    WHERE i.data_avaliacao BETWEEN p_ini AND p_fim AND i.nota IS NOT NULL AND (v_u IS NULL OR d.unidade = v_u)
  ), chaves AS (
    SELECT unidade, marca FROM p UNION SELECT unidade, marca FROM av
  ), marca AS (
    SELECT c.unidade, c.marca,
      (SELECT count(*) FROM p WHERE p.unidade = c.unidade AND p.marca = c.marca) pedidos,
      (SELECT count(*) FROM p WHERE p.unidade = c.unidade AND p.marca = c.marca AND p.tipo = 'TOTAL') cancel_total,
      (SELECT count(*) FROM p WHERE p.unidade = c.unidade AND p.marca = c.marca AND p.tipo = 'PARCIAL') cancel_parcial,
      (SELECT coalesce(sum(valor_cancel), 0) FROM p WHERE p.unidade = c.unidade AND p.marca = c.marca) valor_cancel,
      (SELECT count(*) FROM p WHERE p.unidade = c.unidade AND p.marca = c.marca AND p.disputa) negociacoes,
      (SELECT count(*) FROM p WHERE p.unidade = c.unidade AND p.marca = c.marca AND p.acordo) acordos,
      (SELECT count(*) FROM av WHERE av.unidade = c.unidade AND av.marca = c.marca) avaliacoes,
      (SELECT round(avg(nota), 2) FROM av WHERE av.unidade = c.unidade AND av.marca = c.marca) media,
      (SELECT count(*) FROM av WHERE av.unidade = c.unidade AND av.marca = c.marca AND av.nota <= 3) notas_baixas
    FROM chaves c
  )
  SELECT jsonb_build_object(
    'ini', p_ini, 'fim', p_fim, 'unidade', v_u, 'consultado_em', now(),
    'fontes', jsonb_build_array(
      jsonb_build_object('rotulo', 'Pedidos do iFood (API)', 'tabela', 'ifood_pedidos_api',
        'lido_em', (SELECT max(lido_em) FROM public.ifood_pedidos_api), 'ultimo_dia', (SELECT max(data) FROM public.ifood_pedidos_api),
        'obs', 'Cancelamentos, motivo e negociações vêm do pedido. Não traz a hora prometida ao cliente.'),
      jsonb_build_object('rotulo', 'Avaliações do iFood (API)', 'tabela', 'ifood_avaliacoes_api',
        'lido_em', (SELECT max(lido_em) FROM public.ifood_avaliacoes_api), 'ultimo_dia', (SELECT max(data_avaliacao) FROM public.ifood_avaliacoes_api),
        'obs', 'O iFood libera a avaliação cerca de 24 horas depois do pedido.')),
    'marcas', coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.unidade, m.pedidos DESC) FROM marca m), '[]'::jsonb),
    'dias', coalesce((SELECT jsonb_agg(x ORDER BY x->>'dia') FROM (
       SELECT jsonb_build_object('dia', g::date,
         'pedidos', (SELECT count(*) FROM p WHERE p.dia = g::date),
         'cancelamentos', (SELECT count(*) FROM p WHERE p.dia = g::date AND p.cancelou),
         'negociacoes', (SELECT count(*) FROM p WHERE p.dia = g::date AND p.disputa),
         'avaliacoes', (SELECT count(*) FROM av WHERE av.dia = g::date),
         'media', (SELECT round(avg(nota), 2) FROM av WHERE av.dia = g::date)) x
       FROM generate_series(p_ini, p_fim, interval '1 day') g) s), '[]'::jsonb),
    'motivos', coalesce((SELECT jsonb_agg(x ORDER BY (x->>'qtd')::int DESC) FROM (
       SELECT jsonb_build_object('motivo', motivo, 'tipo', tipo, 'qtd', count(*), 'valor', sum(valor_cancel)) x
       FROM p WHERE cancelou GROUP BY motivo, tipo) s), '[]'::jsonb),
    'cancelados', coalesce((SELECT jsonb_agg(x) FROM (
       SELECT jsonb_build_object('dia', dia, 'hora', to_char(criado_em AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI'), 'unidade', unidade,
         'marca', marca, 'pedido', id_curto, 'tipo', tipo, 'motivo', motivo, 'valor', valor_cancel) x
       FROM p WHERE cancelou ORDER BY dia DESC, criado_em DESC LIMIT 200) s), '[]'::jsonb),
    'notas_baixas', coalesce((SELECT jsonb_agg(x) FROM (
       SELECT jsonb_build_object('dia', dia, 'unidade', unidade, 'marca', marca, 'nota', nota, 'comentario', comentario,
         'pedido', pedido, 'respondida', respondida) x
       FROM av WHERE nota <= 3 ORDER BY avaliado_em DESC LIMIT 200) s), '[]'::jsonb)
  ) INTO v_res;
  RETURN v_res;
END;
$function$;

REVOKE ALL ON FUNCTION public.erp_qualidade_delivery(date, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.erp_qualidade_delivery(date, date, text) TO authenticated;
