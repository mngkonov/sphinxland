/* =========================================================
   Сфинксляндия — профили игроков и кланы
   (account.html, players.html, clans.html).
   Аккаунты, профили и кланы хранятся в Supabase: адрес проекта и ключ
   вписываются в админке («Основное» → «Профили игроков»).
   Схема базы — supabase/schema.sql. Регистрация по желанию:
   играть на сервере можно и без неё.
   ========================================================= */
(function () {
  const accRoot = $("acc"), plRoot = $("players-root"), clRoot = $("clans-root");
  const root = accRoot || plRoot || clRoot; if (!root) return;
  const A = SITE.auth || {};
  const tiers = (SITE.donate || {}).tiers || [];
  const isRecovery = /type=recovery/.test(location.hash);
  const accountUrl = location.href.split(/[?#]/)[0].replace(/[^/]*$/, "account.html");

  /* ---------- Не настроено: показываем заглушку ---------- */
  if (!A.supabaseUrl || !A.supabaseKey || !window.supabase) {
    root.innerHTML = `<div class="acc-soon">
      <img src="img/logo.png" alt="">
      <span class="head__label caps">${accRoot ? "Профили игроков" : clRoot ? "Кланы" : "Игроки"}</span>
      <h1 class="head__title">Скоро откроется</h1>
      <p class="head__sub">${accRoot
        ? "Мы готовим личные профили: свой ник, платформа, клан, привилегия и статус в игре. Регистрация будет по желанию — играть можно и без неё."
        : clRoot ? "Здесь можно будет создать свой клан с флагом и тегом или вступить в чужой."
        : "Здесь появится список игроков с профилями, кланами и привилегиями."}</p>
      <div class="tile__actions" style="justify-content:center"><a class="btn btn--primary" href="guide.html">Как начать играть <span class="arr">→</span></a><a class="btn btn--dark" href="index.html">На главную</a></div>
    </div>`;
    return;
  }

  /* Адрес проекта без хвостов вроде /rest/v1/ — их часто копируют вместе с URL */
  const sbUrl = String(A.supabaseUrl).trim().replace(/\/(rest|auth)\/v1.*$/, "").replace(/\/+$/, "");
  const sb = window.supabase.createClient(sbUrl, String(A.supabaseKey).trim());

  /* ---------- Общие помощники ---------- */
  const NICK_RE = /^[A-Za-z0-9_](?:[A-Za-z0-9_ ]{1,14})[A-Za-z0-9_]$/;
  const CLAN_EMBED = "clans(id,name,tag,flag)";
  const PUBLIC_COLS = `nickname,platform,bio,discord,rank,verified,created_at,stats,last_seen,clan_role,${CLAN_EMBED}`;
  const ROLE_NAMES = { owner: "Владелец", officer: "Офицер", member: "Участник" };

  /* ---------- Пиксельный флаг клана: 8×12 клеток, цвета — 16 красителей Minecraft ---------- */
  const FW = 8, FH = 12;
  const DYES = ["#f9fffe", "#9d9d97", "#474f52", "#1d1d21", "#835432", "#b02e26", "#f9801d", "#fed83d",
    "#80c71f", "#5e7c16", "#169c9c", "#3ab3da", "#3c44aa", "#8932b8", "#c74ebd", "#f38baa"];
  const DYE_NAMES = ["Белый", "Светло-серый", "Серый", "Чёрный", "Коричневый", "Красный", "Оранжевый", "Жёлтый",
    "Лаймовый", "Зелёный", "Бирюзовый", "Голубой", "Синий", "Фиолетовый", "Пурпурный", "Розовый"];
  const DEFAULT_FLAG = "7".repeat(FW * 8) + "3".repeat(FW) + "6".repeat(FW * 3);
  const validFlag = f => /^[0-9a-f]{96}$/.test(f || "") ? f : DEFAULT_FLAG;
  /* SVG флага: соседние клетки одного цвета склеиваются в полосы — меньше элементов */
  function flagSvg(f, cls = "") {
    f = validFlag(f); let r = "";
    for (let y = 0; y < FH; y++) for (let x = 0; x < FW;) {
      const c = f[y * FW + x]; let w = 1;
      while (x + w < FW && f[y * FW + x + w] === c) w++;
      r += `<rect x="${x}" y="${y}" width="${w}" height="1" fill="${DYES[parseInt(c, 16)]}"/>`; x += w;
    }
    return `<svg class="flag ${cls}" viewBox="0 0 ${FW} ${FH}" shape-rendering="crispEdges" aria-hidden="true">${r}</svg>`;
  }
  const clanUrl = c => `clans.html?tag=${encodeURIComponent(c.tag)}`;
  const clanChip = c => c ? `<a class="chip chip--clan" href="${clanUrl(c)}">${flagSvg(c.flag, "flag--xs")}${esc(c.tag)}</a>` : "";
  const platformName = p => p === "bedrock" ? "Bedrock" : "Java";
  const findTier = r => r ? tiers.find(t => [t.id, t.name].some(x => String(x || "").toLowerCase() === String(r).toLowerCase())) : null;
  const rankChip = r => { const t = findTier(r); return r ? `<span class="chip chip--rank" style="--c:${esc(t ? t.color : "#ffc83a")}">${esc(t ? t.name : r)}</span>` : ""; };
  const likeEsc = s => s.replace(/[\\%_]/g, "\\$&");
  function plural(n, one, few, many) { const m10 = n % 10, m100 = n % 100;
    return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many; }
  const errText = e => {
    const m = String(e && (e.message || e.error_description) || e || "");
    if (/Invalid login credentials/i.test(m)) return "Неверная почта или пароль.";
    if (/Email not confirmed/i.test(m)) return "Почта не подтверждена — открой письмо и нажми ссылку.";
    if (/already registered/i.test(m)) return "Эта почта уже зарегистрирована. Попробуй войти.";
    if (/rate limit|too many|seconds/i.test(m)) return "Слишком много попыток. Подожди минуту и попробуй снова.";
    if (/Password should be/i.test(m)) return "Пароль слишком простой: минимум 8 символов.";
    if (/clans_name_key/.test(m)) return "Клан с таким названием уже есть.";
    if (/clans_tag_key/.test(m)) return "Этот тег уже занят другим кланом.";
    if (/clans_tag_check/.test(m)) return "Тег — ровно 4 буквы или цифры.";
    if (/clans_name_check/.test(m)) return "Название клана — от 3 до 24 символов.";
    if (/clans_description_check/.test(m)) return "Описание клана — до 600 символов.";
    if (/duplicate key|23505/i.test(m) || (e && e.code === "23505")) return "Этот ник уже занят другим игроком.";
    if (/check constraint|23514/i.test(m) || (e && e.code === "23514")) return "Проверь поля: ник 3–16 символов (латиница, цифры, _), описание до 300 символов.";
    if (e && e.code === "P0001") return m; /* понятные сообщения из функций базы */
    if (/clan_id|clan_role|clan_member_list|create_clan|schema cache/i.test(m)) return "Кланы ещё не подключены в базе: администратору нужно заново запустить supabase/schema.sql.";
    if (/Failed to fetch|NetworkError/i.test(m)) return "Нет связи с сервером профилей. Проверь интернет.";
    return "Ошибка: " + m;
  };
  /* Свой профиль вместе с кланом. Если кланы ещё не подключены в базе — без клана */
  async function loadMe(uid) {
    const r = await sb.from("profiles").select(`*,${CLAN_EMBED}`).eq("id", uid).maybeSingle();
    if (r.error && /relationship|schema cache|clan/i.test(r.error.message)) return sb.from("profiles").select("*").eq("id", uid).maybeSingle();
    return r;
  }
  /* Запрос профилей с кланом; пока кланы не подключены в базе — без них */
  async function withFallback(mk) {
    const r = await mk(PUBLIC_COLS);
    if (r.error && /relationship|schema cache|clan/i.test(r.error.message)) return mk("nickname,platform,bio,discord,rank,verified,created_at,stats,last_seen");
    return r;
  }
  async function currentUser() {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return { user: null, me: null };
    const { data } = await loadMe(session.user.id);
    return { user: session.user, me: data || null };
  }
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
        <div><b>Клан</b><span>${p.clans ? `<a class="clan-link" href="${clanUrl(p.clans)}">${flagSvg(p.clans.flag, "flag--xs")}[${esc(p.clans.tag)}] ${esc(p.clans.name)}</a>` : "—"}</span></div>
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
      const { data: prof, error } = await loadMe(session.user.id);
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
            <div class="card-box" id="my-clan"><h3>Мой клан</h3>
              ${p.clans ? `<a class="clan-row" href="${clanUrl(p.clans)}">${flagSvg(p.clans.flag, "flag--sm")}
                  <span><b>[${esc(p.clans.tag)}] ${esc(p.clans.name)}</b><span class="muted small">${ROLE_NAMES[p.clan_role] || ""}</span></span><span class="arr">→</span></a>`
                : `<p class="muted">Ты пока не в клане. Найди команду или собери свою — с флагом и тегом.</p>
                  <div id="my-requests"></div>
                  <div class="tile__actions"><a class="btn btn--primary" href="clans.html">Найти клан</a><a class="btn btn--ghost" href="clans.html?new">Создать клан</a></div>`}
            </div>
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
              <label class="field"><span class="field__label">Discord</span><input class="input" name="discord" maxlength="40" value="${esc(p.discord || "")}" placeholder="nick"></label>
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
      /* Мои заявки в кланы (если я пока не в клане) */
      if (!p.clans && $("my-requests")) {
        const { data: reqs } = await sb.from("clan_requests").select(`clan_id,created_at,${CLAN_EMBED}`).eq("user_id", user.id);
        if (reqs && reqs.length) {
          $("my-requests").innerHTML = `<div class="field__label" style="margin-top:16px">Мои заявки</div>` + reqs.map(r => `
            <div class="clan-row clan-row--req">${flagSvg(r.clans?.flag, "flag--sm")}
              <span><a href="${clanUrl(r.clans || {})}"><b>[${esc(r.clans?.tag)}] ${esc(r.clans?.name)}</b></a><span class="muted small">ждёт ответа с ${fmtDate(r.created_at)}</span></span>
              <button class="btn btn--dark btn--sm" data-cancel="${esc(r.clan_id)}">Отозвать</button></div>`).join("");
          $("my-requests").addEventListener("click", async e => {
            const b = e.target.closest("[data-cancel]"); if (!b) return;
            b.disabled = true;
            const { error } = await sb.rpc("cancel_clan_request", { p_clan: b.dataset.cancel });
            if (error) { b.disabled = false; return toast(errText(error)); }
            b.closest(".clan-row").remove(); toast("Заявка отозвана");
          });
        }
      }
      $("f-profile").addEventListener("submit", async e => {
        e.preventDefault(); const f = e.target; msg("m-profile", "");
        const upd = { nickname: f.nickname.value.trim(), platform: f.platform.value,
          discord: f.discord.value.trim() || null, bio: f.bio.value.trim() || null, public: f.public.checked };
        if (!NICK_RE.test(upd.nickname)) return msg("m-profile", "Ник: 3–16 символов, латиница, цифры и _.");
        lock(f, true);
        const { error: e1 } = await sb.from("profiles").update(upd).eq("id", user.id);
        const { data, error } = e1 ? { error: e1 } : await loadMe(user.id);
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
        withFallback(cols => sb.from("profiles").select(cols).ilike("nickname", likeEsc(n)).maybeSingle()),
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
        withFallback(cols => sb.from("profiles").select(cols).order("created_at", { ascending: false }).limit(1000)),
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
          <input class="input" id="pl-q" placeholder="Поиск по нику, клану или тегу" autocomplete="off">
          <div class="seg seg--inline" id="pl-f">
            <button data-f="all" class="active">Все</button><button data-f="online">В игре</button><button data-f="java">Java</button><button data-f="bedrock">Bedrock</button><button data-f="rank">Спонсоры</button>
          </div>
        </div>
        <div class="pl-grid" id="pl-grid"></div>`;
      const draw = () => {
        const s = q.toLowerCase();
        const list = all.filter(p =>
          (filter === "all" || (filter === "online" && p.on) || (filter === "rank" && p.rank) || p.platform === filter) &&
          (!s || p.nickname.toLowerCase().includes(s) || (p.clans && (p.clans.name.toLowerCase().includes(s) || p.clans.tag.toLowerCase().includes(s)))));
        $("pl-grid").innerHTML = list.length ? list.map(p => `
          <a class="pl-card" href="players.html?nick=${encodeURIComponent(p.nickname)}">
            <img src="${head(p.nickname, 48)}" alt="" loading="lazy">
            <div><b>${p.on ? `<i class="dot on"></i>` : ""}${esc(p.nickname)}</b>
              <span>${p.clans ? `<span class="chip chip--clan">${flagSvg(p.clans.flag, "flag--xs")}${esc(p.clans.tag)}</span>` : ""}${rankChip(p.rank)}<span class="chip">${platformName(p.platform)}</span></span></div>
          </a>`).join("")
          : `<p class="players-empty">${all.length ? "Никого не нашли. Попробуй другой запрос." : "Пока никто не создал профиль. Стань первым!"}</p>`;
      };
      $("pl-q").addEventListener("input", e => { q = e.target.value.trim(); draw(); });
      $("pl-f").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return;
        filter = b.dataset.f; $$("#pl-f button").forEach(x => x.classList.toggle("active", x === b)); draw(); });
      draw();
    }
  }

  /* =========================================================
     КЛАНЫ: список, страница клана, создание
     clans.html · clans.html?tag=ABCD · clans.html?new
     ========================================================= */
  if (clRoot) {
    const qs = new URLSearchParams(location.search);
    const backLink = `<a class="back caps" href="clans.html">← Все кланы</a>`;
    const fail = e => { clRoot.innerHTML = `<div class="acc-soon"><h1 class="head__title">Не удалось загрузить</h1>
      <p class="head__sub">${esc(errText(e))}</p><div class="tile__actions" style="justify-content:center"><a class="btn btn--dark" href="clans.html">← Все кланы</a></div></div>`; };
    const needLogin = text => { clRoot.innerHTML = `<div class="acc-soon"><img src="img/logo.png" alt="">
      <span class="head__label caps">Кланы</span><h1 class="head__title">Нужен профиль</h1><p class="head__sub">${esc(text)}</p>
      <div class="tile__actions" style="justify-content:center"><a class="btn btn--primary" href="account.html">Войти или зарегистрироваться <span class="arr">→</span></a><a class="btn btn--dark" href="clans.html">Все кланы</a></div></div>`; };

    qs.has("new") ? viewNew() : qs.get("tag") ? viewClan(qs.get("tag")) : viewClans();

    /* ---------- Список кланов ---------- */
    async function viewClans() {
      const [{ data, error }, { user, me }] = await Promise.all([
        sb.from("clans").select("id,name,tag,flag,description,open,members,created_at").order("members", { ascending: false }).order("created_at").limit(500),
        currentUser()]);
      if (error) return fail(error);
      const all = data || [];
      let q = "", filter = "all";
      const myAction = !user ? `<a class="btn btn--primary" href="account.html">Войти и создать клан</a>`
        : !me ? `<a class="btn btn--primary" href="account.html">Создать профиль</a>`
        : me.clans ? `<a class="btn btn--ghost" href="${clanUrl(me.clans)}">${flagSvg(me.clans.flag, "flag--xs")} Мой клан [${esc(me.clans.tag)}]</a>`
        : `<a class="btn btn--primary" href="clans.html?new">Создать клан <span class="arr">→</span></a>`;
      clRoot.innerHTML = `
        <div class="dash-head">
          <div><span class="head__label caps">Сообщество</span><h1 class="head__title">Кланы</h1>
            <p class="head__sub">${all.length} ${plural(all.length, "клан", "клана", "кланов")} · собери команду со своим флагом и тегом или вступи в чужую.</p></div>
          ${myAction}
        </div>
        <div class="pl-tools">
          <input class="input" id="cl-q" placeholder="Поиск по названию или тегу" autocomplete="off">
          <div class="seg seg--inline" id="cl-f"><button data-f="all" class="active">Все</button><button data-f="open">Открытые</button><button data-f="closed">По заявке</button></div>
        </div>
        <div class="cl-grid" id="cl-grid"></div>`;
      const draw = () => {
        const s = q.toLowerCase();
        const list = all.filter(c => (filter === "all" || (filter === "open") === c.open) &&
          (!s || c.name.toLowerCase().includes(s) || c.tag.toLowerCase().includes(s)));
        $("cl-grid").innerHTML = list.length ? list.map(c => `
          <a class="cl-card" href="${clanUrl(c)}">
            <span class="cl-card__flag">${flagSvg(c.flag, "flag--md")}</span>
            <div class="cl-card__body"><span class="cl-card__tag">[${esc(c.tag)}]</span><b>${esc(c.name)}</b>
              ${c.description ? `<p>${esc(c.description)}</p>` : ""}
              <span class="cl-card__meta"><span class="chip">${c.members} ${plural(c.members, "участник", "участника", "участников")}</span><span class="chip ${c.open ? "chip--ok" : ""}">${c.open ? "Открытый" : "По заявке"}</span></span></div>
          </a>`).join("")
          : `<p class="players-empty">${all.length ? "Ничего не нашли. Попробуй другой запрос." : "Кланов пока нет — создай первый!"}</p>`;
      };
      $("cl-q").addEventListener("input", e => { q = e.target.value.trim(); draw(); });
      $("cl-f").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return;
        filter = b.dataset.f; $$("#cl-f button").forEach(x => x.classList.toggle("active", x === b)); draw(); });
      draw();
    }

    /* ---------- Создание клана ---------- */
    async function viewNew() {
      const { user, me } = await currentUser();
      if (!user || !me) return needLogin(!user ? "Чтобы создать клан, войди в свой профиль игрока." : "Сначала создай профиль игрока — клан привяжется к нему.");
      if (me.clans) { location.replace(clanUrl(me.clans)); return; }
      myNick = me.nickname;
      clRoot.innerHTML = `${backLink}
        <div class="dash-head"><div><span class="head__label caps">Новый клан</span><h1 class="head__title">Создай свой клан</h1>
          <p class="head__sub">Ты станешь владельцем. Клан сразу появится в твоём профиле и в списке кланов.</p></div></div>
        <div class="card-box">${clanForm(null)}</div>`;
      bindClanForm(null, async v => {
        const { error } = await sb.rpc("create_clan", { p_name: v.name, p_tag: v.tag, p_description: v.description, p_flag: v.flag, p_open: v.open });
        if (error) throw error;
        toast("Клан создан!"); location.href = clanUrl(v);
      });
    }

    /* ---------- Форма клана (создание и настройки) ---------- */
    function clanForm(c) {
      return `<form class="clan-form" id="f-clan" autocomplete="off">
        <div class="clan-form__fields">
          <div class="grid-name">
            <label class="field"><span class="field__label">Название</span><input class="input" name="cname" maxlength="24" value="${esc(c ? c.name : "")}" placeholder="Северный альянс" required></label>
            <label class="field"><span class="field__label">Тег</span><input class="input input--tag" name="tag" maxlength="4" value="${esc(c ? c.tag : "")}" placeholder="NORD" required></label>
          </div>
          <p class="field__hint tag-prev">В игре и на сайте: <b id="tag-prev">[TAG]</b> ${esc(cu_nick())}</p>
          <label class="field"><span class="field__label">Описание</span><textarea class="input" name="description" rows="5" maxlength="600" placeholder="Чем занимается клан, где живёт, кого ищет">${esc(c ? c.description || "" : "")}</textarea></label>
          <div class="field"><span class="field__label">Вступление</span>
            <div class="radio-row">
              <label><input type="radio" name="open" value="1" ${!c || c.open ? "checked" : ""}> Открытый — вступают сразу</label>
              <label><input type="radio" name="open" value="0" ${c && !c.open ? "checked" : ""}> По заявке</label>
            </div></div>
          <button class="btn btn--primary">${c ? "Сохранить" : "Создать клан"} <span class="arr">→</span></button>
          <p class="form__msg" id="m-clanform"></p>
        </div>
        <div class="clan-form__flag"><span class="field__label">Флаг</span><div id="flag-editor"></div></div>
      </form>`;
    }
    let myNick = "";
    function cu_nick() { return myNick || "Ник"; }
    function bindClanForm(c, onSubmit) {
      const f = $("f-clan"), el = f.elements, ed = flagEditor($("flag-editor"), c ? c.flag : DEFAULT_FLAG);
      const prev = () => { $("tag-prev").textContent = `[${el.tag.value || "TAG"}]`; };
      el.tag.addEventListener("input", () => { el.tag.value = el.tag.value.toUpperCase().replace(/[^A-ZА-ЯЁ0-9]/g, ""); prev(); });
      prev();
      f.addEventListener("submit", async e => {
        e.preventDefault();
        const say = t => { $("m-clanform").textContent = t; };
        const v = { name: el.cname.value.trim(), tag: el.tag.value.trim().toUpperCase(), description: el.description.value.trim(), flag: ed.get(), open: el.open.value === "1" };
        if (v.name.length < 3) return say("Название — от 3 до 24 символов.");
        if (!/^[A-ZА-ЯЁ0-9]{4}$/.test(v.tag)) return say("Тег — ровно 4 буквы или цифры.");
        say(""); f.querySelectorAll("button, input, textarea").forEach(x => x.disabled = true);
        try { await onSubmit(v); }
        catch (err) { say(errText(err)); }
        finally { f.querySelectorAll("button, input, textarea").forEach(x => x.disabled = false); }
      });
    }

    /* ---------- Редактор пиксельного флага ---------- */
    function flagEditor(box, initial) {
      let f = validFlag(initial).split(""), color = 3;
      const undo = [];
      box.innerHTML = `<div class="fe">
        <div class="fe__grid" style="--fw:${FW}">${f.map((_, i) => `<i data-i="${i}"></i>`).join("")}</div>
        <div class="fe__side">
          <div class="fe__pal">${DYES.map((d, i) => `<button type="button" data-c="${i}" title="${DYE_NAMES[i]}" aria-label="${DYE_NAMES[i]}" style="--d:${d}"></button>`).join("")}</div>
          <div class="fe__tools">
            <button type="button" data-t="fill">Залить</button><button type="button" data-t="stripe">Полоса</button>
            <button type="button" data-t="cross">Крест</button><button type="button" data-t="border">Рамка</button>
            <button type="button" data-t="half">Половина</button><button type="button" data-t="diag">Диагональ</button>
            <button type="button" data-t="undo">↶ Отменить</button>
          </div>
          <p class="field__hint">Выбери цвет и рисуй по клеткам мышкой или пальцем. Узоры кладутся выбранным цветом.</p>
        </div></div>`;
      const grid = box.querySelector(".fe__grid"), cells = [...grid.children];
      const paint = () => cells.forEach((el, i) => { el.style.background = DYES[parseInt(f[i], 16)]; });
      const pick = c => { color = c; box.querySelectorAll(".fe__pal button").forEach(b => b.classList.toggle("active", +b.dataset.c === c)); };
      const save = () => { undo.push(f.join("")); if (undo.length > 60) undo.shift(); };
      const set = i => { const ch = color.toString(16); if (i >= 0 && f[i] !== ch) { f[i] = ch; cells[i].style.background = DYES[color]; } };
      const at = e => { const el = document.elementFromPoint(e.clientX, e.clientY); return el && el.parentNode === grid ? +el.dataset.i : -1; };
      /* Быстрое движение мыши пропускает клетки — дорисовываем линию между точками */
      let drawing = false, last = -1;
      const stroke = i => {
        if (i < 0) return;
        if (last < 0) { set(i); last = i; return; }
        let x0 = last % FW, y0 = Math.floor(last / FW);
        const x1 = i % FW, y1 = Math.floor(i / FW), steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) || 1;
        for (let s = 1; s <= steps; s++) set(Math.round(y0 + (y1 - y0) * s / steps) * FW + Math.round(x0 + (x1 - x0) * s / steps));
        last = i;
      };
      grid.addEventListener("pointerdown", e => { e.preventDefault(); save(); drawing = true; last = -1; grid.setPointerCapture(e.pointerId); stroke(at(e)); });
      grid.addEventListener("pointermove", e => { if (drawing) stroke(at(e)); });
      ["pointerup", "pointercancel", "lostpointercapture"].forEach(t => grid.addEventListener(t, () => { drawing = false; }));
      box.querySelector(".fe__pal").addEventListener("click", e => { const b = e.target.closest("button"); if (b) pick(+b.dataset.c); });
      const PATTERNS = {
        fill: () => true,
        stripe: (x, y) => y >= 4 && y <= 7,
        cross: (x, y) => x === 3 || x === 4 || y === 5 || y === 6,
        border: (x, y) => x === 0 || y === 0 || x === FW - 1 || y === FH - 1,
        half: x => x < FW / 2,
        diag: (x, y) => Math.abs(x * (FH - 1) / (FW - 1) - y) < 1.6,
      };
      box.querySelector(".fe__tools").addEventListener("click", e => {
        const t = e.target.closest("button")?.dataset.t; if (!t) return;
        if (t === "undo") { if (undo.length) { f = undo.pop().split(""); paint(); } return; }
        save(); const ch = color.toString(16);
        f = f.map((v, i) => PATTERNS[t](i % FW, Math.floor(i / FW)) ? ch : v); paint();
      });
      paint(); pick(color);
      return { get: () => f.join("") };
    }

    /* ---------- Страница клана ---------- */
    async function viewClan(tagParam) {
      const T = tagParam.trim().toUpperCase();
      const [{ data: c, error }, { user, me }] = await Promise.all([
        sb.from("clans").select("*").eq("tag", T).maybeSingle(), currentUser()]);
      if (error) return fail(error);
      if (!c) {
        clRoot.innerHTML = `<div class="acc-soon"><h1 class="head__title">Клан [${esc(T)}] не найден</h1>
          <p class="head__sub">Возможно, его распустили или сменили тег.</p><div class="tile__actions" style="justify-content:center"><a class="btn btn--dark" href="clans.html">← Все кланы</a></div></div>`;
        return;
      }
      myNick = me ? me.nickname : "";
      const [{ data: members, error: e2 }, online] = await Promise.all([sb.rpc("clan_member_list", { p_clan: c.id }), onlineNames()]);
      if (e2) return fail(e2);
      const mine = !!me && me.clan_id === c.id, role = mine ? me.clan_role : null, staff = role === "owner" || role === "officer";
      let myReq = null;
      if (me && !me.clan_id && !c.open) {
        const { data } = await sb.from("clan_requests").select("created_at").eq("clan_id", c.id).eq("user_id", user.id).maybeSingle();
        myReq = data;
      }
      document.title = `[${c.tag}] ${c.name} — Кланы Сфинксляндии`;
      const action = !user ? `<a class="btn btn--primary" href="account.html">Войти, чтобы вступить</a>`
        : !me ? `<a class="btn btn--primary" href="account.html">Создать профиль, чтобы вступить</a>`
        : mine ? `<span class="chip chip--ok">Ты в клане · ${ROLE_NAMES[role]}</span><button class="btn btn--dark" data-act="leave">Покинуть клан</button>`
        : me.clan_id ? `<p class="muted">Ты уже в клане ${me.clans ? `<a class="clan-link" href="${clanUrl(me.clans)}">[${esc(me.clans.tag)}] ${esc(me.clans.name)}</a>` : ""}. Чтобы вступить сюда, сначала выйди из него.</p>`
        : c.open ? `<button class="btn btn--primary" data-act="join">Вступить в клан <span class="arr">→</span></button>`
        : myReq ? `<span class="chip">Заявка отправлена ${fmtDate(myReq.created_at)}</span><button class="btn btn--dark" data-act="cancel">Отозвать заявку</button>`
        : `<form id="f-req" class="req-form"><textarea class="input" name="message" rows="2" maxlength="300" placeholder="Пара слов о себе: что строишь, когда играешь (необязательно)"></textarea>
            <button class="btn btn--primary">Подать заявку <span class="arr">→</span></button></form>`;
      const canKick = m => mine && m.user_id !== user.id && (role === "owner" || (role === "officer" && m.role === "member"));
      clRoot.innerHTML = `${backLink}
        <div class="clan-hero">
          <div class="banner">${flagSvg(c.flag, "flag--lg")}</div>
          <div class="clan-hero__info">
            <span class="head__label caps">Клан · основан ${fmtDate(c.created_at)}</span>
            <h1 class="head__title"><span class="clan-tag">[${esc(c.tag)}]</span> ${esc(c.name)}</h1>
            <div class="pcard__meta"><span class="chip">${c.members} ${plural(c.members, "участник", "участника", "участников")}</span>
              <span class="chip ${c.open ? "chip--ok" : ""}">${c.open ? "Открытый — вступай сразу" : "Вступление по заявке"}</span></div>
            ${c.description ? `<p class="clan-desc">${fmt(c.description)}</p>` : ""}
            <div class="clan-actions">${action}</div>
          </div>
        </div>
        <div class="dash ${staff ? "" : "dash--single"}">
          <div class="dash__col">
            <div class="card-box"><h3>Участники · ${members.length}</h3>
              <div class="members">${members.map(m => `
                <div class="member-row">
                  <img src="${head(m.nickname, 32)}" alt="" loading="lazy">
                  <div class="member-row__main">
                    ${m.is_public ? `<a href="players.html?nick=${encodeURIComponent(m.nickname)}"><b>${esc(m.nickname)}</b></a>` : `<b>${esc(m.nickname)}</b>`}${online.has(m.nickname.toLowerCase()) ? `<i class="dot on" title="В игре"></i>` : ""}
                    <span class="muted small">${ROLE_NAMES[m.role] || ""} · с ${fmtDate(m.joined_at)}</span>
                  </div>
                  <span class="member-row__chips">${m.role === "owner" ? `<span class="chip chip--rank" style="--c:var(--yellow)">Владелец</span>` : m.role === "officer" ? `<span class="chip">Офицер</span>` : ""}${rankChip(m.rank)}</span>
                  ${role === "owner" && m.user_id !== user.id || canKick(m) ? `<span class="member-row__tools">
                    ${role === "owner" && m.user_id !== user.id ? `<button class="btn btn--dark btn--sm" data-act="role" data-role="${m.role === "officer" ? "member" : "officer"}" data-u="${esc(m.user_id)}" data-n="${esc(m.nickname)}">${m.role === "officer" ? "Снять офицера" : "Сделать офицером"}</button>
                      <button class="btn btn--dark btn--sm" data-act="role" data-role="owner" data-u="${esc(m.user_id)}" data-n="${esc(m.nickname)}">Передать клан</button>` : ""}
                    ${canKick(m) ? `<button class="btn btn--dark btn--sm btn--danger" data-act="kick" data-u="${esc(m.user_id)}" data-n="${esc(m.nickname)}">Исключить</button>` : ""}
                  </span>` : ""}
                </div>`).join("")}</div>
            </div>
          </div>
          ${staff ? `<div class="dash__col">
            <div class="card-box"><h3>Заявки</h3><div id="reqs"><p class="muted">Загружаем…</p></div></div>
            <div class="card-box"><h3>Настройки клана</h3>${clanForm(c)}</div>
            ${role === "owner" ? `<div class="card-box danger-box"><h3>Распустить клан</h3><p class="muted">Клан удалится навсегда, все участники выйдут из него.</p><button class="btn btn--dark" data-act="disband">Распустить</button></div>` : ""}
          </div>` : ""}
        </div>`;

      const reload = () => viewClan(T);
      const call = async (fn, args, okText) => {
        const { data, error } = await sb.rpc(fn, args);
        if (error) { toast(errText(error)); return null; }
        if (okText) toast(okText);
        return data ?? true;
      };

      if (staff) {
        loadRequests();
        bindClanForm(c, async v => {
          const { error } = await sb.rpc("update_clan", { p_clan: c.id, p_name: v.name, p_tag: v.tag, p_description: v.description, p_flag: v.flag, p_open: v.open });
          if (error) throw error;
          toast("Клан сохранён");
          v.tag === c.tag ? reload() : location.replace(clanUrl(v));
        });
      }
      async function loadRequests() {
        const box = $("reqs");
        const { data, error } = await sb.rpc("clan_request_list", { p_clan: c.id });
        if (error) { box.innerHTML = `<p class="form__msg">${esc(errText(error))}</p>`; return; }
        box.innerHTML = data.length ? data.map(r => `
          <div class="req-row">
            <img src="${head(r.nickname, 32)}" alt="">
            <div><b>${esc(r.nickname)}</b> <span class="chip">${platformName(r.platform)}</span>
              ${r.message ? `<p>${fmt(r.message)}</p>` : ""}<span class="muted small">${fmtDate(r.created_at)}</span></div>
            <span class="req-row__tools">
              <button class="btn btn--primary btn--sm" data-act="answer" data-ok="1" data-u="${esc(r.user_id)}">Принять</button>
              <button class="btn btn--dark btn--sm" data-act="answer" data-ok="0" data-u="${esc(r.user_id)}">Отклонить</button>
            </span>
          </div>`).join("")
          : `<p class="muted">${c.open ? "Клан открытый — игроки вступают сразу, без заявок." : "Новых заявок нет."}</p>`;
      }

      $("f-req")?.addEventListener("submit", async e => {
        e.preventDefault(); const f = e.target; f.querySelector("button").disabled = true;
        const r = await call("join_clan", { p_clan: c.id, p_message: f.message.value.trim() || null });
        if (r) { toast(r === "joined" ? "Ты вступил в клан!" : "Заявка отправлена"); reload(); } else f.querySelector("button").disabled = false;
      });

      clRoot.onclick = async e => {
        const b = e.target.closest("[data-act]"); if (!b || b.disabled) return;
        const act = b.dataset.act, u = b.dataset.u, n = b.dataset.n;
        b.disabled = true;
        let done = null;
        if (act === "join") {
          done = await call("join_clan", { p_clan: c.id, p_message: null });
          if (done) toast(done === "joined" ? "Ты вступил в клан!" : "Заявка отправлена");
        } else if (act === "cancel") {
          done = await call("cancel_clan_request", { p_clan: c.id }, "Заявка отозвана");
        } else if (act === "leave") {
          const warn = role === "owner"
            ? (c.members > 1 ? "Ты владелец. Клан перейдёт к офицеру или самому давнему участнику. Выйти?" : "Ты последний участник — клан будет удалён. Выйти?")
            : "Покинуть клан?";
          if (confirm(warn)) done = await call("leave_clan", {}, "Ты вышел из клана");
        } else if (act === "role") {
          const ask = b.dataset.role === "owner" ? `Передать клан игроку ${n}? Ты станешь офицером.` : null;
          if (!ask || confirm(ask)) done = await call("set_clan_role", { p_user: u, p_role: b.dataset.role }, "Роль изменена");
        } else if (act === "kick") {
          if (confirm(`Исключить ${n} из клана?`)) done = await call("kick_clan_member", { p_user: u }, `${n} исключён`);
        } else if (act === "answer") {
          const r = await call("answer_clan_request", { p_clan: c.id, p_user: u, p_accept: b.dataset.ok === "1" });
          if (r) toast(r === "accepted" ? "Игрок принят в клан" : r === "busy" ? "Игрок уже вступил в другой клан" : "Заявка отклонена");
          done = r;
        } else if (act === "disband") {
          const typed = prompt(`Чтобы распустить клан навсегда, введи его тег: ${c.tag}`);
          if (typed != null && typed.trim().toUpperCase() === c.tag) {
            if (await call("disband_clan", {}, "Клан распущен")) { location.href = "clans.html"; return; }
          } else if (typed != null) toast("Тег не совпадает — клан не распущен");
        }
        if (done) reload(); else b.disabled = false;
      };
    }
  }
})();
