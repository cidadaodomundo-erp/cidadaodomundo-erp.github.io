// Inspecao somente leitura do snapshot (sem rede).
import fs from "node:fs";
const base = process.argv[2];
const j = JSON.parse(fs.readFileSync(base + "/data/gama-cardapio.json", "utf8"));
console.log(Object.keys(j));
console.log("grupos", JSON.stringify(j.grupos));
console.log("opcoes n=", j.opcoes.length, JSON.stringify(j.opcoes.slice(0, 3)));
console.log("limites", JSON.stringify(j.limites));
console.log("produtos", j.produtos.length);
const cat = Object.fromEntries(j.categorias.map((c) => [c.id, c.nome]));
for (const p of j.produtos) {
  console.log(p.id, cat[p.categoria], "|", p.nome, "|", p.variacoes.map((v) => v.nome + ":" + v.centavos).join(","), "| g", p.grupos.join(","), "|", p.fotoLocal || "-", p.ocultarObservacao ? "noobs" : "", p.ocultarQuantidade ? "noqty" : "");
}
console.log(fs.readdirSync(base + "/public/gama-fotos").length, "fotos");
console.log(fs.readdirSync(base + "/public/marca"));
