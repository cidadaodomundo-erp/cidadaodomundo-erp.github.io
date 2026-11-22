-- 22/11/2026 (pedido do Fábio): ROBÔ DE RESPOSTAS das avaliações (Google e iFood), visto no portal novo.
-- Guarda cada resposta que o robô publicou ou vai publicar, com a situação:
--   rascunho   = preparada, esperando o OK do Fábio (nada sai para fora)
--   publicada  = já está no Google / iFood
--   falhou     = o Google/iFood recusou (motivo em erro)
--   descartada = o Fábio mandou não responder
-- O texto do cliente NÃO é copiado aqui: a tela busca em google_avaliacao_recente / ifood_avaliacoes_api.
-- Quem publica no Google é o robô google-avaliacoes (ação "responder", chamada à mão, sem agendamento).
-- As chaves do Google ficam no cofre do banco pessoal e não vêm para o ERP.
-- iFood: só rascunhos. Nada é publicado até o Fábio e o Neto conferirem (robô de contestações).
CREATE TABLE IF NOT EXISTS public.avaliacao_robo_resposta (
  id bigserial PRIMARY KEY,
  canal text NOT NULL CHECK (canal IN ('google', 'ifood')),
  unidade text NOT NULL,
  id_avaliacao text NOT NULL,
  resposta text NOT NULL,
  status text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'publicada', 'falhou', 'descartada')),
  criado_em timestamptz NOT NULL DEFAULT now(),
  publicado_em timestamptz,
  erro text,
  UNIQUE (canal, id_avaliacao)
);
ALTER TABLE public.avaliacao_robo_resposta ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.avaliacao_robo_resposta FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.erp_robo_respostas(p_canal text, p_unidade text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_lojas text[]; v_ok text[]; v_u text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'não autenticado' USING ERRCODE = '28000'; END IF;
  IF p_canal NOT IN ('google', 'ifood') THEN RAISE EXCEPTION 'canal inválido' USING ERRCODE = '22023'; END IF;
  IF p_unidade IS NOT NULL AND p_unidade NOT IN ('', 'AGUA VERDE', 'SÃO BRAZ', 'AHU') THEN
    RAISE EXCEPTION 'unidade inválida' USING ERRCODE = '22023'; END IF;
  v_u := nullif(p_unidade, '');
  SELECT m.lojas INTO v_lojas FROM public.painel_minhas_lojas() m LIMIT 1;
  IF v_lojas IS NULL THEN RAISE EXCEPTION 'sem acesso a esta consulta' USING ERRCODE = '42501'; END IF;
  v_ok := array(SELECT x FROM unnest(ARRAY['AGUA VERDE', 'SÃO BRAZ', 'AHU']) x
                 WHERE (x = ANY(v_lojas) OR 'REDE' = ANY(v_lojas)) AND (v_u IS NULL OR x = v_u));
  RETURN (
    WITH r AS (
      SELECT r.*,
        CASE WHEN r.canal = 'google' THEN g.estrelas::numeric ELSE i.nota END nota,
        CASE WHEN r.canal = 'google' THEN g.texto ELSE i.comentario END comentario,
        CASE WHEN r.canal = 'google' THEN g.avaliada_em ELSE i.avaliado_em END avaliado_em,
        CASE WHEN r.canal = 'google' THEN 'Cliente ' || coalesce(g.cliente_iniciais, '') ELSE coalesce(d.nome_loja, '') || coalesce(' · pedido ' || i.id_pedido_curto, '') END quem
      FROM public.avaliacao_robo_resposta r
      LEFT JOIN public.google_avaliacao_recente g ON r.canal = 'google' AND g.id_google = r.id_avaliacao
      LEFT JOIN public.ifood_avaliacoes_api i ON r.canal = 'ifood' AND i.id_avaliacao::text = r.id_avaliacao
      LEFT JOIN public.dim_lojas d ON d.id_loja = i.id_loja
      WHERE r.canal = p_canal AND r.unidade = ANY(v_ok)
    )
    SELECT jsonb_build_object(
      'canal', p_canal, 'consultado_em', now(),
      'resumo', coalesce((SELECT jsonb_object_agg(status, n) FROM (SELECT status, count(*) n FROM r GROUP BY status) s), '{}'::jsonb),
      'ultima_publicacao', (SELECT max(publicado_em) FROM r),
      'itens', coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.ordem, x.nota NULLS LAST, x.avaliado_em DESC) FROM (
          SELECT unidade, quem, nota, comentario, avaliado_em, resposta, status, publicado_em, erro,
                 CASE status WHEN 'rascunho' THEN 0 WHEN 'falhou' THEN 1 ELSE 2 END ordem
          FROM r ORDER BY 10, nota NULLS LAST, avaliado_em DESC LIMIT 400) x), '[]'::jsonb)
    ));
END $function$;
REVOKE ALL ON FUNCTION public.erp_robo_respostas(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.erp_robo_respostas(text, text) TO authenticated;
