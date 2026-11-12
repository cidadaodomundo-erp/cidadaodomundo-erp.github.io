-- =====================================================================================================================
-- fabio_delivery — instalação da leitura nativa da Chegada (projeto ANTIGO kqvoatdprjwxyadhvtdd)
-- NÃO é migration da CLI. NÃO executado por este porte: revisar e executar manualmente.
--
-- Porte a partir de docs/chegada-fontes-referencia.sql (cópia de public.chegada_do_dia, public.chegada_conferir,
-- public.chegada_direito). NENHUMA função public é criada, alterada ou removida aqui.
--
--   fabio_delivery.chegada_dia(p_dia)          = public.chegada_do_dia sem o gate portal_pode/p_token (mesma TABLE).
--   fabio_delivery.chegada_consulta(dia, loja) = corpo de public.chegada_conferir, sempre em modo consulta detalhada:
--       sem auth/token, filtro da loja real ANTES de public.chegada_direito (reutilizada, sem mudança de pagamento),
--       overrides manuais separados (garantido n_turno 0 / rango por turno), fila com segundos, saída QR com segundos.
--       Removidos: ramo do balcão, placar, gps_ultimo/gps_parado, tolerancia, agora, dono, quem.
--   Tempo registrado: SOMENTE saída QR menos (fila TrackEat | pátio GPS). Nunca primeira entrega, nunca anotado.
--
-- Unidades: ERP/Edge usam 'AGUA VERDE' | 'AHU' | 'SAO BRAZ'; tabelas public usam o título exato
--   'Água Verde' | 'Ahú' | 'São Braz'. Entrada normalizada (unidade_canonica), comparação pelo título (unidade_titulo),
--   saída sempre canônica (maiúscula sem acento).
--
-- Contrato de fabio_delivery.chegada_consulta(p_dia, p_unidade) (jsonb):
--   { "dia": date, "hoje": date, "ao_vivo": bool, "consultado_em": timestamptz, "unidade": 'AGUA VERDE'|'AHU'|'SAO BRAZ',
--     "robo": { "atualizado_em": timestamptz|null, "ok": bool|null },   -- max(trackeat_fila_batida.lido_em) 2 dias; ok = idade <= 30 min; null = sem dado
--     "linhas": [ { "unidade", "motoboy" (= entregador), "n_turno" int, "na_escala" bool, "vivo_rodando" bool|null,
--                   "escala_txt" HH:MI, "escala_saida_txt" HH:MI, "limite_txt" HH:MI,
--                   "chegada_fila_txt" HH:MI:SS, "chegada_fila_em" timestamptz, "patio_gps_txt" HH:MI:SS, "anotado_txt" HH:MI,
--                   "chegou_txt" HH:MI[:SS] (só fila/pátio), "chegou_fonte" 'fila'|'patio_gps'|null,
--                   "primeira_entrega_txt" HH:MI[:SS] (chegada do pagamento rotulada '1ª entrega' pela fonte; NÃO é chegada),
--                   "saida_registrada_txt" HH:MI:SS, "tempo_registrado_min" int|null, "tempo_fonte" 'fila'|'patio_gps'|null,
--                   "direito" ok|perdeu|rango_excecao|sem_prova|no_prazo|nao_chegou|fora, "garantido_perdido" bool,
--                   "motivo_sem_prova" nome|gps|robo|balcao|null, "atraso_min" int|null,
--                   "garantido_manual" bool|null, "garantido_motivo" text|null, "rango_manual" bool|null, "rango_motivo" text|null } ] }
--
-- Segurança: schema privado sem USAGE para public/anon/authenticated/service_role; funções SECURITY INVOKER, STABLE,
-- só SELECT (a Edge chama em transação READ ONLY). PostgREST: fabio_delivery NÃO deve constar em "Exposed schemas"
-- (este script não mexe nisso; só conferir). Acesso exclusivo pela conexão direta (SUPABASE_DB_URL) da Edge.
-- =====================================================================================================================

begin;

create schema if not exists fabio_delivery;
revoke all on schema fabio_delivery from public, anon, authenticated, service_role;
alter default privileges in schema fabio_delivery revoke all on functions from public, anon, authenticated, service_role;
alter default privileges in schema fabio_delivery revoke all on tables from public, anon, authenticated, service_role;
alter default privileges in schema fabio_delivery revoke all on sequences from public, anon, authenticated, service_role;

-- dia operacional: vira às 05:00 de Brasília (mesma expressão de chegada_do_dia/chegada_conferir)
create or replace function fabio_delivery.dia_operacional()
returns date
language sql stable security invoker
set search_path = ''
as $$ select ((now() at time zone 'America/Sao_Paulo') - interval '5 hours')::date $$;

-- whitelist de loja real, forma canônica do ERP (REDE não entra no banco: a Edge expande para as lojas autorizadas)
create or replace function fabio_delivery.unidade_canonica(p text)
returns text
language sql immutable security invoker
set search_path = ''
as $$
  select case x when 'AGUA VERDE' then x when 'SAO BRAZ' then x when 'AHU' then x else null end
  from (select upper(btrim(regexp_replace(
          translate(coalesce(p, ''), 'ÁÀÂÃáàâãÉÊéêÍíÓÔÕóôõÚúÇç', 'AAAAaaaaEEeeIiOOOoooUuCc'), '\s+', ' ', 'g'))) as x) s
$$;

-- título EXATO usado nas tabelas public do banco antigo
create or replace function fabio_delivery.unidade_titulo(p text)
returns text
language sql immutable security invoker
set search_path = ''
as $$
  select case fabio_delivery.unidade_canonica(p)
           when 'AGUA VERDE' then 'Água Verde'
           when 'AHU'        then 'Ahú'
           when 'SAO BRAZ'   then 'São Braz'
         end
$$;

create or replace function fabio_delivery.chegada_guard_dia(p_dia date)
returns date
language plpgsql stable security invoker
set search_path = ''
as $$
declare v_op date := fabio_delivery.dia_operacional();
begin
  if p_dia is null then raise exception 'dia_invalido' using errcode = '22023'; end if;
  if p_dia > v_op or p_dia < v_op - 60 then raise exception 'dia_fora_da_janela' using errcode = '22023'; end if;
  return p_dia;
end
$$;

-- rascunho anterior (nunca instalado) devolvia jsonb; a assinatura nova devolve a TABLE original
drop function if exists fabio_delivery.chegada_dia(date);

-- Cópia de public.chegada_do_dia: removido SOMENTE o gate portal_pode/p_token (+ guarda de janela do dia).
-- Objetos principais qualificados (public.*, extensions.*). Regras inalteradas.
create function fabio_delivery.chegada_dia(p_dia date)
 RETURNS TABLE(unidade text, entregador text, n_turno integer, na_escala boolean, escala_txt text, sistema_txt text, fonte text, anotado_txt text, quem text, digitada boolean, diferenca_min integer, situacao text, vivo_onde text, vivo_dist_m integer, vivo_visto text, vivo_fila text, vivo_rodando boolean, vivo_nome text)
 LANGUAGE plpgsql
 STABLE
 SECURITY INVOKER
 SET search_path = public, extensions, pg_temp
AS $function$
declare
  -- 24/09/2026: o dia da OPERACAO vira as 05h. A loja fecha 01h30 e o "fecha" roda ate ~04h;
  -- antes disso a tela usava o dia do calendario e o Jose das 20h/fecha aparecia com a escala do dia seguinte.
  v_op   date := ((now() at time zone 'America/Sao_Paulo') - interval '5 hours')::date;
  v_dia  date := fabio_delivery.chegada_guard_dia(p_dia);
  v_hoje boolean := v_dia = v_op;
begin
  return query
  with turnos as (
    select t.unidade::text as unidade, t.entregador::text as entregador, t.n_turno::int as n_turno,
           lower(extensions.unaccent(t.entregador)) as chave,
           t.hora_combinada as escala, t.chegada as sistema, t.tem_gps as tem_gps
      from public.vw_motoboy_turno_gps t
     where t.dia_operacional = v_dia
  ),
  anot as (select a.* from public.chegada_anotada a where a.dia_operacional = v_dia),
  viv as (
    select distinct on (fp.unidade, lower(extensions.unaccent(fp.entregador)))
           fp.unidade::text as unidade, fp.entregador::text as entregador,
           lower(extensions.unaccent(fp.entregador)) as chave,
           fp.no_patio, fp.dist_loja_m, fp.na_fila, fp.disponivel, fp.visto_em,
           (select greatest((max(q.lat)-min(q.lat))*111000, (max(q.lng)-min(q.lng))*102000)
              from public.foody_presenca q
             where q.unidade = fp.unidade
               and lower(extensions.unaccent(q.entregador)) = lower(extensions.unaccent(fp.entregador))
               and q.visto_em > now() - interval '20 minutes') as mexeu_m
      from public.foody_presenca fp
     where v_hoje and fp.visto_em > now() - interval '20 minutes'
     order by fp.unidade, lower(extensions.unaccent(fp.entregador)), fp.visto_em desc
     limit 200
  ),
  base as (
    select t.unidade, t.entregador, t.n_turno, true as na_escala, t.chave, t.escala, t.sistema, t.tem_gps
      from turnos t
    union all
    select a.unidade, a.entregador, a.n_turno, false, a.chave_curta, null::time, null::timestamptz, false
      from anot a
     where not exists (select 1 from turnos t
                        where t.unidade = a.unidade and t.chave = a.chave_curta and t.n_turno = a.n_turno)
    union all
    -- 10/09/2026: quem esta com o aplicativo ligado agora e nao esta na escala nem foi anotado.
    -- 24/09/2026: nome do aplicativo "Mateus Ribeiro" = escala "Mateus Ribeiro dos Santos" (um comeca o outro).
    select v.unidade, v.entregador, 1, false, v.chave, null::time, null::timestamptz, false
      from viv v
     where not exists (select 1 from turnos t where t.unidade = v.unidade
                          and (t.chave = v.chave or t.chave like v.chave||' %' or v.chave like t.chave||' %'))
       and not exists (select 1 from anot a where a.unidade = v.unidade and a.chave_curta = v.chave)
  )
  select b.unidade, b.entregador, b.n_turno, b.na_escala,
         to_char(b.escala, 'HH24:MI'),
         to_char(b.sistema at time zone 'America/Sao_Paulo', 'HH24:MI'),
         case when b.sistema is not null and b.tem_gps then 'GPS do aplicativo' end,
         to_char(a.hora_anotada at time zone 'America/Sao_Paulo', 'HH24:MI'),
         a.quem,
         coalesce(a.digitada, false),
         case when b.sistema is not null and a.hora_anotada is not null
              then round(extract(epoch from (a.hora_anotada - b.sistema)) / 60.0)::int end,
         case
           when b.sistema is null and a.hora_anotada is null and not b.na_escala then 'esperando o balcao'
           when b.sistema is null and a.hora_anotada is null then 'nao chegou'
           when a.hora_anotada is null then 'esperando o balcao'
           when b.sistema is null then 'o sistema perdeu'
           when abs(extract(epoch from (a.hora_anotada - b.sistema)) / 60.0) <= 3 then 'bate'
           when abs(extract(epoch from (a.hora_anotada - b.sistema)) / 60.0) <= 10 then 'diferenca pequena'
           else 'nao bate'
         end,
         case when v.chave is null then null
              when v.no_patio then 'no patio'
              when v.dist_loja_m is not null and v.dist_loja_m < 3000 then 'na rua'
              else 'longe' end,
         v.dist_loja_m,
         to_char(v.visto_em at time zone 'America/Sao_Paulo', 'HH24:MI'),
         case when v.chave is null then null
              when v.na_fila then 'na fila'
              when v.disponivel then 'disponivel'
              else 'indisponivel' end,
         -- 24/09/2026, pedido do Fabio: "rodando" e quem esta trabalhando de verdade:
         -- no patio, na fila, disponivel ou se mexeu 100 m ou mais nos ultimos 20 min.
         -- Aplicativo ligado, parado, fora da fila e indisponivel NAO e rodando (em geral e o motoboy em casa).
         case when v.chave is null then null
              else (coalesce(v.no_patio,false) or coalesce(v.na_fila,false) or coalesce(v.disponivel,false)
                    or coalesce(v.mexeu_m, 0) >= 100) end,
         case when v.chave is not null and v.chave <> b.chave then v.entregador end
    from base b
    left join anot a on a.unidade = b.unidade and a.chave_curta = b.chave and a.n_turno = b.n_turno
    left join lateral (
      select vv.* from viv vv
       where vv.unidade = b.unidade
         and (vv.chave = b.chave or vv.chave like b.chave||' %' or b.chave like vv.chave||' %')
       order by (vv.chave = b.chave) desc, vv.visto_em desc
       limit 1) v on true
   order by b.unidade, b.escala nulls last, b.entregador, b.n_turno;
end $function$;

-- Corpo de public.chegada_conferir em modo consulta detalhada fixo (dono=false, somente_consulta=true), por loja real.
create or replace function fabio_delivery.chegada_consulta(p_dia date, p_unidade text)
returns jsonb
language plpgsql stable security invoker
set search_path = public, extensions, pg_temp
as $function$
declare
  v_un    text := fabio_delivery.unidade_canonica(p_unidade);   -- saída: 'AGUA VERDE' | 'AHU' | 'SAO BRAZ'
  v_tit   text := fabio_delivery.unidade_titulo(p_unidade);     -- comparação: 'Água Verde' | 'Ahú' | 'São Braz'
  v_op    date := fabio_delivery.dia_operacional();
  v_dia   date;
  v_todas jsonb;
  v_robo  jsonb;
begin
  if p_unidade is null or v_un is null or v_tit is null then
    raise exception 'unidade_invalida' using errcode = '22023';
  end if;
  v_dia := fabio_delivery.chegada_guard_dia(p_dia);

  -- filtro da loja real ANTES de chegada_direito (garantido_perdido particiona por unidade+entregador: resultado igual)
  select coalesce(jsonb_agg(to_jsonb(x) order by x.escala_txt nulls last, x.entregador, x.n_turno), '[]'::jsonb)
    into v_todas
    from fabio_delivery.chegada_dia(v_dia) x
   where x.unidade = v_tit;

  -- direito ao garantido e ao rango por turno: MESMA regra do pagamento, função public existente, sem alteração.
  v_todas := public.chegada_direito(v_todas, v_dia);

  -- 15/10/2026: escolha manual da equipe (motoboy_direito_manual), SEPARADA por direito. Garantido vale o dia (n_turno 0);
  -- rango por turno. null = segue a regra. Sem "quem".
  select coalesce(jsonb_agg(x.e || jsonb_build_object(
           'garantido_manual', g.valor, 'garantido_motivo', g.motivo,
           'rango_manual', r.valor, 'rango_motivo', r.motivo) order by x.ord), '[]'::jsonb)
    into v_todas
    from jsonb_array_elements(v_todas) with ordinality x(e, ord)
    left join lateral (select m.valor, m.motivo from public.motoboy_direito_manual m
                        where m.dia = v_dia and m.unidade = x.e->>'unidade'
                          and m.chave_curta = lower(extensions.unaccent(x.e->>'entregador'))
                          and m.campo = 'garantido' and m.n_turno = 0
                        order by m.id desc limit 1) g on true
    left join lateral (select m.valor, m.motivo from public.motoboy_direito_manual m
                        where m.dia = v_dia and m.unidade = x.e->>'unidade'
                          and m.chave_curta = lower(extensions.unaccent(x.e->>'entregador'))
                          and m.campo = 'rango' and m.n_turno = coalesce((x.e->>'n_turno')::integer, 1)
                        order by m.id desc limit 1) r on true;

  -- Fabio 11/11: chegada da fila com segundos; janelas de turno e saída QR copiadas de chegada_conferir.
  -- Tempo registrado: saída QR menos fila TrackEat, ou pátio GPS (vw.chegou_gps). Nunca vw.chegada (pode ser 1ª entrega).
  with t as (
   select v.*, lead(v.combinado_em) over w as proximo,
    lag((v.dia_operacional+v.hora_saida+case when v.hora_saida<v.hora_combinada then interval '1 day' else interval '0' end)
       at time zone 'America/Sao_Paulo') over w as fim_anterior
   from public.vw_motoboy_turno_gps v
   where v.dia_operacional = v_dia and v.unidade = v_tit
   window w as (partition by v.unidade, v.entregador order by v.n_turno)
  ), dados as (
   select x.e, x.ord, t.hora_saida, t.chegou_gps as patio_gps,
    fila.chegada_fila, qr.saida_qr
   from jsonb_array_elements(v_todas) with ordinality x(e, ord)
   left join t on t.unidade = x.e->>'unidade' and t.entregador = x.e->>'entregador' and t.n_turno = (x.e->>'n_turno')::int
   left join lateral (
    select min(k.chegou_em) as chegada_fila from public.trackeat_chegada k
    where k.dia_operacional = v_dia and k.unidade = x.e->>'unidade' and k.origem = 'api'
    and lower(extensions.unaccent(public.motoboy_nome_padrao(k.unidade, k.entregador)))
        = lower(extensions.unaccent(public.motoboy_nome_padrao(x.e->>'unidade', x.e->>'entregador')))
    and k.chegou_em >= coalesce(greatest(t.combinado_em - interval '2 hours', t.fim_anterior), (v_dia + time '05:00') at time zone 'America/Sao_Paulo')
    and k.chegou_em <  coalesce(least(t.combinado_em + interval '4 hours', t.proximo), (v_dia + 1 + time '05:00') at time zone 'America/Sao_Paulo')
   ) fila on true
   left join lateral (
    select max(q.ultima_saida) as saida_qr from public.foody_vw_horas_qr q
    where q.dia_operacional = v_dia and q.unidade = x.e->>'unidade' and q.completo and q.sem_batida_saida = 0
     and lower(extensions.unaccent(q.nome)) = lower(extensions.unaccent(x.e->>'entregador'))
     and t.combinado_em is not null and q.ultima_saida >= t.combinado_em
     and q.ultima_saida < least(coalesce(t.proximo, 'infinity'::timestamptz),
       ((v_dia + t.hora_saida + case when t.hora_saida < t.hora_combinada then interval '1 day' else interval '0' end)
          at time zone 'America/Sao_Paulo') + interval '2 hours')
   ) qr on true
  ), tempo as (
   select d.*, coalesce(d.chegada_fila, d.patio_gps) as inicio,
          case when d.chegada_fila is not null then 'fila' when d.patio_gps is not null then 'patio_gps' end as inicio_fonte
   from dados d
  )
  select coalesce(jsonb_agg(d.e || jsonb_build_object(
   'escala_saida_txt', to_char(d.hora_saida, 'HH24:MI'),
   'chegada_fila_txt', to_char(d.chegada_fila at time zone 'America/Sao_Paulo', 'HH24:MI:SS'),
   'chegada_fila_em', d.chegada_fila,
   'patio_gps_txt', to_char(d.patio_gps at time zone 'America/Sao_Paulo', 'HH24:MI:SS'),
   'saida_registrada_txt', to_char(d.saida_qr at time zone 'America/Sao_Paulo', 'HH24:MI:SS'),
   'tempo_registrado_min', case when d.saida_qr is not null and d.inicio is not null and d.saida_qr >= d.inicio
     then round(extract(epoch from (d.saida_qr - d.inicio)) / 60)::int end,
   'tempo_fonte', case when d.saida_qr is not null and d.inicio is not null and d.saida_qr >= d.inicio
     then d.inicio_fonte end
  ) order by d.ord), '[]'::jsonb) into v_todas from tempo d;

  -- allowlist final: unidade canônica, motoboy = entregador, chegada real separada da 1ª entrega
  select coalesce(jsonb_agg(jsonb_build_object(
           'unidade', v_un,
           'motoboy', x.e->'entregador',
           'n_turno', x.e->'n_turno',
           'na_escala', x.e->'na_escala',
           'vivo_rodando', x.e->'vivo_rodando',
           'escala_txt', x.e->'escala_txt',
           'escala_saida_txt', x.e->'escala_saida_txt',
           'limite_txt', x.e->'limite_txt',
           'chegada_fila_txt', x.e->'chegada_fila_txt',
           'chegada_fila_em', x.e->'chegada_fila_em',
           'patio_gps_txt', x.e->'patio_gps_txt',
           'anotado_txt', x.e->'anotado_txt',
           'chegou_txt', case when x.e->>'chegou_fonte' in ('entrou na fila (TrackEat)', 'GPS no pátio') then x.e->'chegou_txt' end,
           'chegou_fonte', case x.e->>'chegou_fonte' when 'entrou na fila (TrackEat)' then 'fila'
                                                    when 'GPS no pátio' then 'patio_gps' end,
           'primeira_entrega_txt', case when x.e->>'chegou_fonte' = '1ª entrega' then x.e->'chegou_txt' end,
           'saida_registrada_txt', x.e->'saida_registrada_txt',
           'tempo_registrado_min', x.e->'tempo_registrado_min',
           'tempo_fonte', x.e->'tempo_fonte',
           'direito', x.e->'direito',
           'garantido_perdido', x.e->'garantido_perdido',
           'motivo_sem_prova', x.e->'motivo_sem_prova',
           'atraso_min', x.e->'atraso_min',
           'garantido_manual', x.e->'garantido_manual',
           'garantido_motivo', x.e->'garantido_motivo',
           'rango_manual', x.e->'rango_manual',
           'rango_motivo', x.e->'rango_motivo'
         ) order by x.ord), '[]'::jsonb)
    into v_todas
    from jsonb_array_elements(v_todas) with ordinality x(e, ord);

  -- saúde do robô da fila TrackEat nesta loja: última leitura nos últimos 2 dias; ok = idade <= 30 min; sem dado = null
  select jsonb_build_object('atualizado_em', s.ult,
                            'ok', case when s.ult is null then null else (now() - s.ult) <= interval '30 minutes' end)
    into v_robo
    from (select max(b.lido_em) as ult from public.trackeat_fila_batida b
           where b.unidade = v_tit and b.lido_em >= now() - interval '2 days') s;

  return jsonb_build_object(
    'dia', v_dia, 'hoje', v_op, 'ao_vivo', v_dia = v_op, 'consultado_em', now(),
    'unidade', v_un, 'robo', v_robo, 'linhas', v_todas);
end
$function$;

revoke all on function fabio_delivery.dia_operacional()                 from public, anon, authenticated, service_role;
revoke all on function fabio_delivery.unidade_canonica(text)            from public, anon, authenticated, service_role;
revoke all on function fabio_delivery.unidade_titulo(text)              from public, anon, authenticated, service_role;
revoke all on function fabio_delivery.chegada_guard_dia(date)           from public, anon, authenticated, service_role;
revoke all on function fabio_delivery.chegada_dia(date)                 from public, anon, authenticated, service_role;
revoke all on function fabio_delivery.chegada_consulta(date, text)      from public, anon, authenticated, service_role;

commit;

-- Conferência pós-instalação (somente leitura; esperar false em tudo):
-- select r, has_schema_privilege(r, 'fabio_delivery', 'USAGE')
--   from unnest(array['anon','authenticated','service_role']) r;
-- select r, has_function_privilege(r, 'fabio_delivery.chegada_consulta(date,text)', 'EXECUTE')
--   from unnest(array['anon','authenticated','service_role']) r;
-- Teste de fumaça (read only):
-- begin read only; select fabio_delivery.chegada_consulta(fabio_delivery.dia_operacional(), 'Ahú'); rollback;
