// Empacota o tablet-mesas-cdm.html standalone. LOCAL, sem rede. Le (somente leitura) a base do laboratorio
// e escreve APENAS dentro desta pasta de projeto (tablet-mesas).
// Uso: node tools/build.mjs [--completo] [caminho-do-app-do-totem]   (padrao: ../../totem/app deste repositorio)
//   --completo: todos os produtos ativos/visiveis com foto (cardapio inteiro do totem), em vez da amostra de 6-10.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { montarMenu, gruposValidos as gruposValidosMenu } from "./menu.mjs";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARGS = process.argv.slice(2);
const COMPLETO = ARGS.includes("--completo");
const BASE = path.resolve(ARGS.find((a) => !a.startsWith("--")) || path.join(RAIZ, "..", "..", "totem", "app"));
if (BASE === RAIZ || RAIZ.startsWith(BASE + path.sep)) throw new Error("Base e saida nao podem coincidir nem a saida ficar dentro da base.");

const lerBase = (...p) => fs.readFileSync(path.join(BASE, ...p)); // unica forma de tocar a base: leitura
const lerSrc = (f) => fs.readFileSync(path.join(RAIZ, "src", f), "utf8");
const uri = (buf, mime) => `data:${mime};base64,${buf.toString("base64")}`;

const j = JSON.parse(lerBase("data", "gama-cardapio.json").toString("utf8"));
const fotoArquivo = (p) => path.join(BASE, "public", p.fotoLocal.replace(/^\//, ""));
const temFoto = (p) => p.fotoLocal && fs.existsSync(fotoArquivo(p));

const gruposValidos = (p) => gruposValidosMenu(j, p);
const elegivel = (p) => p.ativo && p.visivel && temFoto(p);

// ---------- amostra representativa (6-10 produtos, todos com foto) ----------
const escolhidos = [];
const add = (p) => { if (p && elegivel(p) && !escolhidos.includes(p)) escolhidos.push(p); };
const porId = (id) => j.produtos.find((p) => p.id === id);
for (const id of [146, 150, 255]) { if (!porId(id) || !elegivel(porId(id))) throw new Error("Produto base ausente: " + id); add(porId(id)); }
const regras = [
  (p) => gruposValidos(p).some((g) => g.minimo >= 1 && g.maximo === 1 && !g.permitir_quantidade), // escolha unica obrigatoria
  (p) => gruposValidos(p).some((g) => g.minimo >= 1 && g.maximo > 1),                              // minimo/maximo obrigatorio
  (p) => p.variacoes.length > 1 && p.categoria !== 55,                                             // variacoes fora de bebidas
  (p) => p.categoria === 34,                                                                       // porcoes
  (p) => p.categoria === 38,                                                                       // caldos
];
if (!COMPLETO) for (const r of regras) { const antes = escolhidos.length; add(j.produtos.find((p) => elegivel(p) && !escolhidos.includes(p) && r(p))); if (escolhidos.length === antes) console.warn("AVISO: regra de amostra sem produto novo"); }
for (const p of j.produtos) { if (escolhidos.length >= 6) break; add(p); }
if (COMPLETO) { escolhidos.length = 0; for (const p of j.produtos) add(p); }
if (!COMPLETO && (escolhidos.length < 6 || escolhidos.length > 10)) throw new Error("Amostra fora de 6-10: " + escolhidos.length);

// ---------- menu embutido (so o necessario; precos exatamente como no snapshot) ----------
const dados = { ...montarMenu(j, escolhidos), fotos: Object.fromEntries(escolhidos.map((p) => [p.id, uri(fs.readFileSync(fotoArquivo(p)), "image/webp")])) };
const { produtos, categorias, fotos } = dados;

// ---------- fontes e logo ----------
const fonte = (familia, arq, peso, formato, mime) => `@font-face{font-family:"${familia}";font-weight:${peso};font-style:normal;font-display:swap;src:url(${uri(lerBase("public", "marca", arq), mime)}) format("${formato}")}`;
const css = [
  fonte("Cubano", "Cubano-Regular.otf", 400, "opentype", "font/otf"),
  fonte("Barlow", "Barlow-Regular.ttf", 400, "truetype", "font/ttf"),
  fonte("Barlow", "Barlow-SemiBold.ttf", 600, "truetype", "font/ttf"),
  lerSrc("style.css"),
].join("\n");
const logo = uri(lerBase("public", "marca", "logo-cdm.png"), "image/png");

const seguro = (s) => s.replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
let html = lerSrc("index.template.html");
const trocas = { "{{CSS}}": css, "{{CORE}}": lerSrc("core.js"), "{{APP}}": lerSrc("app.js"), "{{DADOS}}": seguro(JSON.stringify(dados)), "{{LOGO}}": logo };
for (const [k, v] of Object.entries(trocas)) html = html.split(k).join(v);

// ---------- verificacoes de seguranca do artefato ----------
const proibidos = [/https?:\/\//i, /\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /sendBeacon/, /EventSource/, /innerHTML/, /outerHTML/, /insertAdjacentHTML/, /document\.write/, /\beval\s*\(/, /new Function/, /\bimport\s*\(/, /<script[^>]+src=/i, /<link\b/i, /\.env\b/];
const semDados = html.replace(/data:[^"')\s]+/g, "DATA");
for (const re of proibidos) if (re.test(semDados)) throw new Error("Padrao proibido no artefato: " + re);
// Cubano nao tem cedilha/acentos garantidos: titulos Cubano estaticos devem ser ASCII
for (const m of html.matchAll(/class="[^"]*\bcubano\b[^"]*"[^>]*>([^<]*)</g)) if (/[^\x20-\x7e]/.test(m[1])) throw new Error("Titulo Cubano nao ASCII: " + m[1]);

fs.writeFileSync(path.join(RAIZ, "tablet-mesas-cdm.html"), html);
fs.writeFileSync(path.join(RAIZ, "amostra-produtos.json"), JSON.stringify({ consultadoEm: j.fonte.consultadoEm, sha256: j.fonte.sha256, totalProdutosSnapshot: j.produtos.length,
  produtos: produtos.map((p) => ({ id: p.id, nome: p.nome, categoria: categorias.find((c) => c.id === p.categoria).nome, variacoes: p.variacoes.map((v) => `${v.nome}: ${(v.centavos / 100).toFixed(2)}`), grupos: p.grupos })) }, null, 2));

const kb = (n) => (n / 1024).toFixed(0) + " KB";
console.log("OK tablet-mesas-cdm.html", kb(Buffer.byteLength(html)), "| produtos:", produtos.map((p) => p.id + " " + p.nome).join("; "));
console.log("logo", kb(logo.length), "| fotos", Object.entries(fotos).map(([id, u]) => id + ":" + kb(u.length)).join(" "));
