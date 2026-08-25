/* ARTFLEX — painel de fluxo de caixa (contas a pagar)
   Os dados chegam cifrados em dados.js e sao abertos aqui no navegador. */
(function () {
'use strict';

/* ------------------------------------------------------------------ utils */
const $ = s => document.querySelector(s);
const NS = 'http://www.w3.org/2000/svg';
const el = (t, a, txt) => {
  const n = document.createElementNS(NS, t);
  for (const k in a) n.setAttribute(k, a[k]);
  if (txt != null) n.textContent = txt;
  return n;
};
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const money = v => brl.format(v || 0);
const compact = v => {
  const a = Math.abs(v);
  if (a >= 1e6) return 'R$ ' + (v / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace('.', ',') + ' mi';
  if (a >= 1000) return 'R$ ' + Math.round(v / 1000) + ' mil';
  return money(v);
};
const axisFmt = v => v === 0 ? '0'
  : Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1).replace('.', ',') + ' mi'
  : Math.abs(v) >= 1000 ? Math.round(v / 1000) + ' mil' : String(Math.round(v));

const D = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const iso = dt => dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') +
                  '-' + String(dt.getDate()).padStart(2, '0');
const addD = (s, n) => { const d = D(s); d.setDate(d.getDate() + n); return iso(d); };
const SEM = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const SEM3 = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const MES3 = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const ddmm = s => { const d = D(s); return String(d.getDate()).padStart(2, '0') + '/' + MES3[d.getMonth()]; };
const dtLongo = s => { const d = D(s); return String(d.getDate()).padStart(2, '0') + '/' +
  String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear(); };
/* CPF/CNPJ so aparece formatado na tela; o dado cru continua sendo o numero. */
const fmtDoc = d => {
  const x = String(d || '').replace(/\D/g, '');
  if (x.length === 14) return x.slice(0, 2) + '.' + x.slice(2, 5) + '.' + x.slice(5, 8) +
    '/' + x.slice(8, 12) + '-' + x.slice(12);
  if (x.length === 11) return x.slice(0, 3) + '.' + x.slice(3, 6) + '.' + x.slice(6, 9) +
    '-' + x.slice(9);
  return x;
};
const diasDe = s => Math.round((D(HOJE) - D(s)) / 864e5);
const pcts = (a, b) => b ? (a / b * 100).toFixed(1).replace('.', ',') + '%' : '—';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let _cv;
const largura = (txt, font) => {
  _cv = _cv || document.createElement('canvas');
  const c = _cv.getContext('2d');
  c.font = font || '11px system-ui, -apple-system, "Segoe UI", sans-serif';
  return c.measureText(String(txt)).width;
};

/* Corta o texto com reticências para caber em maxW — nunca deixa o rótulo
   vazar do desenho (o nome completo continua no tooltip e na tabela). */
function corta(txt, maxW, font) {
  let s = String(txt);
  if (largura(s, font) <= maxW) return s;
  while (s.length > 1 && largura(s + '…', font) > maxW) s = s.slice(0, -1);
  return s + '…';
}

function ticks(max, alvo) {
  if (max <= 0) return { passo: 1, topo: 1, lista: [0, 1] };
  const bruto = max / (alvo || 4);
  const mag = Math.pow(10, Math.floor(Math.log10(bruto)));
  const passo = [1, 2, 2.5, 5, 10].map(m => m * mag).find(p => p >= bruto) || 10 * mag;
  const topo = Math.ceil(max / passo) * passo;
  const lista = [];
  for (let v = 0; v <= topo + 1e-6; v += passo) lista.push(v);
  return { passo, topo, lista };
}

/* ---------------------------------------------------------------- tooltip */
const tip = $('#tip');
function mostraTip(html, ev) {
  tip.innerHTML = html;
  tip.classList.add('on');
  const r = tip.getBoundingClientRect();
  let x = ev.clientX + 14, y = ev.clientY + 14;
  if (x + r.width > innerWidth - 10) x = ev.clientX - r.width - 14;
  if (y + r.height > innerHeight - 10) y = ev.clientY - r.height - 14;
  tip.style.left = Math.max(8, x) + 'px';
  tip.style.top = Math.max(8, y) + 'px';
}
const escondeTip = () => tip.classList.remove('on');
addEventListener('scroll', escondeTip, true);

/* ----------------------------------------------------------------- estado */
const CORES = ['--s1', '--s2', '--s3', '--s4', '--s5', '--s6', '--s7', '--s8'];
const ORDEM_BLOCO = ['Indústria', 'Varejo', 'Sócio', 'Não classificado'];
let DADOS = null, PAG = [], REC = [], PARC = [], EMPRESAS = [], BLOCOS = [], CATS = [], COR = {};
let HOJE = iso(new Date()), MIN = '', MAX = '', SALDOS = [];
const F = { de: '', ate: '', emp: new Set(), blo: new Set(), cat: new Set(), busca: '' };
let ordem = { k: 'd', dir: 1 };

/* ------------------------------------------------------------- carregamento
   O GitHub Pages serve dados.js com cache de alguns minutos, então quem já
   visitou a página continuaria vendo a versão anterior depois de uma troca de
   senha ou de uma atualização da planilha. Buscamos o arquivo de novo forçando
   revalidação; se o fetch não estiver disponível (abrindo por file://), fica
   valendo o que a tag <script> já carregou. */
let PAYLOAD = null;
async function carregarPayload() {
  if (PAYLOAD) return PAYLOAD;
  try {
    const r = await fetch('dados.js', { cache: 'no-cache' });
    if (r.ok) {
      const m = (await r.text()).match(/=\s*(\{[\s\S]*\})\s*;?\s*$/);
      if (m) return (PAYLOAD = JSON.parse(m[1]));
    }
  } catch (e) { /* file:// ou sem rede: usa o que já está em memória */ }
  return (PAYLOAD = window.__ARTFLEX__);
}

/* ---------------------------------------------------------------- decrypt */
async function abrir(senha) {
  const p = await carregarPayload();
  const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(senha),
    'PBKDF2', false, ['deriveKey']);
  const chave = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: b64(p.salt), iterations: p.it, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const claro = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(p.iv) }, chave, b64(p.ct));
  return JSON.parse(new TextDecoder().decode(claro));
}

/* ------------------------------------------------------------------- boot */
function iniciar(d) {
  DADOS = d;
  if (d.hoje) HOJE = d.hoje;
  PAG = d.pagamentos.slice().sort((a, b) => a.d.localeCompare(b.d) || a.e.localeCompare(b.e));
  REC = (d.recebimentos || []).slice().sort((a, b) => a.d.localeCompare(b.d));
  PARC = (d.parcelas || []).slice();            // parcelas de dívida, fora da planilha
  SALDOS = d.saldos || [];
  MIN = PAG[0].d; MAX = PAG[PAG.length - 1].d;
  BLOCOS = ORDEM_BLOCO.filter(b => PAG.some(p => p.g === b));

  // cor segue a empresa (ordem fixa pelo total geral) e nao muda ao filtrar
  const tot = {};
  PAG.forEach(p => { tot[p.e] = (tot[p.e] || 0) + (p.v || 0); });
  EMPRESAS = Object.keys(tot).sort((a, b) => tot[b] - tot[a]);
  EMPRESAS.forEach((e, i) => { COR[e] = CORES[i % CORES.length]; });
  CATS = [...new Set(PAG.map(p => p.c))]
    .sort((a, b) => PAG.filter(p => p.c === b).reduce((s, p) => s + (p.v || 0), 0) -
                    PAG.filter(p => p.c === a).reduce((s, p) => s + (p.v || 0), 0));

  F.de = MIN; F.ate = MAX;
  EMPRESAS.forEach(e => F.emp.add(e));      // tudo marcado no estado inicial
  BLOCOS.forEach(b => F.blo.add(b));
  CATS.forEach(c => F.cat.add(c));
  $('#de').value = MIN; $('#de').min = MIN; $('#de').max = MAX;
  $('#ate').value = MAX; $('#ate').min = MIN; $('#ate').max = MAX;

  $('#meta').innerHTML = 'Planilha: <b>' + esc(d.origem) + '</b><br>' +
    'Período dos dados: ' + dtLongo(MIN) + ' a ' + dtLongo(MAX) + ' · extraído em ' + esc(d.gerado_em);

  montaPresets(); montaChips(); iniciarReceber(); montaDiag(); montaRodape();

  $('#gate').hidden = true; $('#gate').style.display = 'none';
  $('#app').hidden = false;

  let aba = 'resumo';
  try { aba = localStorage.getItem('artflex-aba') || 'resumo'; } catch (e) {}
  mostraAba(aba);
  render();
  observaLargura();
}

/* --------------------------------------------------------------- filtros */
function montaPresets() {
  const hoje = HOJE < MIN ? MIN : (HOJE > MAX ? MAX : HOJE);
  const fimMes = s => { const d = D(s); return iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)); };
  const iniMes = s => { const d = D(s); return iso(new Date(d.getFullYear(), d.getMonth(), 1)); };
  const proxMes = s => { const d = D(s); return iso(new Date(d.getFullYear(), d.getMonth() + 1, 1)); };
  const P = [
    ['Tudo', MIN, MAX],
    ['Próx. 7 dias', hoje, addD(hoje, 7)],
    ['Próx. 15 dias', hoje, addD(hoje, 15)],
    ['Próx. 30 dias', hoje, addD(hoje, 30)],
    ['Este mês', iniMes(hoje), fimMes(hoje)],
    ['Mês seguinte', proxMes(hoje), fimMes(proxMes(hoje))],
    ['Em atraso', MIN, addD(HOJE, -1)],
  ];
  const box = $('#presets'); box.innerHTML = '';
  P.forEach(([nome, de, ate]) => {
    const b = document.createElement('button');
    b.className = 'chip'; b.textContent = nome; b.type = 'button';
    b.dataset.de = de < MIN ? MIN : de; b.dataset.ate = ate > MAX ? MAX : ate;
    b.setAttribute('aria-pressed', 'false');
    b.onclick = () => { F.de = b.dataset.de; F.ate = b.dataset.ate;
      $('#de').value = F.de; $('#ate').value = F.ate; render(); };
    box.appendChild(b);
  });
}

/* Chips = caixas de seleção: todos marcados no início, clique desmarca,
   duplo-clique isola aquele item. Mesma regra para empresa e natureza. */
function chip(texto, dot, conjunto, valor, universo, aoMudar) {
  const b = document.createElement('button');
  b.className = 'chip fac'; b.type = 'button';
  b.title = 'Clique para mostrar/ocultar · duplo-clique para ver só este';
  b.innerHTML = (dot ? '<i class="dot" style="background:var(' + dot + ')"></i>' : '') + esc(texto);
  b.onclick = ev => {
    if (ev.detail > 1) return;                       // deixa o dblclick decidir
    if (conjunto.has(valor)) conjunto.delete(valor); else conjunto.add(valor);
    (aoMudar || render)();
  };
  b.ondblclick = () => {
    conjunto.clear(); conjunto.add(valor);
    (aoMudar || render)();
  };
  return b;
}

function montaChips() {
  const bb = $('#blocos'); bb.innerHTML = '';
  BLOCOS.forEach(b => bb.appendChild(chip(b, null, F.blo, b, BLOCOS)));
  const be = $('#empresas'); be.innerHTML = '';
  EMPRESAS.forEach(e => be.appendChild(chip(e, COR[e], F.emp, e, EMPRESAS)));
  const bc = $('#categorias'); bc.innerHTML = '';
  CATS.forEach(c => bc.appendChild(chip(c, null, F.cat, c, CATS)));
}

/* Recorte por entidade — vale tanto para pagamentos quanto para recebimentos.
   O fluxo de 13 semanas usa só esta parte: o filtro de datas não se aplica lá,
   porque aquela seção tem horizonte próprio. */
function daEntidade(x) {
  return F.emp.has(x.e) && F.blo.has(x.g);
}

/* Saldo de abertura do fluxo: só das contas das entidades filtradas. Antes isso
   somava o grupo inteiro, então filtrar uma empresa dava um saldo inicial que
   não era dela. Conta de entidade não reconhecida entra só no consolidado. */
function contasDoFiltro() {
  const tudo = F.emp.size === EMPRESAS.length && F.blo.size === BLOCOS.length;
  return SALDOS.filter(c => (tudo || daEntidade(c)) && c.off !== 1);
}

function saldoAbertura() {
  return contasDoFiltro().reduce((s, c) => s + (c.atual || 0), 0);
}

function filtrar() {
  const q = F.busca.trim().toLowerCase();
  return PAG.filter(p =>
    p.d >= F.de && p.d <= F.ate && daEntidade(p) && F.cat.has(p.c) &&
    (!q || p.n.toLowerCase().includes(q) || p.e.toLowerCase().includes(q) || p.c.toLowerCase().includes(q))
  );
}

/* ------------------------------------------------------------- KPIs/alerta */
function kpis(sel) {
  const total = sel.reduce((s, p) => s + (p.v || 0), 0);
  const porDia = {};
  sel.forEach(p => { porDia[p.d] = (porDia[p.d] || 0) + (p.v || 0); });
  const dias = Object.keys(porDia).sort();
  const pico = dias.reduce((a, d) => porDia[d] > (porDia[a] || -1) ? d : a, dias[0]);
  const semValor = sel.filter(p => !p.v).length;
  const saldo = saldoAbertura();

  $('#k-total').textContent = money(total);
  $('#k-total-sub').textContent = dtLongo(F.de) + ' a ' + dtLongo(F.ate) +
    ' · ' + dias.length + (dias.length === 1 ? ' dia com pagamento' : ' dias com pagamento');
  $('#k-saldo').textContent = money(saldo);
  $('#k-saldo').className = 'val ' + (saldo < 0 ? 'neg' : '');
  $('#k-saldo-sub').textContent = 'Soma das contas das entidades filtradas';
  $('#k-pico').textContent = pico ? compact(porDia[pico]) : '—';
  $('#k-pico-sub').textContent = pico ? dtLongo(pico) + ' · ' + SEM[D(pico).getDay()] : 'sem lançamentos';
  $('#k-qtd').textContent = String(sel.length);
  $('#k-qtd-sub').textContent = semValor ? semValor + ' aguardando boleto'
    : 'todos com valor preenchido';

  return { total, porDia, dias, saldo, semValor };
}

function alertas(k, sel, f13) {
  const box = $('#alertas'); box.innerHTML = '';
  const add = (nivel, ic, titulo, texto) => {
    const d = document.createElement('div');
    d.className = 'alerta ' + nivel;
    d.innerHTML = '<div class="ic">' + ic + '</div><div><b>' + titulo + '</b><p>' + texto + '</p></div>';
    box.appendChild(d);
  };

  // Recorte que tem saída e nenhuma entrada não é caixa ruim: é dado faltando.
  // O varejo recebe cartão em D+1 com antecipação automática, então não existe
  // recebível futuro para importar — a entrada dele tem que ser projetada da
  // série de vendas, e enquanto isso não existe o painel mostra só o lado de lá.
  const semEntrada = f13 && f13.sem &&
    f13.sem.reduce((s, x) => s + x.sai, 0) > 0 &&
    f13.sem.reduce((s, x) => s + x.ent, 0) === 0;

  if (REC.length === 0) {
    add('serious', '!', 'Falta o lado das entradas',
      'O fluxo de 13 semanas está rodando só com saídas porque nenhuma carteira de cobrança ' +
      'foi carregada. Exporte a posição de títulos dos bancos e solte os arquivos na pasta ' +
      '<code>recebiveis/</code>. <b>Enquanto isso, trate o saldo projetado como "quanto falta ' +
      'entrar", não como previsão de caixa.</b>');
  } else if (semEntrada) {
    add('serious', '!', 'Este recorte não tem entrada nenhuma — e isso não significa que não entra dinheiro',
      'As empresas filtradas têm pagamentos mas nenhum recebimento carregado. <b>O varejo ' +
      'recebe cartão em D+1, com antecipação automática</b>: não existe recebível futuro para ' +
      'importar de lugar nenhum, então a entrada das lojas ainda não está no painel. ' +
      'Ela precisa ser projetada da série histórica de vendas do ERP. ' +
      '<b>Não leia este saldo como o caixa real dessas empresas.</b>');
  } else if (f13 && f13.neg) {
    add('critical', '!', 'Caixa fura na semana de ' + dtLongo(f13.neg.ini),
      'Com o que está carregado, o saldo projetado chega a <b class="neg">' + money(f13.neg.saldo) +
      '</b> na semana de ' + ddmm(f13.neg.ini) + ' a ' + ddmm(f13.neg.fim) +
      '. É a semana para antecipar recebível ou renegociar prazo — com antecedência, não na véspera.');
  }
  const cob = k.saldo / (k.total || 1);
  if (k.total > 0 && k.saldo < k.total) {
    add(k.saldo <= 0 ? 'critical' : 'serious', '!', 'Caixa não cobre o período selecionado',
      'Saldo em conta de <b>' + money(k.saldo) + '</b> contra <b>' + money(k.total) +
      '</b> a pagar — faltam <b>' + money(k.total - k.saldo) + '</b>. ' +
      'A cobertura atual é de ' + (cob * 100).toFixed(1).replace('.', ',') +
      '% do compromisso. A aba SEMANAL não tem nenhum recebimento lançado, então essa diferença ' +
      'precisa vir de faturamento e de desconto de boletos que hoje não estão no arquivo.');
  }
  const neg = (DADOS.saldos || []).filter(c => (c.atual || 0) < 0);
  if (neg.length) {
    add('critical', '!', neg.length + (neg.length === 1 ? ' conta no negativo' : ' contas no negativo'),
      neg.map(c => '<b>' + esc(c.conta) + '</b> ' + money(c.atual)).join(' · ') +
      ' — uso de limite/cheque especial, que é a linha de crédito mais cara disponível.');
  }
  if (k.semValor) {
    add('warning', '?', k.semValor + (k.semValor === 1 ? ' boleto ainda não chegou' : ' boletos ainda não chegaram'),
      'Compromissos com data e empresa definidas, à espera do boleto: <b>' +
      esc(sel.filter(p => !p.v).map(p => p.n).join(', ')) +
      '</b>. Ficam listados sem valor de propósito, como lembrete — e por isso o total acima ' +
      'está abaixo do desembolso real do período.');
  }
}

/* ------------------------------------------------------- fluxo 13 semanas
   Horizonte fixo de tesouraria: 13 semanas a partir da semana corrente.
   Não obedece ao filtro de datas (tem horizonte próprio), mas obedece ao
   recorte por empresa e bloco. Contas vencidas antes da semana 1 entram nela:
   atraso não some do caixa, só muda de lugar. */
function fluxo13() {
  const segunda = s => { const x = D(s); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return iso(x); };
  const ini = segunda(HOJE);
  const sem = [];
  for (let i = 0; i < 13; i++) {
    const a = addD(ini, i * 7);
    sem.push({ ini: a, fim: addD(a, 6), ent: 0, sai: 0, atraso: 0, divida: 0, nEnt: 0, nSai: 0 });
  }
  const fim = sem[12].fim;
  const idx = s => Math.floor(Math.round((D(s) - D(ini)) / 864e5) / 7);

  PAG.filter(daEntidade).forEach(p => {
    if (!p.v) return;
    if (p.d < ini) { sem[0].sai += p.v; sem[0].atraso += p.v; sem[0].nSai++; return; }
    if (p.d > fim) return;
    const i = idx(p.d); sem[i].sai += p.v; sem[i].nSai++;
  });
  // Parcelas de empréstimo: não vêm da planilha, mas saem do mesmo caixa.
  PARC.filter(daEntidade).forEach(p => {
    if (p.d < ini || p.d > fim) return;
    const i = idx(p.d);
    sem[i].sai += p.v; sem[i].divida += p.v; sem[i].nSai++;
  });
  REC.filter(daEntidade).forEach(r => {
    if (!r.v) return;
    if (r.d < ini) { sem[0].ent += r.v; sem[0].nEnt++; return; }
    if (r.d > fim) return;
    const i = idx(r.d); sem[i].ent += r.v; sem[i].nEnt++;
  });

  let saldo = saldoAbertura();
  sem.forEach(s => { s.abre = saldo; s.fluxo = s.ent - s.sai; saldo += s.fluxo; s.saldo = saldo; });
  return sem;
}

function faixa(min, max, alvo) {
  const span = Math.max(max - min, 1);
  const bruto = span / (alvo || 4);
  const mag = Math.pow(10, Math.floor(Math.log10(bruto)));
  const passo = [1, 2, 2.5, 5, 10].map(m => m * mag).find(p => p >= bruto) || 10 * mag;
  const lo = Math.floor(min / passo) * passo, hi = Math.ceil(max / passo) * passo;
  const lista = [];
  for (let v = lo; v <= hi + 1e-6; v += passo) lista.push(v);
  return { lo, hi, lista };
}

function chart13(sem) {
  const host = $('#ch13'); host.innerHTML = '';
  const saldos = sem.map(s => s.saldo);
  const s0 = saldoAbertura();
  const T = faixa(Math.min(0, ...saldos, s0), Math.max(0, ...saldos, s0), 4);
  const padL = 78, padR = 24, padT = 22, padB = 42, plotH = 200;
  const larg = Math.max(host.clientWidth || 640, 13 * 44 + padL + padR);
  const plotW = larg - padL - padR, H = plotH + padT + padB;
  const x = i => padL + (i + 0.5) * (plotW / 13);
  const y = v => padT + plotH - ((v - T.lo) / (T.hi - T.lo)) * plotH;

  const svg = el('svg', { width: larg, height: H, role: 'img',
    'aria-label': 'Saldo de caixa projetado para as próximas 13 semanas' });

  if (T.lo < 0) svg.appendChild(el('rect', { x: padL, y: y(0), width: plotW,
    height: Math.max(0, y(T.lo) - y(0)), style: 'fill:var(--critical);opacity:.07' }));

  T.lista.forEach(v => {
    svg.appendChild(el('line', { x1: padL, x2: padL + plotW, y1: y(v), y2: y(v),
      style: 'stroke:var(--grid);stroke-width:1' }));
    svg.appendChild(el('text', { x: padL - 10, y: y(v) + 4, 'text-anchor': 'end',
      style: 'fill:var(--ink-muted);font-size:11px;font-variant-numeric:tabular-nums' }, axisFmt(v)));
  });
  svg.appendChild(el('line', { x1: padL, x2: padL + plotW, y1: y(0), y2: y(0),
    style: 'stroke:var(--axis);stroke-width:1.5' }));

  const linha = sem.map((s, i) => (i ? 'L' : 'M') + x(i) + ',' + y(s.saldo)).join(' ');
  svg.appendChild(el('path', { d: linha + ' L' + x(12) + ',' + y(0) + ' L' + x(0) + ',' + y(0) + ' Z',
    style: 'fill:var(--s1);opacity:.10' }));
  svg.appendChild(el('path', { d: linha,
    style: 'fill:none;stroke:var(--s1);stroke-width:2;stroke-linejoin:round;stroke-linecap:round' }));

  const primeiraNeg = sem.findIndex(s => s.saldo < 0);
  sem.forEach((s, i) => {
    const critico = i === primeiraNeg;
    svg.appendChild(el('circle', { cx: x(i), cy: y(s.saldo), r: critico ? 5.5 : 4,
      style: 'fill:var(' + (critico ? '--critical' : '--s1') + ');stroke:var(--surface);stroke-width:2' }));
    if (i % 2 === 0 || critico) svg.appendChild(el('text', { x: x(i), y: padT + plotH + 18,
      'text-anchor': 'middle', style: 'fill:var(--ink-muted);font-size:11px' }, ddmm(s.ini)));

    const hit = el('rect', { x: padL + i * (plotW / 13), y: padT, width: plotW / 13, height: plotH,
      fill: 'transparent' });
    hit.addEventListener('mousemove', ev => mostraTip(
      '<div class="tt">' + ddmm(s.ini) + ' a ' + ddmm(s.fim) + '</div>' +
      '<div class="tr"><span>Abre com</span><b>' + money(s.abre) + '</b></div>' +
      '<div class="tr"><span>Entradas</span><b>' + money(s.ent) + '</b></div>' +
      '<div class="tr"><span>Saídas</span><b>' + money(s.sai) + '</b></div>' +
      (s.divida ? '<div class="tr"><span>· parcelas de dívida</span><b>' + money(s.divida) + '</b></div>' : '') +
      (s.atraso ? '<div class="tr"><span>· incluindo atraso</span><b>' + money(s.atraso) + '</b></div>' : '') +
      '<div class="tf"><span>Saldo final</span><span>' + money(s.saldo) + '</span></div>', ev));
    hit.addEventListener('mouseleave', escondeTip);
    svg.appendChild(hit);
  });

  if (primeiraNeg >= 0) {
    const s = sem[primeiraNeg];
    const t = 'caixa fura aqui';
    const anc = primeiraNeg > 8 ? 'end' : 'start';
    svg.appendChild(el('text', { x: x(primeiraNeg) + (anc === 'end' ? -9 : 9), y: y(s.saldo) - 11,
      'text-anchor': anc, style: 'fill:var(--critical);font-size:11px;font-weight:600' }, t));
  }
  host.appendChild(svg);
}

let ULT13 = null;

function render13() {
  const sem = fluxo13();
  const temRec = REC.filter(daEntidade).length > 0;
  const totalSai = sem.reduce((s, x) => s + x.sai, 0);
  const totalEnt = sem.reduce((s, x) => s + x.ent, 0);
  const neg = sem.find(s => s.saldo < 0);
  const comMov = sem.filter(s => s.sai > 0 || s.ent > 0).length;

  $('#desc13').innerHTML =
    'Horizonte de tesouraria a partir da semana de ' + dtLongo(sem[0].ini) +
    '. Não segue o filtro de datas acima — segue o de empresa e bloco.' +
    (temRec ? '' : ' <b style="color:var(--critical)">Nenhum recebimento carregado:' +
      ' a linha de entradas está zerada, então o saldo abaixo é "quanto falta", não previsão.</b>');

  const nc = contasDoFiltro().length;
  const totalDiv = sem.reduce((s, x) => s + x.divida, 0);
  $('#cd13').innerHTML = 'Abre com ' + money(saldoAbertura()) + ' em ' +
    nc + (nc === 1 ? ' conta · ' : ' contas · ') +
    money(totalEnt) + ' a entrar · ' + money(totalSai) + ' a sair' +
    (totalDiv ? ', <b>dos quais ' + money(totalDiv) + ' são parcelas de dívida</b>' : '') +
    ' · ' + comMov + ' das 13 semanas têm lançamento' +
    (comMov < 13 ? ' — o calendário da planilha não alcança o fim do horizonte.' : '.');

  $('#tb13').innerHTML = sem.map((s, i) => {
    const marca = i === 0 ? '<span class="marca hoje">semana atual</span>' : '';
    const atraso = s.atraso ? '<span class="marca">inclui ' + money(s.atraso) + ' em atraso</span>' : '';
    return '<tr class="' + (s.saldo < 0 ? 'fura' : '') + (s.sai === 0 && s.ent === 0 ? ' passada' : '') + '">' +
      '<td class="sem">' + ddmm(s.ini) + ' a ' + ddmm(s.fim) + marca + atraso + '</td>' +
      '<td class="n">' + (s.ent ? money(s.ent) : '—') + '</td>' +
      '<td class="n">' + (s.sai ? money(s.sai) : '—') + '</td>' +
      '<td class="n' + (s.fluxo < 0 ? ' neg' : '') + '">' + money(s.fluxo) + '</td>' +
      '<td class="n saldo' + (s.saldo < 0 ? ' neg' : '') + '">' + money(s.saldo) + '</td></tr>';
  }).join('');

  // O desenho fica com desenhaAba(): SVG montado dentro de painel escondido
  // sai com largura 0. Guarda o calculo para nao refazer na troca de aba.
  ULT13 = sem;
  return { sem, neg, temRec };
}

/* --------------------------------------------------- gráfico: por data */
function chartDia(sel) {
  const host = $('#ch-dia'); host.innerHTML = '';
  const emps = EMPRESAS.filter(e => sel.some(p => p.e === e));
  const dias = [];
  for (let d = F.de; d <= F.ate; d = addD(d, 1)) dias.push(d);
  if (!dias.length || !sel.length) { host.innerHTML = '<div class="vazio">Sem pagamentos no período.</div>'; $('#lg-dia').innerHTML = ''; return; }

  const agrup = dias.length > 70;               // muitos dias -> agrega por semana
  const chaves = [], mapa = {};
  const chaveDe = s => { if (!agrup) return s; const d = D(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d); };
  dias.forEach(s => { const c = chaveDe(s); if (!mapa[c]) { mapa[c] = {}; chaves.push(c); } });
  sel.forEach(p => { const c = chaveDe(p.d); mapa[c][p.e] = (mapa[c][p.e] || 0) + (p.v || 0); });
  const totalDe = c => emps.reduce((s, e) => s + (mapa[c][e] || 0), 0);

  const maxV = Math.max(...chaves.map(totalDe), 1);
  const T = ticks(maxV, 4);
  const padL = 66, padR = 16, padT = 26, padB = 46, plotH = 250;
  const larg = Math.max(host.clientWidth || 640, chaves.length * 15 + padL + padR);
  const plotW = larg - padL - padR;
  const H = plotH + padT + padB;
  const banda = plotW / chaves.length;
  const barW = Math.min(24, Math.max(3, banda * 0.62));
  const y = v => padT + plotH - (v / T.topo) * plotH;

  const svg = el('svg', { width: larg, height: H, role: 'img',
    'aria-label': 'Pagamentos por data no período selecionado' });

  T.lista.forEach(v => {
    svg.appendChild(el('line', { x1: padL, x2: padL + plotW, y1: y(v), y2: y(v),
      style: 'stroke:var(--grid);stroke-width:1' }));
    svg.appendChild(el('text', { x: padL - 10, y: y(v) + 4, 'text-anchor': 'end',
      style: 'fill:var(--ink-muted);font-size:11px;font-variant-numeric:tabular-nums' }, axisFmt(v)));
  });
  svg.appendChild(el('line', { x1: padL, x2: padL + plotW, y1: y(0), y2: y(0),
    style: 'stroke:var(--axis);stroke-width:1' }));

  const pico = chaves.reduce((a, c) => totalDe(c) > totalDe(a) ? c : a, chaves[0]);
  const passoLab = Math.max(1, Math.ceil((chaves.length * 36) / plotW));

  chaves.forEach((c, i) => {
    const cx = padL + banda * i + banda / 2;
    const tv = totalDe(c);
    let base = y(0);
    const pilha = emps.map(e => [e, mapa[c][e] || 0]).filter(x => x[1] > 0);
    pilha.forEach(([e, v], j) => {
      const alt = (v / T.topo) * plotH;
      const gap = j < pilha.length - 1 ? 2 : 0;           // 2px de superfície entre fatias
      const h = Math.max(1, alt - gap);
      const topo = base - alt;
      const ultimo = j === pilha.length - 1;
      const r = ultimo ? Math.min(4, barW / 2, h) : 0;
      const x = cx - barW / 2;
      const path = r > 0
        ? 'M' + x + ',' + (topo + h) + ' L' + x + ',' + (topo + r) + ' Q' + x + ',' + topo + ' ' + (x + r) + ',' + topo +
          ' L' + (x + barW - r) + ',' + topo + ' Q' + (x + barW) + ',' + topo + ' ' + (x + barW) + ',' + (topo + r) +
          ' L' + (x + barW) + ',' + (topo + h) + ' Z'
        : 'M' + x + ',' + topo + ' h' + barW + ' v' + h + ' h' + (-barW) + ' Z';
      svg.appendChild(el('path', { d: path, style: 'fill:var(' + COR[e] + ')' }));
      base -= alt;
    });

    if (c === pico && tv > 0) {                            // rótulo direto só no pico
      const t = compact(tv);
      if (largura(t, '600 11px system-ui') < banda * 2.6) {
        svg.appendChild(el('text', { x: cx, y: y(tv) - 8, 'text-anchor': 'middle',
          style: 'fill:var(--ink);font-size:11px;font-weight:600' }, t));
      }
    }
    if (i % passoLab === 0) {
      const d0 = D(c);
      svg.appendChild(el('text', { x: cx, y: padT + plotH + 17, 'text-anchor': 'middle',
        style: 'fill:var(--ink-muted);font-size:11px' }, ddmm(c)));
      if (!agrup) svg.appendChild(el('text', { x: cx, y: padT + plotH + 31, 'text-anchor': 'middle',
        style: 'fill:var(--ink-muted);font-size:10px;opacity:.8' }, SEM3[d0.getDay()]));
    }

    const hit = el('rect', { x: padL + banda * i, y: padT, width: banda, height: plotH,
      fill: 'transparent', style: 'cursor:default' });
    hit.addEventListener('mousemove', ev => {
      const linhas = emps.map(e => [e, mapa[c][e] || 0]).filter(x => x[1] > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([e, v]) => '<div class="tr"><span><i class="dot" style="display:inline-block;background:var(' +
          COR[e] + ');margin-right:6px"></i>' + esc(e) + '</span><b>' + money(v) + '</b></div>').join('');
      const tit = agrup ? 'Semana de ' + dtLongo(c) : SEM[D(c).getDay()] + ', ' + dtLongo(c);
      mostraTip('<div class="tt">' + tit + '</div>' + (linhas || '<div class="tr">sem pagamentos</div>') +
        (tv > 0 ? '<div class="tf"><span>Total</span><span>' + money(tv) + '</span></div>' : ''), ev);
    });
    hit.addEventListener('mouseleave', escondeTip);
    svg.appendChild(hit);
  });

  host.appendChild(svg);
  $('#cd-dia').textContent = agrup
    ? 'Agregado por semana (período com mais de 70 dias). Total do período: ' + money(sel.reduce((s, p) => s + (p.v || 0), 0))
    : 'Um dia por coluna, incluindo dias sem pagamento. Total do período: ' + money(sel.reduce((s, p) => s + (p.v || 0), 0));
  $('#lg-dia').innerHTML = emps.map(e =>
    '<span><i class="dot" style="background:var(' + COR[e] + ')"></i>' + esc(e) + '</span>').join('');
}

/* --------------------------------------------------- gráfico: acumulado */
function chartAcum(sel) {
  const host = $('#ch-acum'); host.innerHTML = '';
  if (!sel.length) { host.innerHTML = '<div class="vazio">Sem pagamentos no período.</div>'; return; }
  const porDia = {};
  sel.forEach(p => { porDia[p.d] = (porDia[p.d] || 0) + (p.v || 0); });
  const pts = []; let acc = 0;
  for (let d = F.de; d <= F.ate; d = addD(d, 1)) { acc += porDia[d] || 0; pts.push({ d, v: acc }); }

  const T = ticks(acc, 4);
  const padL = 66, padR = 22, padT = 20, padB = 34, plotH = 170;
  const larg = Math.max(host.clientWidth || 640, 260);
  const plotW = larg - padL - padR, H = plotH + padT + padB;
  const x = i => padL + (pts.length === 1 ? plotW / 2 : (i / (pts.length - 1)) * plotW);
  const y = v => padT + plotH - (v / (T.topo || 1)) * plotH;

  const svg = el('svg', { width: larg, height: H, role: 'img',
    'aria-label': 'Desembolso acumulado no período' });
  T.lista.forEach(v => {
    svg.appendChild(el('line', { x1: padL, x2: padL + plotW, y1: y(v), y2: y(v),
      style: 'stroke:var(--grid);stroke-width:1' }));
    svg.appendChild(el('text', { x: padL - 10, y: y(v) + 4, 'text-anchor': 'end',
      style: 'fill:var(--ink-muted);font-size:11px;font-variant-numeric:tabular-nums' }, axisFmt(v)));
  });

  const dLine = pts.map((p, i) => (i ? 'L' : 'M') + x(i) + ',' + y(p.v)).join(' ');
  svg.appendChild(el('path', { d: dLine + ' L' + x(pts.length - 1) + ',' + y(0) + ' L' + x(0) + ',' + y(0) + ' Z',
    style: 'fill:var(--s1);opacity:.1' }));
  svg.appendChild(el('path', { d: dLine, style: 'fill:none;stroke:var(--s1);stroke-width:2;stroke-linejoin:round;stroke-linecap:round' }));

  const cross = el('line', { y1: padT, y2: padT + plotH, style: 'stroke:var(--axis);stroke-width:1;visibility:hidden' });
  svg.appendChild(cross);
  const marc = el('circle', { r: 5, style: 'fill:var(--s1);stroke:var(--surface);stroke-width:2;visibility:hidden' });

  const fim = pts[pts.length - 1];
  svg.appendChild(el('circle', { cx: x(pts.length - 1), cy: y(fim.v), r: 5,
    style: 'fill:var(--s1);stroke:var(--surface);stroke-width:2' }));
  const rot = compact(fim.v);
  svg.appendChild(el('text', { x: Math.min(x(pts.length - 1), padL + plotW) , y: y(fim.v) - 12, 'text-anchor': 'end',
    style: 'fill:var(--ink);font-size:11px;font-weight:600' }, rot));

  [0, pts.length - 1].forEach(i => svg.appendChild(el('text', { x: x(i), y: padT + plotH + 18,
    'text-anchor': i === 0 ? 'start' : 'end', style: 'fill:var(--ink-muted);font-size:11px' }, ddmm(pts[i].d))));

  svg.appendChild(marc);
  const capt = el('rect', { x: padL, y: padT, width: plotW, height: plotH, fill: 'transparent' });
  capt.addEventListener('mousemove', ev => {
    const bb = svg.getBoundingClientRect();
    const rel = (ev.clientX - bb.left - padL) / plotW;
    const i = Math.max(0, Math.min(pts.length - 1, Math.round(rel * (pts.length - 1))));
    const p = pts[i];
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i));
    cross.style.visibility = 'visible';
    marc.setAttribute('cx', x(i)); marc.setAttribute('cy', y(p.v)); marc.style.visibility = 'visible';
    const doDia = porDia[p.d] || 0;
    mostraTip('<div class="tt">' + SEM[D(p.d).getDay()] + ', ' + dtLongo(p.d) + '</div>' +
      '<div class="tr"><span>Pago no dia</span><b>' + money(doDia) + '</b></div>' +
      '<div class="tf"><span>Acumulado</span><span>' + money(p.v) + '</span></div>', ev);
  });
  capt.addEventListener('mouseleave', () => {
    escondeTip(); cross.style.visibility = 'hidden'; marc.style.visibility = 'hidden';
  });
  svg.appendChild(capt);
  host.appendChild(svg);
}

/* ------------------------------------------------- gráfico: barras (h) */
function barras(hostSel, itens, corFn, subtitulo) {
  const host = $(hostSel); host.innerHTML = '';
  if (!itens.length) { host.innerHTML = '<div class="vazio">Sem dados no período.</div>'; return; }
  const max = Math.max(...itens.map(i => i.v), 1);
  const linha = 30, padT = 4, padB = 6;
  const fonteLab = '13px system-ui, -apple-system, "Segoe UI", sans-serif';
  const larg = Math.max(host.clientWidth || 460, 250);
  const fim = larg < 400 ? 76 : 96;                   // espaço do valor na ponta
  // o rótulo nunca passa de 42% da largura: em tela estreita o texto cede, não a barra
  const gutter = Math.min(larg * 0.42,
    Math.max(70, Math.max(...itens.map(i => largura(i.k, fonteLab))) + 14));
  const plotW = Math.max(40, larg - gutter - fim);
  const H = itens.length * linha + padT + padB;

  const svg = el('svg', { width: larg, height: H, role: 'img', 'aria-label': subtitulo || 'Barras' });
  itens.forEach((it, i) => {
    const cy = padT + i * linha + linha / 2;
    const w = Math.max(2, (it.v / max) * plotW);
    const h = 16, ty = cy - h / 2, r = Math.min(4, w);
    svg.appendChild(el('text', { x: gutter - 12, y: cy + 4, 'text-anchor': 'end',
      style: 'fill:var(--ink-2);font-size:13px' }, corta(it.k, gutter - 14, fonteLab)));
    const path = 'M' + gutter + ',' + ty + ' L' + (gutter + w - r) + ',' + ty +
      ' Q' + (gutter + w) + ',' + ty + ' ' + (gutter + w) + ',' + (ty + r) +
      ' L' + (gutter + w) + ',' + (ty + h - r) +
      ' Q' + (gutter + w) + ',' + (ty + h) + ' ' + (gutter + w - r) + ',' + (ty + h) +
      ' L' + gutter + ',' + (ty + h) + ' Z';
    svg.appendChild(el('path', { d: path, style: 'fill:var(' + corFn(it) + ')' }));
    svg.appendChild(el('text', { x: gutter + w + 10, y: cy + 4,
      style: 'fill:var(--ink);font-size:12px;font-weight:500;font-variant-numeric:tabular-nums' }, compact(it.v)));

    const hit = el('rect', { x: 0, y: padT + i * linha, width: larg, height: linha, fill: 'transparent' });
    hit.addEventListener('mousemove', ev => mostraTip(
      '<div class="tt">' + esc(it.k) + '</div>' +
      '<div class="tr"><span>Valor</span><b>' + money(it.v) + '</b></div>' +
      '<div class="tr"><span>Participação</span><b>' + it.pct + '</b></div>' +
      '<div class="tr"><span>Lançamentos</span><b>' + it.n + '</b></div>', ev));
    hit.addEventListener('mouseleave', escondeTip);
    svg.appendChild(hit);
  });
  host.appendChild(svg);
}

/* ---------------------------------------------------------------- agenda */
function agenda(sel) {
  const host = $('#agenda'); host.innerHTML = '';
  const porDia = {};
  sel.forEach(p => { (porDia[p.d] = porDia[p.d] || []).push(p); });
  const dias = Object.keys(porDia).sort();
  if (!dias.length) { host.innerHTML = '<div class="card vazio">Nenhum pagamento nos filtros escolhidos.</div>'; return; }

  const totalGeral = sel.reduce((s, p) => s + (p.v || 0), 0);
  const atrasados = dias.filter(d => d < HOJE).reduce((s, d) => s + porDia[d].reduce((a, p) => a + (p.v || 0), 0), 0);
  $('#desc-agenda').innerHTML = dias.length + (dias.length === 1 ? ' data' : ' datas') +
    ' com pagamento · ' + money(totalGeral) + ' no total' +
    (atrasados > 0 ? ' · <b style="color:var(--critical)">' + money(atrasados) + ' com data já vencida</b>' : '');

  const abrirTudo = dias.length <= 12;
  dias.forEach(d => {
    const itens = porDia[d];
    const tot = itens.reduce((s, p) => s + (p.v || 0), 0);
    const det = document.createElement('details');
    det.className = 'dia'; det.open = abrirTudo;

    const badge = d < HOJE ? '<span class="dbadge vencido">vencido</span>'
      : d === HOJE ? '<span class="dbadge hoje">hoje</span>'
      : '<span class="dbadge">em ' + Math.round((D(d) - D(HOJE)) / 864e5) + ' dias</span>';

    const emps = {};
    itens.forEach(p => { (emps[p.e] = emps[p.e] || []).push(p); });
    const ordemEmp = EMPRESAS.filter(e => emps[e]);

    det.innerHTML =
      '<summary><span class="dtag"><span class="dnum">' + dtLongo(d) + '</span>' +
      '<span class="dsem">' + SEM[D(d).getDay()] + '</span>' + badge +
      '<span class="dbadge">' + ordemEmp.length + (ordemEmp.length === 1 ? ' empresa' : ' empresas') + '</span>' +
      '</span><span class="dtot">' + money(tot) + '</span></summary>' +
      '<div class="dbody">' + ordemEmp.map(e => {
        const lst = emps[e].slice().sort((a, b) => (b.v || 0) - (a.v || 0));
        const st = lst.reduce((s, p) => s + (p.v || 0), 0);
        return '<div class="empblk"><div class="emphead">' +
          '<span class="nm"><i class="dot" style="background:var(' + COR[e] + ')"></i>' + esc(e) + '</span>' +
          '<span class="tv">' + money(st) + '</span></div>' +
          lst.map(p => '<div class="item"><span class="l">' + esc(p.n) +
            '<span class="cat">' + esc(p.c) + '</span></span>' +
            '<span class="r' + (p.v ? '' : ' pend') + '">' +
            (p.v ? money(p.v) : 'aguardando boleto') + '</span></div>').join('') +
          '</div>';
      }).join('') + '</div>';
    host.appendChild(det);
  });
}

/* ---------------------------------------------------------------- tabela */
function tabela(sel) {
  const arr = sel.slice().sort((a, b) => {
    const k = ordem.k;
    const va = k === 'v' ? (a.v || 0) : a[k], vb = k === 'v' ? (b.v || 0) : b[k];
    if (va < vb) return -ordem.dir;
    if (va > vb) return ordem.dir;
    return a.d.localeCompare(b.d);
  });
  $('#tb').innerHTML = arr.map(p =>
    '<tr><td>' + dtLongo(p.d) + '</td><td><i class="dot" style="display:inline-block;background:var(' +
    COR[p.e] + ');margin-right:7px"></i>' + esc(p.e) + '</td><td>' + esc(p.n) + '</td><td>' + esc(p.c) +
    '</td><td class="n">' + (p.v ? money(p.v) : '—') + '</td></tr>').join('') ||
    '<tr><td colspan="5" class="vazio">Nenhum lançamento.</td></tr>';
  $('#tfoot-info').innerHTML = arr.length + (arr.length === 1 ? ' linha · ' : ' linhas · ') +
    '<b>' + money(arr.reduce((s, p) => s + (p.v || 0), 0)) + '</b>';
  window.__CSV__ = arr;
}

function csv() {
  const arr = window.__CSV__ || [];
  const linhas = [['Data', 'Empresa', 'Descricao', 'Natureza', 'Valor']]
    .concat(arr.map(p => [dtLongo(p.d), p.e, p.n, p.c,
      p.v == null ? '' : p.v.toFixed(2).replace('.', ',')]));
  const txt = '﻿' + linhas.map(l => l.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([txt], { type: 'text/csv;charset=utf-8' }));
  a.download = 'artflex-pagamentos-' + F.de + '_a_' + F.ate + '.csv';
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* ----------------------------------------------------------- diagnóstico */
function montaDiag() {
  const host = $('#diag');
  const com = PAG.filter(p => p.v);
  const total = com.reduce((s, p) => s + p.v, 0);
  const saldo = (DADOS.saldos || []).reduce((s, c) => s + (c.atual || 0), 0);
  const ant = (DADOS.saldos || []).reduce((s, c) => s + (c.anterior || 0), 0);

  const soma = (fn) => com.filter(fn).reduce((s, p) => s + p.v, 0);
  const pct = v => (v / total * 100).toFixed(1).replace('.', ',') + '%';

  const porEmp = EMPRESAS.map(e => ({ k: e, v: soma(p => p.e === e) })).filter(x => x.v > 0);
  const porCat = CATS.map(c => ({ k: c, v: soma(p => p.c === c) })).filter(x => x.v > 0)
    .sort((a, b) => b.v - a.v);

  // dia da semana com maior concentração
  const dow = [0, 0, 0, 0, 0, 0, 0];
  com.forEach(p => { dow[D(p.d).getDay()] += p.v; });
  const dowMax = dow.indexOf(Math.max(...dow));

  const semanas = {};
  com.forEach(p => { const d = D(p.d); d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    semanas[iso(d)] = (semanas[iso(d)] || 0) + p.v; });
  const semLista = Object.entries(semanas).sort();
  const semMax = semLista.reduce((a, b) => b[1] > a[1] ? b : a, semLista[0]);

  const cards = [];

  cards.push({ nivel: 'critical', tit: 'Caixa não suporta o calendário', txt:
    '<p>As contas somadas na aba SEMANAL fecham em <b>' + money(saldo) + '</b>. ' +
    'O calendário de pagamentos do arquivo soma <b>' + money(total) + '</b> entre ' +
    dtLongo(MIN) + ' e ' + dtLongo(MAX) + '. A diferença é de <b class="neg">' +
    money(total - saldo) + '</b>.</p>' +
    '<p>O saldo consolidado caiu de ' + money(ant) + ' para ' + money(saldo) +
    ' entre a leitura anterior e a atual — uma queda de <b class="neg">' + money(ant - saldo) +
    '</b> sem nenhuma entrada registrada no arquivo. Isso é sintoma, não causa: a planilha só ' +
    'controla o lado de saída, então a operação está sendo financiada por algo que não está ' +
    'sendo medido aqui (faturamento do dia, desconto de duplicatas ou limite bancário).</p>' +
    '<p><b>O que fazer primeiro:</b> lançar as previsões de recebimento na coluna RECEBIMENTOS ' +
    'da aba SEMANAL. Sem isso nenhum saldo projetado é confiável e a decisão de que conta pagar ' +
    'primeiro continua sendo tomada no escuro.</p>' });

  const pend = PAG.filter(p => !p.v);
  if (pend.length) {
    const porData = {};
    pend.forEach(p => { (porData[p.d] = porData[p.d] || []).push(p); });
    cards.push({ nivel: 'warning', tit: 'Aguardando boleto — preencher quando chegar', txt:
      '<p>' + pend.length + (pend.length === 1 ? ' compromisso já tem' : ' compromissos já têm') +
      ' data e empresa definidas, mas o boleto ainda não chegou. Ficam listados no painel com o ' +
      'valor em branco, de propósito, para não serem esquecidos:</p>' +
      '<table class="mini livre">' + Object.keys(porData).sort().map(d =>
        '<tr><td>' + dtLongo(d) + '</td><td>' + esc(porData[d].map(p => p.n).join(', ')) +
        '</td></tr>').join('') + '</table>' +
      '<p style="margin-top:12px">Enquanto estiverem em branco eles <b>não entram em nenhum total</b> ' +
      'deste painel — o desembolso real do período é maior que os ' + money(total) + ' exibidos. ' +
      'Assim que os boletos chegarem, lance o valor na planilha e rode o <code>build.py</code> de novo.</p>' });
  }

  cards.push({ nivel: 'warning', tit: 'Concentração: uma linha carrega tudo', txt:
    '<p><b>' + porCat[0].k + '</b> respondem por <b>' + pct(porCat[0].v) + '</b> de tudo que sai (' +
    money(porCat[0].v) + '). Não há detalhe de qual fornecedor: ' +
    PAG.filter(p => /^FORNECEDOR/i.test(p.n)).length + ' dos ' + PAG.length +
    ' lançamentos estão descritos apenas como "FORNECEDOR".</p>' +
    '<p>Isso impede as duas análises que mais reduzem custo numa operação assim: <b>concentração ' +
    'por fornecedor</b> (quem tem poder de barganha sobre você) e <b>prazo médio de pagamento</b> ' +
    '(se dá para alongar). Recomendo quebrar essa descrição por nome do fornecedor — é a mudança ' +
    'de menor esforço e maior retorno em toda a planilha.</p>' +
    '<table class="mini">' + porCat.slice(0, 6).map(c =>
      '<tr><td>' + esc(c.k) + '</td><td>' + money(c.v) + ' · ' + pct(c.v) + '</td></tr>').join('') + '</table>' });

  cards.push({ nivel: 'warning', tit: 'Concentração por empresa', txt:
    '<p>O calendário distribui pagamentos entre ' + porEmp.length + ' entidades' +
    (porEmp.some(e => e.k === 'Pessoa física') ? ' (uma delas pessoa física)' : '') + ', mas <b>' + porEmp[0].k +
    '</b> concentra <b>' + pct(porEmp[0].v) + '</b> das saídas (' + money(porEmp[0].v) + ').</p>' +
    '<table class="mini">' + porEmp.map(e =>
      '<tr><td><i class="dot" style="display:inline-block;background:var(' + COR[e.k] +
      ');margin-right:8px"></i>' + esc(e.k) + '</td><td>' + money(e.v) + ' · ' + pct(e.v) + '</td></tr>').join('') +
    '</table>' +
    '<p style="margin-top:12px">Compare a coluna acima com os saldos por conta: quando uma ' +
    'empresa do grupo tem caixa parado e outra usa limite bancário, há dinheiro caro sendo ' +
    'pago sem necessidade. Mútuo entre empresas do mesmo grupo resolve — desde que documentado ' +
    'em contrato, com juros de mercado e IOF recolhido, senão a Receita trata como distribuição ' +
    'disfarçada de lucro.</p>' });

  cards.push({ nivel: 'serious', tit: 'O calendário é concentrado — e isso é administrável', txt:
    '<p>O pico é a semana de <b>' + dtLongo(semMax[0]) + '</b>, com <b>' + money(semMax[1]) +
    '</b>. E <b>' + pct(dow[dowMax]) + '</b> de todo o desembolso cai numa <b>' + SEM[dowMax] +
    '-feira</b> (' + money(dow[dowMax]) + ').</p>' +
    '<p>Concentrar vencimentos num único dia da semana obriga o caixa a ter o pico disponível de ' +
    'uma vez, quando o faturamento entra distribuído. <b>Redistribuir vencimentos de fornecedores ' +
    'ao longo da semana não custa nada</b> e reduz a necessidade de limite bancário sem negociar ' +
    'um centavo de prazo a mais.</p>' +
    '<table class="mini">' + semLista.map(([s, v]) =>
      '<tr><td>Semana de ' + dtLongo(s) + '</td><td>' + money(v) + '</td></tr>').join('') + '</table>' });

  const fixos = (DADOS.fixos || []);
  cards.push({ nivel: 'good', tit: 'Obrigações fixas mapeadas', txt:
    '<p>O cabeçalho da planilha já traz o calendário de vencimentos fixos, o que é uma boa prática ' +
    'e deve ser mantido. São os compromissos que não se negociam no mês:</p>' +
    '<table class="mini livre">' + fixos.map(f => {
      const m = String(f).match(/^(.*?)\s{2,}(.*)$/);
      const nome = (m ? m[1] : String(f)).trim();
      const det = (m ? m[2] : '').replace(/\s+/g, ' ').trim();   // espaços da planilha viram um só
      return '<tr><td>' + esc(nome) + '</td><td>' + esc(det) + '</td></tr>';
    }).join('') + '</table>' +
    '<p>Tributos e aluguéis somam <b>' +
    money(soma(p => p.c === 'Tributos') + soma(p => p.c === 'Aluguéis')) + '</b> no período — ' +
    pct(soma(p => p.c === 'Tributos') + soma(p => p.c === 'Aluguéis')) +
    ' do total. É a parcela do calendário que <b>não</b> pode ser adiada sem multa ou juros, e por ' +
    'isso deve ser a primeira a ser reservada, não a última.</p>' });

  const ex = DADOS.excluidos || [];
  if (ex.length) {
    const exTot = ex.reduce((s, p) => s + (p.v || 0), 0);
    cards.push({ nivel: 'serious', tit: 'Lançamentos retirados a pedido', txt:
      '<p>Estes lançamentos <b>existem na planilha</b> mas foram retirados do painel. ' +
      'Nenhum total desta página os inclui:</p>' +
      '<table class="mini">' + ex.map(p =>
        '<tr><td>' + dtLongo(p.d) + ' · ' + esc(p.e) + ' · ' + esc(p.n) + '</td><td class="neg">' +
        money(p.v) + '</td></tr>').join('') +
      '<tr><td><b>Total retirado</b></td><td class="neg"><b>' + money(exTot) + '</b></td></tr></table>' +
      '<p style="margin-top:12px">Somando estes ' + money(exTot) + ' de volta aos ' +
      money(total) + ' exibidos, chega-se aos ' + money(total + exTot) +
      ' que a planilha soma nos subtotais semanais. <b>A planilha não foi alterada</b> — o corte ' +
      'vive só na geração do painel, em <code>build.py</code>, e pode ser desfeito a qualquer momento.</p>' });
  }

  const TIT = DADOS.titulos || [];
  if (TIT.length) {
    const simples = TIT.filter(t => t.carteira === 'simples');
    const desc = TIT.filter(t => t.carteira === 'descontada');
    const soma = a => a.reduce((s, t) => s + t.v, 0);
    const venc = a => a.filter(t => t.d < HOJE);
    const pc = (a, b) => b ? (a / b * 100).toFixed(1).replace('.', ',') + '%' : '—';

    // concentração pela RAIZ do CNPJ: matriz e filial são o mesmo risco
    const porRaiz = {};
    TIT.forEach(t => {
      const k = t.raiz || t.sacado;
      if (!porRaiz[k]) porRaiz[k] = { nome: t.sacado, v: 0, n: 0, cnpjs: new Set() };
      porRaiz[k].v += t.v; porRaiz[k].n++; porRaiz[k].cnpjs.add(t.cnpj);
    });
    const top = Object.values(porRaiz).sort((a, b) => b.v - a.v).slice(0, 6);
    const totalTit = soma(TIT);
    const somaTop = top.reduce((s, c) => s + c.v, 0);

    // por fonte, para enxergar onde está concentrado o risco de recompra
    const fontes = {};
    TIT.forEach(t => {
      const k = t.banco + '|' + t.carteira;
      if (!fontes[k]) fontes[k] = { banco: t.banco, cart: t.carteira, v: 0, n: 0, venc: 0 };
      fontes[k].v += t.v; fontes[k].n++;
      if (t.d < HOJE) fontes[k].venc += t.v;
    });
    const listaFontes = Object.values(fontes).sort((a, b) => b.v - a.v);

    cards.push({ nivel: venc(desc).length ? 'critical' : 'serious',
      tit: 'Carteira de recebíveis — o que é seu e o que já não é', txt:
      '<table class="mini">' +
      '<tr><td><b>Carteira simples</b> — título seu; se o cliente não pagar, você não recebe</td>' +
      '<td>' + money(soma(simples)) + ' · ' + simples.length + '</td></tr>' +
      '<tr><td>· dos quais <b>vencidos</b></td><td class="neg">' + money(soma(venc(simples))) +
      ' · ' + pc(soma(venc(simples)), soma(simples)) + '</td></tr>' +
      '<tr><td><b>Descontada</b> — o dinheiro já entrou; se o cliente não pagar, <b>você devolve</b></td>' +
      '<td>' + money(soma(desc)) + ' · ' + desc.length + '</td></tr>' +
      (venc(desc).length
        ? '<tr><td>· <b>vencidos e não liquidados</b> — recompra a caminho</td><td class="neg">' +
          money(soma(venc(desc))) + ' · ' + venc(desc).length + '</td></tr>' : '') +
      '<tr><td><b>Carteira total</b></td><td><b>' + money(soma(TIT)) + ' · ' + TIT.length +
      '</b></td></tr></table>' +
      '<p style="margin-top:12px"><b>' + pc(soma(desc), soma(TIT)) + ' da carteira já foi ' +
      'antecipada.</b> Antecipação de recebível é a maior fonte de financiamento do grupo — ' +
      'maior que qualquer empréstimo — e não aparece como passivo em lugar nenhum.</p>' +
      '<table class="mini"><tr><td><b>Onde está</b></td><td><b>Saldo · vencido</b></td></tr>' +
      listaFontes.map(f => '<tr><td>' + esc(f.banco) + ' · ' + f.cart + ' <span style="color:var(--ink-muted)">' +
        f.n + ' títulos</span></td><td>' + money(f.v) +
        (f.venc ? ' · <span class="neg">' + money(f.venc) + '</span>' : '') +
        '</td></tr>').join('') + '</table>' +
      '<p style="margin-top:12px"><b>Somar os dois seria contar o mesmo dinheiro duas vezes.</b> ' +
      'A descontada já virou caixa: o que resta dela não é direito a receber, é <b>risco de ' +
      'recompra</b>. Por isso ela fica fora do fluxo de 13 semanas — só a carteira simples ' +
      'entra como entrada futura.</p>' +
      (venc(simples).length
        ? '<p><b>' + pc(soma(venc(simples)), soma(simples)) + ' da carteira simples está vencida</b> (' +
          venc(simples).length + ' de ' + simples.length + ' títulos, ' + money(soma(venc(simples))) +
          '). Não é ruído de calendário — é boa parte da explicação da pressão de caixa e da ' +
          'dependência de antecipação.</p>' : '') +
      '<p style="margin-top:12px"><b>Concentração por cliente</b>, agrupada pela raiz do CNPJ — ' +
      'matriz e filial do mesmo grupo são o mesmo risco:</p>' +
      '<table class="mini">' + top.map(c =>
        '<tr><td>' + esc(c.nome) + (c.cnpjs.size > 1 ? ' <span style="color:var(--ink-muted)">(' +
        c.cnpjs.size + ' CNPJs)</span>' : '') + '</td><td>' + money(c.v) + ' · ' +
        pc(c.v, totalTit) + '</td></tr>').join('') + '</table>' +
      '<p style="margin-top:12px">Os ' + top.length + ' maiores somam <b>' + pc(somaTop, totalTit) +
      '</b> da carteira, e o maior sozinho é <b>' + pc(top[0].v, totalTit) + '</b>. ' +
      '<b>Isso é concentração saudável</b> — nenhum cliente derruba a operação sozinho.</p>' +
      '<p>O que exige atenção é outra coisa: <b>o mesmo cliente aparece em várias fontes ao ' +
      'mesmo tempo</b>. Se ele parar de pagar, você é atingido no banco, na carteira descontada ' +
      'e no FIDC de uma vez — e a recompra vem junto. Por isso a concentração tem que ser lida ' +
      'somando todas as fontes, nunca uma de cada vez.</p>' });
  }

  const DIV = (DADOS.dividas || []).filter(d => d.tipo !== 'antecipacao');
  const ANT = (DADOS.dividas || []).filter(d => d.tipo === 'antecipacao');
  const aa = t => ((Math.pow(1 + t / 100, 12) - 1) * 100).toFixed(1).replace('.', ',');

  if (DIV.length || ANT.length) {
    const todas = (DADOS.dividas || []).slice().sort((a, b) => a.taxa - b.taxa);
    const maisCara = todas[todas.length - 1], maisBarata = todas[0];
    cards.push({ nivel: 'critical', tit: 'Quanto custa cada real que você toma emprestado', txt:
      '<p>Sete fontes de capital de giro, com custos que vão de <b>' + aa(maisBarata.taxa) +
      '%</b> a <b>' + aa(maisCara.taxa) + '% ao ano</b>. Ordenadas da mais barata para a mais cara:</p>' +
      '<table class="mini"><tr><td><b>Fonte</b></td><td><b>Saldo · custo</b></td></tr>' +
      todas.map(d => '<tr><td>' + esc(d.banco) + ' · ' + esc(d.produto.replace(/ - antecipacao.*/i, '')) +
        (d.tipo === 'antecipacao' ? ' <span style="color:var(--ink-muted)">(cedido)</span>' : '') +
        '</td><td>' + money(d.saldo) + ' · <b>' + aa(d.taxa) + '% a.a.</b></td></tr>').join('') +
      '</table>' +
      (ANT.length && maisCara.tipo !== 'antecipacao'
        ? '<p style="margin-top:12px"><b>A antecipação nas FIDCs não é a vilã.</b> As duas saem ' +
          '<b>mais baratas</b> que a ' + esc(maisCara.produto) + ' do ' + esc(maisCara.banco) +
          ', a ' + aa(maisCara.taxa) + '%. O caro aqui é o rotativo do banco — e ele é o único ' +
          'que <b>não amortiza nada</b>: enquanto o saldo ficar de pé, o juro se repete todo mês.</p>'
        : '') +
      (() => {                                    // taxa da capa × taxa efetiva
        const c = ANT.find(d => d.taxa_capa && d.taxa_capa < d.taxa);
        if (!c) return '';
        const dif = ((c.taxa / c.taxa_capa - 1) * 100).toFixed(0);
        return '<p><b>O custo do borderô é maior que o anunciado.</b> O documento da ' +
          esc(c.banco) + ' traz "Custo: ' + c.taxa_capa.toFixed(2).replace('.', ',') +
          '% a.m.", mas isso é só o deságio. Somando custo operacional, TED, consulta de ' +
          'crédito, assinatura digital e despesa bancária, o efetivo é <b>' +
          c.taxa.toFixed(2).replace('.', ',') + '% a.m.</b> — ' + dif + '% acima do que está ' +
          'escrito. Sempre calcule pelo desembolso, nunca pela taxa da capa.</p>';
      })() });

    if (ANT.length) {
      const sa = ANT.reduce((s, d) => s + d.saldo, 0);
      cards.push({ nivel: 'serious', tit: 'Título cedido continua sendo risco seu', txt:
        '<p><b>' + money(sa) + '</b> em duplicatas foram cedidas às duas FIDCs e ainda não ' +
        'venceram. Os contratos são <b>com coobrigação</b>: se o sacado não pagar, o cedente ' +
        'recompra o título. Confira em cada termo se há <b>devedor solidário</b>: quando há, a ' +
        'garantia alcança o patrimônio pessoal do sócio.</p>' +
        (() => {                        // recompra que de fato aconteceu
          const r = ANT.find(d => d.recompra > 0 && d.face && d.liquido);
          if (!r) return '';
          return '<p><b>Não é hipótese.</b> Num dos borderôs há <b>' + money(r.recompra) +
            '</b> de recompra — títulos que voltaram porque o sacado não pagou. Na prática, ' +
            'daquela operação de ' + money(r.face) + ' em títulos entraram em caixa apenas <b>' +
            money(r.liquido) + '</b>, ou ' + (r.liquido / r.face * 100).toFixed(0) + '%. ' +
            'Parte da antecipação nova estava pagando o calote da anterior.</p>';
        })() +
        '<p><b>Consequência para o gerencial:</b> com coobrigação, o título cedido não saiu do ' +
        'balanço — economicamente isso é <b>empréstimo com duplicata em garantia</b>, não venda ' +
        'de recebível. Tratar como venda esconde ' + money(sa) + ' de passivo contingente e ' +
        'melhora artificialmente o endividamento.</p>' });
    }
  }

  if (DIV.length) {
    const sd = DIV.reduce((s, d) => s + d.saldo, 0);
    const jm = DIV.reduce((s, d) => s + d.saldo * d.taxa / 100, 0);
    const ord = DIV.slice().sort((a, b) => b.taxa - a.taxa);
    const cara = ord[0], barata = ord[ord.length - 1];
    const parc6 = PARC.reduce((s, p) => s + p.v, 0);
    const mensal = parc6 / 6;
    cards.push({ nivel: 'critical', tit: 'O custo da dívida não estava no fluxo', txt:
      '<p>Cinco operações, <b>' + money(sd) + '</b> de saldo devedor — e <b>nenhuma parcela ' +
      'aparecia no calendário da planilha</b>. Só de juros são <b class="neg">' + money(jm) +
      ' por mês</b>, ou ' + money(jm * 12) + ' ao ano.</p>' +
      '<table class="mini">' + ord.map(d =>
        '<tr><td>' + esc(d.banco) + ' · ' + esc(d.produto) + ' <span style="color:var(--ink-muted)">' +
        esc(d.e) + '</span></td><td>' + money(d.saldo) + ' · ' +
        d.taxa.toFixed(2).replace('.', ',') + '% a.m.</td></tr>').join('') +
      '<tr><td><b>Total</b></td><td><b>' + money(sd) + '</b></td></tr></table>' +
      '<p style="margin-top:12px"><b>O serviço da dívida é de cerca de ' + money(mensal) +
      ' por mês</b> (média das parcelas dos próximos 6 meses). Isso agora entra no fluxo de ' +
      '13 semanas — antes o painel projetava um desembolso menor que o real por esse valor.</p>' +
      '<p><b>A conta que mais dói:</b> a ' + esc(cara.produto) + ' da ' + esc(cara.e) + ' custa ' +
      cara.taxa.toFixed(2).replace('.', ',') + '% ao mês sobre ' + money(cara.saldo) + ' — são <b>' +
      money(cara.saldo * cara.taxa / 100) + ' por mês só de juros</b>, sem amortizar um real. ' +
      'É rotativo: enquanto o saldo não baixar, esse valor se repete todo mês para sempre. ' +
      'Ao lado dela existe a ' + esc(barata.produto) + ' a ' +
      barata.taxa.toFixed(2).replace('.', ',') + '% a.m. — ' +
      (cara.taxa / Math.max(barata.taxa, 0.01)).toFixed(1).replace('.', ',') +
      ' vezes mais barata. <b>Trocar dívida cara por barata é a economia mais rápida ' +
      'disponível hoje</b>, e não depende de vender mais nada.</p>' });
  }

  cards.push({ nivel: 'warning', tit: 'Limitações desta leitura', txt:
    '<p>Para não gerar leitura errada, o que este painel <b>não</b> pode afirmar:</p>' +
    (ex.length ? '<p>· <b>' + ex.length + (ex.length === 1 ? ' lançamento foi retirado' : ' lançamentos foram retirados') +
      ' a pedido</b> (' + money(ex.reduce((s, p) => s + (p.v || 0), 0)) +
      '). O painel não bate com a planilha por esse valor — detalhe no quadro acima.</p>' : '') +
    '<p>· <b>Só uma aba da planilha é usada.</b> A outra ficou de fora por decisão do ' +
    'operador, porque seus números estão desatualizados. Com isso o painel não tem a posição ' +
    'de contas a receber, que só existia lá.</p>' +
    (REC.length
      ? '<p>· <b>As entradas vêm de <code>recebimentos.csv</code></b>, não da planilha. ' +
        'A qualidade do fluxo de 13 semanas depende de esse arquivo estar atualizado.</p>'
      : '<p>· <b>Não há entrada de caixa carregada.</b> A coluna RECEBIMENTOS da planilha está ' +
        'vazia e ainda não existe <code>recebimentos.csv</code>. Todo saldo aqui é "quanto falta", ' +
        'não "quanto sobra".</p>') +
    (pend.length ? '<p>· <b>' + pend.length + ' compromissos ainda estão sem valor</b> ' +
      '(aguardando boleto). O desembolso real do período é maior que o exibido.</p>' : '') +
    '<p>· <b>Pagamentos feitos fora do sistema bancário não aparecem aqui.</b> O que não passa ' +
    'por extrato nem pela planilha é saída de caixa que o fluxo nunca vê, e todo mês o ' +
    'desembolso projetado fica menor que o efetivo.</p>' +
    '<p>· <b>A classificação por natureza é inferida</b> a partir do texto da descrição, ' +
    'não veio classificada da planilha. Serve para leitura gerencial, não para contabilidade.</p>' +
    '<p>· <b>Empréstimos não aparecem.</b> Não há parcela de PRONAMPE, BNB ou qualquer financiamento ' +
    'no calendário da SEMANAL. Se essas dívidas existem, elas não estão no fluxo — e parcela de ' +
    'empréstimo é a despesa que menos aceita atraso.</p>' });

  // Notas do operador: análise que não pode viver no código, porque o
  // repositório é público. Vêm de notas.json, cifradas dentro do dados.js.
  (DADOS.notas || []).forEach(n => cards.push(
    { nivel: n.nivel || 'warning', tit: n.tit, txt: n.txt }));

  host.innerHTML = cards.map(c =>
    '<div class="card"><h3><span class="pill ' + c.nivel + '">' +
    ({ critical: 'crítico', serious: 'atenção', warning: 'observação', good: 'ok' }[c.nivel]) +
    '</span>' + c.tit + '</h3>' + c.txt + '</div>').join('');
}

function montaRodape() {
  const ex = DADOS.excluidos || [];
  const exTot = ex.reduce((s, p) => s + (p.v || 0), 0);
  $('#rodape').innerHTML =
    'Painel gerado a partir de <b>' + esc(DADOS.origem) + '</b> (aba SEMANAL), extraído em ' +
    esc(DADOS.gerado_em) + '. Total exibido: ' +
    money(PAG.reduce((s, p) => s + (p.v || 0), 0)) + '.' +
    (ex.length ? ' <b style="color:var(--critical)">' + ex.length +
      (ex.length === 1 ? ' lançamento retirado' : ' lançamentos retirados') + ' a pedido, somando ' +
      money(exTot) + '</b> — a planilha continua com eles; somando de volta, fecha com os ' +
      'subtotais semanais do arquivo.' : ' Confere com a soma dos subtotais semanais do arquivo.') + '<br>' +
    'Para atualizar: substitua a planilha e rode <code>python build.py "caminho\\da\\planilha.xlsx" SUA_SENHA</code>, ' +
    'depois faça commit do <code>dados.js</code>.<br>' +
    'Conteúdo confidencial. A página é criptografada em repouso, mas quem tem a senha tem os dados — ' +
    'não compartilhe o link junto com a senha no mesmo canal.';
}

/* ---------------------------------------------------------------- render */
function render() {
  const sel = filtrar();
  document.querySelectorAll('#presets .chip').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.de === F.de && b.dataset.ate === F.ate)));
  document.querySelectorAll('#blocos .chip').forEach((b, i) =>
    b.setAttribute('aria-pressed', String(F.blo.has(BLOCOS[i]))));
  document.querySelectorAll('#empresas .chip').forEach((b, i) =>
    b.setAttribute('aria-pressed', String(F.emp.has(EMPRESAS[i]))));
  document.querySelectorAll('#categorias .chip').forEach((b, i) =>
    b.setAttribute('aria-pressed', String(F.cat.has(CATS[i]))));

  const k = kpis(sel);
  const f13 = render13();
  resumoKpis(f13);
  alertas(k, sel, f13);
  agenda(sel);
  tabela(sel);
  renderRec();

  $('#cnt-pagar').textContent = PAG.length;
  if (TIT.length) $('#cnt-receber').textContent = TIT.length;

  desenhaAba();                      // só a aba visível desenha
}

/* Tudo que depende da largura disponível. Chamado só para a aba visível —
   ver desenhaAba(). */
function desenhaPagar(sel) {
  chartDia(sel);
  chartAcum(sel);

  const t = sel.reduce((s, p) => s + (p.v || 0), 0) || 1;
  const pct = x => (x.v / t * 100).toFixed(1).replace('.', ',') + '%';

  const agEmp = EMPRESAS.map(e => {
    const l = sel.filter(p => p.e === e);
    return { k: e, v: l.reduce((s, p) => s + (p.v || 0), 0), n: l.length };
  }).filter(x => x.v > 0).sort((a, b) => b.v - a.v);
  agEmp.forEach(x => x.pct = pct(x));
  barras('#ch-emp', agEmp, it => COR[it.k], 'Total por empresa');

  let agCat = [...new Set(sel.map(p => p.n))].map(n => {
    const l = sel.filter(p => p.n === n);
    return { k: n, v: l.reduce((s, p) => s + (p.v || 0), 0), n: l.length };
  }).filter(x => x.v > 0).sort((a, b) => b.v - a.v);
  if (agCat.length > 9) {
    const resto = agCat.slice(8);
    agCat = agCat.slice(0, 8).concat([{ k: 'Outros (' + resto.length + ')',
      v: resto.reduce((s, x) => s + x.v, 0), n: resto.reduce((s, x) => s + x.n, 0) }]);
  }
  agCat.forEach(x => x.pct = pct(x));
  barras('#ch-cat', agCat, () => '--s1', 'Total por natureza do gasto');
}


/* ====================================================== contas a receber ==
   A carteira vem dos arquivos de posicao dos bancos e das financeiras. A
   distincao que manda em tudo aqui e simples x descontada:

     simples     - titulo ainda seu. Se o sacado nao pagar, voce nao recebe.
     descontada  - ja foi antecipado, o dinheiro entrou. O que resta nao e
                   direito a receber, e RISCO DE RECOMPRA.

   Somar os dois conta o mesmo dinheiro duas vezes. Por isso eles nunca
   aparecem num total unico - nem nos KPIs, nem no grafico, nem no rodape. */
const FR = { de: '', ate: '', sit: new Set(), cart: new Set(), banco: new Set(), busca: '' };
const SITS = ['Vencidos', 'A vencer'];
const NOMECART = { simples: 'Simples', descontada: 'Descontada' };
let TIT = [], BANCOS = [], CARTS = [], RMIN = '', RMAX = '';
let ordemRec = { k: 'd', dir: 1 };

const situacao = t => t.d < HOJE ? 'Vencidos' : 'A vencer';
const somaV = a => a.reduce((s, t) => s + (t.v || 0), 0);

function iniciarReceber() {
  TIT = (DADOS.titulos || []).slice().sort((a, b) => a.d.localeCompare(b.d));
  if (!TIT.length) { $('#tab-receber').hidden = true; return; }

  BANCOS = [...new Set(TIT.map(t => t.banco))].sort();
  CARTS = ['simples', 'descontada'].filter(c => TIT.some(t => t.carteira === c));
  RMIN = TIT[0].d; RMAX = TIT[TIT.length - 1].d;
  FR.de = RMIN; FR.ate = RMAX;
  SITS.forEach(s => FR.sit.add(s));
  CARTS.forEach(c => FR.cart.add(c));
  BANCOS.forEach(b => FR.banco.add(b));

  $('#rde').value = RMIN; $('#rde').min = RMIN; $('#rde').max = RMAX;
  $('#rate').value = RMAX; $('#rate').min = RMIN; $('#rate').max = RMAX;

  const bs = $('#rsit'); bs.innerHTML = '';
  SITS.forEach(s => bs.appendChild(chip(s, null, FR.sit, s, SITS, renderRec)));
  const bc = $('#rcart'); bc.innerHTML = '';
  CARTS.forEach(c => bc.appendChild(chip(NOMECART[c] || c, null, FR.cart, c, CARTS, renderRec)));
  const bb = $('#rbanco'); bb.innerHTML = '';
  BANCOS.forEach(b => bb.appendChild(chip(b, null, FR.banco, b, BANCOS, renderRec)));
}

function filtrarRec() {
  const q = FR.busca.trim().toLowerCase();
  const dig = q.replace(/[^0-9]/g, '');       // busca por CNPJ ignora pontuação
  return TIT.filter(t => {
    if (t.d < FR.de || t.d > FR.ate) return false;
    if (!FR.sit.has(situacao(t))) return false;
    if (!FR.cart.has(t.carteira)) return false;
    if (!FR.banco.has(t.banco)) return false;
    if (!q) return true;
    if ((t.sacado || '').toLowerCase().includes(q)) return true;
    return dig.length >= 3 && String(t.cnpj || '').includes(dig);
  });
}

function kpisRec(sel) {
  const simples = sel.filter(t => t.carteira === 'simples');
  const desc = sel.filter(t => t.carteira === 'descontada');
  const sVenc = simples.filter(t => t.d < HOJE);
  const sFut = simples.filter(t => t.d >= HOJE);
  const dVenc = desc.filter(t => t.d < HOJE);

  $('#rk-simples').textContent = money(somaV(simples));
  $('#rk-simples-sub').innerHTML = simples.length + ' títulos · é o dinheiro que ainda pode ' +
    'entrar. Não está somado com a carteira descontada — seria contar duas vezes.';

  $('#rk-venc').textContent = money(somaV(sVenc));
  $('#rk-venc').className = 'val' + (somaV(sVenc) ? ' neg' : '');
  $('#rk-venc-sub').innerHTML = sVenc.length + ' títulos · ' +
    pcts(somaV(sVenc), somaV(simples)) + ' da carteira simples';

  $('#rk-avencer').textContent = money(somaV(sFut));
  $('#rk-avencer-sub').innerHTML = sFut.length + ' títulos · vencem de hoje em diante';

  $('#rk-desc').textContent = money(somaV(desc));
  $('#rk-desc-sub').innerHTML = desc.length + ' títulos · o dinheiro já entrou. ' +
    (dVenc.length
      ? '<b class="neg">' + money(somaV(dVenc)) + ' vencidos e não liquidados</b> — recompra a caminho.'
      : 'Nenhum vencido em aberto.');
}

function alertasRec(sel) {
  const box = $('#ralertas'); box.innerHTML = '';
  const add = (nivel, ic, titulo, texto) => {
    const d = document.createElement('div');
    d.className = 'alerta ' + nivel;
    d.innerHTML = '<div class="ic">' + ic + '</div><div><b>' + titulo + '</b><p>' + texto + '</p></div>';
    box.appendChild(d);
  };
  const desc = sel.filter(t => t.carteira === 'descontada');
  const dVenc = desc.filter(t => t.d < HOJE);
  const simples = sel.filter(t => t.carteira === 'simples');
  const sVenc = simples.filter(t => t.d < HOJE);

  if (dVenc.length) {
    add('critical', '!', 'Recompra a caminho',
      '<b>' + money(somaV(dVenc)) + '</b> em ' + dVenc.length + ' títulos já antecipados ' +
      'venceram e não foram liquidados. Nos contratos com coobrigação, o que o sacado não paga ' +
      '<b>volta para você, com encargos</b>. Nos borderôs conferidos, o encargo de recompra ' +
      'chegou a 12% sobre 18 dias de atraso — perto de 20% ao mês.');
  }
  const total = somaV(simples);
  if (total && somaV(sVenc) / total > 0.2) {
    add('serious', '!', pcts(somaV(sVenc), total) + ' da carteira simples está vencida',
      sVenc.length + ' de ' + simples.length + ' títulos, ' + money(somaV(sVenc)) + '. ' +
      'Não é ruído de calendário — é boa parte da explicação da pressão de caixa e da ' +
      'dependência de antecipação. Cobrar no vencimento vale mais que negociar taxa.');
  }
}

/* Aging: ha quanto tempo cada titulo venceu. So carteira simples - o
   descontado ja virou caixa e a leitura dele e outra (risco de recompra). */
function chartAging(sel) {
  const simples = sel.filter(t => t.carteira === 'simples');
  const FAIXAS = [
    ['A vencer', t => t.d >= HOJE, '--s4'],
    ['1 a 30 dias', t => { const x = diasDe(t.d); return x >= 1 && x <= 30; }, '--s1'],
    ['31 a 60 dias', t => { const x = diasDe(t.d); return x >= 31 && x <= 60; }, '--s3'],
    ['61 a 90 dias', t => { const x = diasDe(t.d); return x >= 61 && x <= 90; }, '--serious'],
    ['Mais de 90 dias', t => diasDe(t.d) > 90, '--critical'],
  ];
  const total = somaV(simples);
  const itens = FAIXAS.map(f => {
    const l = simples.filter(f[1]);
    return { k: f[0], v: somaV(l), n: l.length, cor: f[2], pct: pcts(somaV(l), total) };
  });
  const vencido = itens.slice(1).reduce((s, x) => s + x.v, 0);
  $('#cd-aging').innerHTML = simples.length
    ? 'Só a carteira simples, ' + money(total) + '. <b>' + money(vencido) + '</b> já venceu — ' +
      pcts(vencido, total) + ' dela.'
    : 'Nenhum título da carteira simples nos filtros atuais.';
  barras('#ch-aging', itens.filter(x => x.v > 0), it => it.cor, 'Idade da carteira simples');
}

function chartConc(sel) {
  const porRaiz = {};
  sel.forEach(t => {
    const k = t.raiz || ('n:' + t.sacado);
    if (!porRaiz[k]) porRaiz[k] = { k: t.sacado || '(sem nome)', v: 0, n: 0, nomes: new Set(), docs: new Set() };
    const e = porRaiz[k];
    e.v += t.v; e.n++; e.nomes.add(t.sacado); if (t.cnpj) e.docs.add(t.cnpj);
  });
  const total = somaV(sel);
  const todos = Object.values(porRaiz).sort((a, b) => b.v - a.v);
  const top = todos.slice(0, 10);
  top.forEach(x => {
    x.pct = pcts(x.v, total);
    if (x.docs.size > 1) x.k += ' (' + x.docs.size + ' CNPJs)';
  });
  const soma10 = top.reduce((s, x) => s + x.v, 0);
  $('#cd-conc').innerHTML = todos.length
    ? todos.length + ' clientes. Os 10 maiores somam <b>' + pcts(soma10, total) +
      '</b> e o maior sozinho é <b>' + pcts(top[0].v, total) + '</b>.'
    : 'Sem títulos nos filtros atuais.';
  barras('#ch-conc', top, () => '--s2', 'Concentração por cliente');
}

function tabelaFontes(sel) {
  const f = {};
  sel.forEach(t => {
    const k = t.banco + '|' + t.carteira;
    if (!f[k]) f[k] = { banco: t.banco, cart: t.carteira, v: 0, n: 0, venc: 0, nv: 0 };
    const e = f[k];
    e.v += t.v; e.n++;
    if (t.d < HOJE) { e.venc += t.v; e.nv++; }
  });
  const lista = Object.values(f).sort((a, b) => b.v - a.v);
  $('#tbfontes').innerHTML = lista.length
    ? '<tr><td><b>Fonte</b></td><td><b>Saldo · do qual vencido</b></td></tr>' +
      lista.map(x =>
        '<tr><td>' + esc(x.banco) + ' · ' + x.cart +
        ' <span style="color:var(--ink-muted)">' + x.n + ' títulos</span></td>' +
        '<td>' + money(x.v) +
        (x.venc ? ' · <span class="neg">' + money(x.venc) + '</span>' : '') +
        '</td></tr>').join('')
    : '<tr><td>Sem títulos nos filtros atuais.</td></tr>';
}

function tabelaRec(sel) {
  const k = ordemRec.k === 'atraso' ? 'd' : ordemRec.k;
  const arr = sel.slice().sort((a, b) => {
    const va = k === 'v' ? (a.v || 0) : String(a[k] || '');
    const vb = k === 'v' ? (b.v || 0) : String(b[k] || '');
    if (va < vb) return -ordemRec.dir;
    if (va > vb) return ordemRec.dir;
    return a.d.localeCompare(b.d);
  });
  const LIM = 400;
  const mostra = arr.slice(0, LIM);
  $('#tbrec').innerHTML = mostra.length ? mostra.map(t => {
    const venc = t.d < HOJE, dias = diasDe(t.d);
    return '<tr>' +
      '<td>' + dtLongo(t.d) + '</td>' +
      '<td class="nome">' + esc(t.sacado || '—') +
        (t.cnpj ? '<span class="doc">' + esc(fmtDoc(t.cnpj)) + '</span>' : '') + '</td>' +
      '<td>' + esc(t.banco) + '</td>' +
      '<td>' + (t.carteira === 'descontada'
        ? '<span class="tag desc">descontada</span>' : '<span class="tag">simples</span>') + '</td>' +
      '<td>' + (venc
        ? '<span class="tag venc">' + dias + (dias === 1 ? ' dia' : ' dias') + ' em atraso</span>'
        : '<span class="tag">a vencer</span>') + '</td>' +
      '<td class="n">' + money(t.v) + '</td></tr>';
  }).join('') : '<tr><td colspan="6"><div class="vazio">Nenhum título com os filtros atuais.</div></td></tr>';

  const simples = arr.filter(x => x.carteira === 'simples');
  const desc = arr.filter(x => x.carteira === 'descontada');
  $('#rtfoot-info').innerHTML = arr.length + (arr.length === 1 ? ' título · ' : ' títulos · ') +
    '<b>' + money(somaV(simples)) + '</b> em carteira simples' +
    (desc.length ? ' · ' + money(somaV(desc)) + ' descontada (já recebida)' : '') +
    (arr.length > LIM ? ' · <b>a tabela mostra os ' + LIM + ' primeiros; o CSV sai completo</b>' : '');
  window.__CSVREC__ = arr;
}

function csvRec() {
  const arr = window.__CSVREC__ || [];
  const linhas = [['Vencimento', 'Sacado', 'Documento', 'Fonte', 'Carteira', 'Situacao',
                   'Dias em atraso', 'Valor', 'Como o CNPJ foi identificado']]
    .concat(arr.map(t => [dtLongo(t.d), t.sacado || '', fmtDoc(t.cnpj), t.banco, t.carteira,
      t.d < HOJE ? 'vencido' : 'a vencer', t.d < HOJE ? diasDe(t.d) : 0,
      (t.v || 0).toFixed(2).replace('.', ','), t.fonte_raiz || 'não identificado']));
  const txt = '﻿' + linhas.map(l =>
    l.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([txt], { type: 'text/csv;charset=utf-8' }));
  a.download = 'artflex-receber-' + FR.de + '_a_' + FR.ate + '.csv';
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function desenhaReceber(sel) { chartAging(sel); chartConc(sel); }

function renderRec() {
  if (!TIT.length) return;
  document.querySelectorAll('#rsit .chip').forEach((b, i) =>
    b.setAttribute('aria-pressed', String(FR.sit.has(SITS[i]))));
  document.querySelectorAll('#rcart .chip').forEach((b, i) =>
    b.setAttribute('aria-pressed', String(FR.cart.has(CARTS[i]))));
  document.querySelectorAll('#rbanco .chip').forEach((b, i) =>
    b.setAttribute('aria-pressed', String(FR.banco.has(BANCOS[i]))));

  const sel = filtrarRec();
  kpisRec(sel); alertasRec(sel); tabelaFontes(sel); tabelaRec(sel);
  if (ABA === 'receber') desenhaReceber(sel);
}

/* ========================================================= resumo de caixa */
function resumoKpis(f13) {
  const sem = f13.sem;
  const ent = sem.reduce((s, x) => s + x.ent, 0);
  const sai = sem.reduce((s, x) => s + x.sai, 0);
  const div = sem.reduce((s, x) => s + x.divida, 0);
  const fim = sem[12].saldo, abre = saldoAbertura();

  $('#r-pos').textContent = money(fim);
  $('#r-pos').className = 'val' + (fim < 0 ? ' neg' : '');
  $('#r-pos-sub').innerHTML = f13.neg
    ? 'O caixa vira negativo já na semana de <b>' + dtLongo(f13.neg.ini) + '</b>.' +
      (f13.temRec ? '' : ' <b>Sem entradas carregadas, isto é "quanto falta", não previsão.</b>')
    : 'O saldo projetado não fica negativo em nenhuma das 13 semanas.';

  $('#r-saldo').textContent = money(abre);
  $('#r-saldo').className = 'val' + (abre < 0 ? ' neg' : '');
  const nc = contasDoFiltro().length;
  $('#r-saldo-sub').textContent = 'Somado de ' + nc + (nc === 1 ? ' conta ativa' : ' contas ativas');

  $('#r-pagar').textContent = money(sai);
  $('#r-pagar-sub').innerHTML = div
    ? '<b>' + money(div) + '</b> são parcelas de dívida' : 'Contas a pagar do calendário';

  $('#r-receber').textContent = money(ent);
  $('#r-receber').className = 'val' + (ent ? '' : ' neg');
  $('#r-receber-sub').innerHTML = ent
    ? 'Recebimentos previstos no horizonte'
    : '<b>Nenhuma entrada carregada</b> — veja o alerta abaixo';
}

/* Vencimentos da carteira simples nas proximas 13 semanas. A descontada fica
   de fora: aquele dinheiro ja entrou, nao e previsao de entrada. */
function chartPrev() {
  const host = $('#ch-prev');
  const simples = (DADOS.titulos || []).filter(t => t.carteira === 'simples');
  if (!simples.length) {
    host.innerHTML = '<div class="vazio">Nenhuma carteira de cobrança carregada.</div>';
    $('#cd-prev').textContent = '';
    return;
  }
  const segunda = s => { const x = D(s); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return iso(x); };
  const ini = segunda(HOJE);
  const sem = [];
  for (let i = 0; i < 13; i++) {
    const a = addD(ini, i * 7);
    sem.push({ ini: a, fim: addD(a, 6), v: 0, n: 0 });
  }
  const fim = sem[12].fim;
  let venc = 0, nVenc = 0, depois = 0, nDepois = 0;
  simples.forEach(t => {
    if (t.d < ini) { venc += t.v; nVenc++; return; }
    if (t.d > fim) { depois += t.v; nDepois++; return; }
    const i = Math.floor(Math.round((D(t.d) - D(ini)) / 864e5) / 7);
    sem[i].v += t.v; sem[i].n++;
  });
  const noHorizonte = sem.reduce((s, x) => s + x.v, 0);
  const base = noHorizonte + venc;

  const itens = [];
  if (venc) itens.push({ k: 'Vencido até ' + ddmm(addD(ini, -1)), v: venc, n: nVenc, venc: 1 });
  sem.forEach(s => itens.push({ k: ddmm(s.ini) + ' a ' + ddmm(s.fim), v: s.v, n: s.n }));
  itens.forEach(x => x.pct = pcts(x.v, base));

  $('#cd-prev').innerHTML = '<b>' + money(noHorizonte) + '</b> vence dentro das 13 semanas' +
    (venc ? ', e <b class="neg">' + money(venc) + '</b> já venceu antes delas' : '') +
    (depois ? ' · ' + money(depois) + ' vence depois do horizonte' : '') + '.';
  barras('#ch-prev', itens, it => it.venc ? '--critical' : '--s4', 'A receber por semana');
}

/* ================================================================== abas ==
   O SVG e dimensionado por clientWidth. Dentro de painel escondido isso e
   zero, entao o desenho so acontece quando a aba fica visivel. */
const ABAS = ['resumo', 'pagar', 'receber', 'diag'];
let ABA = 'resumo';

function mostraAba(nome) {
  if (ABAS.indexOf(nome) < 0) nome = 'resumo';
  const bt = $('#tab-' + nome);
  if (!bt || bt.hidden) nome = 'resumo';
  ABA = nome;
  ABAS.forEach(a => {
    const on = a === nome;
    $('#pane-' + a).hidden = !on;
    const b = $('#tab-' + a);
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
  });
  try { localStorage.setItem('artflex-aba', nome); } catch (e) {}
  escondeTip();
  desenhaAba();
}

function desenhaAba() {
  if (!DADOS) return;
  if (ABA === 'resumo') { chart13(ULT13 || fluxo13()); chartPrev(); }
  else if (ABA === 'pagar') desenhaPagar(filtrar());
  else if (ABA === 'receber' && TIT.length) desenhaReceber(filtrarRec());
}

/* --------------------------------------------------------------- eventos */
$('#de').addEventListener('change', e => { F.de = e.target.value || MIN; if (F.de > F.ate) { F.ate = F.de; $('#ate').value = F.ate; } render(); });
$('#ate').addEventListener('change', e => { F.ate = e.target.value || MAX; if (F.ate < F.de) { F.de = F.ate; $('#de').value = F.de; } render(); });
let deb;
$('#busca').addEventListener('input', e => { clearTimeout(deb); deb = setTimeout(() => { F.busca = e.target.value; render(); }, 180); });
$('#limpar').addEventListener('click', () => {
  F.de = MIN; F.ate = MAX; F.busca = '';
  F.emp.clear(); EMPRESAS.forEach(e => F.emp.add(e));
  F.blo.clear(); BLOCOS.forEach(b => F.blo.add(b));
  F.cat.clear(); CATS.forEach(c => F.cat.add(c));
  $('#de').value = MIN; $('#ate').value = MAX; $('#busca').value = ''; render();
});
$('#csv').addEventListener('click', csv);
document.querySelectorAll('#tbl th').forEach(th => th.addEventListener('click', () => {
  const k = th.dataset.k;
  ordem = { k, dir: ordem.k === k ? -ordem.dir : (k === 'v' ? -1 : 1) };
  tabela(filtrar());
}));

/* ----------------------------------------------------------- abas: eventos */
ABAS.forEach(a => {
  $('#tab-' + a).addEventListener('click', () => mostraAba(a));
});
$('.tabs').addEventListener('keydown', ev => {
  const passo = ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : 0;
  if (!passo && ev.key !== 'Home' && ev.key !== 'End') return;
  ev.preventDefault();
  const vis = ABAS.filter(a => !$('#tab-' + a).hidden);
  let i = vis.indexOf(ABA);
  if (ev.key === 'Home') i = 0;
  else if (ev.key === 'End') i = vis.length - 1;
  else i = (i + passo + vis.length) % vis.length;
  mostraAba(vis[i]);
  $('#tab-' + vis[i]).focus();
});

/* ------------------------------------------ contas a receber: eventos */
$('#rde').addEventListener('change', e => {
  FR.de = e.target.value || RMIN;
  if (FR.de > FR.ate) { FR.ate = FR.de; $('#rate').value = FR.ate; }
  renderRec();
});
$('#rate').addEventListener('change', e => {
  FR.ate = e.target.value || RMAX;
  if (FR.ate < FR.de) { FR.de = FR.ate; $('#rde').value = FR.de; }
  renderRec();
});
let debR;
$('#rbusca').addEventListener('input', e => {
  clearTimeout(debR);
  debR = setTimeout(() => { FR.busca = e.target.value; renderRec(); }, 180);
});
$('#rlimpar').addEventListener('click', () => {
  FR.de = RMIN; FR.ate = RMAX; FR.busca = '';
  FR.sit.clear(); SITS.forEach(s => FR.sit.add(s));
  FR.cart.clear(); CARTS.forEach(c => FR.cart.add(c));
  FR.banco.clear(); BANCOS.forEach(b => FR.banco.add(b));
  $('#rde').value = RMIN; $('#rate').value = RMAX; $('#rbusca').value = '';
  renderRec();
});
$('#rcsv').addEventListener('click', csvRec);
document.querySelectorAll('#tblrec th').forEach(th => th.addEventListener('click', () => {
  const k = th.dataset.k;
  ordemRec = { k, dir: ordemRec.k === k ? -ordemRec.dir : (k === 'v' ? -1 : 1) };
  tabelaRec(filtrarRec());
}));

$('#tema').addEventListener('click', () => {
  const atual = document.documentElement.getAttribute('data-theme');
  const escuro = atual ? atual === 'dark'
    : matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.setAttribute('data-theme', escuro ? 'light' : 'dark');
  try { localStorage.setItem('artflex-tema', escuro ? 'light' : 'dark'); } catch (e) {}
});
try {
  const t = localStorage.getItem('artflex-tema');
  if (t) document.documentElement.setAttribute('data-theme', t);
} catch (e) {}

/* Redesenha quando a largura disponível muda. Observa o cartão (largura ditada
   pelo layout), não o alvo do desenho, para não realimentar o observer. */
let rz, ultimaLarg = 0;
function observaLargura() {
  // Observa o container das abas, nao um cartao: cartao dentro de painel
  // escondido tem largura 0 e o observer nunca dispararia.
  const alvo = $('#conteudo');
  if (!alvo || typeof ResizeObserver === 'undefined') return;
  new ResizeObserver(() => {
    const w = Math.round(alvo.clientWidth);
    if (w === ultimaLarg) return;
    ultimaLarg = w;
    clearTimeout(rz);
    rz = setTimeout(desenhaAba, 140);
  }).observe(alvo);
}

/* ------------------------------------------------------------------ gate */
async function tentar(senha, silencioso) {
  const err = $('#erro');
  if (!window.crypto || !crypto.subtle) {
    err.textContent = 'Este navegador não expõe a API de criptografia. Abra a página por https:// ou use Chrome/Edge/Firefox atualizado.';
    return false;
  }
  let d;
  try {
    d = await abrir(senha);
  } catch (e) {
    if (!silencioso) err.textContent = 'Senha incorreta.';
    try { sessionStorage.removeItem('artflex-pw'); } catch (e2) {}
    return false;
  }
  // A senha ja abriu os dados. Daqui para baixo, qualquer erro e de montagem
  // do painel - e antes isso caia no mesmo catch e aparecia como "senha
  // incorreta", mandando quem digitou certo tentar de novo para sempre.
  try { sessionStorage.setItem('artflex-pw', senha); } catch (e) {}
  try {
    iniciar(d);
  } catch (e) {
    err.textContent = 'A senha abriu os dados, mas o painel falhou ao montar: ' + e.message;
    console.error('falha ao montar o painel', e);
    return false;
  }
  return true;
}
$('#entrar').addEventListener('click', () => {
  $('#erro').textContent = '';
  $('#entrar').textContent = 'Abrindo…';
  setTimeout(async () => { await tentar($('#pw').value); $('#entrar').textContent = 'Abrir painel'; }, 10);
});
$('#pw').addEventListener('keydown', e => { if (e.key === 'Enter') $('#entrar').click(); });

(async () => {
  if (!window.__ARTFLEX__) { $('#erro').textContent = 'Arquivo dados.js não encontrado.'; return; }
  let s = null;
  try { s = sessionStorage.getItem('artflex-pw'); } catch (e) {}
  if (s) await tentar(s, true);
  if ($('#app').hidden) $('#pw').focus();
})();

})();
