/* Saldo — núcleo de lógica (etapa 1). Sem DOM, sem rede, sem efeitos colaterais.
   Funciona no navegador (window.SaldoCore) e no Node (module.exports). */
(function (root) {
'use strict';

const CAT_EXP = ['Moradia','Alimentação','Transporte','Saúde','Lazer','Contas','Compras','Dívidas','Metas','Outros'];
const CAT_INC = ['Salário','Freelance','Investimentos','Presente','Outros'];

const cents = n => Math.round((Number(n) || 0) * 100);
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
const STOP = new Set(['pix','ted','doc','compra','pagto','pagamento','debito','credito','cartao','de','da','do','em','para','recebido','enviado','transferencia','tarifa']);
function merchantKey(name) {
  const t = norm(name).split(' ').filter(w => w.length > 2 && !STOP.has(w));
  return t.slice(0, 2).join(' ');
}

/* Palavras-chave -> categoria (só categorias que já existem no app) */
const RULES = {
  expense: [
    ['Moradia', ['aluguel','condominio','iptu','imobiliaria']],
    ['Alimentação', ['mercado','supermercado','padaria','restaurante','ifood','lanchonete','acougue','hortifruti']],
    ['Transporte', ['uber','99','combustivel','posto','estacionamento','pedagio','metro','onibus']],
    ['Saúde', ['farmacia','drogaria','hospital','clinica','laboratorio','plano de saude','unimed']],
    ['Lazer', ['netflix','spotify','cinema','streaming','disney','youtube','bar','show','ingresso']],
    ['Contas', ['energia','luz','agua','internet','telefone','celular','vivo','claro','tim','gas']],
    ['Compras', ['amazon','shopee','mercado livre','magazine','loja','shopping']],
    ['Dívidas', ['emprestimo','financiamento','parcela','fatura']]
  ],
  income: [
    ['Salário', ['salario','folha','pagamento de salario','holerite']],
    ['Freelance', ['freela','freelance','servico prestado']],
    ['Investimentos', ['rendimento','dividendo','juros','cdb','tesouro']]
  ]
};

/* learned: { 'income|chave' | 'expense|chave': categoria } — vem das correções manuais */
function categorize(tx, learned) {
  const type = tx.type === 'income' ? 'income' : 'expense';
  const valid = type === 'income' ? CAT_INC : CAT_EXP;
  const key = merchantKey(tx.name);
  const L = learned && key ? learned[type + '|' + key] : null;
  if (L && valid.includes(L)) return { category: L, catSource: 'learned' };
  const n = ' ' + norm(tx.name) + ' ';
  for (const [cat, words] of RULES[type]) {
    if (words.some(w => n.includes(' ' + w + ' ') || (w.length > 4 && n.includes(w)))) return { category: cat, catSource: 'rule' };
  }
  return { category: 'Outros', catSource: 'rule' };
}

/* Correção manual: devolve a transação corrigida e o novo mapa aprendido (imutável) */
function applyManualCategory(tx, category, learned) {
  const type = tx.type === 'income' ? 'income' : 'expense';
  if (!(type === 'income' ? CAT_INC : CAT_EXP).includes(category)) throw new Error('Categoria inválida');
  const key = merchantKey(tx.name);
  const next = Object.assign({}, learned || {});
  if (key) next[type + '|' + key] = category;
  return { tx: Object.assign({}, tx, { category, catSource: 'manual' }), learned: next };
}

function dayDiff(a, b) {
  return Math.abs(Math.round((new Date(a + 'T00:00:00') - new Date(b + 'T00:00:00')) / 864e5));
}
function sim(a, b) {
  const A = new Set(norm(a).split(' ')), B = new Set(norm(b).split(' '));
  const inter = [...A].filter(x => x && B.has(x)).length;
  return inter / Math.max(1, Math.min(A.size, B.size));
}

/* Conciliação.
   existing: lançamentos atuais do Saldo.  incoming: movimentações do provedor
   ({extId, accountId, type, name, amount, date, status}).
   Regras: (1) mesmo extId já importado -> nunca duplica (atualiza status pendente->efetivado);
   (2) lançamento manual igual (tipo, valor, data ±3 dias) -> vincula, não soma de novo;
   (3) senão -> nova transação importada.  Não altera os arrays recebidos. */
function reconcile(existing, incoming, opts) {
  opts = opts || {};
  const tol = opts.dayTolerance == null ? 3 : opts.dayTolerance;
  const mkId = opts.makeId || (() => Date.now().toString(36) + Math.random().toString(36).slice(2, 7));
  const tx = existing.map(t => Object.assign({}, t));
  const byExt = new Map(tx.filter(t => t.extId).map(t => [t.accountId + '|' + t.extId, t]));
  const used = new Set();
  const out = { added: [], matched: [], duplicates: [], updated: [], manualWithoutBank: [] };

  for (const inc of incoming) {
    const k = inc.accountId + '|' + inc.extId;
    const prev = byExt.get(k);
    if (prev) {
      if (prev.status === 'pending' && inc.status !== 'pending') {
        Object.assign(prev, { status: 'posted', date: inc.date, amount: inc.amount });
        out.updated.push(prev.id);
      } else out.duplicates.push(inc.extId);
      continue;
    }
    let best = null, bestScore = -Infinity;
    for (const t of tx) {
      if (t.extId || used.has(t.id) || t.type !== inc.type || cents(t.amount) !== cents(inc.amount)) continue;
      const dd = dayDiff(t.date, inc.date); if (dd > tol) continue;
      const score = sim(t.name, inc.name) * 2 - dd;
      if (score > bestScore) { best = t; bestScore = score; }
    }
    if (best) {
      Object.assign(best, { extId: inc.extId, accountId: inc.accountId, status: inc.status === 'pending' ? 'pending' : 'posted', source: best.source || 'manual' });
      used.add(best.id); byExt.set(k, best); out.matched.push({ id: best.id, extId: inc.extId });
      continue;
    }
    const c = categorize(inc, opts.learned);
    const nt = { id: mkId(), type: inc.type, name: inc.name, amount: inc.amount, date: inc.date,
      category: c.category, catSource: c.catSource, source: 'import', extId: inc.extId,
      accountId: inc.accountId, status: inc.status === 'pending' ? 'pending' : 'posted' };
    tx.push(nt); byExt.set(k, nt); out.added.push(nt.id);
  }

  if (incoming.length) {
    const ds = incoming.map(i => i.date).sort(), lo = ds[0], hi = ds[ds.length - 1];
    const accs = new Set(incoming.map(i => i.accountId));
    if (opts.checkMissing !== false) {
      for (const t of tx) if (!t.extId && t.source !== 'import' && t.date >= lo && t.date <= hi && accs.size) out.manualWithoutBank.push(t.id);
    }
  }
  return Object.assign(out, { tx });
}


/* Leitura de extrato (OFX ou CSV) -> movimentações no formato de reconcile() */
function parseAmount(s){ s = String(s).trim().replace(/[R$\s]/g,''); if(/,\d{1,2}$/.test(s)) s = s.replace(/\./g,'').replace(',','.'); return parseFloat(s); }
function parseDate(s){ s = String(s).trim(); let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if(m) return m[0]; m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/); return m ? m[3]+'-'+m[2]+'-'+m[1] : null; }
function splitCsv(line, d){ const o = []; let cur = '', q = false; for(const ch of line){ if(ch === '"') q = !q; else if(ch === d && !q){ o.push(cur); cur = ''; } else cur += ch; } o.push(cur); return o.map(x => x.trim()); }
function parseStatement(text, accountId){
  accountId = accountId || 'arquivo';
  const out = [], seen = {};
  const push = (id, date, amt, name) => {
    if(!date || !isFinite(amt) || amt === 0) return;
    name = (name || '').trim() || 'Sem descrição';
    let extId = id;
    if(!extId){ const b = 'h:' + date + '|' + cents(amt) + '|' + name.toLowerCase(); seen[b] = (seen[b] || 0) + 1; extId = b + '#' + seen[b]; }
    out.push({ extId, accountId, type: amt > 0 ? 'income' : 'expense', name, amount: Math.abs(Math.round(amt * 100) / 100), date, status: 'posted' });
  };
  if(/<STMTTRN>/i.test(text)){
    (text.match(/<STMTTRN>[\s\S]*?(?=<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>|$)/gi) || []).forEach(b => {
      const g = t => { const m = b.match(new RegExp('<' + t + '>([^<\\r\\n]*)', 'i')); return m ? m[1].trim() : ''; };
      const d = g('DTPOSTED');
      push(g('FITID'), d.length >= 8 ? d.slice(0,4)+'-'+d.slice(4,6)+'-'+d.slice(6,8) : null, parseFloat(g('TRNAMT')), g('MEMO') || g('NAME'));
    });
    return out;
  }
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(l => l.trim());
  if(lines.length < 2) return out;
  const del = lines[0].includes(';') ? ';' : ',', H = splitCsv(lines[0], del).map(h => norm(h));
  const iD = H.findIndex(h => /data|date/.test(h)), iN = H.findIndex(h => /descri|hist|memo|nome|estab/.test(h)), iV = H.findIndex(h => /valor|amount|value/.test(h));
  if(iD < 0 || iV < 0) return out;
  lines.slice(1).forEach(l => { const c = splitCsv(l, del); push(null, parseDate(c[iD] || ''), parseAmount(c[iV] || ''), iN >= 0 ? c[iN] : ''); });
  return out;
}

const api = { parseStatement, CAT_EXP, CAT_INC, cents, norm, merchantKey, categorize, applyManualCategory, reconcile };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SaldoCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
