/* =========================================================
   Сфинксляндия — профили игроков и кланы
   (account.html, players.html, clans.html).
   Аккаунты, профили и кланы хранятся в Supabase: адрес проекта и ключ
   вписываются в админке («Основное» → «Профили игроков»).
   Схема базы — supabase/schema.sql. Регистрация по желанию:
   играть на сервере можно и без неё.
   ========================================================= */
(function () {
  const accRoot = $("acc"), plRoot = $("players-root"), clRoot = $("clans-root"), stRoot = $("stats-root");
  const root = accRoot || plRoot || clRoot || stRoot; if (!root) return;
  const A = SITE.auth || {};
  const tiers = (SITE.donate || {}).tiers || [];

  /* ---------- Не настроено: показываем заглушку ---------- */
  if (!A.supabaseUrl || !A.supabaseKey || !window.supabase) {
    root.innerHTML = `<div class="acc-soon">
      <img src="img/logo.png" alt="">
      <span class="head__label caps">${accRoot ? "Профили игроков" : clRoot ? "Кланы" : stRoot ? "Статистика" : "Игроки"}</span>
      <h1 class="head__title">Скоро откроется</h1>
      <p class="head__sub">${accRoot
        ? "Скоро здесь можно будет войти по нику и паролю с сервера и увидеть свой профиль: скин, клан, статистику и статус в игре."
        : clRoot ? "Здесь появятся кланы сервера — с флагами, участниками и статистикой из игры."
        : stRoot ? "Здесь появятся онлайн, TPS, график и топы игроков."
        : "Здесь появится список игроков с профилями, кланами и привилегиями."}</p>
      <div class="tile__actions" style="justify-content:center"><a class="btn btn--primary" href="guide.html">Как начать играть <span class="arr">→</span></a><a class="btn btn--dark" href="index.html">На главную</a></div>
    </div>`;
    return;
  }

  /* Адрес проекта без хвостов вроде /rest/v1/ — их часто копируют вместе с URL */
  const sbUrl = String(A.supabaseUrl).trim().replace(/\/(rest|auth)\/v1.*$/, "").replace(/\/+$/, "");
  const sb = window.supabase.createClient(sbUrl, String(A.supabaseKey).trim());

  /* ---------- Общие помощники ---------- */
  const NICK_RE = /^[.*]?[A-Za-z0-9_.](?:[A-Za-z0-9_. ]{1,14})[A-Za-z0-9_.]$/;
  /* У профиля клан свой (clan_id), но кланы связаны с профилями ещё и через заявки — указываем связь явно */
  const CLAN_EMBED = "clans:clans!profiles_clan_id_fkey(id,name,tag,flag,game)";
  const PUBLIC_COLS = `nickname,platform,bio,discord,rank,verified,created_at,stats,last_seen,skin,online,clan_role,${CLAN_EMBED}`;
  /* Настоящий скин (из SkinsRestorer через плагин SiteSync) по хешу текстуры; иначе — по нику */
  const SKIN_RE = /^[0-9a-f]{20,80}$/;
  const ava = (p, size) => SKIN_RE.test(p.skin || "") ? `https://mc-heads.net/avatar/${p.skin}/${size}` : head(p.nickname, size);
  const bodyImg = p => `https://mc-heads.net/body/${SKIN_RE.test(p.skin || "") ? p.skin : encodeURIComponent(p.nickname)}/180`;
  const isOn = (p, online) => !!p.online || online.has(p.nickname.toLowerCase());
  const ROLE_NAMES = { owner: "Лидер", officer: "Модератор", member: "Участник" }; /* как в ApexClan */

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
  /* Название клана цветом тега из игры: один цвет или градиент (как /clan color в ApexClan) */
  const clanStyle = c => {
    const cs = ((c && c.game && c.game.colors) || []).filter(x => /^#[0-9a-f]{6}$/i.test(x));
    return cs.length > 1 ? `background:linear-gradient(90deg,${cs.join(",")});-webkit-background-clip:text;background-clip:text;color:transparent`
      : cs.length ? `color:${cs[0]}` : "";
  };
  const clanName = c => `<span class="clan-name" style="${clanStyle(c)}">${esc(c.name)}</span>`;
  const platformName = p => p === "bedrock" ? "Bedrock" : "Java";
  const findTier = r => r ? tiers.find(t => [t.id, t.name].some(x => String(x || "").toLowerCase() === String(r).toLowerCase())) : null;
  const rankChip = r => { const t = findTier(r); return r ? `<span class="chip chip--rank" style="--c:${esc(t ? t.color : "#ffc83a")}">${esc(t ? t.name : r)}</span>` : ""; };
  const likeEsc = s => s.replace(/[\\%_]/g, "\\$&");
  /* Аккаунты из игры (плагин SiteSync) входят по нику: ник превращается в служебную почту.
     Формула должна совпадать с SiteSync.email() в плагине. */
  const GAME_DOMAIN = String(A.gameEmailDomain || "").trim().toLowerCase();
  const BE_PREFIX = A.bedrockPrefix ?? ".";
  function nickEmail(nick) {
    let n = nick.trim().toLowerCase();
    if (BE_PREFIX && n.startsWith(BE_PREFIX)) n = "be-" + n.slice(BE_PREFIX.length);
    return n.replace(/[^a-z0-9_]/g, "-") + "@" + GAME_DOMAIN;
  }
  const isGameAccount = (user, p) => (p && p.source === "game") || (!!GAME_DOMAIN && String(user.email || "").endsWith("@" + GAME_DOMAIN));
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
    if (/check constraint|23514/i.test(m) || (e && e.code === "23514")) return "Проверь поля: ник 3–16 символов (латиница, цифры, _ и точка), описание до 300 символов.";
    if (e && e.code === "P0001") return m; /* понятные сообщения из функций базы */
    if (/clan_id|clan_role|clan_member_list|create_clan|schema cache/i.test(m)) return "Кланы ещё не подключены в базе: администратору нужно заново запустить supabase/schema.sql.";
    if (/Failed to fetch|NetworkError/i.test(m)) return "Нет связи с сервером профилей. Проверь интернет.";
    return "Ошибка: " + m;
  };
  /* Свой профиль вместе с кланом. Если кланы ещё не подключены в базе — без клана */
  async function loadMe(uid) {
    const r = await sb.from("profiles").select(`*,${CLAN_EMBED}`).eq("id", uid).maybeSingle();
    if (r.error && /Could not find|does not exist/i.test(r.error.message)) return sb.from("profiles").select("*").eq("id", uid).maybeSingle();
    return r;
  }
  /* Запрос профилей с кланом; пока кланы не подключены в базе — без них */
  async function withFallback(mk) {
    const r = await mk(PUBLIC_COLS);
    if (r.error && /Could not find|does not exist/i.test(r.error.message)) return mk("nickname,platform,bio,discord,rank,verified,created_at,stats,last_seen");
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
    /* Порядок — как в STAT_NAMES (база хранит ключи JSON в своём порядке), неизвестные ключи — в конце */
    const order = Object.keys(STAT_NAMES);
    const st = p.stats && typeof p.stats === "object" ? Object.entries(p.stats).filter(([, v]) => v != null && v !== "")
      .sort(([a], [b]) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99)) : [];
    const last = p.last_seen ? `<p class="muted small">Последний раз в игре: ${fmtDate(p.last_seen)}</p>` : "";
    if (!st.length) return `<div class="card-box"><h3>Статистика с сервера</h3>
      <p class="muted">${own ? "Зайди на сервер — твои часы в игре, добытые блоки и другие цифры появятся здесь через несколько минут или сразу после выхода из игры." : "Статистика появится, когда игрок зайдёт на сервер."}</p>${last}</div>`;
    return `<div class="card-box"><h3>Статистика с сервера</h3><div class="stats">${st.map(([k, v]) => {
      const [name, f] = STAT_NAMES[k] || [k, x => x];
      return `<div><b>${esc(f(v))}</b><span class="caps">${esc(name)}</span></div>`;
    }).join("")}</div>${last}</div>`;
  }

  function profileCard(p, online, own) {
    return `<div class="pcard pcard--big">
      <div class="pcard__top">
        <img class="pcard__ava" src="${ava(p, 96)}" alt="">
        <div>
          <div class="pcard__nick">${esc(p.nickname)}</div>
          <div class="pcard__meta">${rankChip(p.rank)}<span class="chip">${platformName(p.platform)}</span>${p.verified ? `<span class="chip chip--ok" title="Ник подтверждён на сервере">✓ подтверждён</span>` : ""}</div>
        </div>
      </div>
      ${p.bio ? `<p class="pcard__bio">${fmt(p.bio)}</p>` : own ? `<p class="pcard__bio muted">Расскажи о себе — заполни поле «О себе» в настройках.</p>` : ""}
      <div class="pcard__grid">
        <div><b>Клан</b><span>${p.clans ? `<a class="clan-link" href="${clanUrl(p.clans)}">${flagSvg(p.clans.flag, "flag--xs")}${clanName(p.clans)}</a>` : "—"}</span></div>
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
    const msg = (id, text, ok) => { const m = $(id); if (m) { m.textContent = text || ""; m.classList.toggle("ok", !!ok); } };
    const lock = (form, on) => form.querySelectorAll("button, input, textarea, select").forEach(x => x.disabled = on);

    async function boot() {
      const { data: { session } } = await sb.auth.getSession();
      if (!session) { try { localStorage.removeItem("sl-nick"); localStorage.removeItem("sl-skin"); } catch {} return viewAuth(); }
      const { data: prof, error } = await loadMe(session.user.id);
      if (error) { accRoot.innerHTML = `<div class="acc-soon"><h1 class="head__title">Не удалось загрузить профиль</h1><p class="head__sub">${esc(errText(error))}</p></div>`; return; }
      if (!prof) return viewNoProfile();
      try { localStorage.setItem("sl-nick", prof.nickname); localStorage.setItem("sl-skin", prof.skin || ""); } catch {}
      viewDashboard(session.user, prof);
    }

    /* ---------- Вход: только ник и пароль с сервера ----------
       Аккаунт на сайте создаёт плагин SiteSync, когда игрок регистрируется на сервере (/register) */
    function viewAuth() {
      accRoot.innerHTML = `<div class="auth">
        <div class="auth__intro">
          <span class="head__label caps">Профиль игрока</span>
          <h1 class="head__title">Твой профиль<br><span class="grad-text">на сайте</span></h1>
          <p class="head__sub">Отдельно регистрироваться не нужно: профиль появляется сам, как только ты зарегистрировался на сервере.</p>
          <ol class="steps-mini">
            <li><b>Зайди на сервер</b> и зарегистрируйся: <code>/register пароль пароль</code></li>
            <li><b>Входи сюда</b> по своему нику и тому же паролю</li>
          </ol>
          <ul class="ticks">
            <li>Твой скин, статистика и статус «в игре»</li>
            <li>Клан, привилегия и дата регистрации</li>
            <li>Рассказ о себе и Discord, чтобы тебя нашли тиммейты</li>
          </ul>
        </div>
        <div class="auth__card">
          <h2>Вход</h2>
          <form id="f-login" class="form">
            <label class="field"><span class="field__label">Ник</span><input class="input" type="text" name="nick" maxlength="17" autocomplete="username" autocapitalize="off" spellcheck="false" required></label>
            <label class="field"><span class="field__label">Пароль из игры</span><input class="input" type="password" name="password" autocomplete="current-password" required></label>
            <button class="btn btn--primary btn--block">Войти <span class="arr">→</span></button>
            <p class="form__msg" id="m-login"></p>
          </form>
          <details class="help-mini">
            <summary>Не получается войти?</summary>
            <ul>
              <li>Пароль — тот же, что ты вводишь в игре после <code>/login</code>.</li>
              <li>Регистрировался на сервере давно? Зайди в игру и введи <code>/login</code> — через пару секунд пароль заработает и здесь.</li>
              <li>Забыл пароль или хочешь сменить — <code>/changepassword старый новый</code> в игре, на сайте он обновится сам.</li>
              <li>Пароль короче 6 символов сайт не принимает — смени его в игре на более длинный.</li>
            </ul>
          </details>
        </div>
      </div>`;

      $("f-login").addEventListener("submit", async e => {
        e.preventDefault(); const f = e.target; msg("m-login", "");
        const nick = f.nick.value.trim();
        if (!GAME_DOMAIN) return msg("m-login", "Вход на сайт ещё не настроен. Загляни позже.");
        if (!NICK_RE.test(nick)) return msg("m-login", "Введи ник, под которым играешь на сервере.");
        lock(f, true);
        const { error } = await sb.auth.signInWithPassword({ email: nickEmail(nick), password: f.password.value });
        lock(f, false);
        if (error) return msg("m-login", /Invalid login credentials/i.test(error.message)
          ? "Неверный ник или пароль. Пароль — тот же, что в игре. Регистрировался давно? Введи в игре /login и попробуй снова через пару секунд."
          : errText(error));
        boot();
      });
    }

    /* ---------- Аккаунт есть, а профиля нет (обычно — профиль удалили вручную) ---------- */
    function viewNoProfile() {
      accRoot.innerHTML = `<div class="acc-soon">
        <span class="head__label caps">Профиль</span>
        <h1 class="head__title">Профиль ещё не готов</h1>
        <p class="head__sub">Профиль создаётся сервером. Зайди в игру и введи <b>/login</b> — через несколько секунд обнови эту страницу.</p>
        <div class="tile__actions" style="justify-content:center"><button class="btn btn--dark" id="logout">Выйти</button></div>
      </div>`;
      $("logout").addEventListener("click", logout);
    }

    /* ---------- Кабинет ---------- */
    async function viewDashboard(user, p) {
      const online = isOn(p, await onlineNames());
      const tier = findTier(p.rank), game = isGameAccount(user, p);
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
                  <span><b>${clanName(p.clans)}</b><span class="muted small">${ROLE_NAMES[p.clan_role] || ""}</span></span><span class="arr">→</span></a>`
                : `<p class="muted">Ты пока не в клане. Кланы создаются и собираются в игре: введи <code>/clan</code> на сервере — через несколько минут клан появится здесь.</p>
                  <div class="tile__actions"><a class="btn btn--primary" href="clans.html">Кланы сервера</a></div>`}
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
                <label class="field"><span class="field__label">Ник</span><input class="input" name="nickname" maxlength="17" value="${esc(p.nickname)}" required ${game ? "readonly" : ""}>
                  ${game ? `<span class="field__hint">Ник из игры — меняется только на сервере.</span>` : ""}</label>
                <label class="field"><span class="field__label">Платформа</span><select class="input" name="platform"><option value="java">Java</option><option value="bedrock" ${p.platform === "bedrock" ? "selected" : ""}>Bedrock</option></select></label>
              </div>
              <label class="field"><span class="field__label">Discord</span><input class="input" name="discord" maxlength="40" value="${esc(p.discord || "")}" placeholder="nick"></label>
              <label class="field"><span class="field__label">О себе</span><textarea class="input" name="bio" rows="4" maxlength="300" placeholder="Что строишь, чем занимаешься, кого ищешь">${esc(p.bio || "")}</textarea></label>
              <label class="check"><input type="checkbox" name="public" ${p.public ? "checked" : ""}><span>Показывать мой профиль в списке игроков</span></label>
              <button class="btn btn--primary">Сохранить</button>
              <p class="form__msg" id="m-profile"></p>
            </form>
            ${game ? `<div class="card-box">
              <h3>Аккаунт из игры</h3>
              <p class="muted">Ты входишь на сайт по нику <b>${esc(p.nickname)}</b> и паролю из игры (AuthMe).</p>
              <p class="muted">Сменить пароль — командой <b>/changepassword</b> на сервере: здесь он обновится сам.</p>
            </div>` : `<form class="card-box form" id="f-pass">
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
            </div>`}
          </div>
        </div>`;

      $("logout").addEventListener("click", logout);
      $("f-profile").addEventListener("submit", async e => {
        e.preventDefault(); const f = e.target; msg("m-profile", "");
        const upd = { nickname: f.nickname.value.trim(), platform: f.platform.value,
          discord: f.discord.value.trim() || null, bio: f.bio.value.trim() || null, public: f.public.checked };
        if (!NICK_RE.test(upd.nickname)) return msg("m-profile", "Ник: 3–16 символов — латиница, цифры, _ и точка.");
        lock(f, true);
        const { error: e1 } = await sb.from("profiles").update(upd).eq("id", user.id);
        const { data, error } = e1 ? { error: e1 } : await loadMe(user.id);
        lock(f, false);
        if (error) return msg("m-profile", errText(error));
        try { localStorage.setItem("sl-nick", data.nickname); localStorage.setItem("sl-skin", data.skin || ""); } catch {}
        toast("Профиль сохранён"); viewDashboard(user, data);
      });
      $("f-pass")?.addEventListener("submit", async e => {
        e.preventDefault(); const f = e.target; lock(f, true);
        const { error } = await sb.auth.updateUser({ password: f.password.value });
        lock(f, false);
        if (error) return msg("m-pass", errText(error));
        f.reset(); msg("m-pass", "Пароль изменён.", true);
      });
      $("delete")?.addEventListener("click", async () => {
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
      try { localStorage.removeItem("sl-nick"); localStorage.removeItem("sl-skin"); } catch {}
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
          <div class="dash__col">${profileCard(p, isOn(p, online), false)}</div>
          <div class="dash__col">
            <div class="card-box skin"><img src="${bodyImg(p)}" alt="Скин ${esc(p.nickname)}" loading="lazy"></div>
            ${statsBlock(p, false)}
          </div>
        </div>`;
    }

    async function viewList() {
      const [{ data, error }, online] = await Promise.all([
        withFallback(cols => sb.from("profiles").select(cols).order("created_at", { ascending: false }).limit(1000)),
        onlineNames()]);
      if (error) { plRoot.innerHTML = `<div class="acc-soon"><h1 class="head__title">Не удалось загрузить</h1><p class="head__sub">${esc(errText(error))}</p></div>`; return; }
      const all = (data || []).map(p => ({ ...p, on: isOn(p, online) }));
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
            <img src="${ava(p, 48)}" alt="" loading="lazy">
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
     КЛАНЫ: список и страница клана
     clans.html · clans.html?tag=Название
     Кланы создаются и собираются в игре (ApexClan), на сайт их переносит плагин SiteSync.
     На сайте лидер и модераторы клана рисуют флаг и пишут описание.
     ========================================================= */
  if (clRoot) {
    const qs = new URLSearchParams(location.search);
    const backLink = `<a class="back caps" href="clans.html">← Все кланы</a>`;
    const JOIN_NAMES = { OPEN: "Открытый", PUBLIC: "Открытый", INVITE_ONLY: "По приглашению", PASSWORD: "По паролю", PASSWORD_PROTECTED: "По паролю" };
    const joinName = c => JOIN_NAMES[(c.game || {}).join] || (c.open ? "Открытый" : "По приглашению");
    const descOf = c => c.description || (c.game || {}).description || "";
    const fail = e => { clRoot.innerHTML = `<div class="acc-soon"><h1 class="head__title">Не удалось загрузить</h1>
      <p class="head__sub">${esc(errText(e))}</p><div class="tile__actions" style="justify-content:center"><a class="btn btn--dark" href="clans.html">← Все кланы</a></div></div>`; };

    qs.get("tag") ? viewClan(qs.get("tag")) : viewClans(qs.has("new"));

    /* ---------- Список кланов ---------- */
    async function viewClans(askedNew) {
      const [{ data, error }, { me }] = await Promise.all([
        sb.from("clans").select("id,name,tag,flag,description,open,members,created_at,game").limit(500),
        currentUser()]);
      if (error) return fail(error);
      const xp = c => Number((c.game || {}).xp) || 0;
      const all = (data || []).sort((a, b) => xp(b) - xp(a) || b.members - a.members);
      let q = "", filter = "all";
      clRoot.innerHTML = `
        <div class="dash-head">
          <div><span class="head__label caps">Сообщество</span><h1 class="head__title">Кланы</h1>
            <p class="head__sub">${all.length} ${plural(all.length, "клан", "клана", "кланов")} на сервере. Кланы создаются в игре — командой <code>/clan</code>.</p></div>
          ${me && me.clans ? `<a class="btn btn--ghost" href="${clanUrl(me.clans)}">${flagSvg(me.clans.flag, "flag--xs")} Мой клан</a>` : ""}
        </div>
        ${askedNew ? `<div class="card-box note-box"><b>Клан создаётся в игре.</b> Зайди на сервер и введи <code>/clan</code> — откроется меню кланов.
          Через несколько минут клан появится здесь, и ты сможешь нарисовать ему флаг.</div>` : ""}
        <div class="pl-tools">
          <input class="input" id="cl-q" placeholder="Поиск по названию" autocomplete="off">
          <div class="seg seg--inline" id="cl-f"><button data-f="all" class="active">Все</button><button data-f="open">Открытые</button><button data-f="closed">По приглашению</button></div>
        </div>
        <div class="cl-grid" id="cl-grid"></div>`;
      const draw = () => {
        const s = q.toLowerCase();
        const list = all.filter(c => (filter === "all" || (filter === "open") === c.open) && (!s || c.name.toLowerCase().includes(s)));
        $("cl-grid").innerHTML = list.length ? list.map(c => `
          <a class="cl-card" href="${clanUrl(c)}">
            <span class="cl-card__flag">${flagSvg(c.flag, "flag--md")}</span>
            <div class="cl-card__body"><b>${clanName(c)}${(c.game || {}).verified ? ` <span class="chip chip--ok" title="Клан подтверждён администрацией">✓</span>` : ""}</b>
              ${descOf(c) ? `<p>${esc(descOf(c))}</p>` : ""}
              <span class="cl-card__meta"><span class="chip">${c.members} ${plural(c.members, "участник", "участника", "участников")}</span>
                <span class="chip">${xp(c)} XP</span><span class="chip ${c.open ? "chip--ok" : ""}">${joinName(c)}</span></span></div>
          </a>`).join("")
          : `<p class="players-empty">${all.length ? "Ничего не нашли. Попробуй другой запрос." : "Кланов пока нет — создай первый в игре командой /clan."}</p>`;
      };
      $("cl-q").addEventListener("input", e => { q = e.target.value.trim(); draw(); });
      $("cl-f").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return;
        filter = b.dataset.f; $$("#cl-f button").forEach(x => x.classList.toggle("active", x === b)); draw(); });
      draw();
    }

    /* ---------- Форма страницы клана: описание и флаг ---------- */
    function pageForm(c) {
      return `<form class="clan-form" id="f-clan" autocomplete="off">
        <div class="clan-form__fields">
          <label class="field"><span class="field__label">Описание на сайте</span><textarea class="input" name="description" rows="6" maxlength="600" placeholder="Чем занимается клан, где живёт, кого ищет">${esc(c.description || "")}</textarea>
            <span class="field__hint">Название, участники и роли меняются в игре через /clan.</span></label>
          <button class="btn btn--primary">Сохранить <span class="arr">→</span></button>
          <p class="form__msg" id="m-clanform"></p>
        </div>
        <div class="clan-form__flag"><span class="field__label">Флаг</span><div id="flag-editor"></div></div>
      </form>`;
    }
    function bindPageForm(c, onSubmit) {
      const f = $("f-clan"), ed = flagEditor($("flag-editor"), c.flag);
      f.addEventListener("submit", async e => {
        e.preventDefault();
        const say = t => { $("m-clanform").textContent = t; };
        say(""); f.querySelectorAll("button, textarea").forEach(x => x.disabled = true);
        try { await onSubmit({ description: f.elements.description.value.trim(), flag: ed.get() }); }
        catch (err) { say(errText(err)); }
        finally { f.querySelectorAll("button, textarea").forEach(x => x.disabled = false); }
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
      const T = tagParam.trim();
      const [{ data: c, error }, { user, me }] = await Promise.all([
        sb.from("clans").select("*").ilike("tag", likeEsc(T)).maybeSingle(), currentUser()]);
      if (error) return fail(error);
      if (!c) {
        clRoot.innerHTML = `<div class="acc-soon"><h1 class="head__title">Клан «${esc(T)}» не найден</h1>
          <p class="head__sub">Возможно, его распустили или переименовали в игре.</p><div class="tile__actions" style="justify-content:center"><a class="btn btn--dark" href="clans.html">← Все кланы</a></div></div>`;
        return;
      }
      const [{ data: members, error: e2 }, online] = await Promise.all([sb.rpc("clan_member_list", { p_clan: c.id }), onlineNames()]);
      if (e2) return fail(e2);
      const g = c.game || {};
      const mine = !!me && me.clan_id === c.id, role = mine ? me.clan_role : null, staff = role === "owner" || role === "officer";
      const kdr = g.deaths ? (g.kills / g.deaths).toFixed(2) : String(g.kills || 0);
      document.title = `${c.name} — Кланы Сфинксляндии`;
      clRoot.innerHTML = `${backLink}
        <div class="clan-hero">
          <div class="banner">${flagSvg(c.flag, "flag--lg")}</div>
          <div class="clan-hero__info">
            <span class="head__label caps">Клан · основан ${fmtDate(c.created_at)}</span>
            <h1 class="head__title">${clanName(c)}</h1>
            <div class="pcard__meta"><span class="chip">${c.members} ${plural(c.members, "участник", "участника", "участников")}</span>
              <span class="chip ${c.open ? "chip--ok" : ""}">${joinName(c)}</span>
              ${g.verified ? `<span class="chip chip--ok">✓ подтверждён</span>` : ""}
              ${mine ? `<span class="chip chip--rank" style="--c:var(--yellow)">Твой клан · ${ROLE_NAMES[role] || ""}</span>` : ""}</div>
            ${descOf(c) ? `<p class="clan-desc">${fmt(descOf(c))}</p>` : ""}
            <div class="stats clan-stats">
              <div><b>${Number(g.xp || 0).toLocaleString("ru-RU")}</b><span class="caps">Опыт клана</span></div>
              <div><b>${g.prestige || 0}</b><span class="caps">Престиж</span></div>
              <div><b>${g.kills || 0}</b><span class="caps">Убийств</span></div>
              <div><b>${g.deaths || 0}</b><span class="caps">Смертей</span></div>
              <div><b>${kdr}</b><span class="caps">K/D</span></div>
            </div>
            ${!mine ? `<p class="note">Вступить в клан можно в игре: попроси лидера пригласить тебя или открой меню <code>/clan</code>.</p>` : ""}
          </div>
        </div>
        <div class="dash ${staff ? "" : "dash--single"}">
          <div class="dash__col">
            <div class="card-box"><h3>Участники · ${members.length}${members.length < c.members ? ` <span class="muted small">(ещё ${c.members - members.length} без профиля на сайте)</span>` : ""}</h3>
              <div class="members">${members.map(m => `
                <div class="member-row">
                  <img src="${ava(m, 32)}" alt="" loading="lazy">
                  <div class="member-row__main">
                    ${m.is_public ? `<a href="players.html?nick=${encodeURIComponent(m.nickname)}"><b>${esc(m.nickname)}</b></a>` : `<b>${esc(m.nickname)}</b>`}${isOn(m, online) ? `<i class="dot on" title="В игре"></i>` : ""}
                    <span class="muted small">${ROLE_NAMES[m.role] || ""}${m.joined_at ? ` · с ${fmtDate(m.joined_at)}` : ""}</span>
                  </div>
                  <span class="member-row__chips">${m.role === "owner" ? `<span class="chip chip--rank" style="--c:var(--yellow)">Лидер</span>` : m.role === "officer" ? `<span class="chip">Модератор</span>` : ""}${rankChip(m.rank)}</span>
                </div>`).join("") || `<p class="muted">Участники клана ещё не заходили на сайт.</p>`}</div>
            </div>
          </div>
          ${staff ? `<div class="dash__col">
            <div class="card-box"><h3>Страница клана</h3>${pageForm(c)}</div>
          </div>` : ""}
        </div>`;

      if (staff) bindPageForm(c, async v => {
        const { error } = await sb.rpc("update_clan_page", { p_clan: c.id, p_description: v.description, p_flag: v.flag });
        if (error) throw error;
        toast("Страница клана сохранена"); viewClan(T);
      });
    }
  }

  /* =========================================================
     СТАТИСТИКА СЕРВЕРА (stats.html)
     Данные пишет плагин SiteSync раз в несколько минут: server_stats, online_history.
     ========================================================= */
  if (stRoot) {
    const RANGES = { day: { label: "24 часа", hours: 24, bucket: 0 }, week: { label: "7 дней", hours: 168, bucket: 60 }, month: { label: "30 дней", hours: 720, bucket: 180 } };
    const ENV = { NORMAL: "Обычный мир", NETHER: "Незер", THE_END: "Энд", CUSTOM: "Свой мир" };
    const num = v => Number(v || 0).toLocaleString("ru-RU");
    const dur = ms => { const m = Math.max(0, Math.floor(ms / 60000)), d = Math.floor(m / 1440), h = Math.floor(m % 1440 / 60);
      return d ? `${d} д ${h} ч` : h ? `${h} ч ${m % 60} мин` : `${m} мин`; };
    const ago = ts => { const m = Math.round((Date.now() - new Date(ts)) / 60000); return m < 1 ? "только что" : m < 60 ? `${m} мин назад` : `${Math.round(m / 60)} ч назад`; };
    /* Статус TPS: цвет + значок + подпись (никогда только цветом) */
    const tpsStatus = t => t == null ? null : t >= 19.5 ? ["good", "●", "Отлично"] : t >= 15 ? ["warn", "▲", "Подтормаживает"] : ["bad", "■", "Лагает"];

    viewStats();

    async function viewStats() {
      const [{ data: st, error }, totals] = await Promise.all([
        sb.from("server_stats").select("*").eq("id", 1).maybeSingle(),
        sb.rpc("server_totals")]);
      if (error && !/does not exist|Could not find/i.test(error.message)) {
        stRoot.innerHTML = `<div class="acc-soon"><h1 class="head__title">Не удалось загрузить</h1><p class="head__sub">${esc(errText(error))}</p></div>`; return;
      }
      const t = (totals.data && totals.data[0]) || {};
      const fresh = st && st.running && Date.now() - new Date(st.updated_at) < 15 * 60000;
      const ts = fresh ? tpsStatus(st.tps) : null;
      stRoot.innerHTML = `
        <div class="dash-head">
          <div><span class="head__label caps">Сервер</span><h1 class="head__title">Статистика</h1>
            <p class="head__sub">${st ? `Данные с сервера обновляются раз в 5 минут · последнее обновление ${ago(st.updated_at)}.` : "Данные появятся, когда сервер начнёт их отправлять (плагин SiteSync)."}</p></div>
          <div class="status ${fresh ? "" : "status--off"}"><span class="dot ${fresh ? "on" : "off"}"></span>${fresh ? "Сервер работает" : st ? "Сервер выключен или не отвечает" : "Нет данных"}</div>
        </div>

        <div class="specs st-specs">
          <div class="spec"><div class="spec__num">${fresh ? st.online : "—"}<small>/ ${st ? st.max_players : "—"}</small></div><div class="spec__label caps">онлайн сейчас</div></div>
          <div class="spec"><div class="spec__num">${fresh && st.tps != null ? Number(st.tps).toFixed(1) : "—"}</div><div class="spec__label caps">TPS ${ts ? `<span class="st-badge st-badge--${ts[0]}">${ts[1]} ${ts[2]}</span>` : ""}</div></div>
          <div class="spec"><div class="spec__num">${fresh && st.mspt != null ? Number(st.mspt).toFixed(1) : "—"}<small>мс</small></div><div class="spec__label caps">время тика</div></div>
          <div class="spec"><div class="spec__num st-small">${fresh && st.started_at ? dur(Date.now() - new Date(st.started_at)) : "—"}</div><div class="spec__label caps">без перезапуска</div></div>
        </div>

        <div class="card-box st-chart-card">
          <div class="st-chart-head">
            <div><h3>Онлайн</h3><p class="muted small" id="ch-sum">Загружаем…</p></div>
            <div class="seg seg--inline" id="ch-range">${Object.entries(RANGES).map(([k, r], i) => `<button data-r="${k}" class="${i ? "" : "active"}">${r.label}</button>`).join("")}</div>
          </div>
          <div class="st-chart" id="chart"></div>
          <details class="st-table"><summary>Показать таблицей</summary><div id="ch-table"></div></details>
        </div>

        <div class="specs st-specs st-totals">
          <div class="spec"><div class="spec__num">${num(t.players)}</div><div class="spec__label caps">игроков всего</div></div>
          <div class="spec"><div class="spec__num">${num(t.active_day)}</div><div class="spec__label caps">заходили за сутки</div></div>
          <div class="spec"><div class="spec__num">${num(t.active_week)}</div><div class="spec__label caps">за неделю</div></div>
          <div class="spec"><div class="spec__num">${num(Math.floor((t.playtime_minutes || 0) / 60))}<small>ч</small></div><div class="spec__label caps">наиграно всеми</div></div>
        </div>

        <div class="st-tops" id="tops"></div>

        ${fresh && Array.isArray(st.worlds) && st.worlds.length ? `<div class="card-box"><h3>Миры</h3>
          <div class="st-worlds"><div class="st-worlds__row st-worlds__head caps"><span>Мир</span><span>Игроков</span><span>Чанков</span><span>Сущностей</span></div>
          ${st.worlds.map(w => `<div class="st-worlds__row"><span><b>${esc(w.name)}</b><small class="muted">${ENV[w.env] || esc(w.env || "")}</small></span>
            <span>${num(w.players)}</span><span>${num(w.chunks)}</span><span>${w.entities != null ? num(w.entities) : "—"}</span></div>`).join("")}</div></div>` : ""}`;

      $("ch-range").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return;
        $$("#ch-range button").forEach(x => x.classList.toggle("active", x === b)); drawChart(b.dataset.r); });
      drawChart("day");
      loadTops();
    }

    /* ---------- История онлайна (по 1000 строк за запрос — лимит Supabase) ---------- */
    const histCache = {};
    async function history(hours) {
      if (histCache[hours]) return histCache[hours];
      const since = new Date(Date.now() - hours * 3600000).toISOString(), out = [];
      for (let from = 0; from < 20000; from += 1000) {
        const { data, error } = await sb.from("online_history").select("ts,online,tps").gte("ts", since).order("ts").range(from, from + 999);
        if (error) throw error;
        out.push(...data);
        if (data.length < 1000) break;
      }
      return (histCache[hours] = out.map(p => ({ t: new Date(p.ts).getTime(), v: p.online })));
    }
    /* Для недели и месяца — максимум за интервал (пик важнее среднего) */
    function bucketize(points, minutes) {
      if (!minutes) return points;
      const size = minutes * 60000, map = new Map();
      for (const p of points) { const k = Math.floor(p.t / size) * size; map.set(k, Math.max(map.get(k) ?? 0, p.v)); }
      return [...map].map(([t, v]) => ({ t, v })).sort((a, b) => a.t - b.t);
    }

    async function drawChart(rangeKey) {
      const r = RANGES[rangeKey], box = $("chart");
      let pts;
      try { pts = bucketize(await history(r.hours), r.bucket); }
      catch (e) { box.innerHTML = `<p class="form__msg">${esc(errText(e))}</p>`; return; }
      if (pts.length < 2) {
        $("ch-sum").textContent = "Пока мало данных";
        box.innerHTML = `<p class="players-empty">График появится, когда сервер пришлёт хотя бы пару точек — это примерно 10 минут после установки SiteSync.</p>`;
        $("ch-table").innerHTML = ""; return;
      }
      const peak = pts.reduce((a, b) => b.v > a.v ? b : a), avg = pts.reduce((s, p) => s + p.v, 0) / pts.length;
      const fmtT = t => new Date(t).toLocaleString("ru-RU", rangeKey === "day" ? { hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
      $("ch-sum").innerHTML = `Пик <b>${peak.v}</b> · ${esc(fmtT(peak.t))} &nbsp;·&nbsp; в среднем <b>${avg.toFixed(1)}</b>`;

      const W = Math.max(320, box.clientWidth || 800), H = 260, L = 34, R = 10, T = 12, B = 26;
      const t0 = Date.now() - r.hours * 3600000, t1 = Date.now();
      const step = [1, 2, 5, 10, 20, 25, 50, 100].find(s => Math.ceil(Math.max(peak.v, 4) / s) <= 5) || 100;
      const yMax = Math.ceil(Math.max(peak.v, 4) / step) * step;
      const x = t => L + (t - t0) / (t1 - t0) * (W - L - R), y = v => T + (1 - v / yMax) * (H - T - B);
      /* Разрыв линии, если сервер не присылал данные (выключен) */
      const gap = (r.bucket || 5) * 60000 * 3, segs = [[]];
      pts.forEach((p, i) => { if (i && p.t - pts[i - 1].t > gap) segs.push([]); segs[segs.length - 1].push(p); });
      const line = s => s.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
      const area = s => s.length < 2 ? "" : `${line(s)}L${x(s[s.length - 1].t).toFixed(1)},${y(0)}L${x(s[0].t).toFixed(1)},${y(0)}Z`;
      let grid = "";
      for (let v = 0; v <= yMax; v += step) grid += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="ch-grid"/><text x="${L - 8}" y="${y(v) + 4}" class="ch-ax" text-anchor="end">${v}</text>`;
      const tickEvery = rangeKey === "day" ? 3 * 3600000 : rangeKey === "week" ? 86400000 : 5 * 86400000;
      for (let tt = Math.ceil(t0 / tickEvery) * tickEvery; tt <= t1; tt += tickEvery) {
        const label = new Date(tt).toLocaleString("ru-RU", rangeKey === "day" ? { hour: "2-digit", minute: "2-digit" } : rangeKey === "week" ? { weekday: "short" } : { day: "numeric", month: "short" });
        grid += `<text x="${x(tt)}" y="${H - 6}" class="ch-ax" text-anchor="middle">${esc(label)}</text>`;
      }
      box.innerHTML = `<svg class="ch" viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Онлайн за ${r.label}: пик ${peak.v}, в среднем ${avg.toFixed(1)}">
          ${grid}
          ${segs.map(s => `<path d="${area(s)}" class="ch-area"/><path d="${line(s)}" class="ch-line"/>`).join("")}
          <g class="ch-hover" id="ch-hover" style="display:none"><line y1="${T}" y2="${H - B}" class="ch-cross"/><circle r="5" class="ch-dot"/></g>
          <rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent" id="ch-hit"/>
        </svg><div class="ch-tip" id="ch-tip" hidden></div>`;
      const hit = $("ch-hit"), hov = $("ch-hover"), tip = $("ch-tip"), svg = box.querySelector("svg");
      const move = e => {
        const rect = svg.getBoundingClientRect(), mx = (e.clientX - rect.left) * W / rect.width;
        const tt = t0 + (mx - L) / (W - L - R) * (t1 - t0);
        let best = pts[0]; for (const p of pts) if (Math.abs(p.t - tt) < Math.abs(best.t - tt)) best = p;
        const px = x(best.t), py = y(best.v);
        hov.style.display = ""; hov.querySelector("line").setAttribute("x1", px); hov.querySelector("line").setAttribute("x2", px);
        hov.querySelector("circle").setAttribute("cx", px); hov.querySelector("circle").setAttribute("cy", py);
        tip.hidden = false; tip.innerHTML = `<b>${best.v}</b> ${plural(best.v, "игрок", "игрока", "игроков")}${r.bucket ? " (пик)" : ""}<span>${esc(fmtT(best.t))}</span>`;
        const left = px / W * rect.width; tip.style.left = Math.min(rect.width - 150, Math.max(0, left - 70)) + "px"; tip.style.top = Math.max(0, py / H * rect.height - 64) + "px";
      };
      hit.addEventListener("pointermove", move);
      hit.addEventListener("pointerleave", () => { hov.style.display = "none"; tip.hidden = true; });

      /* Таблица: по часам для суток, по дням для недели и месяца */
      const tb = bucketize(pts, rangeKey === "day" ? 60 : 1440).reverse();
      $("ch-table").innerHTML = `<div class="st-worlds"><div class="st-worlds__row st-worlds__head caps"><span>${rangeKey === "day" ? "Час" : "День"}</span><span>Пик онлайна</span></div>
        ${tb.map(p => `<div class="st-worlds__row"><span>${esc(new Date(p.t).toLocaleString("ru-RU", rangeKey === "day" ? { hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "long" }))}</span><span>${p.v}</span></div>`).join("")}</div>`;
    }

    /* ---------- Топы игроков и кланов ---------- */
    async function loadTops() {
      const top = key => sb.from("profiles").select("nickname,skin,stats").not(`stats->${key}`, "is", null)
        .order(`stats->${key}`, { ascending: false, nullsFirst: false }).limit(10);
      const [play, mined, pvp, clans] = await Promise.all([top("playtime"), top("blocks_mined"), top("player_kills"),
        sb.from("clans").select("name,tag,flag,game,members").order("game->xp", { ascending: false, nullsFirst: false }).limit(10)]);
      const list = (title, res, val, unit) => {
        const rows = (res.data || []).map(p => ({ p, v: Number(val(p)) || 0 })).filter(r => r.v > 0).sort((a, b) => b.v - a.v);
        const max = Math.max(1, ...rows.map(r => r.v));
        return `<div class="card-box"><h3>${title}</h3>${rows.length ? `<ol class="st-top">${rows.map((r, i) => `
          <li><span class="st-top__n">${i + 1}</span>
            <a href="players.html?nick=${encodeURIComponent(r.p.nickname)}"><img src="${ava(r.p, 24)}" alt="" loading="lazy">${esc(r.p.nickname)}</a>
            <span class="st-top__v">${unit(r.v)}</span>
            <i class="st-top__bar" style="width:${(r.v / max * 100).toFixed(1)}%"></i></li>`).join("")}</ol>`
          : `<p class="muted">Пока нет данных — они появятся после первых выходов игроков с сервера.</p>`}</div>`;
      };
      const clanRows = (clans.data || []).filter(c => Number((c.game || {}).xp) > 0);
      const cmax = Math.max(1, ...clanRows.map(c => Number(c.game.xp)));
      $("tops").innerHTML =
        list("Больше всех в игре", play, p => p.stats.playtime, v => `${num(Math.floor(v / 60))} ч`) +
        list("Добыли блоков", mined, p => p.stats.blocks_mined, v => num(v)) +
        list("Победы в PvP", pvp, p => p.stats.player_kills, v => num(v)) +
        `<div class="card-box"><h3>Кланы по опыту</h3>${clanRows.length ? `<ol class="st-top">${clanRows.map((c, i) => `
          <li><span class="st-top__n">${i + 1}</span>
            <a href="${clanUrl(c)}">${flagSvg(c.flag, "flag--xs")}${clanName(c)}</a>
            <span class="st-top__v">${num(c.game.xp)} XP</span>
            <i class="st-top__bar" style="width:${(c.game.xp / cmax * 100).toFixed(1)}%"></i></li>`).join("")}</ol>`
          : `<p class="muted">Кланы с опытом появятся здесь.</p>`}</div>`;
    }
  }
})();
