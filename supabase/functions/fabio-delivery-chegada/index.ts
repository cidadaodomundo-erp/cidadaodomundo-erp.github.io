// @ts-nocheck
// Edge Function fabio-delivery-chegada (Deno). Handler FINO: toda a regra está em leitura.mjs (testável em Node).
// Implantar no projeto ANTIGO (kqvoatdprjwxyadhvtdd) com verify_jwt = false: o JWT é do ERP (rtmgzsikwglsvpopbfbw) e é
// validado remotamente em leitura.mjs ANTES de qualquer consulta. Banco: SUPABASE_DB_URL (automática), transação READ ONLY,
// statement_timeout 8s, só SELECT nas funções privadas fabio_delivery.*. Sem cache de resposta. Nada é impresso em log.
import postgres from "npm:postgres@3.4.7";
import { responder, criarLimitador, corsHeaders } from "./leitura.mjs";

const limitador = criarLimitador({ max: 12, janelaMs: 60000 });   // por auth user.id do ERP

// Uma conexão por chamada, fechada no fim. Cada unidade em SAVEPOINT: falha de uma loja vira "indisponível" só dela.
async function lerConsulta(dia, unidades) {
  const url = Deno.env.get("SUPABASE_DB_URL");
  if (!url) throw new Error("sem_db");
  const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 8, prepare: false, onnotice: () => {} });
  try {
    return await sql.begin("read only", async (tx) => {
      await tx`set local statement_timeout = '8s'`;
      const out = [];
      for (const un of unidades) {
        try {
          const r = await tx.savepoint(async (sp) => await sp`select fabio_delivery.chegada_consulta(${dia}::date, ${un}::text) as c`);
          out.push(r.length === 1 ? { unidade: un, ok: true, valor: r[0].c } : { unidade: un, ok: false, valor: null });
        } catch (_e) {
          out.push({ unidade: un, ok: false, valor: null });   // sem detalhe do erro: não vaza nada
        }
      }
      return out;
    });
  } finally {
    await sql.end({ timeout: 2 });
  }
}

Deno.serve(async (req) => {
  const origem = req.headers.get("origin") || "";
  const u = new URL(req.url);
  const r = await responder({
    metodo: req.method, origem, authorization: req.headers.get("authorization"),
    query: { dia: u.searchParams.get("dia"), unidade: u.searchParams.get("unidade") },
    fetchImpl: fetch, agora: Date.now, limitador, lerConsulta,
  });
  const headers = { ...corsHeaders(origem), "Content-Type": "application/json; charset=utf-8" };
  return new Response(r.corpo === null ? null : JSON.stringify(r.corpo), { status: r.status, headers });
});
