#!/usr/bin/env node
// SO PARA DEMONSTRACAO: deixa celulares da mesma rede Wi-Fi abrirem o totem DEMO
// (que so escuta em 127.0.0.1). Repassa tudo para http://127.0.0.1:<alvo>.
// Nunca use com o modo real (Saipos/pagamento de verdade): so com bin/start-demo.js.
//   node bin/rede-demo.js            (escuta em 0.0.0.0:4661 e repassa para 127.0.0.1:4660)
// Opcoes: --porta 4661  --alvo 4660

import http from "node:http";
import { networkInterfaces } from "node:os";
import { fileURLToPath } from "node:url";

function opcao(nome, padrao) {
  const i = process.argv.indexOf(nome);
  const v = i > 0 ? Number(process.argv[i + 1]) : padrao;
  return Number.isInteger(v) && v > 0 && v < 65536 ? v : padrao;
}

export function criarRedeDemo({ alvo = 4660 } = {}) {
  const destino = `127.0.0.1:${alvo}`;
  return http.createServer((req, res) => {
    const headers = { ...req.headers, host: destino };
    if (headers.origin) headers.origin = `http://${destino}`;
    delete headers.referer;
    const p = http.request({ host: "127.0.0.1", port: alvo, method: req.method, path: req.url, headers }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    p.on("error", () => { if (!res.headersSent) res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" }); res.end("Totem demo desligado."); });
    req.pipe(p);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const porta = opcao("--porta", 4661);
  const alvo = opcao("--alvo", 4660);
  criarRedeDemo({ alvo }).listen(porta, "0.0.0.0", () => {
    const ips = Object.values(networkInterfaces()).flat().filter((i) => i && i.family === "IPv4" && !i.internal).map((i) => i.address);
    console.log("DEMO na rede (tudo simulado, nada e cobrado):");
    for (const ip of ips) console.log(`  Totem: http://${ip}:${porta}/   Cozinha: http://${ip}:${porta}/cozinha-hml.html   TV: http://${ip}:${porta}/tv-hml.html`);
  });
}
