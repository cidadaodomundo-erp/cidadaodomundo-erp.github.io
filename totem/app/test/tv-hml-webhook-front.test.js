// TV: saude do webhook vem no MESMO /api/hml/preparo (uma unica consulta); campo ausente = legado. DOM/fetch/timers falsos.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const FONTE = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "tv-hml.js");

class El {
  constructor() { this.children = []; this._t = ""; this.hidden = true; }
  get textContent() { return this._t; }
  set textContent(v) { this._t = String(v); this.children = []; }
  appendChild(c) { this.children.push(c); }
}
const tick = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };

async function rodar(dados) {
  const els = Object.fromEntries(["preparando", "pronto", "retirados", "conexao", "webhook"].map((id) => [id, new El()]));
  const urls = [];
  const ctx = vm.createContext({
    document: { getElementById: (id) => els[id], createElement: () => new El() },
    fetch: async (url) => { urls.push(url); return { ok: true, json: async () => dados }; },
    AbortController,
    setTimeout: () => 1, // nao agenda a proxima rodada
    clearTimeout: () => {},
  });
  vm.runInContext(await readFile(FONTE, "utf8"), ctx);
  await tick();
  return { els, urls };
}

const base = { preparando: [], pronto: [], retirados: [] };

test("TV: aguardando avisos / ultimo aviso, sem segredo e sem segunda consulta", async () => {
  const a = await rodar({ ...base, webhook: { ativo: true, estado: "aguardando_avisos", ultimoAvisoEm: null } });
  assert.deepEqual(a.urls, ["/api/hml/preparo"]);
  assert.equal(a.els.webhook.hidden, false);
  assert.match(a.els.webhook.textContent, /Aguardando avisos/);
  const b = await rodar({ ...base, webhook: { ativo: true, estado: "recebendo", ultimoAvisoEm: "2026-11-11T10:00:00.000Z" } });
  assert.match(b.els.webhook.textContent, /Último aviso do Saipos/);
  assert.ok(!/[a-f0-9]{32}/i.test(b.els.webhook.textContent));
});

test("TV: legado (campo ausente) ou nao_ligado mantem a linha oculta", async () => {
  assert.equal((await rodar(base)).els.webhook.hidden, true);
  assert.equal((await rodar({ ...base, webhook: { ativo: false, estado: "nao_ligado", ultimoAvisoEm: null } })).els.webhook.hidden, true);
});
