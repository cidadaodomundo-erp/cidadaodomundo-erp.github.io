-- 16/11/2026: Avaliações do dia (portal novo). Só leitura.
-- Delivery: iFood (ifood_avaliacoes_api). Site (Accon): não há avaliações gravadas no ERP.
-- Salão: Google (google_avaliacao_recente / google_avaliacao_loja, API oficial do Perfil da Empresa).
-- Lojas: as que o login vê (painel_minhas_lojas), só AGUA VERDE, SÃO BRAZ e AHU.
-- "Sem resposta": iFood = com comentário, não descartada e sem resposta da loja, nos últimos 7 dias;
--                 Google = avaliações dos últimos 30 dias sem resposta (o robô traz as 50 mais recentes de cada loja).
CREATE OR REPLACE FUNCTION public.erp_avaliacoes_dia(p_modo text, p_dia date DEFAULT NULL, p_unidade text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_dia date := coalesce(p_dia, (now() AT TIME ZONE 'America/Sao_Paulo')::date);
  v_lojas text[]; v_ok text[]; v_u text;
  v_res jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'não autenticado' USING ERRCODE = '28000'; END IF;
  IF p_modo NOT IN ('delivery', 'salao') THEN RAISE EXCEPTION 'modo inválido' USING ERRCODE = '22023'; END IF;
  IF v_dia > v_hoje OR v_dia < v_hoje - 60 THEN RAISE EXCEPTION 'dia fora do alcance' USING ERRCODE = '22023'; END IF;
  IF p_unidade IS NOT NULL AND p_unidade NOT IN ('', 'AGUA VERDE', 'SÃO BRAZ', 'AHU') THEN
    RAISE EXCEPTION 'unidade inválida' USING ERRCODE = '22023'; END IF;
  v_u := nullif(p_unidade, '');

  SELECT m.lojas INTO v_lojas FROM public.painel_minhas_lojas() m LIMIT 1;
  IF v_lojas IS NULL THEN RAISE EXCEPTION 'sem acesso a esta consulta' USING ERRCODE = '42501'; END IF;
  v_ok := array(SELECT x FROM unnest(ARRAY['AGUA VERDE', 'SÃO BRAZ', 'AHU']) x
                 WHERE (x = ANY(v_lojas) OR 'REDE' = ANY(v_lojas)) AND (v_u IS NULL OR x = v_u));

  IF p_modo = 'delivery' THEN
    WITH a AS (
      SELECT d.unidade, d.nome_loja marca, i.id_avaliacao::text id, i.nota, i.comentario, i.tags, i.avaliado_em,
             i.id_pedido_curto pedido, i.situacao, i.resposta_loja, i.resposta_em,
             (i.resposta_em IS NOT NULL OR coalesce(i.respostas_qtd, 0) > 0 OR i.situacao = 'REPLIED') respondida,
             (coalesce(btrim(i.comentario), '') <> '' AND coalesce(i.situacao, '') <> 'DISCARDED') pede_resposta,
             (i.avaliado_em AT TIME ZONE 'America/Sao_Paulo')::date dia
      FROM public.ifood_avaliacoes_api i JOIN public.dim_lojas d ON d.id_loja = i.id_loja
      WHERE d.unidade = ANY(v_ok)
        AND (i.avaliado_em >= (least(v_dia, v_hoje - 8))::timestamp AT TIME ZONE 'America/Sao_Paulo')
    )
    SELECT jsonb_build_object(
      'modo', 'delivery', 'hoje', v_hoje, 'dia', v_dia, 'consultado_em', now(), 'unidades', to_jsonb(v_ok),
      'fontes', jsonb_build_array(
        jsonb_build_object('rotulo', 'iFood', 'lido_em', (SELECT max(lido_em) FROM public.ifood_avaliacoes_api),
          'ultima_avaliacao', (SELECT max(i.avaliado_em) FROM public.ifood_avaliacoes_api i JOIN public.dim_lojas d ON d.id_loja = i.id_loja WHERE d.unidade = ANY(v_ok)),
          'obs', 'O iFood só libera a avaliação cerca de 24 horas depois do pedido.'),
        jsonb_build_object('rotulo', 'Site (Accon)', 'lido_em', NULL, 'sem_fonte', true,
          'obs', 'O site (Accon) não tem avaliações gravadas no sistema.')),
      'lojas', coalesce((SELECT jsonb_agg(jsonb_build_object('unidade', u,
          'novas', (SELECT count(*) FROM a WHERE a.unidade = u AND a.dia = v_dia),
          'media', (SELECT round(avg(a.nota), 2) FROM a WHERE a.unidade = u AND a.dia = v_dia),
          'ruins', (SELECT count(*) FROM a WHERE a.unidade = u AND a.dia = v_dia AND a.nota <= 2),
          'com_texto', (SELECT count(*) FROM a WHERE a.unidade = u AND a.dia = v_dia AND a.pede_resposta),
          'sem_resposta', (SELECT count(*) FROM a WHERE a.unidade = u AND a.pede_resposta AND NOT a.respondida AND a.dia >= v_hoje - 7))
        ORDER BY u) FROM unnest(v_ok) u), '[]'::jsonb),
      'avaliacoes', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.avaliado_em DESC) FROM (
          SELECT unidade, marca, nota, comentario, tags, avaliado_em, pedido, respondida, pede_resposta, resposta_loja
          FROM a WHERE a.dia = v_dia ORDER BY avaliado_em DESC LIMIT 400) x), '[]'::jsonb),
      'pendentes', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.avaliado_em DESC) FROM (
          SELECT unidade, marca, nota, comentario, tags, avaliado_em, pedido
          FROM a WHERE a.pede_resposta AND NOT a.respondida AND a.dia >= v_hoje - 7 ORDER BY avaliado_em DESC LIMIT 300) x), '[]'::jsonb)
    ) INTO v_res;
  ELSE
    WITH a AS (
      SELECT r.unidade, r.estrelas nota, r.texto comentario, r.cliente_iniciais iniciais, r.avaliada_em avaliado_em,
             r.respondida, (r.avaliada_em AT TIME ZONE 'America/Sao_Paulo')::date dia
      FROM public.google_avaliacao_recente r WHERE r.unidade = ANY(v_ok)
    ), l AS (
      SELECT DISTINCT ON (unidade) unidade, nota, num_avaliacoes, data_coleta, lido_em
      FROM public.google_avaliacao_loja WHERE unidade = ANY(v_ok) ORDER BY unidade, data_coleta DESC
    )
    SELECT jsonb_build_object(
      'modo', 'salao', 'hoje', v_hoje, 'dia', v_dia, 'consultado_em', now(), 'unidades', to_jsonb(v_ok),
      'fontes', jsonb_build_array(
        jsonb_build_object('rotulo', 'Google', 'lido_em', (SELECT max(lido_em) FROM l),
          'ultima_avaliacao', (SELECT max(avaliado_em) FROM a),
          'obs', 'API oficial do Google (Perfil da Empresa). O sistema guarda as 50 avaliações mais recentes de cada loja.')),
      'lojas', coalesce((SELECT jsonb_agg(jsonb_build_object('unidade', u,
          'nota_google', (SELECT l.nota FROM l WHERE l.unidade = u),
          'total_google', (SELECT l.num_avaliacoes FROM l WHERE l.unidade = u),
          'novas', (SELECT count(*) FROM a WHERE a.unidade = u AND a.dia = v_dia),
          'media', (SELECT round(avg(a.nota), 2) FROM a WHERE a.unidade = u AND a.dia = v_dia),
          'ruins', (SELECT count(*) FROM a WHERE a.unidade = u AND a.dia = v_dia AND a.nota <= 2),
          'sem_resposta', (SELECT count(*) FROM a WHERE a.unidade = u AND NOT a.respondida AND a.dia >= v_hoje - 30))
        ORDER BY u) FROM unnest(v_ok) u), '[]'::jsonb),
      'avaliacoes', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.avaliado_em DESC) FROM (
          SELECT unidade, nota, comentario, iniciais, avaliado_em, respondida FROM a WHERE a.dia = v_dia) x), '[]'::jsonb),
      'pendentes', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.avaliado_em DESC) FROM (
          SELECT unidade, nota, comentario, iniciais, avaliado_em FROM a WHERE NOT a.respondida AND a.dia >= v_hoje - 30
          ORDER BY avaliado_em DESC LIMIT 300) x), '[]'::jsonb)
    ) INTO v_res;
  END IF;
  RETURN v_res;
END;
$function$;

REVOKE ALL ON FUNCTION public.erp_avaliacoes_dia(text, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.erp_avaliacoes_dia(text, date, text) TO authenticated;
