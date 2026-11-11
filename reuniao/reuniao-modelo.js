/* Modelo puro da Reunião semanal (pauta temporária, só em memória da aba).
 * CommonJS + browser UMD. Sem rede, sem DB, sem DOM, sem storage, sem relógio, sem timers.
 * Não lê dado de negócio e não sugere métrica nem decisão: os campos nascem vazios. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ModeloReuniao = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TEMAS_INICIAIS = ['Vendas/Pedidos', 'Delivery/Qualidade', 'Equipe/escala', 'Compras/Manutenção'];
  var LIMITES = { tema: 120, curto: 120, decisao: 2000, ata: 10000, participante: 80, temas: 30, participantes: 40 };
  var CAMPOS_TEMA = ['tema', 'decisao', 'responsavel', 'prazo'];

  // Atalhos: só chaves que já existem no menu da casca. href relativo a reuniao/index.html.
  var DESTINOS = [
    { chave: 'semana', rotulo: 'Ver A semana', pagina: 'gestao/index.html#semana' },
    { chave: 'delivery', rotulo: 'Ver Delivery do dia', pagina: 'delivery/index.html' },
    { chave: 'qualidade', rotulo: 'Ver Qualidade', pagina: 'canal/index.html#qualidade' },
    { chave: 'reservas', rotulo: 'Ver Reservas', pagina: 'reservas/index.html' }
  ];

  function destino(chave) {
    for (var i = 0; i < DESTINOS.length; i++) if (DESTINOS[i].chave === chave) return DESTINOS[i];
    return null;
  }
  /* Link para abrir fora da casca (nova aba, só por clique). Só chaves da lista; nunca javascript:. */
  function hrefExterno(chave) {
    var d = destino(chave);
    return d ? '../sistema.html#' + d.chave : null;
  }

  function validarDia(s) {
    if (typeof s !== 'string') return false;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return false;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1) return false;
    var dt = new Date(Date.UTC(y, mo - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
  }
  function diaBR(s) { return validarDia(s) ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : ''; }

  /* Texto digitado -> texto seguro: string, CRLF vira LF, sem caracteres de controle (menos \n e \t),
   * sem marcas de direção bidi, cortado no limite. Não faz escape de HTML: o texto só vai para
   * textContent/value e para .txt, nunca para innerHTML. */
  function limparTexto(v, max) {
    var s = v == null ? '' : String(v);
    s = s.replace(/\r\n?/g, '\n')
      .replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F‎‏‪-‮⁦-⁩﻿]/g, '');
    return s.length > max ? s.slice(0, max) : s;
  }

  function rascunhoNovo() {
    var r = { proximoId: 1, participantes: [], temas: [], ata: '' };
    TEMAS_INICIAIS.forEach(function (t) { adicionarTema(r, t); });
    return r;
  }

  function adicionarTema(r, texto) {
    if (r.temas.length >= LIMITES.temas) return null;
    var t = { id: r.proximoId++, tema: limparTexto(texto, LIMITES.tema), decisao: '', responsavel: '', prazo: '' };
    r.temas.push(t);
    return t;
  }
  function removerTema(r, id) {
    var n = r.temas.length;
    r.temas = r.temas.filter(function (t) { return t.id !== id; });
    return r.temas.length !== n;
  }
  function definirCampoTema(r, id, campo, valor) {
    if (CAMPOS_TEMA.indexOf(campo) < 0) return false;
    var t = r.temas.filter(function (x) { return x.id === id; })[0];
    if (!t) return false;
    if (campo === 'prazo') {
      var p = valor == null ? '' : String(valor);
      if (p !== '' && !validarDia(p)) return false;
      t.prazo = p;
      return true;
    }
    t[campo] = limparTexto(valor, campo === 'decisao' ? LIMITES.decisao : LIMITES.curto);
    return true;
  }
  function adicionarParticipante(r, nome) {
    var n = limparTexto(nome, LIMITES.participante).replace(/\s+/g, ' ').trim();
    if (!n || r.participantes.length >= LIMITES.participantes) return false;
    var baixo = n.toLowerCase();
    if (r.participantes.some(function (p) { return p.toLowerCase() === baixo; })) return false;
    r.participantes.push(n);
    return true;
  }
  function removerParticipante(r, indice) {
    if (!(indice >= 0 && indice < r.participantes.length)) return false;
    r.participantes.splice(indice, 1);
    return true;
  }
  function definirAta(r, texto) { r.ata = limparTexto(texto, LIMITES.ata); }

  /* Há algo que o usuário digitou/mudou e perderia ao fechar a aba? */
  function rascunhoEditado(r) {
    if (!r) return false;
    if (r.participantes.length || r.ata.trim()) return true;
    if (r.temas.length !== TEMAS_INICIAIS.length) return true;
    return r.temas.some(function (t, i) {
      return t.tema !== TEMAS_INICIAIS[i] || t.decisao.trim() || t.responsavel.trim() || t.prazo;
    });
  }

  /* Armazém em memória: chave = perfil (e-mail) + dia + loja. Map sem protótipo herdado de dados.
   * Troca/saída de identidade apaga tudo na hora; mesma identidade preserva. */
  function criarArmazem() {
    var mapa = new Map();
    var identidade = null;
    var lojas = [];

    function chave(dia, loja) { return JSON.stringify([identidade, dia, loja]); }
    function norm(email) {
      var e = email == null ? '' : String(email).trim().toLowerCase();
      return e || null;
    }
    function lojaPermitida(l) {
      if (typeof l !== 'string') return false;
      if (l === '') return lojas.length === 0;   // login sem loja cadastrada: um único contexto neutro
      return lojas.indexOf(l) >= 0;
    }
    function purgar() { mapa.clear(); }

    return {
      /* 'iniciada' | 'mantida' | 'trocada' | 'sem-sessao'. Trocada e sem-sessao já apagam tudo. */
      sincronizarIdentidade: function (email) {
        var n = norm(email);
        if (!n) { purgar(); identidade = null; lojas = []; return 'sem-sessao'; }
        if (identidade === null) { identidade = n; return 'iniciada'; }
        if (identidade === n) return 'mantida';
        purgar(); identidade = n; lojas = [];
        return 'trocada';
      },
      identidade: function () { return identidade; },
      /* allowlist real vinda do núcleo (painel_minhas_lojas). Rascunho de loja que saiu da lista é descartado. */
      definirLojas: function (lista) {
        lojas = Array.isArray(lista) ? lista.filter(function (x) { return typeof x === 'string' && x; }) : [];
        mapa.forEach(function (e, k) { if (!lojaPermitida(e.loja)) mapa.delete(k); });
      },
      lojaPermitida: lojaPermitida,
      obter: function (dia, loja) {
        if (identidade === null) throw new Error('sem sessão');
        if (!validarDia(dia)) throw new Error('dia inválido');
        if (!lojaPermitida(loja)) throw new Error('loja fora da lista');
        var k = chave(dia, loja);
        var e = mapa.get(k);
        if (!e) { e = { dia: dia, loja: loja, rascunho: rascunhoNovo() }; mapa.set(k, e); }
        return e.rascunho;
      },
      /* Limpar: volta à pauta inicial só desta data+loja. */
      reiniciar: function (dia, loja) {
        if (identidade === null || !validarDia(dia) || !lojaPermitida(loja)) return false;
        mapa.set(chave(dia, loja), { dia: dia, loja: loja, rascunho: rascunhoNovo() });
        return true;
      },
      temConteudo: function () {
        var achou = false;
        mapa.forEach(function (e) { if (rascunhoEditado(e.rascunho)) achou = true; });
        return achou;
      },
      resumo: function (dia, loja) {
        var e = identidade === null ? null : mapa.get(chave(dia, loja));
        var r = e && e.rascunho;
        if (!r) return { temas: 0, preenchidos: 0, participantes: 0, ata: 0 };
        return {
          temas: r.temas.length,
          preenchidos: r.temas.filter(function (t) { return t.decisao.trim() || t.responsavel.trim() || t.prazo; }).length,
          participantes: r.participantes.length,
          ata: r.ata.trim().length
        };
      },
      purgar: purgar,
      tamanho: function () { return mapa.size; }
    };
  }

  function recuar(texto) { return String(texto).split('\n').join('\n      '); }

  /* Ata em texto puro. Só o que o usuário digitou + data/loja do contexto. */
  function gerarAta(ctx, r) {
    var L = [];
    L.push('REUNIÃO SEMANAL — CIDADÃO DO MUNDO');
    L.push('Pauta temporária gerada nesta aba; não foi salva no sistema.');
    L.push('');
    L.push('Data: ' + (diaBR(ctx.dia) || '—'));
    if (ctx.lojaRotulo) L.push('Loja: ' + limparTexto(ctx.lojaRotulo, LIMITES.curto));
    L.push('Participantes: ' + (r.participantes.length ? r.participantes.join(', ') : '(nenhum informado)'));
    L.push('');
    L.push('PAUTA');
    r.temas.forEach(function (t, i) {
      L.push((i + 1) + '. ' + (t.tema || '(sem título)'));
      L.push('   Decisão: ' + (t.decisao ? recuar(t.decisao) : '—'));
      L.push('   Responsável: ' + (t.responsavel || '—'));
      L.push('   Prazo: ' + (diaBR(t.prazo) || '—'));
    });
    if (!r.temas.length) L.push('(sem temas)');
    L.push('');
    L.push('ANOTAÇÕES');
    L.push(r.ata.trim() ? r.ata : '—');
    return L.join('\n') + '\n';
  }

  function slug(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }
  /* Nome limpo: reuniao-AAAA-MM-DD[-loja].txt. Null se o dia não for válido. */
  function nomeArquivo(dia, loja) {
    if (!validarDia(dia)) return null;
    var l = slug(loja);
    return 'reuniao-' + dia + (l ? '-' + l : '') + '.txt';
  }

  return {
    TEMAS_INICIAIS: TEMAS_INICIAIS, LIMITES: LIMITES, DESTINOS: DESTINOS, CAMPOS_TEMA: CAMPOS_TEMA,
    destino: destino, hrefExterno: hrefExterno, validarDia: validarDia, diaBR: diaBR, limparTexto: limparTexto,
    rascunhoNovo: rascunhoNovo, adicionarTema: adicionarTema, removerTema: removerTema,
    definirCampoTema: definirCampoTema, adicionarParticipante: adicionarParticipante,
    removerParticipante: removerParticipante, definirAta: definirAta, rascunhoEditado: rascunhoEditado,
    criarArmazem: criarArmazem, gerarAta: gerarAta, nomeArquivo: nomeArquivo
  };
});
