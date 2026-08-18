/* Sincronização segura do CONTROLE DE GASTOS com Supabase.
   Usa somente a chave pública; nunca coloque uma service_role/secret key neste arquivo. */
(() => {
  const SUPABASE_URL = "https://otvkiavomycwxyvvmjli.supabase.co";
  const SUPABASE_KEY = "sb_publishable_57cayWsC9HfaPXgzsQBPlw_ANWvjDdE";
  const DATA_KEY = "dashboard-gastos-multi-ano-v2";
  const TABLE = "dashboard_data";
  let client = null;
  let user = null;
  let saving = false;
  let saveTimer = null;
  let applyingRemote = false;

  const style = document.createElement("style");
  style.textContent = `
    #root { display: none !important; }
    #cloud-auth { position: fixed; inset: 0; z-index: 2147483647; display:flex; align-items:center; justify-content:center; padding:20px; background:#f7fafc; font-family: ui-sans-serif,system-ui,sans-serif; }
    #cloud-auth .box { width:min(420px,100%); background:white; border:1px solid #e5e7eb; border-radius:18px; padding:28px; box-shadow:0 18px 45px rgba(15,23,42,.12); }
    #cloud-auth img { display:block; width:66px; height:66px; object-fit:contain; margin:0 auto 12px; border-radius:50%; }
    #cloud-auth h1 { margin:0; text-align:center; color:#173b63; font-size:22px; font-weight:800; }
    #cloud-auth p { color:#64748b; font-size:13px; line-height:1.5; text-align:center; margin:8px 0 20px; }
    #cloud-auth label { display:block; color:#334155; font-size:12px; font-weight:700; margin:12px 0 5px; }
    #cloud-auth input { width:100%; box-sizing:border-box; border:1px solid #cbd5e1; border-radius:9px; padding:11px 12px; font-size:15px; }
    #cloud-auth button { width:100%; border:0; border-radius:9px; padding:12px; margin-top:16px; background:#173b63; color:white; font-weight:700; cursor:pointer; }
    #cloud-auth button.secondary { margin-top:9px; background:#e8eef5; color:#173b63; }
    #cloud-auth button:disabled { opacity:.6; cursor:wait; }
    #cloud-auth .link-button { display:block; width:auto; margin:12px auto 0; padding:0; background:transparent; color:#173b63; text-decoration:underline; font-size:12px; font-weight:600; }
    #cloud-auth .message { min-height:20px; margin-top:12px; text-align:center; color:#b42318; font-size:12px; }
  `;
  document.head.appendChild(style);

  const auth = document.createElement("div");
  auth.id = "cloud-auth";
  auth.innerHTML = `
    <div class="box">
      <img src="/LOGODASHBOARD.png" alt="Logo CONTROLE DE GASTOS">
      <h1>CONTROLE DE GASTOS</h1>
      <p>Entre para acessar seus dados em todos os dispositivos.</p>
      <form id="cloud-login-form">
        <label for="cloud-email">E-mail</label>
        <input id="cloud-email" type="email" autocomplete="email" required>
        <label for="cloud-password">Senha</label>
        <input id="cloud-password" type="password" autocomplete="current-password" minlength="6" required>
        <button id="cloud-login" type="submit">Entrar</button>
        <button id="cloud-signup" class="secondary" type="button">Criar nova conta</button>
        <button id="cloud-forgot" class="link-button" type="button">Esqueci a senha</button>
        <div id="cloud-message" class="message"></div>
      </form>
    </div>`;
  document.documentElement.appendChild(auth);

  const message = (text, ok = false) => {
    const el = document.getElementById("cloud-message");
    el.textContent = text || "";
    el.style.color = ok ? "#15803d" : "#b42318";
  };
  const setBusy = (busy) => {
    document.querySelectorAll("#cloud-auth button").forEach((b) => (b.disabled = busy));
  };
  const showApp = () => {
    auth.remove();
    style.remove();
    document.documentElement.dispatchEvent(new CustomEvent("cloud-sync-ready"));
    setTimeout(() => {
      if (document.getElementById('cloud-logout')) return;
      const button = document.createElement('button');
      button.id = 'cloud-logout';
      button.textContent = 'Sair';
      button.title = 'Sair da conta';
      Object.assign(button.style, { position: 'fixed', top: '14px', right: '16px', zIndex: '1000', border: '1px solid #dbe3ec', borderRadius: '8px', padding: '7px 13px', background: '#fff', color: '#173b63', fontWeight: '700', fontSize: '12px', cursor: 'pointer', boxShadow: '0 2px 8px rgba(15,23,42,.08)' });
      button.addEventListener('click', async () => { button.disabled = true; await client.auth.signOut(); window.location.reload(); });
      document.body.appendChild(button);
    }, 250);
  };
  const localData = () => localStorage.getItem(DATA_KEY);
  const resetRedirect = () => `${window.location.origin}${window.location.pathname}`;
  const showResetForm = () => {
    document.querySelector('#cloud-auth .box').innerHTML = `
      <img src="/LOGODASHBOARD.png" alt="Logo CONTROLE DE GASTOS">
      <h1>Nova senha</h1>
      <p>Escolha uma nova senha para acessar seus dados.</p>
      <form id="cloud-reset-form">
        <label for="cloud-new-password">Nova senha</label>
        <input id="cloud-new-password" type="password" minlength="6" autocomplete="new-password" required>
        <label for="cloud-new-password-confirm">Repita a nova senha</label>
        <input id="cloud-new-password-confirm" type="password" minlength="6" autocomplete="new-password" required>
        <button type="submit">Salvar nova senha</button>
        <div id="cloud-message" class="message"></div>
      </form>`;
    document.getElementById('cloud-reset-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      setBusy(true);
      const password = document.getElementById('cloud-new-password').value;
      const confirmation = document.getElementById('cloud-new-password-confirm').value;
      if (password !== confirmation) {
        message('As senhas não conferem.');
        setBusy(false);
        return;
      }
      try {
        const { error } = await client.auth.updateUser({ password });
        if (error) throw error;
        message('Senha alterada. Você já pode entrar.', true);
        window.history.replaceState({}, document.title, window.location.pathname);
        setTimeout(() => window.location.reload(), 900);
      } catch (error) {
        message(error?.message || 'Não foi possível alterar a senha. Solicite um novo e-mail.');
        setBusy(false);
      }
    });
  };

  const emptyState = () => ({ cartoes: [], contasFixas: [], contasAdicionais: [], ganhos: {}, descricoesGanhos: {}, categoriaCores: {} });
  const mergeState = (base, incoming) => {
    const a = base && typeof base === 'object' ? base : emptyState();
    const b = incoming && typeof incoming === 'object' ? incoming : emptyState();
    const mergeItems = (left = [], right = []) => {
      const result = left.map(item => ({ ...item, meses: { ...(item.meses || {}) } }));
      for (const item of right || []) {
        const index = result.findIndex(existing => existing.nome === item.nome);
        if (index < 0) result.push({ ...item, meses: { ...(item.meses || {}) } });
        else result[index] = { ...result[index], ...item, meses: { ...(result[index].meses || {}), ...(item.meses || {}) } };
      }
      return result;
    };
    return {
      ...a,
      ...b,
      cartoes: mergeItems(a.cartoes, b.cartoes),
      contasFixas: mergeItems(a.contasFixas, b.contasFixas),
      contasAdicionais: mergeItems(a.contasAdicionais, b.contasAdicionais),
      ganhos: { ...(a.ganhos || {}), ...(b.ganhos || {}) },
      descricoesGanhos: { ...(a.descricoesGanhos || {}), ...(b.descricoesGanhos || {}) },
      categoriaCores: { ...(a.categoriaCores || {}), ...(b.categoriaCores || {}) }
    };
  };
  const normalizeMoney = value => {
    if (typeof value === 'number') return value;
    const text = String(value ?? '').trim().replace(/R\$\s?/g, '').replace(/\s/g, '');
    if (!text) return 0;
    // Aceita a vírgula brasileira e também o ponto como separador decimal.
    // Pontos seguidos de três dígitos continuam sendo tratados como milhar.
    const normalized = text.includes(',')
      ? text.replace(/\./g, '').replace(',', '.')
      : (/^-?\d+\.\d{1,2}$/.test(text) ? text : text.replace(/\./g, ''));
    const number = Number(normalized);
    return Number.isFinite(number) ? number : 0;
  };
  const normalizeFlatState = state => {
    const result = mergeState(emptyState(), state);
    for (const collection of ['cartoes', 'contasFixas', 'contasAdicionais']) {
      result[collection] = (result[collection] || []).map(item => ({
        ...item,
        meses: Object.fromEntries(Object.entries(item.meses || {}).map(([month, value]) => [month, normalizeMoney(value)])),
        total: Object.values(item.meses || {}).reduce((sum, value) => sum + normalizeMoney(value), 0)
      }));
    }
    result.ganhos = Object.fromEntries(Object.entries(result.ganhos || {}).map(([month, value]) => [month, normalizeMoney(value)]));
    return result;
  };
  const isFlatState = state => !!state && typeof state === 'object' && (Array.isArray(state.cartoes) || Array.isArray(state.contasFixas) || Array.isArray(state.contasAdicionais) || !!state.ganhos);
  const isYearState = state => !!state && typeof state === 'object' && !isFlatState(state) && Object.keys(state).some(key => /^20\d{2}$/.test(key));
  const normalizeStoredState = state => {
    if (isFlatState(state)) return { '2026': normalizeFlatState(state) };
    const source = isYearState(state) ? state : {};
    return Object.fromEntries(Object.entries(source).filter(([year]) => /^20\d{2}$/.test(year)).map(([year, value]) => [year, normalizeFlatState(value)]));
  };
  const mergeStoredState = (base, incoming) => {
    const left = normalizeStoredState(base);
    const right = normalizeStoredState(incoming);
    const years = new Set([...Object.keys(left), ...Object.keys(right)]);
    return Object.fromEntries([...years].map(year => [year, normalizeFlatState(mergeState(left[year] || emptyState(), right[year] || emptyState()))]));
  };
  async function writeRemote() {
    if (!client || !user || saving || applyingRemote) return;
    const raw = localData();
    if (!raw) return;
    saving = true;
    try {
      const local = normalizeStoredState(JSON.parse(raw));
      const { data: existing } = await client.from(TABLE).select('data').eq('user_id', user.id).maybeSingle();
      const merged = mergeStoredState(existing?.data || {}, local);
      localStorage.setItem(DATA_KEY, JSON.stringify(merged));
      await client.from(TABLE).upsert({ user_id: user.id, data: merged, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    } finally {
      saving = false;
    }
  }
  function queueRemoteWrite() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void writeRemote(), 350);
  }

  async function syncCurrentUser() {
    const { data, error } = await client.from(TABLE).select("data").eq("user_id", user.id).maybeSingle();
    if (error) throw error;
    if (data?.data) {
      applyingRemote = true;
      const local = localData();
      const merged = mergeStoredState(data.data, local ? JSON.parse(local) : {});
      localStorage.setItem(DATA_KEY, JSON.stringify(merged));
      applyingRemote = false;
    } else if (localData()) {
      await writeRemote();
    } else {
      await client.from(TABLE).upsert({ user_id: user.id, data: {}, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    }
    client.channel(`dashboard-${user.id}`).on("postgres_changes", { event: "UPDATE", schema: "public", table: TABLE, filter: `user_id=eq.${user.id}` }, (payload) => {
      if (!payload.new?.data) return;
      applyingRemote = true;
      const local = localData();
      const merged = mergeStoredState(payload.new.data, local ? JSON.parse(local) : {});
      localStorage.setItem(DATA_KEY, JSON.stringify(merged));
      applyingRemote = false;
      document.documentElement.dispatchEvent(new CustomEvent('cloud-data-updated'));
    }).subscribe();
  }

  function installLocalStorageSync() {
    const originalSetItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = (key, value) => {
      originalSetItem(key, value);
      if (key === DATA_KEY && !applyingRemote) queueRemoteWrite();
    };
  }
  function installBrazilianMoneyInputs() {
    const format = value => {
      const number = normalizeMoney(value);
      return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(number);
    };
    const raw = value => {
      const text = String(value || '').replace(/R\$\s?/g, '').replace(/\s/g, '').trim();
      if (!text) return '';
      return text.includes(',')
        ? text.replace(/\./g, '').replace(',', '.')
        : (/^-?\d+\.\d{1,2}$/.test(text) ? text : text.replace(/\./g, ''));
    };
    const isMoney = input => input instanceof HTMLInputElement && input.type === 'number';
    document.addEventListener('focusin', event => {
      const input = event.target;
      if (!isMoney(input)) return;
      input.dataset.moneyInput = '1';
      input.type = 'text';
      input.inputMode = 'decimal';
      input.value = raw(input.value);
    }, true);
    document.addEventListener('input', event => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.dataset.moneyInput !== '1') return;
      const caret = input.selectionStart;
      const before = input.value;
      input.value = raw(before).replace(/[^0-9.-]/g, '');
      if (caret !== null) input.setSelectionRange(Math.min(caret, input.value.length), Math.min(caret, input.value.length));
    }, true);
    document.addEventListener('focusout', event => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || input.dataset.moneyInput !== '1') return;
      input.value = format(input.value);
      input.type = 'text';
    }, true);
  }

  async function loadSupabase() {
    if (window.supabase?.createClient) return;
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js";
      script.onload = resolve;
      script.onerror = () => reject(new Error("Não foi possível carregar o serviço de sincronização."));
      document.head.appendChild(script);
    });
  }

  async function start() {
    try {
      await loadSupabase();
      client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
      installLocalStorageSync();
      installBrazilianMoneyInputs();
      if (window.location.hash.includes('type=recovery')) {
        showResetForm();
        return;
      }
      const { data } = await client.auth.getSession();
      if (!data.session) return;
      user = data.session.user;
      await syncCurrentUser();
      showApp();
    } catch (error) {
      message(error?.message || "Não foi possível conectar ao serviço.");
      setBusy(false);
    }
  }

  document.getElementById("cloud-login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    setBusy(true);
    message("Entrando...", true);
    try {
      const { data, error } = await client.auth.signInWithPassword({ email: document.getElementById("cloud-email").value.trim(), password: document.getElementById("cloud-password").value });
      if (error) throw error;
      user = data.user;
      await syncCurrentUser();
      showApp();
    } catch (error) {
      message(error?.message || "E-mail ou senha incorretos.");
      setBusy(false);
    }
  });
  document.getElementById('cloud-forgot').addEventListener('click', async () => {
    const email = document.getElementById('cloud-email').value.trim();
    if (!email) {
      message('Informe seu e-mail para receber o link de recuperação.');
      return;
    }
    setBusy(true);
    message('Enviando o link de recuperação...', true);
    try {
      const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: resetRedirect() });
      if (error) throw error;
      message('Verifique seu e-mail para criar uma nova senha.', true);
    } catch (error) {
      message(error?.message || 'Não foi possível enviar o e-mail de recuperação.');
    } finally {
      setBusy(false);
    }
  });

  document.getElementById("cloud-signup").addEventListener("click", async () => {
    setBusy(true);
    message("Criando conta...", true);
    try {
      const email = document.getElementById("cloud-email").value.trim();
      const password = document.getElementById("cloud-password").value;
      if (!email || password.length < 6) throw new Error("Informe um e-mail e uma senha com pelo menos 6 caracteres.");
      const { data, error } = await client.auth.signUp({ email, password });
      if (error) throw error;
      if (!data.session) {
        message("Conta criada. Verifique o e-mail de confirmação e depois entre.", true);
        setBusy(false);
        return;
      }
      user = data.user;
      await syncCurrentUser();
      showApp();
    } catch (error) {
      message(error?.message || "Não foi possível criar a conta.");
      setBusy(false);
    }
  });

  start();
})();
