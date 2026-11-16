// Executa public/cozinha-hml.js em node:vm com DOM, fetch, crypto e timers FALSOS. Sem rede.

import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const FONTE = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "cozinha-hml.js");
const ID = "dddddddd-0000-4000-8000-000000000001";

class El {
  constructor() { this.children = []; this._t = ""; this.hidden = false; this.disabled = false; this.className = ""; this.h = []; }
  get textContent() { return this._t; }
  set textContent(v) { this._t = String(v); this.children = []; }
  appendChild(c) { this.children.push(c); }
  append(...cs) { this.children.push(...cs); }
  addEventListener(_, f) { this.h.push(f); }
  click() { for (const f of this.h) f(); }
}

const tick = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };
const resp = (status, obj = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => obj });
const pendurar = (init) => new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(new Error("abortado"))));

async function montar(roteador) {
  const els = Object.fromEntries(["preparando", "pronto", "conexao", "mensagem"].map((i) => [i, new El()]));
  els.conexao.hidden = true;
  let agora = 0, timers = [], proximoId = 1, uuid = 1;
  const chamadas = [];
  const fetchFalso = (url, init = {}) => {
    const c = { url, metodo: init.method ?? "GET", corpo: init.body ? JSON.parse(init.body) : null };
    chamadas.push(c);
    return roteador(c, init);
  };
  const ctx = vm.createContext({
    document: { getElementById: (i) => els[i], createElement: () => new El() },
    fetch: fetchFalso,
    AbortController,
    crypto: { randomUUID: () => `aaaaaaaa-0000-4000-8000-${String(uuid++).padStart(12, "0")}` },
    setTimeout: (fn, ms) => { const id = proximoId++; timers.push({ id, em: agora + ms, fn }); return id; },
    clearTimeout: (id) => { timers = timers.filter((t) => t.id !== id); },
    setInterval: () => { throw new Error("setInterval proibido"); },
  });
  async function avancar(ms) {
    const alvo = agora + ms;
    for (;;) {
      await tick();
      const t = timers.filter((x) => x.em <= alvo).sort((a, b) => a.em - b.em)[0];
      if (!t) break;
      timers = timers.filter((x) => x !== t);
      agora = t.em;
      t.fn();
    }
    await tick();
    agora = alvo;
  }
  vm.runInContext(await readFile(FONTE, "utf8"), ctx);
  const botao = (col) => els[col].children[0]?.children[1];
  return { els, avancar, chamadas, botao, posts: () => chamadas.filter((c) => c.metodo === "POST") };
}

const lista = { preparando: [{ id: ID, senha: 9201 }], pronto: [], retirados: [] };

test("cozinha: inicio sem rede recupera CSRF; GET pendurado aborta, limpa, avisa e recupera; sem sobreposicao", async () => {
  let rede = "fora"; // fora | ok | hang
  let emVoo = 0, maxEmVoo = 0;
  const h = await montar((c, init) => {
    emVoo++; maxEmVoo = Math.max(maxEmVoo, emVoo);
    const sair = (v) => { emVoo--; return v; };
    if (rede === "fora") return Promise.reject(new Error("rede")).catch((e) => { emVoo--; throw e; });
    if (rede === "hang") return new Promise((_, rej) => init.signal.addEventListener("abort", () => { emVoo--; rej(new Error("a")); }));
    return Promise.resolve(c.url.endsWith("/config") ? resp(200, { csrf: "tok" }) : resp(200, lista)).then(sair);
  });
  await h.avancar(0);
  assert.equal(h.els.conexao.hidden, false);
  assert.equal(h.botao("preparando"), undefined);

  rede = "ok";
  await h.avancar(1600);
  assert.equal(h.els.conexao.hidden, true);
  assert.equal(h.els.preparando.children.length, 1);
  assert.ok(h.chamadas.some((c) => c.url.endsWith("/config")));

  rede = "hang";
  await h.avancar(1500);
  await h.avancar(3800);
  assert.equal(h.els.preparando.children.length, 1); // ainda dentro dos 4 s
  await h.avancar(200);
  assert.equal(h.els.preparando.children.length, 0);
  assert.equal(h.els.conexao.hidden, false);

  rede = "ok";
  await h.avancar(1600);
  assert.equal(h.els.preparando.children.length, 1);
  assert.equal(h.els.conexao.hidden, true);
  assert.equal(maxEmVoo, 1);
});

test("cozinha: POST com timeout/5xx repete a MESMA actionKey; definitiva elimina; sem GET antes do POST", async () => {
  let modoPost = "hang";
  const h = await montar((c, init) => {
    if (c.url.endsWith("/config")) return Promise.resolve(resp(200, { csrf: "tok" }));
    if (c.metodo === "GET") return Promise.resolve(resp(200, lista));
    if (modoPost === "hang") return pendurar(init);
    return Promise.resolve(resp(modoPost));
  });
  await h.avancar(0);
  const antes = h.chamadas.length;
  h.botao("preparando").click();
  // a chamada seguinte ao clique e o POST (nenhum GET bloqueante antes)
  assert.equal(h.chamadas.length, antes + 1);
  assert.equal(h.chamadas.at(-1).metodo, "POST");
  assert.equal(h.botao("preparando").disabled, true);
  h.botao("preparando").click(); // duplo clique em voo: ignorado
  assert.equal(h.posts().length, 1);

  await h.avancar(4100); // timeout 4 s
  assert.match(h.els.mensagem.textContent, /Sem confirmação/);
  assert.equal(h.botao("preparando").disabled, false);
  const k1 = h.posts()[0].corpo.actionKey;

  modoPost = 503;
  h.botao("preparando").click();
  await h.avancar(10);
  assert.equal(h.posts()[1].corpo.actionKey, k1); // mesmo evento no retry
  assert.match(h.els.mensagem.textContent, /Sem confirmação/);

  modoPost = 200;
  h.botao("preparando").click();
  await h.avancar(10);
  assert.equal(h.posts()[2].corpo.actionKey, k1);
  assert.equal(h.els.mensagem.textContent, "");

  modoPost = 200;
  h.botao("preparando").click(); // lista ainda (velha) mostra o item: chave nova
  await h.avancar(10);
  assert.notEqual(h.posts()[3].corpo.actionKey, k1);

  modoPost = 409; // definitiva: elimina a chave
  h.botao("preparando").click();
  await h.avancar(10);
  const k409 = h.posts()[4].corpo.actionKey;
  assert.match(h.els.mensagem.textContent, /Não foi possível concluir/);
  h.botao("preparando").click();
  await h.avancar(10);
  assert.notEqual(h.posts()[5].corpo.actionKey, k409);
  assert.ok(h.posts().every((p) => Object.keys(p.corpo).join() === "actionKey"));
});
