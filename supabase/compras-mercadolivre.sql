-- COMPRAS · MERCADO LIVRE (17/11/2026, pedido do Fábio: "achar o melhor preço das compras da Rita")
-- Cotação de compras no Mercado Livre. O pedido entra pelo portal (tela Mercado Livre) ou pelo WhatsApp 1602
-- (mensagem que começa com "compra" ou que traz link do ML). O robô de Compras (Escritório 2) lê o site público
-- do ML e grava as ofertas. NADA é comprado automaticamente e ninguém recebe resposta pelo WhatsApp.
-- Lojas: Água Verde (padrão), São Braz, Ahú. Boqueirão não entra (não é nossa).
-- Robô: porta estreita com chave própria (vault 'compras_robo_segredo'); só estas funções. Sem DDL em rotina.
begin;

create table if not exists public.compra_cotacao (
  id bigint generated always as identity primary key,
  criado_em timestamptz not null default now(),
  origem text not null check (origem in ('portal','whatsapp')),
  pedido_por text,
  texto text not null check (char_length(texto) between 2 and 600),
  link text check (link is null or char_length(link) <= 600),
  busca text check (busca is null or char_length(busca) <= 200),
  loja text not null default 'AGUA VERDE' check (loja in ('AGUA VERDE','SÃO BRAZ','AHU')),
  status text not null default 'novo' check (status in ('novo','buscando','pronto','erro','comprado','descartado')),
  tentativas int not null default 0,
  pego_em timestamptz,
  buscado_em timestamptz,
  erro text check (erro is null or char_length(erro) <= 300),
  ref_titulo text check (ref_titulo is null or char_length(ref_titulo) <= 300),
  ref_preco numeric(12,2),
  ref_item text check (ref_item is null or ref_item ~ '^MLB\d{5,15}$'),
  wa_id text unique check (wa_id is null or char_length(wa_id) <= 200),
  decidido_por text,
  decidido_em timestamptz,
  oferta_escolhida bigint
);
create index if not exists compra_cotacao_status_idx on public.compra_cotacao (status, criado_em);

create table if not exists public.compra_cotacao_oferta (
  id bigint generated always as identity primary key,
  cotacao_id bigint not null references public.compra_cotacao(id) on delete cascade,
  canal text not null default 'Mercado Livre',
  posicao int not null,
  item_id text check (item_id is null or item_id ~ '^MLB\d{5,15}$'),
  catalogo_id text check (catalogo_id is null or catalogo_id ~ '^MLB\d{5,15}$'),
  titulo text not null check (char_length(titulo) between 1 and 300),
  preco numeric(12,2) not null check (preco > 0 and preco < 1000000),
  preco_antigo numeric(12,2),
  frete_gratis boolean,
  entrega text check (entrega is null or char_length(entrega) <= 120),
  vendedor text check (vendedor is null or char_length(vendedor) <= 120),
  loja_oficial boolean not null default false,
  avaliacao numeric(2,1) check (avaliacao is null or (avaliacao >= 0 and avaliacao <= 5)),
  vendidos text check (vendidos is null or char_length(vendidos) <= 60),
  patrocinado boolean not null default false,
  mesmo_produto boolean not null default false,
  parecido int check (parecido is null or (parecido between 0 and 100)),
  obs text check (obs is null or char_length(obs) <= 160),
  link text not null check (link ~ '^https://(www\.|produto\.)?mercadolivre\.com\.br/' and char_length(link) <= 300),
  imagem text check (imagem is null or (imagem ~ '^https://[a-z0-9.-]*mlstatic\.com/' and char_length(imagem) <= 400)),
  lido_em timestamptz not null default now()
);
create index if not exists compra_cotacao_oferta_cot_idx on public.compra_cotacao_oferta (cotacao_id, posicao);

create table if not exists public.compra_robo_estado (
  id int primary key check (id = 1),
  ultima_volta timestamptz,
  ultimo_status text,
  ultima_busca timestamptz
);
insert into public.compra_robo_estado (id) values (1) on conflict do nothing;

alter table public.compra_cotacao enable row level security;
alter table public.compra_cotacao_oferta enable row level security;
alter table public.compra_robo_estado enable row level security;
revoke all on public.compra_cotacao, public.compra_cotacao_oferta, public.compra_robo_estado from anon, authenticated;

-- quem vê: o dono e quem tem a loja liberada (a mesma regra das outras telas: painel_minhas_lojas)
create or replace function public.compra_minha_loja(l text) returns boolean
language sql stable security definer set search_path to 'public' as $$
  select public.eh_dono() or public.manutencao_minha_loja(l)
$$;
revoke all on function public.compra_minha_loja(text) from public, anon;
grant execute on function public.compra_minha_loja(text) to authenticated;

drop policy if exists compra_cotacao_le on public.compra_cotacao;
create policy compra_cotacao_le on public.compra_cotacao for select to authenticated using (public.compra_minha_loja(loja));
drop policy if exists compra_cotacao_oferta_le on public.compra_cotacao_oferta;
create policy compra_cotacao_oferta_le on public.compra_cotacao_oferta for select to authenticated
  using (exists (select 1 from public.compra_cotacao c where c.id = cotacao_id and public.compra_minha_loja(c.loja)));
grant select on public.compra_cotacao, public.compra_cotacao_oferta to authenticated;

-- chave do robô de Compras (porta estreita: só as funções compra_robo_* e compra_wa_receber).
-- A chave é criada SÓ no Escritório 2 (compras-ml\gerar-chave.js) e nunca sai de lá: o vault guarda apenas o
-- resumo sha256 dela (gravado com vault.update_secret em 17/11/2026, depois deste arquivo).
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'compras_robo_segredo') then
    perform vault.create_secret('trocar-pelo-resumo-sha256-da-chave', 'compras_robo_segredo',
      'Resumo sha256 da chave do robo de Compras (a chave fica so no Escritorio 2).');
  end if;
end $$;

create or replace function public.compra_robo_segredo_ok(p_segredo text) returns boolean
language sql stable security definer set search_path to 'public','pg_temp' as $$
  select p_segredo is not null and char_length(p_segredo) >= 32
     and encode(sha256(convert_to(p_segredo, 'UTF8')), 'hex') = (select decrypted_secret from vault.decrypted_secrets where name = 'compras_robo_segredo')
$$;
revoke all on function public.compra_robo_segredo_ok(text) from public, anon, authenticated;

-- loja a partir do texto (padrão Água Verde: é para lá que vai quase tudo, Fábio 17/11)
create or replace function public.compra_loja_do_texto(t text) returns text
language sql immutable set search_path to 'public' as $$
  select case
    when translate(lower(coalesce(t,'')),'áàâãéêíóôõúç','aaaaeeiooouc') ~ '(sao bra[sz]|\msb\M)' then 'SÃO BRAZ'
    when translate(lower(coalesce(t,'')),'áàâãéêíóôõúç','aaaaeeiooouc') ~ '\mahu\M' then 'AHU'
    else 'AGUA VERDE' end
$$;

-- link do ML dentro do texto
create or replace function public.compra_link_do_texto(t text) returns text
language sql immutable set search_path to 'public' as $$
  select left(substring(coalesce(t,'') from '(https?://[^\s<>"]*(mercadolivre\.com\.br|mercadolibre\.com|meli\.la)[^\s<>"]*)'), 600)
$$;

-- termo de busca a partir do texto (tira link, a palavra "compra" e o nome da loja)
create or replace function public.compra_busca_do_texto(t text) returns text
language sql immutable set search_path to 'public' as $$
  select nullif(left(btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    coalesce(t,''),
    'https?://\S+', ' ', 'g'),
    '^\s*(compras?|comprar|cotar|cota[cç][aã]o|pre[cç]o)\s*[:\-]?\s*', '', 'i'),
    '\m(pra|para|p/)?\s*(a\s+|o\s+)?(loja\s+)?(agua verde|água verde|sao braz|são braz|sao bras|são brás|ahu|ahú)\M', ' ', 'gi'),
    '\s+', ' ', 'g')), 200), '')
$$;
-- as três de texto só são chamadas de dentro das funções abaixo (que rodam como dono): ninguém de fora executa
revoke all on function public.compra_loja_do_texto(text), public.compra_link_do_texto(text), public.compra_busca_do_texto(text) from public, anon, authenticated;

-- PORTAL: pedir cotação
create or replace function public.compra_cotacao_pedir(p_texto text, p_loja text default null) returns jsonb
language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_email text := lower(coalesce(auth.jwt() ->> 'email', '')); v_loja text; v_t text := btrim(coalesce(p_texto,'')); v_id bigint;
begin
  if v_email = '' then raise exception 'entre no portal'; end if;
  if char_length(v_t) < 3 then raise exception 'escreva o produto ou cole o link'; end if;
  if char_length(v_t) > 600 then raise exception 'texto muito longo'; end if;
  v_loja := coalesce(nullif(btrim(p_loja),''), public.compra_loja_do_texto(v_t));
  if v_loja not in ('AGUA VERDE','SÃO BRAZ','AHU') then raise exception 'loja invalida'; end if;
  if not public.compra_minha_loja(v_loja) then raise exception 'sem acesso a esta loja'; end if;
  insert into public.compra_cotacao (origem, pedido_por, texto, link, busca, loja)
  values ('portal', v_email, v_t, public.compra_link_do_texto(v_t), public.compra_busca_do_texto(v_t), v_loja)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
revoke all on function public.compra_cotacao_pedir(text, text) from public, anon;
grant execute on function public.compra_cotacao_pedir(text, text) to authenticated;

-- PORTAL: decidir (comprei esta / descartar / buscar de novo). Só registra: não compra nada.
create or replace function public.compra_cotacao_decidir(p_id bigint, p_acao text, p_oferta bigint default null) returns jsonb
language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_email text := lower(coalesce(auth.jwt() ->> 'email', '')); c public.compra_cotacao;
begin
  if v_email = '' then raise exception 'entre no portal'; end if;
  select * into c from public.compra_cotacao where id = p_id for update;
  if not found or not public.compra_minha_loja(c.loja) then raise exception 'cotacao nao encontrada'; end if;
  if p_acao = 'comprado' then
    if p_oferta is not null and not exists (select 1 from public.compra_cotacao_oferta o where o.id = p_oferta and o.cotacao_id = p_id) then raise exception 'oferta invalida'; end if;
    update public.compra_cotacao set status = 'comprado', oferta_escolhida = p_oferta, decidido_por = v_email, decidido_em = now() where id = p_id;
  elsif p_acao = 'descartado' then
    update public.compra_cotacao set status = 'descartado', decidido_por = v_email, decidido_em = now() where id = p_id;
  elsif p_acao = 'buscar' then
    update public.compra_cotacao set status = 'novo', tentativas = 0, erro = null, pego_em = null, decidido_por = null, decidido_em = null, oferta_escolhida = null where id = p_id;
  else raise exception 'acao invalida'; end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.compra_cotacao_decidir(bigint, text, bigint) from public, anon;
grant execute on function public.compra_cotacao_decidir(bigint, text, bigint) to authenticated;

-- PORTAL: listar (últimos N dias) com ofertas e o estado do robô
create or replace function public.compra_cotacao_listar(p_dias int default 30) returns jsonb
language sql stable security definer set search_path to 'public','pg_temp' as $$
  select jsonb_build_object(
    'consultado_em', now(),
    'robo', (select to_jsonb(e) - 'id' from public.compra_robo_estado e where id = 1),
    'pedidos', coalesce((
      select jsonb_agg(to_jsonb(c) || jsonb_build_object('ofertas', coalesce((
          select jsonb_agg(to_jsonb(o) order by o.preco, o.posicao) from public.compra_cotacao_oferta o where o.cotacao_id = c.id), '[]'::jsonb))
        order by c.criado_em desc)
      from public.compra_cotacao c
      where c.criado_em >= now() - make_interval(days => least(greatest(coalesce(p_dias,30),1),180))
        and public.compra_minha_loja(c.loja)), '[]'::jsonb))
$$;
revoke all on function public.compra_cotacao_listar(int) from public, anon;
grant execute on function public.compra_cotacao_listar(int) to authenticated;

-- ROBÔ: sinal de vida + pegar pedidos (até p_max). Sem DDL. Pedido preso em "buscando" há 20 min volta (até 3 tentativas).
create or replace function public.compra_robo_pegar(p_segredo text, p_max int default 3) returns jsonb
language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare r jsonb;
begin
  if not public.compra_robo_segredo_ok(p_segredo) then return jsonb_build_object('erro','segredo invalido'); end if;
  update public.compra_robo_estado set ultima_volta = now() where id = 1;
  update public.compra_cotacao set status = 'erro', erro = 'o robô tentou 3 vezes e não conseguiu ler o Mercado Livre'
   where status = 'buscando' and pego_em < now() - interval '20 minutes' and tentativas >= 3;
  with alvo as (
    select id from public.compra_cotacao
     where status = 'novo' or (status = 'buscando' and pego_em < now() - interval '20 minutes' and tentativas < 3)
     order by criado_em
     limit least(greatest(coalesce(p_max,3),1),5)
     for update skip locked),
  upd as (
    update public.compra_cotacao c set status = 'buscando', pego_em = now(), tentativas = c.tentativas + 1
      from alvo where c.id = alvo.id
    returning c.id, c.texto, c.link, c.busca, c.loja, c.criado_em)
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'texto', texto, 'link', link, 'busca', busca, 'loja', loja) order by criado_em), '[]'::jsonb)
    into r from upd;
  return jsonb_build_object('ok', true, 'pedidos', r);
end $$;
revoke all on function public.compra_robo_pegar(text, int) from public, authenticated;
grant execute on function public.compra_robo_pegar(text, int) to anon;

-- ROBÔ: gravar ofertas (valida os campos antes; troca as ofertas antigas da cotação)
create or replace function public.compra_robo_gravar(p_segredo text, p_id bigint, p_ofertas jsonb, p_ref jsonb default null, p_erro text default null) returns jsonb
language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare x jsonb; n int := 0; v_busca text;
begin
  if not public.compra_robo_segredo_ok(p_segredo) then return jsonb_build_object('erro','segredo invalido'); end if;
  if not exists (select 1 from public.compra_cotacao where id = p_id and status = 'buscando') then return jsonb_build_object('erro','cotacao nao esta em busca'); end if;
  update public.compra_robo_estado set ultima_busca = now(), ultimo_status = case when p_erro is null then 'ok' else 'falha' end where id = 1;
  if p_erro is not null then
    update public.compra_cotacao set status = case when tentativas >= 3 then 'erro' else 'novo' end, erro = left(p_erro, 300), buscado_em = now() where id = p_id;
    perform public.robos_pc_registra('compras-ml', 'FALHA', 'cotacao ' || p_id || ': ' || left(p_erro, 200));
    return jsonb_build_object('ok', true, 'falha_gravada', true);
  end if;
  if p_ofertas is null or jsonb_typeof(p_ofertas) <> 'array' or jsonb_array_length(p_ofertas) > 30 then raise exception 'ofertas invalidas'; end if;
  for x in select * from jsonb_array_elements(p_ofertas) loop
    if jsonb_typeof(x) <> 'object' then raise exception 'oferta invalida'; end if;
    if exists (select 1 from jsonb_object_keys(x) k where k not in ('posicao','item_id','catalogo_id','titulo','preco','preco_antigo','frete_gratis','entrega','vendedor','loja_oficial','avaliacao','vendidos','patrocinado','mesmo_produto','parecido','obs','link','imagem')) then raise exception 'campo nao permitido'; end if;
  end loop;
  delete from public.compra_cotacao_oferta where cotacao_id = p_id;
  insert into public.compra_cotacao_oferta (cotacao_id, posicao, item_id, catalogo_id, titulo, preco, preco_antigo, frete_gratis, entrega, vendedor, loja_oficial, avaliacao, vendidos, patrocinado, mesmo_produto, parecido, obs, link, imagem)
  select p_id, (x->>'posicao')::int, nullif(x->>'item_id',''), nullif(x->>'catalogo_id',''), left(btrim(x->>'titulo'),300), (x->>'preco')::numeric,
         nullif(x->>'preco_antigo','')::numeric, (x->>'frete_gratis')::boolean, left(nullif(btrim(x->>'entrega'),''),120), left(nullif(btrim(x->>'vendedor'),''),120),
         coalesce((x->>'loja_oficial')::boolean,false), nullif(x->>'avaliacao','')::numeric, left(nullif(btrim(x->>'vendidos'),''),60),
         coalesce((x->>'patrocinado')::boolean,false), coalesce((x->>'mesmo_produto')::boolean,false), nullif(x->>'parecido','')::int,
         left(nullif(btrim(x->>'obs'),''),160), x->>'link', nullif(x->>'imagem','')
    from jsonb_array_elements(p_ofertas) x;
  get diagnostics n = row_count;
  v_busca := nullif(left(btrim(p_ref->>'busca'),200),'');
  update public.compra_cotacao set status = 'pronto', erro = null, buscado_em = now(),
         busca = coalesce(v_busca, busca),
         ref_titulo = coalesce(nullif(left(btrim(p_ref->>'titulo'),300),''), ref_titulo),
         ref_preco = coalesce(nullif(p_ref->>'preco','')::numeric, ref_preco),
         ref_item = coalesce(case when (p_ref->>'item_id') ~ '^MLB\d{5,15}$' then p_ref->>'item_id' end, ref_item)
   where id = p_id;
  perform public.robos_pc_registra('compras-ml', 'OK', 'cotacao ' || p_id || ': ' || n || ' ofertas');
  return jsonb_build_object('ok', true, 'ofertas', n);
end $$;
revoke all on function public.compra_robo_gravar(text, bigint, jsonb, jsonb, text) from public, authenticated;
grant execute on function public.compra_robo_gravar(text, bigint, jsonb, jsonb, text) to anon;

-- WHATSAPP 1602: pedido que chega por mensagem (só daqui pra frente; só mensagem que começa com "compra" ou traz link do ML)
create or replace function public.compra_wa_receber(p_segredo text, p_wa_id text, p_nome text, p_texto text) returns jsonb
language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_t text := btrim(coalesce(p_texto,'')); v_id bigint;
begin
  if not public.compra_robo_segredo_ok(p_segredo) then return jsonb_build_object('erro','segredo invalido'); end if;
  if coalesce(p_wa_id,'') = '' or char_length(p_wa_id) > 200 then raise exception 'wa_id invalido'; end if;
  if char_length(v_t) < 3 then return jsonb_build_object('ok', true, 'ignorada', true); end if;
  v_t := left(v_t, 600);
  if public.compra_link_do_texto(v_t) is null and v_t !~* '^\s*(compras?|comprar|cotar)\M' then return jsonb_build_object('ok', true, 'ignorada', true); end if;
  insert into public.compra_cotacao (origem, pedido_por, texto, link, busca, loja, wa_id)
  values ('whatsapp', left(nullif(btrim(regexp_replace(coalesce(p_nome,''), '[[:cntrl:]]', ' ', 'g')),''), 60), v_t,
          public.compra_link_do_texto(v_t), public.compra_busca_do_texto(v_t), public.compra_loja_do_texto(v_t), p_wa_id)
  on conflict (wa_id) do nothing
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'repetida', v_id is null);
end $$;
revoke all on function public.compra_wa_receber(text, text, text, text) from public, authenticated;
grant execute on function public.compra_wa_receber(text, text, text, text) to anon;

-- Rita (compras) passa a ver a tela Mercado Livre
update public.painel_acesso
   set modulos = array_append(modulos, 'mercadolivre'),
       observacao = observacao || ' | 17/11/2026: + Mercado Livre (cotação de compras, pedido do Fábio)',
       atualizado_em = now()
 where email = 'rita@cidadaodomundo.com.br' and not ('mercadolivre' = any(modulos));

commit;
