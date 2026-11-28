-- 28/11/2026: primeira carga do Mapa de acessos a partir do levantamento que já estava no ERP (plano_levante_neto,
-- listas CONTA e PC; 27/11). Só nome, grupo e "o que é". A coluna obs (texto livre) NÃO é copiada.
-- Unidade fica REDE (o levantamento não separa por loja) e "depende do ERP" fica A_CONFERIR: o dono ajusta na tela.
-- Idempotente: a coluna origem ('levante:<id>') impede linha repetida.
INSERT INTO public.mapa_acesso (unidade, categoria, nome, descricao, responsavel, situacao, depende_erp, origem)
SELECT 'REDE',
       CASE WHEN l.lista = 'PC' THEN 'robo'
            WHEN l.grupo IN ('E-mail', 'Domínio e Google') THEN 'email'
            WHEN l.grupo IN ('Sistema do painel', 'Saipos') THEN 'sistema'
            WHEN l.grupo IN ('iFood', 'Entrega', 'Site e canais') THEN 'integracao'
            ELSE 'conta' END,
       left(btrim(l.nome), 120),
       left(nullif(concat_ws(' · ', l.grupo, l.o_que), ''), 500),
       CASE l.estado WHEN 'FEITO' THEN 'Fábio' ELSE 'Neto' END,
       CASE l.estado WHEN 'FEITO' THEN 'OK' WHEN 'FICA_COM_NETO' THEN 'OK'
            ELSE CASE WHEN l.lista = 'PC' THEN 'A_CONFERIR' ELSE 'A_TROCAR' END END,
       'A_CONFERIR',
       'levante:' || l.id
  FROM public.plano_levante_neto l
 WHERE l.lista = 'CONTA' OR (l.lista = 'PC' AND l.grupo <> 'Do que tudo depende')
ON CONFLICT (origem) WHERE origem IS NOT NULL DO NOTHING;
