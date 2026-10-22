/* =========================================================
   Сфинксляндия — профили игроков (account.html и players.html).
   Аккаунты и профили хранятся в Supabase: адрес проекта и ключ
   вписываются в админке («Основное» → «Профили игроков»).
   Схема базы — supabase/schema.sql. Регистрация по желанию:
   играть на сервере можно и без неё.
   ========================================================= */
(function () {
  const accRoot = $("acc"), plRoot = $("players-root");
  const root = accRoot || plRoot; if (!root) return;
  const A = SITE.auth || {};
  const tiers = (SITE.donate || {}).tiers || [];
  const isRecovery = /type=recovery/.test(location.hash);
  const accountUrl = location.href.split(/[?#]/)[0].replace(/[^/]*$/, "account.html");

  /* ---------- Не настроено: показываем заглушку ---------- */
  if (!A.supabaseUrl || !A.supabaseKey || !window.supabase) {
    root.innerHTML = `<div class="acc-soon">
      <img src="img/logo.png" alt="">
      <span class="head__label caps">${accRoot ? "Профили игроков" : "Игроки"}</span>
      <h1 class="head__title">Скоро откроется</h1>
      <p class="head__sub">${accRoot
        ? "Мы готовим личные профили: свой ник, платформа, клан, привилегия и статус в игре. Регистрация будет по желанию — играть можно и без неё."
        : "Здесь появится список игроков с профилями, кланами и привилегиями."}</p>
      <div class="tile__actions" style="justify-content:center"><a class="btn btn--primary" href="guide.html">Как начать играть <span class="arr">→</span></a><a class="btn btn--dark" href="index.html">На главную</a></div>
    </div>`;
    return;
  }

  const sb = window.supabase.createClient(A.supabaseUrl, A.supabaseKey);

  /* ---------- Общие помощники ---------- */
  const NICK_RE = /^[A-Za-z0-9_](?:[A-Za-z0-9_ ]{1,14})[A-Za-z0-9_]$/;
  const PUBLIC_COLS = "nickname,platform,bio,clan,discord,rank,verified,created_at,stats,last_seen";
  const platformName = p => p === "bedrock" ? "Bedrock" : "Java";
  const findTier = r => r ? tiers.find(t => [t.id, t.name].some(x => String(x || "").toLowerCase() === String(r).toLowerCase())) : null;
  const rankChip = r => { const t = findTier(r); return r ? `<span class="chip chip--rank" style="--c:${esc(t ? t.color : "#ffc83a")}">${esc(t ? t.name : r)}</span>` : ""; };
  const likeEsc = s => s.replace(/[\\%_]/g, "\\$&");
  const errText = e => {
    const m = String(e && (e.message || e.error_description) || e || "");
    if (/Invalid login credentials/i.test(m)) return "Неверная почта или пароль.";
    if (/Email not confirmed/i.test(m)) return "Почта не подтверждена — открой письмо и нажми ссылку.";
    if (/already registered/i.test(m)) return "Эта почта уже зарегистрирована. Попробуй войти.";
    if (/rate limit|too many|seconds/i.test(m)) return "Слишком много попыток. Подожди минуту и попробуй снова.";
    if (/Password should be/i.test(m)) return "Пароль слишком простой: минимум 8 символов.";
    if (/duplicate key|23505/i.test(m) || (e && e.code === "23505")) return "Этот ник уже занят другим игроком.";
    if (/check constraint|23514/i.test(m) || (e && e.code === "23514")) return "Проверь поля: ник 3–16 символов (латиница, цифры, _), описание до 300 символов.";
    if (/Failed to fetch|NetworkError/i.test(m)) return "Нет связи с сервером профилей. Проверь интернет.";
    return "Ошибка: " + m;
  };
  async function onlineNames() {
    try { const d = await getStatus(); return new Set((d.players?.list || []).map(p => String(p.name || p).toLowerCase())); }
    catch { return new Set(); }
  }

  /* Статистика с игрового сервера (заполняется плагином в поле stats) */
  const STAT_NAMES = {
    playtime: ["Наиграно", v => `${Math.floor(v / 60)} ч ${v % 60} мин`],
    joins: ["Заходов", v => v],
    deaths: ["Смертей", v => v],
    mob_kills: ["Убито мобов", v => v],
    player_kills: ["Побед в PvP", v => v],
    blocks_mined: ["Добыто блоков", v => Number(v).toLocaleString("ru-RU")],
    blocks_placed: ["Поставлено блоков", v => Number(v).toLocaleString("ru-RU")],
    distance: ["Пройдено", v => `${Number(v).toLocaleString("ru-RU")} блоков`],
  };
  function statsBlock(p, own) {
    const st = p.stats && typeof p.stats === "object" ? Object.entries(p.stats).filter(([, v]) => v != null && v !== "") : [];
    const last = p.last_seen ? `<p class="muted small">Последний раз в игре: ${fmtDate(p.last_seen)}</p>` : "";
    if (!st.length) return `<div class="card-box"><h3>Статистика с сервера</h3>
      <p class="muted">${own ? "Здесь появятся твои часы в игре, добытые блоки и другие цифры, когда мы подключим сервер к сайту." : "Статистика пока не собрана."}</p>${last}</div>`;
    return `<div class="card-box"><h3>Статистика с сервера</h3><div class="stats">${st.map(([k, v]) => {
      const [name, f] = STAT_NAMES[k] || [k, x => x];
      return `<div><b>${esc(f(v))}</b><span class="caps">${esc(name)}</span></div>`;
    }).join("")}</div>${last}</div>`;
  }

  function profileCard(p, online, own) {
    return `<div class="pcard pcard--big">
      <div class="pcard__top">
        <img class="pcard__ava" src="${head(p.nickname, 96)}" alt="">
        <div>
          <div class="pcard__nick">${esc(p.nickname)}</div>
          <div class="pcard__meta">${rankChip(p.rank)}<span class="chip">${platformName(p.platform)}</span>${p.verified ? `<span class="chip chip--ok" title="Ник подтверждён на сервере">✓ подтверждён</span>` : ""}</div>
        </div>
      </div>
      ${p.bio ? `<p class="pcard__bio">${fmt(p.bio)}</p>` : own ? `<p class="pcard__bio muted">Расскажи о себе — заполни поле «О себе» в настройках.</p>` : ""}
      <div class="pcard__grid">
        <div><b>Клан</b><span>${esc(p.clan || "—")}</span></div>
        <div><b>Discord</b><span>${esc(p.discord || "—")}</span></div>
        <div><b>На сайте</b><span>с ${fmtDate(p.created_at)}</span></div>
        <div><b>Статус</b><span>${online ? `<i class="dot on"></i> в игре` : `<i class="dot"></i> не в сети`}</span></div>
      </div>
    </div>`;
  }

  /* =========================================================
     ЛИЧНЫЙ КАБИНЕТ
     ========================================================= */
  if (accRoot) {
    let recovery = isRecovery;
    sb.auth.onAuthStateChange(ev => { if (ev === "PASSWORD_RECOVERY" && !recovery) { recovery = true; viewNewPassword(); } });

    const msg = (id, text, ok) => { const m = $(id); if (m) { m.textContent = text || ""; m.classList.toggle("ok", !!ok); } };
    const lock = (form, on) => form.querySelectorAll("button, input, textarea, select").forEach(x => x.disabled = on);

    async function boot() {
      const { data: { session } } = await sb.auth.getSession();
      if (recovery && session) return viewNewPassword();
      if (!session) { try { localStorage.removeItem("sl-nick"); } catch {} return viewAuth("login"); }
      const { data: prof, error } = await sb.from("profiles").select("*").eq("id", session.user.id).maybeSingle();
      if (error) { accRoot.innerHTML = `<div class="acc-soon"><h1 class="head__title">Не удалось загрузить профиль</h1><p class="head__sub">${esc(errText(error))}</p></div>`; return; }
      if (!prof) return viewCreate(session.user);
      try { localStorage.setItem("sl-nick", prof.nickname); } catch {}
      viewDashboard(session.user, prof);
    }

    /* ---------- Вход / регистрация ---------- */
    function viewAuth(tab) {
      accRoot.innerHTML = `<div class="auth">
        <div class="auth__intro">
          <span class="head__label caps">Профиль игрока · по желанию</span>
          <h1 class="head__title">Твой профиль<br><span class="grad-text">на сайте</span></h1>
          <p class="head__sub">Регистрация не нужна, чтобы играть. Она нужна, чтобы у тебя было своё место на сайте.</p>
          <ul class="ticks">
            <li>Ник, скин, платформа и клан на одной странице</li>
            <li>Привилегия, дата регистрации и статус «в игре»</li>
            <li>Рассказ о себе и Discord, чтобы тебя нашли тиммейты</li>
            <li>Статистика с сервера — скоро</li>
          </ul>
        </div>
        <div class="auth__card">
          <div class="seg">
            <button type="button" data-tab="login" class="${tab === "login" ? "active" : ""}">Вход</button>
            <button type="button" data-tab="signup" class="${tab === "signup" ? "active" : ""}">Регистрация</button>
          </div>
          ${tab === "login" ? `
          <form id="f-login" class="form">
            <label class="field"><span class="field__label">Почта</span><input class="input" type="email" name="email" autocomplete="email" required></label>
            <label class="field"><span class="field__label">Пароль</span><input class="input" type="password" name="password" autocomplete="current-password" required></label>
            <button class="btn btn--primary btn--block">Войти <span class="arr">→</span></button>
            <p class="form__msg" id="m-login"></p>
            <button type="button" class="linkbtn" id="forgot">Забыли пароль?</button>
          </form>` : tab === "signup" ? `
          <form id="f-signup" class="form">
            <label class="field"><span class="field__label">Игровой ник</span><input class="input" name="nickname" maxlength="16" placeholder="Steve_2026" required>
              <span class="field__hint">Тот, под которым ты играешь на сервере.</span></label>
            <div class="field"><span class="field__label">Платформа</span>
              <div class="radio-row"><label><input type="radio" name="platform" value="java" checked> Java (ПК)</label><label><input type="radio" name="platform" value="bedrock"> Bedrock (телефон, консоль)</label></div></div>
            <label class="field"><span class="field__label">Почта</span><input class="input" type="email" name="email" autocomplete="email" required></label>
            <label class="field"><span class="field__label">Пароль</span><input class="input" type="password" name="password" minlength="8" autocomplete="new-password" required>
              <span class="field__hint">Минимум 8 символов. Не используй пароль от Minecraft или почты.</span></label>
            <label class="check"><input type="checkbox" name="agree" required><span>Я прочитал <a href="rules.html" target="_blank">правила сервера</a> и регистрирую профиль на свой ник</span></label>
            <button class="btn btn--primary btn--block">Создать профиль <span class="arr">→</span></button>
            <p class="form__msg" id="m-signup"></p>
          </form>` : `
          <form id="f-forgot" class="form">
            <p class="muted">Введи почту — пришлём ссылку для нового пароля.</p>
            <label class="field"><span class="field__label">Почта</span><input class="input" type="email" name="email" autocomplete="email" required></label>
            <button class="btn btn--primary btn--block">Отправить ссылку</button>
            <p class="form__msg" id="m-forgot"></p>
            <button type="button" class="linkbtn" data-tab="login">← Назад ко входу</button>
          </form>`}
        </div>
      </div>`;
      accRoot.querySelectorAll("[data-tab]").forEach(b => b.addEventListener("click", () => viewAuth(b.dataset.tab)));
      $("forgot")?.addEventListener("click", () => viewAuth("forgot"));

      $("f-login")?.addEventListener("submit", async e => {
        e.preventDefault(); const f = e.target; lock(f, true); msg("m-login", "");
        const { error } = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
        lock(f, false);
        if (error) return msg("m-login", errText(error));
        boot();
      });

      $("f-signup")?.addEventListener("submit", async e => {
        e.preventDefault(); const f = e.target; msg("m-signup", "");
        const nickname = f.nickname.value.trim(), platform = f.platform.value;
        if (!NICK_RE.test(nickname)) return msg("m-signup", "Ник: 3–16 символов, латиница, цифры и _ (для Bedrock можно пробел внутри).");
        lock(f, true);
        try {
          const { data: free, error: e1 } = await sb.rpc("nickname_available", { n: nickname });
          if (e1) throw e1;
          if (!free) { lock(f, false); return msg("m-signup", "Этот ник уже занят. Если это твой ник — напиши администрации в Discord."); }
          const { data, error } = await sb.auth.signUp({ email: f.email.value.trim(), password: f.password.value,
            options: { data: { nickname, platform }, emailRedirectTo: accountUrl } });
          if (error) throw error;
          if (data.session) return boot();
          accRoot.querySelector(".auth__card").innerHTML = `<div class="done">
            <h2>Проверь почту</h2>
            <p class="muted">Мы отправили письмо на <b>${esc(f.email.value.trim())}</b>. Нажми ссылку в нём — и профиль <b>${esc(nickname)}</b> будет готов.</p>
            <p class="muted small">Письма нет? Загляни в «Спам» или подожди пару минут.</p></div>`;
        } catch (err) { lock(f, false); msg("m-signup", errText(err)); }
      });

      $("f-forgot")?.addEventListener("submit", async e => {
        e.preventDefault(); const f = e.target; lock(f, true);
        const { error } = await sb.auth.resetPasswordForEmail(f.email.value.trim(), { redirectTo: accountUrl });
        lock(f, false);
        error ? msg("m-forgot", errText(error)) : msg("m-forgot", "Готово! Проверь почту и перейди по ссылке.", true);
      });
    }

    /* ---------- Новый пароль (по ссылке из письма) ---------- */
    function viewNewPassword() {
      accRoot.innerHTML = `<div class="auth auth--single"><div class="auth__card">
        <h2>Новый пароль</h2>
        <form id="f-newpass" class="form">
          <label class="field"><span class="field__label">Пароль</span><input class="input" type="password" name="password" minlength="8" autocomplete="new-password" required></label>
          <button class="btn btn--primary btn--block">Сохранить</button>
          <p class="form__msg" id="m-newpass"></p>
        </form></div></div>`;
      $("f-newpass").addEventListener("submit", async e => {
        e.preventDefault(); const f = e.target; lock(f, true);
        const { error } = await sb.auth.updateUser({ password: f.password.value });
        lock(f, false);
        if (error) return msg("m-newpass", errText(error));
        recovery = false; history.replaceState(null, "", location.pathname); toast("Пароль обновлён"); boot();
      });
    }

    /* ---------- Создание профиля (после подтверждения почты) ---------- */
    function viewCreate(user) {
      const md = user.user_metadata || {};
      accRoot.innerHTML = `<div class="auth auth--single"><div class="auth__card">
        <span class="head__label caps">Последний шаг</span>
        <h2>Создай профиль</h2>
        <form id="f-create" class="form">
          <label class="field"><span class="field__label">Игровой ник</span><input class="input" name="nickname" maxlength="16" value="${esc(md.nickname || "")}" required></label>
          <div class="field"><span class="field__label">Платформа</span>
            <div class="radio-row"><label><input type="radio" name="platform" value="java" ${md.platform !== "bedrock" ? "checked" : ""}> Java</label><label><input type="radio" name="platform" value="bedrock" ${md.platform === "bedrock" ? "checked" : ""}> Bedrock</label></div></div>
          <button class="btn btn--primary btn--block">Готово <span class="arr">→</span></button>
          <p class="form__msg" id="m-create"></p>
          <button type="button" class="linkbtn" id="logout">Выйти</button>
        </form></div></div>`;
      $("logout").addEventListener("click", logout);
      $("f-create").addEventListener("submit", async e => {
        e.preventDefault(); const f = e.target; const nickname = f.nickname.value.trim();
        if (!NICK_RE.test(nickname)) return msg("m-create", "Ник: 3–16 символов, латиница, цифры и _.");
        lock(f, true);
        const { error } = await sb.from("profiles").insert({ id: user.id, nickname, platform: f.platform.value });
        lock(f, false);
        if (error) return msg("m-create", errText(error));
        toast("Профиль создан!"); boot();
      });
    }

    /* ---------- Кабинет ---------- */
    async function viewDashboard(user, p) {
      const online = (await onlineNames()).has(p.nickname.toLowerCase());
      const tier = findTier(p.rank);
      accRoot.innerHTML = `
        <div class="dash-head">
          <div><span class="head__label caps">Мой профиль</span><h1 class="head__title">Привет, ${esc(p.nickname)}!</h1></div>
          <div class="tile__actions" style="margin-top:0">
            ${p.public ? `<a class="btn btn--dark" href="players.html?nick=${encodeURIComponent(p.nickname)}">Публичная страница</a>` : ""}
            <button class="btn btn--dark" id="logout">Выйти</button>
          </div>
        </div>
        <div class="dash">
          <div class="dash__col">
            ${profileCard(p, online, true)}
            ${p.public ? "" : `<p class="note">Профиль скрыт: его видишь только ты. Включить показ можно в настройках.</p>`}
            ${statsBlock(p, true)}
            <div class="card-box"><h3>Привилегия</h3>
              ${tier ? `<p>У тебя <b style="color:${esc(tier.color)}">${esc(tier.name)}</b>. Спасибо, что поддерживаешь сервер!</p><ul class="ticks">${(tier.perks || []).map(x => `<li>${esc(x)}</li>`).join("")}</ul>`
                : `<p class="muted">Привилегии нет. Она косметическая и помогает серверу жить.</p><a class="btn btn--ghost" href="donate.html" style="margin-top:14px">Посмотреть привилегии <span class="arr">→</span></a>`}
            </div>
          </div>
          <div class="dash__col">
            <form class="card-box form" id="f-profile">
              <h3>Настройки профиля</h3>
              <div class="grid-2">
                <label class="field"><span class="field__label">Ник</span><input class="input" name="nickname" maxlength="16" value="${esc(p.nickname)}" required></label>
                <label class="field"><span class="field__label">Платформа</span><select class="input" name="platform"><option value="java">Java</option><option value="bedrock" ${p.platform === "bedrock" ? "selected" : ""}>Bedrock</option></select></label>
              </div>
              <div class="grid-2">
                <label class="field"><span class="field__label">Клан</span><input class="input" name="clan" maxlength="32" value="${esc(p.clan || "")}" placeholder="Пески Ра"></label>
                <label class="field"><span class="field__label">Discord</span><input class="input" name="discord" maxlength="40" value="${esc(p.discord || "")}" placeholder="nick"></label>
              </div>
              <label class="field"><span class="field__label">О себе</span><textarea class="input" name="bio" rows="4" maxlength="300" placeholder="Что строишь, чем занимаешься, кого ищешь">${esc(p.bio || "")}</textarea></label>
              <label class="check"><input type="checkbox" name="public" ${p.public ? "checked" : ""}><span>Показывать мой профиль в списке игроков</span></label>
              <button class="btn btn--primary">Сохранить</button>
              <p class="form__msg" id="m-profile"></p>
            </form>
            <form class="card-box form" id="f-pass">
              <h3>Аккаунт</h3>
              <p class="muted">Почта: <b>${esc(user.email)}</b></p>
              <label class="field"><span class="field__label">Новый пароль</span><input class="input" type="password" name="password" minlength="8" autocomplete="new-password" required></label>
              <button class="btn btn--dark">Сменить пароль</button>
              <p class="form__msg" id="m-pass"></p>
            </form>
            <div class="card-box danger-box">
              <h3>Удалить профиль</h3>
              <p class="muted">Профиль и аккаунт удалятся навсегда. На игру на сервере это не влияет.</p>
              <button class="btn btn--dark" id="delete">Удалить</button>
            </div>
          </div>
        </div>`;

      $("logout").addEventListener("click", logout);
      $("f-profile").addEventListener("submit", async e => {
        e.preventDefault(); const f = e.target; msg("m-profile", "");
        const upd = { nickname: f.nickname.value.trim(), platform: f.platform.value, clan: f.clan.value.trim() || null,
          discord: f.discord.value.trim() || null, bio: f.bio.value.trim() || null, public: f.public.checked };
        if (!NICK_RE.test(upd.nickname)) return msg("m-profile", "Ник: 3–16 символов, латиница, цифры и _.");
        lock(f, true);
        const { data, error } = await sb.from("profiles").update(upd).eq("id", user.id).select("*").single();
        lock(f, false);
        if (error) return msg("m-profile", errText(error));
        try { localStorage.setItem("sl-nick", data.nickname); } catch {}
        toast("Профиль сохранён"); viewDashboard(user, data);
      });
      $("f-pass").addEventListener("submit", async e => {
        e.preventDefault(); const f = e.target; lock(f, true);
        const { error } = await sb.auth.updateUser({ password: f.password.value });
        lock(f, false);
        if (error) return msg("m-pass", errText(error));
        f.reset(); msg("m-pass", "Пароль изменён.", true);
      });
      $("delete").addEventListener("click", async () => {
        const typed = prompt(`Чтобы удалить профиль навсегда, введи свой ник: ${p.nickname}`);
        if (typed == null) return;
        if (typed.trim() !== p.nickname) return toast("Ник не совпадает — профиль не удалён");
        const { error } = await sb.rpc("delete_me");
        if (error) return toast(errText(error));
        await logout(); toast("Профиль удалён");
      });
    }

    async function logout() {
      await sb.auth.signOut();
      try { localStorage.removeItem("sl-nick"); } catch {}
      boot();
    }

    boot();
  }

  /* =========================================================
     СПИСОК ИГРОКОВ И ПУБЛИЧНЫЙ ПРОФИЛЬ
     ========================================================= */
  if (plRoot) {
    const nick = new URLSearchParams(location.search).get("nick");
    nick ? viewPlayer(nick) : viewList();

    async function viewPlayer(n) {
      const [{ data: p, error }, online] = await Promise.all([
        sb.from("profiles").select(PUBLIC_COLS).ilike("nickname", likeEsc(n)).maybeSingle(),
        onlineNames()]);
      document.title = `${p ? p.nickname : n} — Игроки Сфинксляндии`;
      if (error || !p) {
        plRoot.innerHTML = `<div class="acc-soon">
          <img src="${head(n, 96)}" alt="" style="width:96px;image-rendering:pixelated">
          <h1 class="head__title">${esc(n)}</h1>
          <p class="head__sub">${error ? esc(errText(error)) : online.has(n.toLowerCase())
            ? "Этот игрок сейчас на сервере, но профиля на сайте у него нет."
            : "Профиль не найден: игрок не регистрировался на сайте или скрыл профиль."}</p>
          <div class="tile__actions" style="justify-content:center"><a class="btn btn--dark" href="players.html">← Все игроки</a></div></div>`;
        return;
      }
      plRoot.innerHTML = `
        <a class="back caps" href="players.html">← Все игроки</a>
        <div class="dash">
          <div class="dash__col">${profileCard(p, online.has(p.nickname.toLowerCase()), false)}</div>
          <div class="dash__col">
            <div class="card-box skin"><img src="https://mc-heads.net/body/${encodeURIComponent(p.nickname)}/180" alt="Скин ${esc(p.nickname)}" loading="lazy"></div>
            ${statsBlock(p, false)}
          </div>
        </div>`;
    }

    async function viewList() {
      const [{ data, error }, online] = await Promise.all([
        sb.from("profiles").select(PUBLIC_COLS).order("created_at", { ascending: false }).limit(1000),
        onlineNames()]);
      if (error) { plRoot.innerHTML = `<div class="acc-soon"><h1 class="head__title">Не удалось загрузить</h1><p class="head__sub">${esc(errText(error))}</p></div>`; return; }
      const all = (data || []).map(p => ({ ...p, on: online.has(p.nickname.toLowerCase()) }));
      let filter = "all", q = "";
      plRoot.innerHTML = `
        <div class="dash-head">
          <div><span class="head__label caps">Сообщество</span><h1 class="head__title">Игроки Сфинксляндии</h1>
            <p class="head__sub">${all.length} ${plural(all.length, "профиль", "профиля", "профилей")} · сейчас в игре: ${all.filter(p => p.on).length}</p></div>
          <a class="btn btn--primary" href="account.html">Мой профиль <span class="arr">→</span></a>
        </div>
        <div class="pl-tools">
          <input class="input" id="pl-q" placeholder="Поиск по нику или клану" autocomplete="off">
          <div class="seg seg--inline" id="pl-f">
            <button data-f="all" class="active">Все</button><button data-f="online">В игре</button><button data-f="java">Java</button><button data-f="bedrock">Bedrock</button><button data-f="rank">Спонсоры</button>
          </div>
        </div>
        <div class="pl-grid" id="pl-grid"></div>`;
      const draw = () => {
        const s = q.toLowerCase();
        const list = all.filter(p =>
          (filter === "all" || (filter === "online" && p.on) || (filter === "rank" && p.rank) || p.platform === filter) &&
          (!s || p.nickname.toLowerCase().includes(s) || String(p.clan || "").toLowerCase().includes(s)));
        $("pl-grid").innerHTML = list.length ? list.map(p => `
          <a class="pl-card" href="players.html?nick=${encodeURIComponent(p.nickname)}">
            <img src="${head(p.nickname, 48)}" alt="" loading="lazy">
            <div><b>${p.on ? `<i class="dot on"></i>` : ""}${esc(p.nickname)}</b>
              <span>${rankChip(p.rank)}<span class="chip">${platformName(p.platform)}</span>${p.clan ? `<span class="muted small">${esc(p.clan)}</span>` : ""}</span></div>
          </a>`).join("")
          : `<p class="players-empty">${all.length ? "Никого не нашли. Попробуй другой запрос." : "Пока никто не создал профиль. Стань первым!"}</p>`;
      };
      $("pl-q").addEventListener("input", e => { q = e.target.value.trim(); draw(); });
      $("pl-f").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return;
        filter = b.dataset.f; $$("#pl-f button").forEach(x => x.classList.toggle("active", x === b)); draw(); });
      draw();
    }
    function plural(n, one, few, many) { const m10 = n % 10, m100 = n % 100;
      return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many; }
  }
})();
