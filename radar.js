/* Saldo — Radar (projeção de caixa) e alertas. Lógica pura, sem DOM, sem rede, sem custo. */
(function (root) {
'use strict';
const C = typeof require !== 'undefined' ? require('./core.js') : root.SaldoCore;

const D = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const S = t => new Date(t).toISOString().slice(0, 10);
const addDays = (s, n) => S(D(s) + n * 864e5);
const diff = (a, b) => Math.round((D(b) - D(a)) / 864e5);
const addMonth = (s, k) => { const [y, m, d] = s.split('-').map(Number), t = new Date(Date.UTC(y, m - 1 + k, 1)), dim = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate(); return S(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), Math.min(d, dim))); };
const median = a => { const b = a.slice().sort((x, y) => x - y), n = b.length; return n ? (n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2) : 0; };
const r2 = n => Math.round(n * 100) / 100;

/* Cobranças/entradas que se repetem todo mês (valor parecido, intervalo de ~1 mês) */
function detectRecurring(tx, today) {
  const g = {};
  tx.forEach(t => { const k = C.merchantKey(t.name); if (k) (g[t.type + '|' + k] = g[t.type + '|' + k] || []).push(t); });
  const out = [];
  for (const [id, list] of Object.entries(g)) {
    const med = median(list.map(t => t.amount));
    const l = list.filter(t => Math.abs(t.amount - med) <= med * 0.15 || t === list[list.length - 1]).sort((a, b) => a.date.localeCompare(b.date));
    if (l.length < 2) continue;
    const gaps = l.slice(1).map((t, i) => diff(l[i].date, t.date));
    if (!gaps.every(x => x >= 25 && x <= 35)) continue;
    const last = l[l.length - 1];
    if (diff(last.date, today) > 45) continue; // parou de acontecer
    let next = addMonth(last.date, 1); while (next <= today) next = addMonth(next, 1);
    out.push({ key: id, type: last.type, name: last.name, amount: last.amount, prevAmount: l[l.length - 2].amount, count: l.length, lastDate: last.date, nextDate: next });
  }
  return out;
}

const debtLeft = d => Math.max(0, d.total - d.paid);

/* Projeção de fluxo de caixa: saldo dia a dia e primeiro dia no vermelho */
function projectCashflow(tx, debts, opts) {
  opts = opts || {};
  const today = opts.today, horizon = opts.horizonDays || 60, end = addDays(today, horizon);
  const start = opts.startBalance != null ? opts.startBalance :
    r2(tx.filter(t => t.date <= today).reduce((a, t) => a + (t.type === 'income' ? t.amount : -t.amount), 0));
  const rec = detectRecurring(tx, today), events = [];
  rec.forEach(r => { for (let d = r.nextDate; d <= end; d = addMonth(d, 1)) events.push({ date: d, name: r.name, delta: r.type === 'income' ? r.amount : -r.amount, kind: 'recorrente' }); });
  const rk = new Set(rec.map(r => C.merchantKey(r.name)));
  (debts || []).forEach(d => {
    if (!d.due || debtLeft(d) <= 0 || d.due <= today || d.due > end || rk.has(C.merchantKey(d.name))) return;
    events.push({ date: d.due, name: 'Dívida: ' + d.name, delta: -debtLeft(d), kind: 'divida' });
  });
  const series = []; let bal = start, shortfall = null, min = { date: today, balance: start };
  for (let i = 0; i <= horizon; i++) {
    const day = addDays(today, i);
    events.filter(e => e.date === day).forEach(e => { bal = r2(bal + e.delta); });
    series.push({ date: day, balance: bal });
    if (bal < 0 && !shortfall) shortfall = { date: day, balance: bal };
    if (bal < min.balance) min = { date: day, balance: bal };
  }
  return { startBalance: start, series, events: events.sort((a, b) => a.date.localeCompare(b.date)), shortfall, min, recurring: rec };
}

/* Alertas financeiros */
function buildAlerts(tx, debts, opts) {
  const today = opts.today, al = [];
  const add = (kind, severity, message, refs) => al.push({ id: kind + ':' + (refs || []).join(','), kind, severity, message, refs: refs || [] });
  const brl = n => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const rec = detectRecurring(tx, today);
  rec.filter(r => r.type === 'expense').forEach(r => {
    add('recorrente', 'info', `Cobrança recorrente: ${r.name} (${brl(r.amount)}), próxima em ${r.nextDate}.`, [r.key]);
    if (r.amount > r.prevAmount * 1.1) add('recorrente_aumento', 'aviso', `${r.name} subiu de ${brl(r.prevAmount)} para ${brl(r.amount)}.`, [r.key]);
  });
  // gasto incomum: >3x a mediana da categoria (mín. 4 gastos anteriores e valor >= R$50), últimos 30 dias
  const exp = tx.filter(t => t.type === 'expense');
  exp.filter(t => t.date <= today && diff(t.date, today) <= 30).forEach(t => {
    const prev = exp.filter(x => x.category === t.category && x.id !== t.id && x.date < t.date).map(x => x.amount);
    if (prev.length >= 4 && t.amount >= 50 && t.amount > 3 * median(prev)) add('gasto_incomum', 'aviso', `Gasto acima do normal em ${t.category}: ${t.name} (${brl(t.amount)}).`, [t.id]);
  });
  // possíveis duplicidades: mesmo tipo, valor e nome, com até 1 dia de diferença
  for (let i = 0; i < tx.length; i++) for (let j = i + 1; j < tx.length; j++) {
    const a = tx[i], b = tx[j];
    if (a.type === b.type && C.cents(a.amount) === C.cents(b.amount) && C.merchantKey(a.name) && C.merchantKey(a.name) === C.merchantKey(b.name)
      && Math.abs(diff(a.date, b.date)) <= 1)
      add('duplicada', 'aviso', `Possível transação duplicada: ${a.name} (${brl(a.amount)}) em ${a.date} e ${b.date}.`, [a.id, b.id].sort());
  }
  // dívidas/faturas perto do vencimento
  (debts || []).forEach(d => {
    if (!d.due || debtLeft(d) <= 0) return;
    const n = diff(today, d.due);
    if (n < 0) add('vencida', 'urgente', `${d.name} venceu há ${-n} dia(s). Falta ${brl(debtLeft(d))}.`, [d.id || d.name]);
    else if (n <= 7) add('vencimento', 'aviso', n === 0 ? `${d.name} vence hoje.` : `${d.name} vence em ${n} dia(s). Falta ${brl(debtLeft(d))}.`, [d.id || d.name]);
  });
  // mudança relevante no fluxo: gasto do mês até hoje bem acima da média dos 3 meses anteriores (mesmo trecho do mês)
  const mk = s => s.slice(0, 7), cur = mk(today), day = +today.slice(8, 10);
  const prevs = [1, 2, 3].map(k => mk(addMonth(today.slice(0, 8) + '01', -k)));
  const upto = m => exp.filter(t => mk(t.date) === m && +t.date.slice(8, 10) <= day).reduce((a, t) => a + t.amount, 0);
  const hist = prevs.map(upto).filter(v => v > 0);
  if (hist.length >= 2) { const avg = hist.reduce((a, b) => a + b, 0) / hist.length, now = upto(cur);
    if (now > avg * 1.3 && now - avg >= 100) add('fluxo_gastos', 'aviso', `Seus gastos deste mês (${brl(now)}) estão ${Math.round((now / avg - 1) * 100)}% acima da sua média.`, [cur]); }
  const p = projectCashflow(tx, debts, opts);
  if (p.shortfall) add('falta_de_dinheiro', 'urgente', `Previsão: o saldo pode ficar negativo em ${p.shortfall.date} (${brl(p.shortfall.balance)}).`, [p.shortfall.date]);
  return al;
}

const api = { detectRecurring, projectCashflow, buildAlerts };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SaldoRadar = api;
})(typeof window !== 'undefined' ? window : globalThis);
