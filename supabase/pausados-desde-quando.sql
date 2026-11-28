-- 22/11/2026 (pedido do Fábio): a tela de itens pausados passa a mostrar DESDE QUANDO cada item está
-- pausado ou escondido. Só leitura. Mesma função de antes (erp_pausados_ler), com um campo a mais por item:
--   desde = Tablet (Goomer) e Site (Accon): cardapio_pausado.primeiro_visto (1º dia em que o leitor viu o item assim)
--           iFood: 1º dia da sequência atual fora do ar, pela leitura diária da API (ifood_cardapio_api),
--                  depois do último dia em que o item apareceu disponível. Várias marcas: a data mais antiga.
-- E um campo no topo: inicio_leituras = 1º dia de leitura de cada canal. Se "desde" = esse dia, o item já
-- estava assim quando a leitura começou (a tela mostra "ou antes").
CREATE OR REPLACE FUNCTION public.erp_pausados_ler(p_unidade text DEFAULT NULL::text, p_canal text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_email text; v_unidade text; v_canal text; v_total int; v_itens jsonb; v_comp jsonb;
  v_fontes jsonb := '[]'::jsonb; v_canais text[]; v_unidades text[]; v_c text; v_u text;
  v_suportado boolean; v_rotina text; v_prefixo text; v_ok timestamptz; v_tent timestamptz; v_st text;
  v_inicio jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'não autenticado' USING ERRCODE = '28000'; END IF;
  v_email := lower(coalesce(auth.jwt() ->> 'email', ''));
  IF v_email NOT IN ('fabio@cidadaodomundo.com.br', 'neto@cidadaodomundo.com.br') THEN
    RAISE EXCEPTION 'sem acesso a esta consulta' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = auth.uid() AND lower(u.email) = v_email AND u.email_confirmed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'conta não confirmada' USING ERRCODE = '42501';
  END IF;

  IF p_unidade IS NOT NULL AND p_unidade <> '' THEN
    v_unidade := CASE upper(p_unidade)
      WHEN 'AGUA VERDE' THEN 'AGUA VERDE' WHEN 'ÁGUA VERDE' THEN 'AGUA VERDE'
      WHEN 'SÃO BRAZ' THEN 'SÃO BRAZ' WHEN 'SAO BRAZ' THEN 'SÃO BRAZ'
      WHEN 'AHU' THEN 'AHU' WHEN 'AHÚ' THEN 'AHU' ELSE NULL END;
    IF v_unidade IS NULL THEN RAISE EXCEPTION 'unidade inválida: %', p_unidade USING ERRCODE = '22023'; END IF;
  END IF;
  IF p_canal IS NOT NULL AND p_canal <> '' THEN
    v_canal := CASE p_canal WHEN 'Tablet (Goomer)' THEN 'Tablet (Goomer)' WHEN 'Goomer' THEN 'Tablet (Goomer)'
      WHEN 'Accon' THEN 'Accon' WHEN 'iFood' THEN 'iFood' ELSE NULL END;
    IF v_canal IS NULL THEN RAISE EXCEPTION 'canal inválido: %', p_canal USING ERRCODE = '22023'; END IF;
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _ps_linhas2 (unidade text, canal text, item text, tipo text, estado text, marca text, atualizado_em timestamptz, visto_em date, nome_norm text, desde date) ON COMMIT DROP;
  TRUNCATE _ps_linhas2;

  INSERT INTO _ps_linhas2
  SELECT p.unidade, p.canal, p.item, p.tipo, p.estado, p.marca, p.atualizado_em, p.visto_em,
         lower(btrim(regexp_replace(regexp_replace(p.item, '^\[[^\]]*\]\s*(\([^)]*\)\s*)?', ''), '\s*\(grupo:.*$', ''))),
         p.primeiro_visto
  FROM public.cardapio_pausado p
  WHERE p.canal IN ('Tablet (Goomer)', 'Accon')
    AND (v_unidade IS NULL OR p.unidade = v_unidade)
    AND (v_canal IS NULL OR p.canal = v_canal);

  -- iFood: última leitura de cada marca (data_leitura mais recente), item fora do ar = status <> AVAILABLE
  IF v_canal IS NULL OR v_canal = 'iFood' THEN
    INSERT INTO _ps_linhas2
    SELECT d.unidade, 'iFood', a.item, 'Item principal', 'pausado',
           string_agg(DISTINCT d.nome_loja, ', ' ORDER BY d.nome_loja), max(a.lido_em), max(a.data_leitura),
           lower(btrim(a.item)),
           min((SELECT min(b.data_leitura) FROM public.ifood_cardapio_api b
                 WHERE b.merchant = a.merchant AND b.item_id = a.item_id
                   AND coalesce(b.status, '') <> 'AVAILABLE'
                   AND b.data_leitura > coalesce((SELECT max(c.data_leitura) FROM public.ifood_cardapio_api c
                                                   WHERE c.merchant = a.merchant AND c.item_id = a.item_id
                                                     AND c.status = 'AVAILABLE'), DATE '1900-01-01')))
    FROM public.ifood_cardapio_api a
    JOIN public.dim_lojas d ON d.id_merchant_ifood::uuid = a.merchant
    JOIN (SELECT merchant, max(data_leitura) dl FROM public.ifood_cardapio_api GROUP BY merchant) u
      ON u.merchant = a.merchant AND u.dl = a.data_leitura
    WHERE d.unidade IN ('AGUA VERDE', 'SÃO BRAZ', 'AHU')
      AND coalesce(a.status, '') <> 'AVAILABLE'
      AND (v_unidade IS NULL OR d.unidade = v_unidade)
    GROUP BY d.unidade, a.item;
  END IF;

  SELECT count(*) INTO v_total FROM _ps_linhas2;
  SELECT jsonb_agg(x) INTO v_itens FROM (
    SELECT unidade, canal, item, tipo, estado, marca, atualizado_em, visto_em, desde
    FROM _ps_linhas2 ORDER BY unidade, canal, item LIMIT 1000) x;

  v_inicio := jsonb_build_object(
    'Tablet (Goomer)', (SELECT (min(inicio) AT TIME ZONE 'America/Sao_Paulo')::date FROM public.rotinas_execucao WHERE rotina = 'cardapio-goomer'),
    'Accon', (SELECT least((SELECT (min(inicio) AT TIME ZONE 'America/Sao_Paulo')::date FROM public.rotinas_execucao WHERE rotina = 'cardapio-accon'),
                           (SELECT min(primeiro_visto) FROM public.cardapio_pausado WHERE canal = 'Accon'))),
    'iFood', (SELECT min(data_leitura) FROM public.ifood_cardapio_api));

  -- comparativo iFood x Site (Accon): só unidades onde o site tem leitura gravada
  SELECT jsonb_agg(c ORDER BY c->>'unidade', c->>'grupo', c->>'item') INTO v_comp FROM (
    SELECT jsonb_build_object(
      'unidade', s.unidade,
      'item', s.nome,
      'site', CASE WHEN s.no_site THEN 'pausado' ELSE 'não pausado' END,
      'ifood', CASE WHEN s.no_ifood THEN 'pausado'
                    WHEN EXISTS (SELECT 1 FROM public.ifood_cardapio_api a JOIN public.dim_lojas d ON d.id_merchant_ifood::uuid = a.merchant
                                 WHERE d.unidade = s.unidade AND lower(btrim(a.item)) = s.norm
                                   AND a.data_leitura = (SELECT max(data_leitura) FROM public.ifood_cardapio_api)) THEN 'vendendo'
                    ELSE 'não achado' END,
      'grupo', CASE WHEN s.no_site AND s.no_ifood THEN '1-bate' WHEN s.no_site THEN '2-so-site' ELSE '3-so-ifood' END
    ) c
    FROM (
      SELECT l.unidade, l.nome_norm norm, min(CASE WHEN l.canal='iFood' THEN l.item ELSE regexp_replace(regexp_replace(l.item, '^\[[^\]]*\]\s*(\([^)]*\)\s*)?', ''), '\s*\(grupo:.*$', '') END) nome,
             bool_or(l.canal = 'Accon') no_site, bool_or(l.canal = 'iFood') no_ifood
      FROM (
        SELECT unidade, canal, item, nome_norm FROM _ps_linhas2 WHERE canal IN ('iFood','Accon') AND coalesce(tipo,'') <> 'Categoria'
      ) l
      WHERE l.unidade IN (SELECT DISTINCT unidade FROM public.cardapio_pausado WHERE canal = 'Accon')
      GROUP BY l.unidade, l.nome_norm
    ) s
  ) z;

  v_canais := CASE WHEN v_canal IS NULL THEN ARRAY['iFood', 'Tablet (Goomer)', 'Accon'] ELSE ARRAY[v_canal] END;
  v_unidades := CASE WHEN v_unidade IS NULL THEN ARRAY['AGUA VERDE', 'SÃO BRAZ', 'AHU'] ELSE ARRAY[v_unidade] END;
  FOREACH v_c IN ARRAY v_canais LOOP
    v_rotina := CASE v_c WHEN 'Tablet (Goomer)' THEN 'cardapio-goomer' WHEN 'Accon' THEN 'cardapio-accon' END;
    FOREACH v_u IN ARRAY v_unidades LOOP
      v_suportado := CASE v_c WHEN 'Tablet (Goomer)' THEN v_u <> 'AHU' ELSE true END;
      v_ok := NULL; v_tent := NULL; v_st := NULL;
      IF v_suportado AND v_c = 'iFood' THEN
        SELECT max(a.lido_em) INTO v_ok FROM public.ifood_cardapio_api a JOIN public.dim_lojas d ON d.id_merchant_ifood::uuid = a.merchant
         WHERE d.unidade = v_u AND a.data_leitura >= current_date - 7;
        v_tent := v_ok; v_st := CASE WHEN v_ok IS NULL THEN NULL ELSE 'OK' END;
      ELSIF v_suportado THEN
        v_prefixo := CASE v_u WHEN 'AGUA VERDE' THEN 'Água Verde: ' WHEN 'SÃO BRAZ' THEN 'São Braz: ' WHEN 'AHU' THEN 'Ahú: ' END;
        SELECT max(e.fim) FILTER (WHERE e.status = 'OK'), max(e.fim), (array_agg(e.status ORDER BY e.fim DESC NULLS LAST, e.id DESC))[1]
          INTO v_ok, v_tent, v_st
          FROM public.rotinas_execucao e WHERE e.rotina = v_rotina AND e.resumo LIKE v_prefixo || '%';
        IF v_c = 'Accon' AND v_ok IS NULL THEN
          SELECT max(atualizado_em) INTO v_ok FROM public.cardapio_pausado WHERE canal = 'Accon' AND unidade = v_u;
        END IF;
      END IF;
      v_fontes := v_fontes || jsonb_build_object(
        'rotulo', CASE v_c WHEN 'Accon' THEN 'Site (Accon)' ELSE v_c END || ' · ' || CASE v_u WHEN 'AGUA VERDE' THEN 'Água Verde' WHEN 'SÃO BRAZ' THEN 'São Braz' WHEN 'AHU' THEN 'Ahú' END,
        'canal', v_c, 'unidade', v_u, 'suportado', v_suportado,
        'ultimo_ok', v_ok, 'ultima_tentativa', v_tent, 'ultimo_status', v_st);
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'itens', coalesce(v_itens, '[]'::jsonb),
    'comparativo', coalesce(v_comp, '[]'::jsonb),
    'total_linhas', v_total,
    'truncado', v_total > 1000,
    'consultado_em', now(),
    'inicio_leituras', v_inicio,
    'fonte', jsonb_build_object('fontes', v_fontes));
END;
$function$;
