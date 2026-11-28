// Fixtures FAKE do cardapio/mapa/catalogo HML (sem segredos, sem rede). Nao e um teste.

export const COD_STORE = "ef2dc467-a4a8-4734-a4d7-eb3442ff3401";
export const DIAS = "Domingo,Segunda-Feira,Terça-Feira,Quarta-Feira,Quinta-Feira,Sexta-Feira,Sábado";
export const H24 = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0")).join(",");
export const H_ALMOCO = "11,12,13,14,15,16,17";
// America/Sao_Paulo = UTC-3 (sem horario de verao): 04:00Z = 01h, 15:00Z = 12h
export const AS_01H = new Date("2026-11-11T04:00:00Z");
export const AS_12H = new Date("2026-11-11T15:00:00Z");

const produto = (id, nome, categoria, variacoes, grupos = [], extra = {}) => ({
  id, nome, descricao: `${nome} (desc)`, categoria, posicao: id, ativo: 1, visivel: 1, dias: DIAS, horarios: H24,
  fotoOriginal: "https://exemplo.invalid/x.webp", fotoLocal: `/gama-fotos/p${id}.webp`,
  variacoes, grupos, ingredientes: [], ocultarObservacao: false, ocultarQuantidade: false, ...extra,
});

export function dtoFixture() {
  return {
    formato: "menu-cidadao-gama/1",
    somenteTeste: true,
    fornecedor: "Gama/VNDX",
    fonte: { origem: "exemplo", consultadoEm: "2026-11-11T04:42:27.768Z", sha256: "x", categoriasDisponiveisNaConsulta: [1] },
    categorias: [
      { id: 1, nome: "Lanches", posicao: 1, ativo: 1, visivel: 1, dias: DIAS, horarios: H24 },
      { id: 2, nome: "Feijoada", posicao: 2, ativo: 1, visivel: 1, dias: DIAS, horarios: H_ALMOCO },
    ],
    produtos: [
      produto(10, "Burger", 1, [{ indice: 1, nome: "Unidade", centavos: 3399 }], [4, 5, 38]),
      produto(11, "Cerveja", 1, [{ indice: 1, nome: "300ml", centavos: 1300 }, { indice: 2, nome: "500ml", centavos: 2100 }]),
      produto(12, "Bebida", 1, [{ indice: 1, nome: "Unidade", centavos: 800 }], [38]),
      produto(20, "Feijoada Completa", 2, [{ indice: 1, nome: "Unidade", centavos: 4500 }]),
      produto(21, "PF do dia", 2, [{ indice: 1, nome: "Unidade", centavos: 3000 }], [], { horarios: H24 }), // horario proprio 24h; a CATEGORIA limita
      produto(30, "Sem opcoes", 1, [{ indice: 1, nome: "Unidade", centavos: 500 }], [], { ocultarObservacao: true, ocultarQuantidade: true }),
      produto(31, "Caro", 1, [{ indice: 1, nome: "Unidade", centavos: 300000 }]),
    ],
    grupos: [
      { id: 4, nome: "Turbine", posicao: 19, ativo: 1, minimo: 0, maximo: 3, permitir_quantidade: 1, cobrar_apartir_de: 0 },
      { id: 5, nome: "Molho", posicao: 20, ativo: 1, minimo: 1, maximo: 1, permitir_quantidade: 0, cobrar_apartir_de: 0 },
      { id: 38, nome: "Algo na bebida", posicao: 38, ativo: 0, minimo: 1, maximo: 2, permitir_quantidade: 0, cobrar_apartir_de: 0 },
    ],
    opcoes: [
      { id: 22, nome: "Aneis", adicional: 4, descricao: null, posicao: 22, ativo: 1, centavos: 1299 },
      { id: 23, nome: "Bacon", adicional: 4, descricao: null, posicao: 23, ativo: 1, centavos: 1499 },
      { id: 91, nome: "Inativa", adicional: 4, descricao: null, posicao: 24, ativo: 0, centavos: 300 },
      { id: 25, nome: "Molho Especial", adicional: 5, descricao: "x", posicao: 25, ativo: 1, centavos: 200 },
      { id: 26, nome: "Ketchup", adicional: 5, descricao: null, posicao: 26, ativo: 1, centavos: 0 },
      { id: 90, nome: "Gelo", adicional: 38, descricao: null, posicao: 90, ativo: 1, centavos: 100 },
    ],
  };
}

const prato = (codigo, nome, preco, idItem) => ({ tipo: "PRATO", codigo_saipos: codigo, item: nome, price: preco, store_item_enabled: "Y", id_store_item: idItem, item_type: "simples" });
const comp = (codigo, nome, preco, idItem, idGrupo, min, max) => ({
  tipo: "COMPLEMENTO", codigo_saipos: codigo, complemento_item: nome, price: preco,
  store_choice_item_enabled: "Y", store_choice_enabled: "Y", store_item_enabled: "Y",
  id_store_item: idItem, id_store_choice: idGrupo, min_choices: min, max_choices: max, item_type: "simples",
});

// Catalogo HML FAKE (as linhas de Diversos sao exigidas pela subida do servidor).
export function catalogoHml() {
  return [
    prato("40101353", "Diversos", 0, 1),
    prato("HML-BURGER", "Burger HML", 33.99, 11),
    prato("HML-CERV-500", "Cerveja 500 HML", 21, 12),
    prato("HML-BEBIDA", "Bebida HML", 8, 13),
    prato("HML-FEIJ", "Feijoada HML", 45, 14),
    prato("HML-CARO", "Caro HML", 3000, 15),
    comp("HML-ANEIS", "Aneis HML", 12.99, 11, 100, 0, 3),
    comp("HML-BACON", "Bacon HML", 14.99, 11, 100, 0, 3),
    // codigo GLOBAL de complemento aparece em varios itens, com precos diferentes
    comp("HML-MOLHO", "Molho HML", 2, 11, 101, 1, 1),
    comp("HML-MOLHO", "Molho HML", 9.99, 12, 101, 1, 1),
    comp("HML-KETCHUP", "Ketchup HML", 0, 11, 101, 1, 1),
  ];
}

export function mapaFixture() {
  return {
    schema: "gama-hml-map", version: 1, storeUuid: COD_STORE,
    itens: [
      { produto: 10, variacao: 1, codigoHml: "HML-BURGER", precoCentavos: 3399 },
      { produto: 11, variacao: 2, codigoHml: "HML-CERV-500", precoCentavos: 2100 },
      { produto: 12, variacao: 1, codigoHml: "HML-BEBIDA", precoCentavos: 800 },
      { produto: 20, variacao: 1, codigoHml: "HML-FEIJ", precoCentavos: 4500 },
      { produto: 31, variacao: 1, codigoHml: "HML-CARO", precoCentavos: 300000 },
    ],
    opcoes: [
      { opcao: 22, codigoHml: "HML-ANEIS", precoCentavos: 1299 },
      { opcao: 23, codigoHml: "HML-BACON", precoCentavos: 1499 },
      { opcao: 25, codigoHml: "HML-MOLHO", precoCentavos: 200 },
      { opcao: 26, codigoHml: "HML-KETCHUP", precoCentavos: 0 },
    ],
    grupos: [],
  };
}

// ---------- v2: codigo de complemento COMPOSTO (codigo da variacao + "." + id da opcao), FICTICIO ----------
// Cerveja (11) passa a ter o grupo 4 (Turbine) para repetir a opcao 22 em outro produto; o id_store_choice 100 e o mesmo entre produtos.
export function dtoFixtureV2() {
  const d = dtoFixture();
  d.produtos.find((p) => p.id === 11).grupos = [4];
  return d;
}

const pratoV2 = (codigo, nome, preco, idItem, tamanho, interno) => ({ ...prato(codigo, nome, preco, idItem), tamanho, codigo_interno: interno });
const compV2 = (codigo, nome, preco, idItem, tamanho, grupoNome, idGrupo, min, max) => ({ ...comp(codigo, nome, preco, idItem, idGrupo, min, max), tamanho, complemento: grupoNome });

export function catalogoHmlV2() {
  return [
    prato("40101353", "Diversos", 0, 1),
    pratoV2("501", "Burger HML", 33.99, 11, "Unidade", "GAMA10"),
    pratoV2("901", "Cerveja 300 HML", 13, 12, "300ml", "GAMA11"),
    pratoV2("902", "Cerveja 500 HML", 21, 13, "500ml", "GAMA11"),
    pratoV2("801", "Bebida HML", 8, 14, "Unidade", "GAMA12"),
    compV2("501.22", "Aneis", 12.99, 11, "Unidade", "Turbine", 100, 0, 3),
    compV2("501.23", "Bacon", 14.99, 11, "Unidade", "Turbine", 100, 0, 3),
    compV2("501.25", "Molho Especial", 2, 11, "Unidade", "Molho", 101, 1, 1),
    compV2("501.26", "Ketchup", 0, 11, "Unidade", "Molho", 101, 1, 1),
    compV2("901.22", "Aneis", 12.99, 12, "300ml", "Turbine", 100, 0, 3),
    compV2("902.22", "Aneis", 12.99, 13, "500ml", "Turbine", 100, 0, 3),
  ];
}

export function mapaFixtureV2() {
  const o = (produto, variacao, opcao, codigoHml, precoCentavos) => ({ produto, variacao, opcao, codigoHml, precoCentavos });
  return {
    schema: "gama-hml-map", version: 2, storeUuid: COD_STORE,
    itens: [
      { produto: 10, variacao: 1, codigoHml: "501", precoCentavos: 3399 },
      { produto: 11, variacao: 1, codigoHml: "901", precoCentavos: 1300 },
      { produto: 11, variacao: 2, codigoHml: "902", precoCentavos: 2100 },
    ],
    opcoes: [
      o(10, 1, 22, "501.22", 1299), o(10, 1, 23, "501.23", 1499), o(10, 1, 25, "501.25", 200), o(10, 1, 26, "501.26", 0),
      o(11, 1, 22, "901.22", 1299), o(11, 2, 22, "902.22", 1299),
    ],
    grupos: [],
  };
}

// Carrinho valido de referencia: total = (3399 + 1299*2 + 200)*2 + 2100 = 14494
export const itemBurger = (extra = {}) => ({ produto: 10, variacao: 1, quantidade: 2, opcoes: [{ opcao: 22, quantidade: 2 }, { opcao: 25, quantidade: 1 }], ...extra });
export const itemCerveja = (extra = {}) => ({ produto: 11, variacao: 2, quantidade: 1, opcoes: [], ...extra });
export const TOTAL_REFERENCIA = 14494;
