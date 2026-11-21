-- COMPRAS · MERCADO LIVRE — FLUXO ÚNICO (21/11/2026, aprovado pelo Fábio no projeto CDM -- COMPRAS: "Aprovo tudo (1 a 5)")
-- Liga as três pontas que estavam soltas:
--   1) pedido do robô de cotação (compra_cotacao)  ->  2) compra feita no ML (fin_cartao_compra, gravada pelo leitor de pedidos)
--   3) chegada: quando o pedido do ML fica "Entregue", nasce um aviso (compra_aviso) para o WhatsApp avisar que chegou.
-- E dá à tela Mercado Livre a aba Histórico (compra_ml_historico): o que foi comprado e quanto foi gasto, por mês e por loja.
-- APLICADO no ERP em 21/11/2026 ~16h35 (migração compras_ml_fluxo_unico_21_11).
-- Só dados da empresa. Nada do banco pessoal. Desfazer: compras-ml-fluxo-unico-desfazer.sql
begin;

-- 1) campos novos (só acrescenta; nada some)
alter table public.fin_cartao_compra add column if not exists entregue_em timestamptz;
alter table public.fin_cartao_compra add column if not exists cotacao_id bigint;
alter table public.compra_cotacao add column if not exists pedido_ml text;

-- 2) fila de avisos (o robô do WhatsApp no Escritório 2 pega e envia)
create table if not exists public.compra_aviso (
  id bigint generated always as identity primary key,
  criado_em timestamptz not null default now(),
  tipo text not null check (tipo in ('chegou','comprado')),
  compra_id bigint,
  pedido_ml text,
  loja text,
  texto text not null check (char_length(texto) between 3 and 500),
  pego_em timestamptz,
  enviado_em timestamptz,
  erro text check (erro is null or char_length(erro) <= 300),
  unique (tipo, pedido_ml)
);
alter table public.compra_aviso enable row level security;
revoke all on public.compra_aviso from anon, authenticated;

-- 3) loja da compra pelo endereço de entrega do ML (Petit Carneiro = Água Verde; Colombo = Ahú; São Braz pelo nome)
create or replace function public.compra_ml_loja(d jsonb) returns text
language sql immutable set search_path to 'public' as $$
  select case
    when translate(lower(coalesce(d->>'entrega','')),'áàâãéêíóôõúç','aaaaeeiooouc') ~ 'petit carneiro|agua verde' then 'AGUA VERDE'
    when translate(lower(coalesce(d->>'entrega','')),'áàâãéêíóôõúç','aaaaeeiooouc') ~ 'colombo|ahu' then 'AHU'
    when translate(lower(coalesce(d->>'entrega','')),'áàâãéêíóôõúç','aaaaeeiooouc') ~ 'sao bra[sz]' then 'SÃO BRAZ'
    else null end
$$;

-- palavras de um texto (4+ letras, sem acento) para casar pedido do robô com a compra
create or replace function public.compra_palavras(t text) returns text[]
language sql immutable set search_path to 'public' as $$
  select coalesce(array_agg(distinct w), '{}') from regexp_split_to_table(
    translate(lower(coalesce(t,'')),'áàâãéêíóôõúç','aaaaeeiooouc'), '[^a-z0-9]+') w
  where char_length(w) >= 4 and w not in ('para','com','unidades','unidade','kit','cor','marca','pote','caixa')
$$;

-- 4) gatilho na compra do ML: marca chegada, cria aviso e casa com o pedido do robô
create or replace function public.compra_ml_ao_gravar() returns trigger
language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_loja text; v_cot bigint; v_pal text[]; v_antes text;
begin
  if coalesce(new.origem,'') <> 'MERCADO_LIVRE' then return new; end if;
  v_loja := coalesce(public.compra_ml_loja(new.detalhe), 'AGUA VERDE');
  v_antes := case when tg_op = 'UPDATE' then coalesce(old.detalhe->>'estado','') else '' end;

  -- chegada: o próprio pedido do ML diz "Entregue"
  if coalesce(new.detalhe->>'estado','') = 'Entregue' and new.entregue_em is null then
    new.entregue_em := now();
    -- aviso só para compra nova (não acorda o histórico antigo): virou "Entregue" agora, ou já nasceu entregue nos últimos 5 dias
    if (tg_op = 'UPDATE' and v_antes <> 'Entregue') or (tg_op = 'INSERT' and new.data_compra >= current_date - 5) then
      insert into public.compra_aviso (tipo, compra_id, pedido_ml, loja, texto)
      values ('chegou', new.id, new.pedido_ml, v_loja,
              left('Chegou a compra do Mercado Livre: ' || coalesce(new.descricao,'compra') || ' (pedido ' || coalesce(new.pedido_ml,'?') ||
                   '). Está lá embaixo, na ' || case v_loja when 'AGUA VERDE' then 'Água Verde' when 'AHU' then 'Ahú' else 'São Braz' end || '.', 500))
      on conflict (tipo, pedido_ml) do nothing;
    end if;
  end if;

  -- ligação com o robô de cotação: pedido em aberto da mesma loja, dos 20 dias antes da compra, com 2+ palavras em comum
  if new.cotacao_id is null and coalesce(new.situacao,'') <> 'CANCELADA' then
    v_pal := public.compra_palavras(new.descricao);
    select c.id into v_cot
      from public.compra_cotacao c
     where c.status in ('novo','buscando','pronto','erro')
       and c.loja = v_loja
       and c.criado_em::date between new.data_compra - 20 and new.data_compra + 1
       and cardinality(array(select unnest(v_pal) intersect
             select unnest(public.compra_palavras(coalesce(c.ref_titulo,'') || ' ' || coalesce(c.busca,'') || ' ' || c.texto)))) >= 2
     order by c.criado_em desc limit 1;
    if v_cot is not null then
      new.cotacao_id := v_cot;
      update public.compra_cotacao set status = 'comprado', pedido_ml = new.pedido_ml,
             decidido_por = 'casado com o pedido do Mercado Livre ' || coalesce(new.pedido_ml,''), decidido_em = now()
       where id = v_cot;
    end if;
  end if;
  return new;
end $$;

create or replace trigger compra_ml_ao_gravar before insert or update of detalhe, situacao, descricao on public.fin_cartao_compra
  for each row execute function public.compra_ml_ao_gravar();

-- marca a chegada do que já está entregue hoje (sem aviso: é histórico)
update public.fin_cartao_compra set entregue_em = coalesce(entregue_em, criado_em)
 where origem = 'MERCADO_LIVRE' and detalhe->>'estado' = 'Entregue' and entregue_em is null;

-- 5) PORTAL: aba Histórico
create or replace function public.compra_ml_historico(p_dias int default 180) returns jsonb
language sql stable security definer set search_path to 'public','pg_temp' as $$
  with base as (
    select f.id, f.data_compra, f.valor, f.parcelas, f.descricao, f.fornecedor, f.pedido_ml, f.situacao, f.entregue_em, f.cotacao_id,
           coalesce(public.compra_ml_loja(f.detalhe), 'AGUA VERDE') as loja, f.detalhe->>'estado' as estado,
           (f.nf_chave is not null) as tem_nf, f.observacao
      from public.fin_cartao_compra f
     where f.origem = 'MERCADO_LIVRE'
       and f.data_compra >= current_date - least(greatest(coalesce(p_dias,180),1),730)),
  vis as (select * from base where public.compra_minha_loja(loja))
  select jsonb_build_object(
    'consultado_em', now(),
    'leitor_ultima_carga', (select max(criado_em) from public.fin_cartao_compra where origem = 'MERCADO_LIVRE'),
    'compras', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'data', data_compra, 'valor', valor, 'parcelas', parcelas, 'descricao', descricao, 'vendedor', fornecedor,
        'pedido', pedido_ml, 'situacao', situacao, 'estado', estado, 'entregue_em', entregue_em, 'loja', loja,
        'tem_nf', tem_nf, 'cotacao_id', cotacao_id, 'obs', observacao) order by data_compra desc, id desc) from vis), '[]'::jsonb),
    'por_mes', coalesce((select jsonb_agg(m order by m->>'mes' desc) from (
        select jsonb_build_object('mes', to_char(date_trunc('month', data_compra),'YYYY-MM'), 'loja', loja,
               'n', count(*), 'total', round(sum(valor),2)) m
          from vis where situacao <> 'CANCELADA' group by date_trunc('month', data_compra), loja) x), '[]'::jsonb))
$$;
revoke all on function public.compra_ml_historico(int) from public, anon;
grant execute on function public.compra_ml_historico(int) to authenticated;

-- 6) ROBÔ do WhatsApp (Escritório 2, mesma chave de Compras): pegar e marcar avisos
create or replace function public.compra_aviso_pegar(p_segredo text, p_max int default 5) returns jsonb
language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare r jsonb;
begin
  if not public.compra_robo_segredo_ok(p_segredo) then return jsonb_build_object('erro','segredo invalido'); end if;
  with alvo as (
    select id from public.compra_aviso
     where enviado_em is null and (pego_em is null or pego_em < now() - interval '30 minutes')
     order by criado_em limit least(greatest(coalesce(p_max,5),1),20) for update skip locked),
  upd as (update public.compra_aviso a set pego_em = now() from alvo where a.id = alvo.id
          returning a.id, a.tipo, a.loja, a.texto, a.criado_em)
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'tipo', tipo, 'loja', loja, 'texto', texto) order by criado_em), '[]'::jsonb) into r from upd;
  return jsonb_build_object('ok', true, 'avisos', r);
end $$;
revoke all on function public.compra_aviso_pegar(text, int) from public, authenticated;
grant execute on function public.compra_aviso_pegar(text, int) to anon;

create or replace function public.compra_aviso_marcar(p_segredo text, p_id bigint, p_erro text default null) returns jsonb
language plpgsql security definer set search_path to 'public','pg_temp' as $$
begin
  if not public.compra_robo_segredo_ok(p_segredo) then return jsonb_build_object('erro','segredo invalido'); end if;
  if p_erro is null then
    update public.compra_aviso set enviado_em = now(), erro = null where id = p_id;
  else
    update public.compra_aviso set pego_em = null, erro = left(p_erro,300) where id = p_id;
  end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.compra_aviso_marcar(text, bigint, text) from public, authenticated;
grant execute on function public.compra_aviso_marcar(text, bigint, text) to anon;

commit;
