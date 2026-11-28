// Executa public/tv-hml.js em node:vm com DOM, fetch e timers FALSOS (relogio virtual). Sem rede.

import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const FONTE = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "tv-hml.js");

class El {
  constructor() { this.children = []; this._t = ""; this.hidden = false; this.className = ""; }
  get textContent() { return this._t; }
  set textContent(v) { this._t = String(v); this.children = []; }
  appendChild(c) { this.children.push(c); }
  senhas() { return this.children.map((c) => c.textContent); }
}

const tick = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };

test("TV: uma consulta por vez; fetch pendurado -> aborta, limpa e avisa; depois recupera", async () => {
  const els = Object.fromEntries(["preparando", "pronto", "retirados", "conexao"].map((id) => [id, new El()]));
  els.conexao.hidden = true;
  let agora = 0;
  let timers = [];
  let proximoId = 1;
  const fake = {
    setTimeout: (fn, ms) => { const id = proximoId++; timers.push({ id, em: agora + ms, fn }); return id; },
    clearTimeout: (id) => { timers = timers.filter((t) => t.id !== id); },
    setInterval: () => { throw new Error("setInterval proibido: causaria sobreposicao"); },
  };
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

  let modo = "ok";
  let chamadas = 0, emVoo = 0, maxEmVoo = 0;
  const dados = { preparando: [{ senha: 9201 }], pronto: [{ senha: 9202 }], retirados: [] };
  const fetchFalso = (url, init) => {
    chamadas++; emVoo++; maxEmVoo = Math.max(maxEmVoo, emVoo);
    const fim = (f) => (v) => { emVoo--; return f(v); };
    if (modo === "hang") {
      return new Promise((_, rej) => init.signal.addEventListener("abort", () => { emVoo--; rej(new Error("abortado")); }));
    }
    return Promise.resolve({ ok: true, json: async () => dados }).then(fim((r) => r));
  };

  const contexto = vm.createContext({
    document: { getElementById: (id) => els[id], createElement: () => new El() },
    fetch: fetchFalso,
    AbortController,
    ...fake,
  });
  vm.runInContext(await readFile(FONTE, "utf8"), contexto);

  await avancar(0);
  assert.deepEqual(els.preparando.senhas(), ["9201"]);
  assert.deepEqual(els.pronto.senhas(), ["9202"]);
  assert.equal(els.conexao.hidden, true);

  modo = "hang";
  await avancar(1500); // inicia a consulta pendurada
  assert.equal(chamadas, 2);
  await avancar(3000); // 4500 desde o inicio dela? ainda < 4000 do abort (1500+4000=5500)
  assert.equal(chamadas, 2); // nenhuma segunda consulta sobreposta
  assert.equal(maxEmVoo, 1);
  await avancar(1000); // passou de 4 s: abort
  assert.deepEqual(els.preparando.senhas(), []);
  assert.deepEqual(els.pronto.senhas(), []);
  assert.equal(els.conexao.hidden, false);

  modo = "ok";
  await avancar(1600); // proxima consulta 1,5 s apos o fim da anterior
  assert.deepEqual(els.preparando.senhas(), ["9201"]);
  assert.equal(els.conexao.hidden, true);
  assert.equal(maxEmVoo, 1);
});
