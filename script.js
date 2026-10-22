/* =========================================================
   Сфинксляндия — логика сайта.
   Весь контент берётся из data/content.js (window.SITE),
   который редактируется через админку admin.html.
   ========================================================= */

const SITE = window.SITE || {};
const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const fmt = s => esc(s).replace(/\n/g, "<br>");
const get = (obj, path) => path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
const safeUrl = u => /^(https?:\/\/|img\/|\.\/|\/)/i.test(u || "") ? u : "";
const fmtDate = d => { const x = new Date(d); return isNaN(x) ? esc(d) : x.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" }); };
const S = SITE.server || {};

/* ---------- Простые тексты: data-t="hero.line1" ---------- */
$$("[data-t]").forEach(el => { const v = get(SITE, el.dataset.t); if (v != null) el.innerHTML = fmt(v); });
$$("[data-version]").forEach(el => el.textContent = S.version || "—");

/* Текст с абзацами и списками: строки "- …" → маркированный, "1. …" → нумерованный */
function rich(text) {
  return String(text ?? "").split(/\n\s*\n/).map(block => {
    const lines = block.split("\n").filter(l => l.trim());
    if (lines.length && lines.every(l => /^\s*-\s+/.test(l))) return `<ul>${lines.map(l => `<li>${esc(l.replace(/^\s*-\s+/, ""))}</li>`).join("")}</ul>`;
    if (lines.length && lines.every(l => /^\s*\d+[.)]\s+/.test(l))) return `<ol>${lines.map(l => `<li>${esc(l.replace(/^\s*\d+[.)]\s+/, ""))}</li>`).join("")}</ol>`;
    return `<p>${lines.map(esc).join("<br>")}</p>`;
  }).join("");
}
const head = (nick, size) => `https://mc-heads.net/avatar/${encodeURIComponent(nick || "MHF_Steve")}/${size}`;

/* ---------- Подвал (общий для всех страниц) ---------- */
if ($("footer")) {
  $("footer").innerHTML = `<div class="wrap">
    <div class="footer__grid">
      <div class="footer__brand">
        <img src="img/logo.png" alt="">
        <p>Minecraft-сервер стримера FatSphinx.<br>Место, где зрители встречаются и играют вместе.</p>
        <div class="footer__ip">
          <button class="btn btn--dark" data-copy="java">IP Java</button>
          <button class="btn btn--dark" data-copy="bedrock">IP Bedrock</button>
        </div>
      </div>
      <div><h4 class="caps">Сервер</h4><ul><li><a href="index.html#about">О сервере</a></li><li><a href="index.html#online">Онлайн</a></li><li><a href="news.html">Новости</a></li><li><a href="index.html#faq">FAQ</a></li></ul></div>
      <div><h4 class="caps">Игрокам</h4><ul><li><a href="guide.html">Как начать</a></li><li><a href="rules.html">Правила</a></li><li><a href="players.html">Игроки</a></li><li><a href="account.html">Мой профиль</a></li><li><a href="donate.html">Донат</a></li></ul></div>
      <div><h4 class="caps">Сообщество</h4><ul><li><a data-link="discord">Discord</a></li><li><a data-link="telegram">Telegram</a></li><li><a data-link="youtube">YouTube</a></li><li><a data-link="twitch">Twitch</a></li></ul></div>
    </div>
    <div class="footer__bottom">
      <span>© 2026 Сфинксляндия</span>
      <span>Не является официальным продуктом Minecraft. Не одобрено и не связано с Mojang или Microsoft.</span>
    </div>
  </div>`;
}

/* ---------- Шапка ---------- */
const page = location.pathname.split("/").pop() || "index.html";
$$(".nav a").forEach(a => { if (a.getAttribute("href") === page) a.classList.add("active"); });
/* Кнопка профиля: если игрок уже входил — показываем его голову и ник */
(function accBtn() {
  const b = $("acc-btn"); if (!b) return;
  if (page === "account.html") b.classList.add("active");
  let nick = "", logged = false;
  try {
    nick = localStorage.getItem("sl-nick") || "";
    logged = Object.keys(localStorage).some(k => /^sb-.+-auth-token$/.test(k));
  } catch {}
  if (logged && nick) { b.querySelector("img").src = head(nick, 24); b.querySelector("span").textContent = nick; }
  else if ((SITE.auth || {}).supabaseUrl) b.querySelector("span").textContent = "Войти";
})();
const header = document.querySelector(".header");
const onScroll = () => header && header.classList.toggle("scrolled", scrollY > 30);
addEventListener("scroll", onScroll, { passive: true }); onScroll();
const burger = $("burger"), nav = $("nav");
if (burger && nav) {
  burger.addEventListener("click", () => nav.classList.toggle("open"));
  nav.querySelectorAll("a").forEach(a => a.addEventListener("click", () => nav.classList.remove("open")));
}

/* ---------- Плитки «О сервере» ---------- */
if ($("features")) {
  $("features").innerHTML = (SITE.features || []).map((f, i) => {
    const img = safeUrl(f.image);
    return `<article class="tile ${i === 0 ? "tile--big" : ""} ${img ? "has-img" : ""} reveal" ${img ? `style="--img:url('${esc(img)}')"` : ""}>
      ${i === 0 && !img ? `<img class="tile__art" src="img/logo.png" alt="">` : ""}
      <span class="tile__label caps">${esc(f.label)}</span>
      <div>
        <h3>${esc(f.title)}</h3>
        <p>${fmt(f.text)}</p>
        ${i === 0 ? `<div class="tile__actions"><a class="btn btn--primary" href="#start">Начать</a><a class="btn btn--ghost" data-link="discord">Найти команду</a></div>` : ""}
      </div>
    </article>`;
  }).join("");
}

/* ---------- Новости ---------- */
function newsCard(n, full) {
  const img = safeUrl(n.image);
  return `<article class="news-card reveal" id="${esc(n.id || "")}">
    ${img ? `<div class="news-card__img"><img src="${esc(img)}" alt="" loading="lazy"></div>` : ""}
    <div class="news-card__body">
      <span class="caps news-card__date">${fmtDate(n.date)}</span>
      <h3>${esc(n.title)}</h3>
      <p class="${full ? "" : "clamp"}">${fmt(n.text)}</p>
      ${full ? "" : `<a class="news-card__more caps" href="news.html#${esc(n.id || "")}">Читать →</a>`}
    </div>
  </article>`;
}
const news = [...(SITE.news || [])].sort((a, b) => String(b.date).localeCompare(String(a.date)));
if ($("news-list")) {
  if (news.length) $("news-list").innerHTML = news.slice(0, 3).map(n => newsCard(n, false)).join("");
  else $("news")?.remove();
}
if ($("news-all")) {
  $("news-all").innerHTML = news.length ? news.map(n => newsCard(n, true)).join("") : `<p class="players-empty">Новостей пока нет.</p>`;
  const target = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)));
  if (target) setTimeout(() => target.scrollIntoView({ behavior: "smooth" }), 100);
}

/* ---------- Правила ---------- */
if ($("rules-short")) {
  $("rules-short").innerHTML = (SITE.rulesShort || []).map((r, i) =>
    `<div class="rule"><span class="rule__n">${String(i + 1).padStart(2, "0")}</span><h4>${esc(r.title)}</h4><p>${fmt(r.text)}</p></div>`).join("");
}
if ($("rules-full")) {
  $("rules-full").innerHTML = (SITE.rules || []).map((g, gi) => `
    <div class="rules-group">
      <h2><span>${String(gi + 1).padStart(2, "0")}</span>${esc(g.title)}</h2>
      <ul class="rules-list">${(g.items || []).map((it, ii) => `
        <li><b>${gi + 1}.${ii + 1}</b><div>${fmt(it.text)}${it.punish ? `<span class="punish">${esc(it.punish)}</span>` : ""}</div></li>`).join("")}
      </ul>
    </div>`).join("");
}

/* ---------- Гайд ---------- */
if ($("guide")) {
  const secs = (SITE.guide || []).map((g, i) => ({ ...g, id: "g" + (i + 1) }));
  $("guide").innerHTML = secs.map((g, i) => `
    <section class="guide-sec" id="${g.id}">
      <h2><span>${String(i + 1).padStart(2, "0")}</span>${esc(g.title)}</h2>
      <div class="prose">${rich(g.text)}</div>
    </section>`).join("");
  const cmds = (SITE.commands || []).filter(c => c.cmd);
  if (cmds.length) {
    $("commands").hidden = false;
    $("commands-list").innerHTML = cmds.map(c => `<div class="cmd"><code>${esc(c.cmd)}</code><span>${esc(c.desc)}</span></div>`).join("");
  }
  $("guide-toc").innerHTML = `<span class="caps muted">Содержание</span>` +
    [...secs, ...(cmds.length ? [{ id: "commands", title: "Полезные команды" }] : [])]
      .map(g => `<a href="#${g.id}">${esc(g.title)}</a>`).join("");
}

/* ---------- Команда ---------- */
if ($("team-list")) {
  const team = (SITE.team || []).filter(t => t.nick);
  if (team.length) {
    $("team").hidden = false;
    $("team-list").innerHTML = team.map(t => `
      <div class="member">
        <img src="${head(t.nick, 64)}" alt="" loading="lazy">
        <div><b>${esc(t.nick)}</b><span class="caps">${esc(t.role)}</span>${t.text ? `<p>${fmt(t.text)}</p>` : ""}</div>
      </div>`).join("");
  }
}

/* ---------- FAQ ---------- */
if ($("faq-list")) {
  $("faq-list").innerHTML = (SITE.faq || []).map(f =>
    `<details><summary>${esc(f.q)}</summary><div class="answer">${fmt(f.a)}</div></details>`).join("");
}

/* ---------- Ссылки на соцсети ---------- */
$$("[data-link]").forEach(a => {
  const url = safeUrl((SITE.links || {})[a.dataset.link]);
  if (url) { a.href = url; a.target = "_blank"; a.rel = "noopener"; }
  else {
    a.removeAttribute("href"); a.classList.add("is-empty");
    const go = a.querySelector(".social__go"); if (go) go.textContent = "Скоро";
  }
});

/* ---------- Появление при скролле ---------- */
const io = "IntersectionObserver" in window ? new IntersectionObserver(es => es.forEach(e => {
  if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
}), { threshold: .1 }) : null;
$$(".reveal").forEach(el => io ? io.observe(el) : el.classList.add("in"));

/* ---------- IP ---------- */
let edition = "java";
function showIp(ed) {
  edition = ed;
  const ip = S[ed] || "—";
  if ($("ip-value")) $("ip-value").textContent = ip;
  $$(".ip-tab").forEach(t => t.classList.toggle("active", t.dataset.edition === ed));
  if ($("ip-hint")) {
    const [host, port] = ip.split(":");
    $("ip-hint").innerHTML = ed === "java"
      ? "Мультиплеер → Добавить сервер → вставь адрес целиком"
      : `Серверы → Добавить сервер: адрес <b>${esc(host)}</b>, порт <b>${esc(port || "19132")}</b>`;
  }
}
$$(".ip-tab").forEach(t => t.addEventListener("click", () => showIp(t.dataset.edition)));
showIp("java");

function toast(text) {
  const t = $("toast"); if (!t) return;
  t.textContent = text; t.classList.add("show");
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 1800);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch { const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); }
  toast("IP скопирован");
}
$$("[data-copy]").forEach(b => b.addEventListener("click", () =>
  copyText(S[b.dataset.copy === "current" ? edition : b.dataset.copy] || "")));

/* ---------- Онлайн сервера (mcsrvstat.us) ---------- */
/* Статус сервера; используется и на главной, и в профилях (кто сейчас в игре) */
let statusCache = null;
function getStatus() {
  if (!S.java) return Promise.reject(new Error("нет IP"));
  if (!statusCache || Date.now() - statusCache.t > 55000) {
    statusCache = { t: Date.now(), p: fetch(`https://api.mcsrvstat.us/3/${S.java}`, { cache: "no-store" }).then(r => r.json()) };
    statusCache.p.catch(() => { statusCache = null; });
  }
  return statusCache.p;
}
async function loadStatus() {
  if ((!$("status-text") && !$("online-big")) || !S.java) return;
  try {
    const d = await getStatus();
    const on = !!d.online, now = on ? (d.players?.online ?? 0) : 0, max = on ? (d.players?.max ?? 0) : 0;
    $$(".status .dot, .frame .dot").forEach(x => { x.classList.toggle("on", on); x.classList.toggle("off", !on); });
    if ($("status-text")) $("status-text").textContent = on ? `Онлайн · ${now} из ${max}` : "Сервер офлайн";
    if ($("hud-online")) $("hud-online").textContent = on ? `${now}/${max}` : "офлайн";
    if ($("spec-online")) $("spec-online").textContent = now;
    if ($("spec-max")) $("spec-max").textContent = max || "—";
    if ($("online-big")) $("online-big").innerHTML = `${now}<small> / ${max || "—"}</small>`;
    if ($("online-motd")) $("online-motd").textContent = on ? (d.motd?.clean?.join(" ") || "Сервер работает") : "Сервер не отвечает. Загляни чуть позже.";
    if ($("bar-fill")) $("bar-fill").style.width = max ? Math.min(100, now / max * 100) + "%" : "0";
    const list = $("players");
    if (list) {
      const ps = d.players?.list || [];
      list.innerHTML = ps.length
        ? ps.map(p => { const n = p.name || p; return `<a class="player" href="players.html?nick=${encodeURIComponent(n)}"><img src="${head(n, 26)}" alt="" loading="lazy"><span>${esc(n)}</span></a>`; }).join("")
        : `<p class="players-empty">${on && now ? "Сервер скрывает список ников, но игроки на месте." : "Сейчас никого нет — самое время стать первым."}</p>`;
    }
  } catch {
    if ($("status-text")) $("status-text").textContent = "Статус недоступен";
    if ($("online-motd")) $("online-motd").textContent = "Не удалось получить статус сервера.";
  }
}
loadStatus(); setInterval(loadStatus, 60000);

/* ---------- Hero: сетка блоков и пиксельный горизонт ---------- */
(function blocks() {
  const cv = $("blocks"); if (!cv) return;
  const g = cv.getContext("2d"), C = 32;
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let W, H, cols, rows, ground = [], lit = [];
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  function resize() {
    W = cv.width = cv.offsetWidth; H = cv.height = cv.offsetHeight;
    cols = Math.ceil(W / C) + 1; rows = Math.ceil(H / C);
    seed = 11;
    /* Рельеф: высота каждой колонки в блоках (1–4), плюс редкая «руда» */
    ground = Array.from({ length: cols }, (_, x) => {
      const h = 2 + Math.round(Math.sin(x / 5) * 1.1 + Math.sin(x / 2.3) * .6);
      return { h: Math.max(1, Math.min(4, h)), ore: Array.from({ length: 4 }, () => rnd() < .1) };
    });
  }
  function draw(t) {
    g.clearRect(0, 0, W, H);
    /* Линии сетки, плавно исчезающие кверху */
    for (let y = 0; y < rows; y++) {
      g.fillStyle = `rgba(255,230,180,${.05 * Math.min(1, y / rows * 1.6)})`;
      g.fillRect(0, y * C, W, 1);
    }
    for (let x = 0; x < cols; x++) {
      const grad = g.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, "rgba(255,230,180,0)"); grad.addColorStop(1, "rgba(255,230,180,.05)");
      g.fillStyle = grad; g.fillRect(x * C, 0, 1, H);
    }
    /* Вспыхивающие блоки */
    lit.forEach(b => {
      const a = Math.sin(Math.min(1, (t - b.t0) / b.d) * Math.PI);
      g.fillStyle = `rgba(255,201,42,${.09 * a})`; g.fillRect(b.x * C + 1, b.y * C + 1, C - 1, C - 1);
    });
    /* Горизонт из блоков */
    ground.forEach((col, x) => {
      for (let k = 0; k < col.h; k++) {
        const y = H - (k + 1) * C, top = k === col.h - 1;
        g.fillStyle = top ? "#241c0f" : (x + k) % 2 ? "#17130b" : "#1a150c";
        g.fillRect(x * C, y, C, C);
        if (top) { g.fillStyle = "rgba(255,201,42,.55)"; g.fillRect(x * C, y, C, 3); }
        if (col.ore[k] && !top) {
          g.fillStyle = k % 2 ? "#c8601a" : "#f7a51a";
          g.fillRect(x * C + 8, y + 10, 6, 6); g.fillRect(x * C + 18, y + 18, 6, 6);
        }
      }
    });
  }
  function tick(t) {
    lit = lit.filter(b => t - b.t0 < b.d);
    if (lit.length < 14 && Math.random() < .2)
      lit.push({ x: Math.floor(Math.random() * cols), y: Math.floor(Math.random() * (rows - 5)), t0: t, d: 1800 + Math.random() * 2200 });
    draw(t);
  }
  resize(); addEventListener("resize", () => { resize(); draw(performance.now()); });
  if (still) { draw(0); return; }
  let last = 0;
  (function loop(t) { if (t - last > 100) { tick(t); last = t; } requestAnimationFrame(loop); })(0);
})();

/* ---------- Страница доната ---------- */
(function donate() {
  const box = $("tiers"); if (!box) return;
  const D = SITE.donate || {}, tiers = (D.tiers || []).map((t, i) => ({ ...t, id: t.id || "t" + i }));
  if (!tiers.length) { box.innerHTML = `<p class="players-empty">Привилегии скоро появятся.</p>`; return; }
  const money = v => `${Number(v || 0).toLocaleString("ru-RU")} ${D.currency || "₽"}`;
  const rgba = (hex, a) => { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ""); if (!m) return `rgba(255,122,26,${a})`; const n = parseInt(m[1], 16); return `rgba(${n >> 16},${n >> 8 & 255},${n & 255},${a})`; };

  box.innerHTML = tiers.map(t => `
    <button class="tier" data-id="${esc(t.id)}" style="--c:${esc(t.color)}">
      <span class="tier__name"><i></i>${esc(t.name)}${t.tag ? `<span class="tier__tag">${esc(t.tag)}</span>` : ""}</span>
      <span class="tier__price">${money(t.price)} <small>${esc(D.period)}</small></span>
    </button>`).join("");

  function select(id) {
    const i = Math.max(0, tiers.findIndex(t => t.id === id)), t = tiers[i];
    $$(".tier").forEach(b => b.classList.toggle("active", b.dataset.id === t.id));
    const stage = $("stage");
    stage.style.setProperty("--glow", rgba(t.color, .16));
    stage.style.setProperty("--glow-solid", t.color);
    $("rank-name").textContent = t.name; $("rank-name").style.color = t.color;
    $("rank-sub").textContent = t.sub || "";
    $("spec-price").textContent = money(t.price);
    $("spec-perks").textContent = tiers.slice(0, i + 1).reduce((n, x) => n + (x.perks || []).length, 0);
    $("spec-level").textContent = `${i + 1}/${tiers.length}`;
    $("total").textContent = money(t.price);
    const perks = $("perks"); perks.style.setProperty("--c", t.color);
    perks.innerHTML = (t.perks || []).map(p => `<li>${esc(p)}</li>`).join("") +
      (i > 0 ? `<li class="inherit">Всё из привилегии «${esc(tiers[i - 1].name)}» и ниже</li>` : "");
    const buy = $("buy"), url = safeUrl(t.url || D.shopUrl);
    if (url) { buy.href = url; buy.target = "_blank"; buy.rel = "noopener"; buy.classList.remove("is-empty"); buy.querySelector(".lbl").textContent = `Купить «${t.name}»`; }
    else { buy.removeAttribute("href"); buy.classList.add("is-empty"); buy.querySelector(".lbl").textContent = "Магазин скоро откроется"; }
    history.replaceState(null, "", "#" + t.id);
  }
  box.addEventListener("click", e => { const b = e.target.closest(".tier"); if (b) select(b.dataset.id); });
  const fromHash = tiers.find(t => t.id === location.hash.slice(1));
  select((fromHash || tiers.find(t => t.tag) || tiers[0]).id);

  const sup = $("support"), su = safeUrl(D.supportUrl);
  if (sup) { if (su) { sup.href = su; sup.target = "_blank"; sup.rel = "noopener"; } else { sup.removeAttribute("href"); sup.classList.add("is-empty"); sup.querySelector(".lbl").textContent = "Скоро"; } }
})();
