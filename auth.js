/* Saldo — login de TESTE (sem banco de dados).
   Contas e dados ficam só neste navegador (localStorage). NÃO é segurança de produção:
   em produção o login precisa ser validado em um servidor. */
(function (root) {
'use strict';
const USERS = 'saldo-users', SESSION = 'saldo-session', ATT = 'saldo-attempts', LEGACY = 'saldo-verde-v1', ITER = 120000;
const enc = new TextEncoder();
const b64 = u => btoa(String.fromCharCode(...new Uint8Array(u)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function derive(pw, salt) {
  const k = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' }, k, 256));
}
const same = (a, b) => { let r = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) r |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); return r === 0; };
const normEmail = e => String(e || '').trim().toLowerCase();
const rid = () => b64(crypto.getRandomValues(new Uint8Array(9))).replace(/[^a-z0-9]/gi, 'x');

function create(local, session, opts) {
  const now = (opts && opts.now) || Date.now;
  const users = () => { try { return JSON.parse(local.getItem(USERS)) || {}; } catch (e) { return {}; } };
  const put = u => local.setItem(USERS, JSON.stringify(u));
  const dataKey = id => LEGACY + ':u:' + id;
  const byEmail = e => Object.values(users()).find(u => u.email === e);
  const api = {
    dataKey,
    async register(email, pw) {
      email = normEmail(email);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('E-mail inválido.');
      if (String(pw).length < 8) throw new Error('A senha precisa ter pelo menos 8 caracteres.');
      const all = users(), first = Object.keys(all).length === 0;
      if (byEmail(email)) throw new Error('Este e-mail já tem conta.');
      const salt = crypto.getRandomValues(new Uint8Array(16)), id = rid();
      all[id] = { id, email, salt: b64(salt), hash: await derive(pw, salt), createdAt: new Date(now()).toISOString() };
      put(all);
      const legacy = local.getItem(LEGACY);
      if (first && legacy) local.setItem(dataKey(id), legacy); // a 1ª conta herda os dados que já existiam neste navegador
      session.setItem(SESSION, id);
      return { id, email };
    },
    async login(email, pw) {
      email = normEmail(email);
      const att = JSON.parse(local.getItem(ATT) || '{}'), a = att[email] || { n: 0, until: 0 };
      if (a.until > now()) throw new Error('Muitas tentativas. Aguarde ' + Math.ceil((a.until - now()) / 1000) + 's.');
      const u = byEmail(email), h = await derive(String(pw), u ? unb64(u.salt) : new Uint8Array(16));
      if (!u || !same(h, u.hash)) {
        a.n++; if (a.n >= 5) { a.until = now() + 30000; a.n = 0; }
        att[email] = a; local.setItem(ATT, JSON.stringify(att));
        throw new Error('E-mail ou senha incorretos.');
      }
      delete att[email]; local.setItem(ATT, JSON.stringify(att));
      session.setItem(SESSION, u.id);
      return { id: u.id, email: u.email };
    },
    currentUserId() { const id = session.getItem(SESSION); return id && users()[id] ? id : null; },
    currentEmail() { const id = api.currentUserId(); return id ? users()[id].email : ''; },
    logout() { session.removeItem(SESSION); },
    deleteAccount() {
      const id = api.currentUserId(); if (!id) return;
      const all = users(); delete all[id]; put(all);
      local.removeItem(dataKey(id)); session.removeItem(SESSION);
    }
  };
  return api;
}
const mod = { create };
if (typeof module !== 'undefined' && module.exports) module.exports = mod;
else root.SaldoAuth = create(localStorage, sessionStorage);
})(typeof window !== 'undefined' ? window : globalThis);
