// @ts-nocheck
// Edge Function fabio-ponto-leitura (Deno). Handler FINO: toda a regra está em leitura.mjs (testável em Node).
// Só LEITURA. Não cria RPC, grant, policy nem expõe schema próprio. Segredo e vínculos vêm do banco por conexão
// direta (SUPABASE_DB_URL, automática), em transação READ ONLY, só depois de autenticar e autorizar o chamador.
// Nada é impresso em log: nem chave, nem JWT, nem dado de pessoa.
import postgres from "npm:postgres@3.4.7";
import { responder, criarCache, criarLimitador, corsHeaders, origensDe, origemPermitida } from "./leitura.mjs";

const cache = criarCache({ ttlMs: 60000 });   // só leitura bruta do Flash por empresa/dia; dado filtrado por usuário nunca é guardado

async function lerPrivado(consulta) {
  const url = Deno.env.get("SUPABASE_DB_URL");
  if (!url) throw new Error("sem_db");
  const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 10, prepare: false, onnotice: () => {} });
  try { return await sql.begin("read only", consulta); }
  finally { await sql.end({ timeout: 2 }); }
}
// (1) chave BUSINESS do Flash (vault); devolve só o valor, em memória desta chamada
const obterChaveFlash = async () => lerPrivado(async (tx) => {
  const r = await tx`select decrypted_secret from vault.decrypted_secrets where name = 'fabio_ponto_flash_api' limit 1`;
  return r.length === 1 && typeof r[0].decrypted_secret === "string" ? r[0].decrypted_secret : null;
});
// (2) cadastro próprio de vínculos de refeição (só CADASTRO: unidade, tipo, chave, nome, vigência)
const obterVinculos = async () => lerPrivado(async (tx) =>
  await tx`select unidade, tipo, chave, nome, valido_desde::text as valido_desde from fabio_ponto.vinculo_refeicao`);

// (3) jornada cadastral privada (retrato conferido; NÃO é escala diária). Falha aqui não derruba o ponto.
const obterJornadas = async () => lerPrivado(async (tx) =>
  await tx`select unidade, nome, entrada::text as entrada, saida::text as saida, conferido_em::text as conferido_em from fabio_ponto.jornada`);

const limitador = criarLimitador({ max: 12, janelaMs: 60000 });   // por auth user.id; memória limitada; nada de resposta guardada

Deno.serve(async (req) => {
  const origens = origensDe(Deno.env.get("FABIO_PONTO_ORIGENS"));   // padrão explícito; '*' nunca
  const origem = req.headers.get("origin") || "";
  const cors = corsHeaders(origem, origens);
  const jsonErro = (status, erro) => new Response(JSON.stringify({ erro }), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });
  if (!origemPermitida(origem, origens)) return jsonErro(403, "origem_nao_permitida");   // sem Allow-Origin e antes de ler qualquer dado
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const u = new URL(req.url);
  const r = await responder({
    metodo: req.method, authorization: req.headers.get("authorization"), origem, origens,
    query: { dia: u.searchParams.get("dia"), unidade: u.searchParams.get("unidade") },
    env: { supabaseUrl: Deno.env.get("SUPABASE_URL"), anonKey: Deno.env.get("SUPABASE_ANON_KEY") },
    fetchImpl: fetch, agora: Date.now, cache, limitador, obterChaveFlash, obterVinculos, obterJornadas,
  });
  return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });
});

