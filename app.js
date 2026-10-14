(() => {
'use strict';
const UID = window.SaldoAuth ? window.SaldoAuth.currentUserId() : null;
const KEY = UID ? window.SaldoAuth.dataKey(UID) : null; // cada usuário tem a sua própria chave de dados
const $ = id => document.getElementById(id);
const CAT_EXP = ['Moradia','Alimentação','Transporte','Saúde','Lazer','Contas','Compras','Dívidas','Metas','Outros'];
const CAT_INC = ['Salário','Freelance','Investimentos','Presente','Outros'];
const COLORS = ['#16b985','#4cc9f0','#f2c14e','#ff6b72','#b388ff','#7be0b6','#ff9f5a','#2f8f6d','#ff6fb5','#7f988b'];
const TITLES = {dashboard:'Visão geral', moves:'Movimentações', debts:'Dívidas', goals:'Metas'};

let state = load();
let view = 'dashboard';
let month = 'all';

function load(){
  try{
    const s = KEY && JSON.parse(localStorage.getItem(KEY));
    if(s && Array.isArray(s.tx) && Array.isArray(s.debts) && Array.isArray(s.goals)) return s;
  }catch(e){}
  return {tx:[], debts:[], goals:[], learned:{}, lastImport:'', bank:null};
}
function save(){ if(!KEY) return; try{ localStorage.setItem(KEY, JSON.stringify(state)); }catch(e){ toast('Não foi possível salvar neste navegador.'); } }

const brl = n => (Number(n)||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2,7);
const ico = n => `<svg class="i"><use href="#i-${n}"/></svg>`;
const pad = n => String(n).padStart(2,'0');
function monthKey(d){ return d.getFullYear()+'-'+pad(d.getMonth()+1); }
function todayStr(){ const d=new Date(); return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); }
function fmtDate(s){ if(!s) return ''; const [y,m,d]=s.split('-'); return d+'/'+m+'/'+y; }
function monthLabel(k){ const [y,m]=k.split('-'); return new Date(y,m-1,1).toLocaleDateString('pt-BR',{month:'long',year:'numeric'}); }
function toast(msg){ const t=$('toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(toast.t); toast.t=setTimeout(()=>t.classList.remove('show'),2400); }
const pct = (a,b) => b>0 ? Math.max(0,Math.min(100,a/b*100)) : 0;

/* ---------- cálculos ---------- */
function periodTx(){ return month==='all' ? state.tx : state.tx.filter(t => t.date.slice(0,7)===month); }
function sums(list){
  let inc=0, exp=0;
  list.forEach(t => t.type==='income' ? inc+=t.amount : exp+=t.amount);
  return {inc, exp, bal:inc-exp};
}
const debtLeft = d => Math.max(0, d.total - d.paid);

/* ---------- render ---------- */
function render(){
  renderMonths();
  const list = periodTx(), s = sums(list);
  $('balance').textContent = brl(s.bal);
  $('sumIncome').textContent = brl(s.inc);
  $('sumExpense').textContent = brl(s.exp);
  $('balanceSub').textContent = s.bal>=0 ? (list.length ? 'Você está no positivo neste período.' : 'Adicione sua primeira movimentação.') : 'Atenção: seus gastos passaram das entradas.';

  const open = state.debts.reduce((a,d)=>a+debtLeft(d),0);
  const openCount = state.debts.filter(d=>debtLeft(d)>0).length;
  $('sumDebt').textContent = brl(open);
  $('debtCount').textContent = openCount ? openCount+(openCount>1?' dívidas abertas':' dívida aberta') : 'Nenhuma dívida aberta';
  const saved = state.goals.reduce((a,g)=>a+g.saved,0);
  $('sumGoals').textContent = brl(saved);
  $('goalCount').textContent = state.goals.length ? state.goals.length+(state.goals.length>1?' metas':' meta') : 'Nenhuma meta ainda';
  const net = sums(state.tx).bal - open;
  const nb = $('netAfterDebt'); nb.textContent = brl(net); nb.style.color = net<0 ? 'var(--red)' : '';

  renderSpend(list);
  renderFlow();
  $('recent').innerHTML = moveHTML(list.slice().sort(byDate).slice(0,5), false);
  renderPreview();
  renderMoves();
  renderDebts();
  renderGoals();
  renderRadar();
  renderBank();
}
function byDate(a,b){ return b.date.localeCompare(a.date) || b.id.localeCompare(a.id); }

function renderMonths(){
  const keys = new Set(state.tx.map(t=>t.date.slice(0,7)));
  keys.add(monthKey(new Date()));
  if(month!=='all') keys.add(month);
  const sel = $('monthFilter');
  sel.innerHTML = '<option value="all">Todo o período</option>' + [...keys].sort().reverse()
    .map(k=>`<option value="${k}">${esc(monthLabel(k))}</option>`).join('');
  sel.value = month;
}

/* ---------- gráficos de linha com seta ---------- */
let chartSeq = 0, lastW = 0;
const SHORT_MONTH = (y,m) => new Date(y,m,1).toLocaleDateString('pt-BR',{month:'short'}).replace('.','');
function smoothPath(pts){
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for(let i=1;i<pts.length;i++){
    const [x0,y0]=pts[i-1],[x1,y1]=pts[i], mx=(x0+x1)/2;
    d += ` C${mx.toFixed(1)},${y0.toFixed(1)} ${mx.toFixed(1)},${y1.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
  }
  return d;
}
function lineChart(el, labels, series, height){
  const W = Math.max(el.clientWidth||0, 280), H = height||190, pl=22, pr=30, pt=16, pb=12;
  const n = labels.length, max = Math.max(1, ...series.flatMap(s=>s.data));
  const X = i => pl + (n<2 ? (W-pl-pr)/2 : i*(W-pl-pr)/(n-1));
  const Y = v => pt + (H-pt-pb)*(1 - v/max);
  const id = 'g'+(++chartSeq);
  let defs='', grid='', body='';
  for(let k=0;k<4;k++){ const y = pt + (H-pt-pb)*k/3; grid += `<line x1="${pl-8}" x2="${W-pr+12}" y1="${y}" y2="${y}" class="grid"/>`; }
  series.forEach((s,si)=>{
    const pts = s.data.map((v,i)=>[X(i),Y(v)]);
    if(pts.length<2) pts.push([pts[0][0]+1,pts[0][1]]);
    const path = smoothPath(pts), last = pts[pts.length-1], prev = pts[pts.length-2];
    let ang = Math.atan2(last[1]-prev[1], Math.max(last[0]-prev[0],1))*180/Math.PI;
    ang = Math.max(-55, Math.min(55, ang*1.6));
    defs += `<linearGradient id="${id}-${si}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.color}" stop-opacity=".28"/><stop offset="1" stop-color="${s.color}" stop-opacity="0"/></linearGradient>`;
    body += `<path d="${path} L${last[0].toFixed(1)},${H-pb} L${pts[0][0].toFixed(1)},${H-pb} Z" fill="url(#${id}-${si})" class="area"/>`;
    body += `<path d="${path}" class="ln" pathLength="1" stroke="${s.color}"/>`;
    pts.forEach((p,i)=>{ if(i<pts.length-1 && n<=8) body += `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.4" fill="${s.color}" class="dot" style="--i:${i}"/>`; });
    body += `<g transform="translate(${last[0].toFixed(1)},${last[1].toFixed(1)}) rotate(${ang.toFixed(1)})" class="arrow"><path d="M9,0 L-5,-7 L-2,0 L-5,7 Z" fill="${s.color}"/></g>`;
  });
  const step = n<=8 ? 1 : Math.ceil((n-1)/4);
  let xl = '';
  for(let i=0;i<n;i++){ if(i%step===0 || i===n-1){ if(i!==n-1 && n-1-i<step*0.6) continue; xl += `<span style="left:${(X(i)/W*100).toFixed(2)}%">${esc(labels[i])}</span>`; } }
  el.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img"><defs>${defs}</defs>${grid}${body}</svg><div class="xl">${xl}</div>`;
}

function renderFlow(){
  const now = new Date(), keys=[], labels=[];
  for(let i=5;i>=0;i--){ const d=new Date(now.getFullYear(), now.getMonth()-i, 1); keys.push(monthKey(d)); labels.push(SHORT_MONTH(d.getFullYear(),d.getMonth())); }
  const data = keys.map(k => sums(state.tx.filter(t=>t.date.slice(0,7)===k)));
  const inc = data.map(x=>x.inc), exp = data.map(x=>x.exp);
  lineChart($('flowChart'), labels, [{data:inc,color:'#16b985'},{data:exp,color:'#ff6b72'}]);
  const chip = (name, cur, prev, goodUp) => {
    let dir=0, txt='sem dados';
    if(cur===0 && prev===0){ txt='—'; }
    else if(prev===0){ dir=1; txt='novo'; }
    else { const p=(cur-prev)/prev*100; dir = p>0.5?1:p<-0.5?-1:0; txt = (dir===0?'estável':Math.abs(p).toFixed(0)+'%'); }
    const good = dir===0 ? null : (dir>0)===goodUp;
    const cls = good===null ? '' : good ? 'good' : 'bad';
    const arrow = dir===0 ? '' : ico(dir>0?'up':'down');
    return `<div class="tchip ${cls}"><small>${name}</small><b>${arrow}${esc(txt)}</b><span>vs mês anterior</span></div>`;
  };
  $('trendChips').innerHTML = chip('Entradas', inc[5], inc[4], true) + chip('Gastos', exp[5], exp[4], false);
}

function renderSpend(list){
  const exp = list.filter(t=>t.type==='expense'), total = exp.reduce((a,t)=>a+t.amount,0);
  $('catTotal').textContent = brl(total);
  const el = $('spendChart');
  if(!exp.length){ el.innerHTML='<p class="empty">Sem gastos neste período.</p>'; $('legend').innerHTML=''; return; }
  let labels=[], data=[];
  if(month!=='all'){
    const [y,m] = month.split('-').map(Number), dim = new Date(y,m,0).getDate();
    const isNow = month===monthKey(new Date());
    const last = Math.max(2, isNow ? new Date().getDate() : dim);
    const perDay = Array(last+1).fill(0);
    exp.forEach(t => { const dd=+t.date.slice(8,10); if(dd<=last) perDay[dd]+=t.amount; });
    let acc=0; for(let d=1; d<=last; d++){ acc+=perDay[d]; labels.push(String(d)); data.push(acc); }
  } else {
    const keys = [...new Set(exp.map(t=>t.date.slice(0,7)))].sort();
    let [y,m] = keys[0].split('-').map(Number); const end = monthKey(new Date());
    const all=[]; for(let k=monthKey(new Date(y,m-1,1)); k<=end; ){ all.push(k); const [yy,mm]=k.split('-').map(Number); k=monthKey(new Date(yy,mm,1)); if(all.length>36) break; }
    if(all.length<2){ const [yy,mm]=all[0].split('-').map(Number); all.unshift(monthKey(new Date(yy,mm-2,1))); }
    const per = {}; exp.forEach(t=>{ const k=t.date.slice(0,7); per[k]=(per[k]||0)+t.amount; });
    let acc=0; all.forEach(k=>{ acc+=per[k]||0; const [yy,mm]=k.split('-').map(Number); labels.push(SHORT_MONTH(yy,mm-1)); data.push(acc); });
  }
  lineChart(el, labels, [{data, color:'#ff6b72'}]);
  const by = {}; exp.forEach(t => by[t.category] = (by[t.category]||0)+t.amount);
  let rows = Object.entries(by).sort((a,b)=>b[1]-a[1]);
  if(rows.length>6){ const rest = rows.slice(5).reduce((a,r)=>a+r[1],0); rows = rows.slice(0,5).concat([['Demais',rest]]); }
  $('legend').innerHTML = rows.map(([c,v],i)=>`<li><i style="background:${COLORS[i%COLORS.length]}"></i>${esc(c)}<span>${Math.round(v/total*100)}% · ${esc(brl(v))}</span></li>`).join('');
}
function redrawCharts(){ renderFlow(); renderSpend(periodTx()); }

function moveHTML(list, withDel){
  if(!list.length) return '<p class="empty">Nenhuma movimentação por aqui.</p>';
  return list.map(t=>{
    const inc = t.type==='income';
    return `<div class="item"><span class="ic ${inc?'in':'out'}">${ico(inc?'down':'up')}</span>
      <div class="item-info"><b>${esc(t.name)}</b><small>${esc(t.category)} · ${fmtDate(t.date)}</small></div>
      <span class="val ${inc?'in':'out'}">${inc?'+':'−'} ${esc(brl(t.amount))}</span>
      ${withDel?`<button class="del" data-del-tx="${t.id}" aria-label="Excluir">${ico('trash')}</button>`:''}</div>`;
  }).join('');
}
function renderMoves(){
  const q = $('search').value.trim().toLowerCase(), type = $('typeFilter').value;
  const list = periodTx().filter(t => (type==='all'||t.type===type) && (!q || (t.name+' '+t.category).toLowerCase().includes(q))).sort(byDate);
  $('allMoves').innerHTML = moveHTML(list, true);
}

function dueInfo(d){
  if(!d.due || debtLeft(d)<=0) return '';
  const days = Math.round((new Date(d.due+'T00:00:00') - new Date(todayStr()+'T00:00:00'))/864e5);
  if(days<0) return `<span class="badge warn">Vencida há ${-days} d</span>`;
  if(days===0) return '<span class="badge warn">Vence hoje</span>';
  return `<span class="badge">Vence em ${days} d</span>`;
}
function renderDebts(){
  const tot = state.debts.reduce((a,d)=>a+d.total,0), paid = state.debts.reduce((a,d)=>a+Math.min(d.paid,d.total),0);
  $('dTotal').textContent = brl(tot); $('dPaid').textContent = brl(paid); $('dLeft').textContent = brl(tot-paid);
  if(!state.debts.length){ $('debtList').innerHTML='<p class="empty">Nenhuma dívida cadastrada. Que bom! Quando houver, cadastre aqui.</p>'; return; }
  $('debtList').innerHTML = state.debts.map(d=>{
    const left = debtLeft(d), p = pct(d.paid,d.total), done = left<=0;
    return `<article class="card"><div class="card-top"><b>${esc(d.name)}</b>${done?'<span class="badge ok">Quitada ✓</span>':dueInfo(d)}</div>
      <div class="card-nums"><div>Pago<b>${esc(brl(Math.min(d.paid,d.total)))}</b></div><div>Falta<b class="${done?'':'amber'}">${esc(brl(left))}</b></div></div>
      <div class="aline amber"><i style="width:${p}%"></i></div>
      <div class="card-foot"><small>${Math.round(p)}% de ${esc(brl(d.total))}</small><span>
        ${done?'':`<button class="btn ghost small" data-pay="${d.id}">Pagar</button> `}<button class="del" data-del-debt="${d.id}" aria-label="Excluir">${ico('trash')}</button></span></div></article>`;
  }).join('');
}

function monthsLeft(date){
  const now=new Date(), t=new Date(date+'T00:00:00');
  return Math.max(1, (t.getFullYear()-now.getFullYear())*12 + t.getMonth()-now.getMonth() + (t.getDate()>=now.getDate()?1:0));
}
function renderGoals(){
  const tot = state.goals.reduce((a,g)=>a+g.target,0), sv = state.goals.reduce((a,g)=>a+Math.min(g.saved,g.target),0);
  $('gTarget').textContent = brl(tot); $('gSaved').textContent = brl(sv); $('gLeft').textContent = brl(tot-sv);
  if(!state.goals.length){ $('goalList').innerHTML='<p class="empty">Crie sua primeira meta: viagem, reserva, carro, estudos…</p>'; return; }
  $('goalList').innerHTML = state.goals.map(g=>{
    const left = Math.max(0,g.target-g.saved), p = pct(g.saved,g.target), done = left<=0;
    let hint = done ? 'Meta alcançada! 🎉' : (g.date ? `Guardar ~${brl(left/monthsLeft(g.date))}/mês até ${fmtDate(g.date)}` : `${Math.round(p)}% concluída`);
    return `<article class="card"><div class="card-top"><b>${esc(g.name)}</b>${done?'<span class="badge ok">Concluída ✓</span>':''}</div>
      <div class="card-nums"><div>Guardado<b>${esc(brl(g.saved))}</b></div><div>Meta<b>${esc(brl(g.target))}</b></div></div>
      <div class="aline"><i style="width:${p}%"></i></div>
      <div class="card-foot"><small>${esc(hint)}</small><span>
        ${done?'':`<button class="btn ghost small" data-save="${g.id}">Guardar</button> `}<button class="del" data-del-goal="${g.id}" aria-label="Excluir">${ico('trash')}</button></span></div></article>`;
  }).join('');
}
function renderPreview(){
  const items = [
    ...state.debts.filter(d=>debtLeft(d)>0).slice(0,3).map(d=>({n:d.name, s:Math.round(pct(d.paid,d.total))+'% paga · falta '+brl(debtLeft(d)), p:pct(d.paid,d.total), amber:true})),
    ...state.goals.slice(0,3).map(g=>({n:g.name, s:Math.round(pct(g.saved,g.target))+'% · '+brl(g.saved)+' de '+brl(g.target), p:pct(g.saved,g.target)}))
  ];
  $('previewProgress').innerHTML = items.length ? items.map(i=>`<div class="pv"><div class="pv-top"><b>${esc(i.n)}</b><span>${esc(i.s)}</span></div><div class="aline ${i.amber?'amber':''}"><i style="width:${i.p}%"></i></div></div>`).join('') : '<p class="empty">Cadastre dívidas e metas para acompanhar aqui.</p>';
}

/* ---------- navegação ---------- */
function go(v){
  view = v;
  document.querySelectorAll('.view').forEach(el => el.classList.toggle('hidden', el.id!=='view-'+v));
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view===v));
  $('pageTitle').textContent = TITLES[v];
  window.scrollTo({top:0});
  if(v==='dashboard') redrawCharts();
}

/* ---------- modal ---------- */
let mode = null, ctx = null, txType = 'expense';
function catOptions(type, sel){ return (type==='income'?CAT_INC:CAT_EXP).map(c=>`<option ${c===sel?'selected':''}>${c}</option>`).join(''); }
function openModal(kind, id){
  mode = kind; ctx = id||null;
  const f = $('mForm'); let title='', html='';
  const amount = (label,idn,extra='') => `<label>${label}<input id="${idn}" type="number" step="0.01" min="0" inputmode="decimal" placeholder="0,00" ${extra}></label>`;
  if(kind==='income'||kind==='expense'){
    txType = kind; title='Nova movimentação';
    html = `<div class="seg"><button type="button" data-seg="income" class="${kind==='income'?'on':''}">Entrada</button><button type="button" data-seg="expense" class="${kind==='expense'?'on':''}">Gasto</button></div>
      <label>Descrição<input id="fName" required maxlength="80" placeholder="Ex.: Salário, mercado, internet"></label>
      ${amount('Valor (R$)','fAmount','required min="0.01"')}
      <label>Categoria<select id="fCat">${catOptions(kind)}</select></label>
      <label>Data<input id="fDate" type="date" required value="${todayStr()}"></label>`;
  } else if(kind==='debt'){
    title='Nova dívida';
    html = `<label>Nome da dívida<input id="fName" required maxlength="80" placeholder="Ex.: Cartão, empréstimo, financiamento"></label>
      ${amount('Valor total (R$)','fTotal','required min="0.01"')}
      ${amount('Já pago (R$)','fPaid')}
      <label>Vencimento (opcional)<input id="fDue" type="date"></label>`;
  } else if(kind==='goal'){
    title='Nova meta';
    html = `<label>Nome da meta<input id="fName" required maxlength="80" placeholder="Ex.: Viagem, reserva de emergência"></label>
      ${amount('Valor desejado (R$)','fTarget','required min="0.01"')}
      ${amount('Quanto já guardou (R$)','fSaved')}
      <label>Prazo (opcional)<input id="fDate" type="date"></label>`;
  } else if(kind==='pay'){
    const d = state.debts.find(x=>x.id===id); if(!d) return;
    title='Pagar: '+d.name;
    html = `<p class="hint">Falta pagar ${esc(brl(debtLeft(d)))}.</p>${amount('Valor do pagamento (R$)','fAmount',`required min="0.01" max="${debtLeft(d)}" value="${debtLeft(d)}"`)}
      <label class="check"><input type="checkbox" id="fReg" checked> Registrar também como gasto (categoria Dívidas)</label>`;
  } else if(kind==='save'){
    const g = state.goals.find(x=>x.id===id); if(!g) return;
    title='Guardar para: '+g.name;
    html = `<p class="hint">Falta guardar ${esc(brl(Math.max(0,g.target-g.saved)))}.</p>${amount('Valor a guardar (R$)','fAmount','required min="0.01"')}
      <label class="check"><input type="checkbox" id="fReg" checked> Descontar do saldo (registrar como gasto em Metas)</label>`;
  }
  $('mTitle').textContent = title;
  f.innerHTML = html + '<button class="btn lime full" type="submit">Salvar</button>';
  $('backdrop').classList.remove('hidden');
  const first = f.querySelector('input:not([type=checkbox])'); if(first) first.focus();
}
function closeModal(){ if(mode==='auth') return; $('backdrop').classList.add('hidden'); mode=null; }
const num = id => Math.round((parseFloat($(id).value)||0)*100)/100;

$('mForm').addEventListener('click', e => {
  const b = e.target.closest('[data-seg]'); if(!b) return;
  txType = b.dataset.seg;
  document.querySelectorAll('[data-seg]').forEach(x=>x.classList.toggle('on', x===b));
  $('fCat').innerHTML = catOptions(txType);
});
$('mForm').addEventListener('submit', e => {
  e.preventDefault();
  if(mode==='auth') return doAuth();
  if(mode==='income'||mode==='expense'){
    const a = num('fAmount'); if(a<=0) return toast('Informe um valor maior que zero.');
    state.tx.push({id:uid(), type:txType, name:$('fName').value.trim(), amount:a, category:$('fCat').value, date:$('fDate').value||todayStr()});
    const mk = ($('fDate').value||todayStr()).slice(0,7); if(month!=='all') month = mk;
    toast('Movimentação salva!');
  } else if(mode==='debt'){
    const total = num('fTotal'), paid = Math.min(num('fPaid'), total);
    if(total<=0) return toast('Informe o valor total.');
    state.debts.push({id:uid(), name:$('fName').value.trim(), total, paid, due:$('fDue').value||''});
    toast('Dívida cadastrada!');
  } else if(mode==='goal'){
    const target = num('fTarget'); if(target<=0) return toast('Informe o valor desejado.');
    state.goals.push({id:uid(), name:$('fName').value.trim(), target, saved:num('fSaved'), date:$('fDate').value||''});
    toast('Meta criada!');
  } else if(mode==='pay'){
    const d = state.debts.find(x=>x.id===ctx); const a = Math.min(num('fAmount'), debtLeft(d));
    if(a<=0) return toast('Informe um valor válido.');
    d.paid = Math.round((d.paid+a)*100)/100;
    if($('fReg').checked) state.tx.push({id:uid(), type:'expense', name:'Pagamento: '+d.name, amount:a, category:'Dívidas', date:todayStr()});
    toast(debtLeft(d)<=0 ? 'Dívida quitada! 🎉' : 'Pagamento registrado!');
  } else if(mode==='save'){
    const g = state.goals.find(x=>x.id===ctx); const a = num('fAmount'); if(a<=0) return toast('Informe um valor válido.');
    g.saved = Math.round((g.saved+a)*100)/100;
    if($('fReg').checked) state.tx.push({id:uid(), type:'expense', name:'Meta: '+g.name, amount:a, category:'Metas', date:todayStr()});
    toast(g.saved>=g.target ? 'Meta alcançada! 🎉' : 'Valor guardado!');
  }
  save(); closeModal(); render();
});

/* ---------- eventos ---------- */
document.addEventListener('click', e => {
  const t = e.target;
  let el;
  if((el=t.closest('[data-view]'))) return go(el.dataset.view);
  if((el=t.closest('[data-goto]'))) return go(el.dataset.goto);
  if((el=t.closest('[data-new]'))) return openModal(el.dataset.new);
  if((el=t.closest('[data-pay]'))) return openModal('pay', el.dataset.pay);
  if((el=t.closest('[data-save]'))) return openModal('save', el.dataset.save);
  if((el=t.closest('[data-del-tx]'))){ if(confirm('Excluir esta movimentação?')){ state.tx=state.tx.filter(x=>x.id!==el.dataset.delTx); save(); render(); } return; }
  if((el=t.closest('[data-del-debt]'))){ if(confirm('Excluir esta dívida?')){ state.debts=state.debts.filter(x=>x.id!==el.dataset.delDebt); save(); render(); } return; }
  if((el=t.closest('[data-del-goal]'))){ if(confirm('Excluir esta meta?')){ state.goals=state.goals.filter(x=>x.id!==el.dataset.delGoal); save(); render(); } return; }
});
$('addTop').onclick = () => openModal('expense');
$('fab').onclick = () => openModal('expense');
$('mClose').onclick = closeModal;
$('backdrop').addEventListener('mousedown', e => { if(e.target===$('backdrop')) closeModal(); });
document.addEventListener('keydown', e => { if(e.key==='Escape' && mode) closeModal(); });
$('monthFilter').onchange = e => { month = e.target.value; render(); };
$('search').oninput = renderMoves;
$('typeFilter').onchange = renderMoves;

function download(name, text, type){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text],{type}));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
$('exportCsv').onclick = () => {
  const q = v => '"'+String(v).replace(/"/g,'""')+'"';
  const rows = [['Data','Tipo','Descrição','Categoria','Valor']].concat(state.tx.slice().sort(byDate).map(t=>[t.date,t.type==='income'?'Entrada':'Gasto',t.name,t.category,t.amount.toFixed(2).replace('.',',')]));
  download('saldo-movimentacoes.csv','﻿'+rows.map(r=>r.map(q).join(';')).join('\n'),'text/csv;charset=utf-8');
};
/* ---------- Saldo Radar e importação de extrato ---------- */
const SEV = {urgente:0, aviso:1, info:2};
function renderRadar(){
  const R = window.SaldoRadar; if(!R) return;
  $('lastSync').textContent = [state.lastImport ? 'Último extrato importado: '+new Date(state.lastImport).toLocaleString('pt-BR') : '', state.bank&&state.bank.lastSync ? 'Banco (teste) sincronizado em '+new Date(state.bank.lastSync).toLocaleString('pt-BR') : ''].filter(Boolean).join(' · ');
  if(!state.tx.length){ $('radarList').innerHTML = '<p class="empty">Adicione ou importe movimentações para o Radar prever seu fluxo.</p>'; return; }
  const o = {today: todayStr()}, p = R.projectCashflow(state.tx, state.debts, o), al = R.buildAlerts(state.tx, state.debts, o);
  const row = (cls, icon, title, sub) => `<div class="item"><span class="ic ${cls}">${ico(icon)}</span><div class="item-info"><b>${esc(title)}</b><small>${esc(sub)}</small></div></div>`;
  let h = p.shortfall ? row('out','up','Possível falta de dinheiro em '+fmtDate(p.shortfall.date), 'Saldo previsto: '+brl(p.shortfall.balance))
    : row('in','down','Sem falta de dinheiro prevista', 'Menor saldo previsto em 60 dias: '+brl(p.min.balance));
  h += al.filter(a=>a.kind!=='falta_de_dinheiro').sort((a,b)=>SEV[a.severity]-SEV[b.severity]).slice(0,8)
    .map(a=>row(a.severity==='info'?'in':'out', a.severity==='info'?'swap':'up', a.message, a.severity==='info'?'Informação':a.severity==='urgente'?'Urgente':'Atenção')).join('');
  $('radarList').innerHTML = h;
}
$('importStmt').onchange = e => {
  const f = e.target.files[0]; if(!f) return;
  const r = new FileReader();
  r.onload = () => {
    const inc = window.SaldoCore.parseStatement(String(r.result), 'arquivo');
    if(!inc.length) toast('Não encontrei movimentações neste arquivo (use CSV ou OFX).');
    else {
      const res = window.SaldoCore.reconcile(state.tx, inc, {learned: state.learned});
      state.tx = res.tx; state.lastImport = new Date().toISOString(); save(); render();
      toast(res.added.length+' novas, '+res.matched.length+' conciliadas, '+res.duplicates.length+' já importadas');
    }
    e.target.value = '';
  };
  r.readAsText(f);
};

/* ---------- Conexão bancária (modo de teste, via ponte no servidor) ---------- */
const FN = '/.netlify/functions/pluggy';
async function bankApi(action, extra){
  const r = await fetch(FN, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(Object.assign({action}, extra))});
  let d = {}; try{ d = await r.json(); }catch(e){}
  if(!r.ok) throw new Error(d.error || 'Servidor de teste indisponível. Veja TESTE-BANCO.txt.');
  return d;
}
function renderBank(){
  $('whoami').textContent = 'Conta de teste: '+(window.SaldoAuth.currentEmail()||'');
  const on = !!(state.bank && state.bank.itemId);
  $('bankConnect').classList.toggle('hidden', on); $('bankSync').classList.toggle('hidden', !on); $('bankDisc').classList.toggle('hidden', !on);
}
async function syncBank(silent){
  if(!(state.bank && state.bank.itemId)) return;
  try{
    const d = await bankApi('transactions', {itemId: state.bank.itemId});
    const res = window.SaldoCore.reconcile(state.tx, d.transactions, {learned: state.learned});
    state.tx = res.tx; state.bank.lastSync = new Date().toISOString(); save(); render();
    if(!silent) toast(res.added.length+' novas, '+res.matched.length+' conciliadas, '+res.updated.length+' atualizadas');
  }catch(e){ if(!silent) toast(e.message); }
}
$('bankConnect').onclick = async () => {
  try{
    if(!window.PluggyConnect) await new Promise((ok,no)=>{ const s=document.createElement('script'); s.src='https://cdn.pluggy.ai/pluggy-connect/v2.7.0/pluggy-connect.js'; s.onload=ok; s.onerror=()=>no(new Error('Não foi possível carregar o widget da Pluggy.')); document.head.appendChild(s); });
    const {connectToken} = await bankApi('token');
    new window.PluggyConnect({connectToken, includeSandbox:true, language:'pt',
      onSuccess: d => { state.bank = {itemId: d.item.id, lastSync:''}; save(); render(); syncBank(false); },
      onError: e => toast('Erro na conexão: '+((e&&e.message)||'tente de novo'))}).init();
  }catch(e){ toast(e.message); }
};
$('bankSync').onclick = () => syncBank(false);
$('bankDisc').onclick = async () => {
  if(!confirm('Desconectar este banco? As movimentações já importadas continuam no Saldo.')) return;
  try{ await bankApi('disconnect', {itemId: state.bank.itemId}); state.bank = null; save(); render(); toast('Banco desconectado.'); }catch(e){ toast(e.message); }
};
function autoSync(){ const b = state.bank; if(b && b.itemId && (!b.lastSync || Date.now()-new Date(b.lastSync) > 6*36e5)) syncBank(true); }

/* ---------- Login de teste (sem banco de dados; ver auth.js) ---------- */
let authMode = 'login';
function showAuth(m){
  authMode = m || 'login'; mode = 'auth';
  const reg = authMode === 'register';
  $('mTitle').textContent = reg ? 'Criar conta' : 'Entrar';
  $('mClose').style.display = 'none';
  $('mForm').innerHTML = `<div class="seg"><button type="button" data-aseg="login" class="${reg?'':'on'}">Entrar</button><button type="button" data-aseg="register" class="${reg?'on':''}">Criar conta</button></div>
    <label>E-mail<input id="aEmail" type="email" required maxlength="120" autocomplete="username"></label>
    <label>Senha<input id="aPass" type="password" required minlength="8" autocomplete="${reg?'new-password':'current-password'}"></label>
    ${reg ? '<label>Confirmar senha<input id="aPass2" type="password" required minlength="8" autocomplete="new-password"></label>' : ''}
    <p class="hint">Modo de teste: a conta fica salva só neste navegador.</p>
    <button class="btn lime full" type="submit">${reg ? 'Criar conta' : 'Entrar'}</button>`;
  $('backdrop').classList.remove('hidden');
}
async function doAuth(){
  const email = $('aEmail').value, pw = $('aPass').value;
  try{
    if(authMode === 'register'){ if(pw !== $('aPass2').value) return toast('As senhas não conferem.'); await window.SaldoAuth.register(email, pw); }
    else await window.SaldoAuth.login(email, pw);
    location.reload();
  }catch(e){ toast(e.message); }
}
$('mForm').addEventListener('click', e => { const b = e.target.closest('[data-aseg]'); if(b) showAuth(b.dataset.aseg); });
$('logout').onclick = () => { window.SaldoAuth.logout(); location.reload(); };
$('delAccount').onclick = async () => {
  if(!confirm('Excluir sua conta e todos os seus dados deste navegador? Isso não pode ser desfeito.')) return;
  const b = state.bank; if(b && b.itemId){ try{ await bankApi('disconnect', {itemId:b.itemId}); }catch(e){} }
  window.SaldoAuth.deleteAccount(); location.reload();
};

$('exportJson').onclick = () => download('saldo-backup.json', JSON.stringify(state,null,2), 'application/json');
$('importJson').onchange = e => {
  const f = e.target.files[0]; if(!f) return;
  const r = new FileReader();
  r.onload = () => {
    try{
      const s = JSON.parse(r.result);
      if(!Array.isArray(s.tx)||!Array.isArray(s.debts)||!Array.isArray(s.goals)) throw 0;
      if(confirm('Isso substitui os dados atuais pelos do backup. Continuar?')){ state = {tx:s.tx, debts:s.debts, goals:s.goals, learned:s.learned||{}, lastImport:s.lastImport||'', bank:s.bank||null}; save(); render(); toast('Backup restaurado!'); }
    }catch(err){ toast('Arquivo de backup inválido.'); }
    e.target.value='';
  };
  r.readAsText(f);
};
$('resetAll').onclick = () => { if(confirm('Apagar TODOS os dados deste aparelho? Isso não pode ser desfeito.')){ { const b=state.bank; if(b&&b.itemId) bankApi('disconnect',{itemId:b.itemId}).catch(()=>{}); } state={tx:[],debts:[],goals:[],learned:{},lastImport:'',bank:null}; save(); render(); toast('Dados apagados.'); } };

month = monthKey(new Date());
let rz; window.addEventListener('resize',()=>{ clearTimeout(rz); rz=setTimeout(()=>{ const w=$('flowChart').clientWidth; if(view==='dashboard' && w && w!==lastW){ lastW=w; redrawCharts(); } },200); });
$('dateLabel').textContent = new Date().toLocaleDateString('pt-BR',{weekday:'long',day:'numeric',month:'long'});
if(!UID) showAuth('login'); else { render(); autoSync(); }
})();
