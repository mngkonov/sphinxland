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

/* ---------- Шапка ---------- */
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
    return `<article class="tile ${i === 0 ? "tile--big" : ""} reveal" ${img ? `style="--img:url('${esc(img)}')"` : ""}>
      <span class="tile__label caps">${esc(f.label)}</span>
      <div>
        <h3>${esc(f.title)}</h3>
        <p>${fmt(f.text)}</p>
        ${i === 0 ? `<div class="tile__actions"><a class="btn btn--light" href="#start">Начать</a><a class="btn btn--dark" data-link="discord">Найти клан</a></div>` : ""}
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
async function loadStatus() {
  if ((!$("status-text") && !$("online-big")) || !S.java) return;
  try {
    const r = await fetch(`https://api.mcsrvstat.us/3/${S.java}`, { cache: "no-store" });
    const d = await r.json();
    const on = !!d.online, now = on ? (d.players?.online ?? 0) : 0, max = on ? (d.players?.max ?? 0) : 0;
    $$(".dot").forEach(x => { x.classList.toggle("on", on); x.classList.toggle("off", !on); });
    if ($("status-text")) $("status-text").textContent = on ? `Онлайн · ${now} из ${max}` : "Сервер офлайн";
    if ($("spec-online")) $("spec-online").textContent = now;
    if ($("spec-max")) $("spec-max").textContent = max || "—";
    if ($("online-big")) $("online-big").innerHTML = `${now}<small> / ${max || "—"}</small>`;
    if ($("online-motd")) $("online-motd").textContent = on ? (d.motd?.clean?.join(" ") || "Сервер работает") : "Сервер не отвечает. Загляни чуть позже.";
    if ($("bar-fill")) $("bar-fill").style.width = max ? Math.min(100, now / max * 100) + "%" : "0";
    const list = $("players");
    if (list) {
      const ps = d.players?.list || [];
      list.innerHTML = ps.length
        ? ps.map(p => { const n = p.name || p; return `<div class="player"><img src="https://mc-heads.net/avatar/${encodeURIComponent(n)}/26" alt="" loading="lazy"><span>${esc(n)}</span></div>`; }).join("")
        : `<p class="players-empty">${on && now ? "Сервер скрывает список ников, но игроки на месте." : "Сейчас никого нет — самое время стать первым."}</p>`;
    }
  } catch {
    if ($("status-text")) $("status-text").textContent = "Статус недоступен";
    if ($("online-motd")) $("online-motd").textContent = "Не удалось получить статус сервера.";
  }
}
loadStatus(); setInterval(loadStatus, 60000);

/* ---------- Пиксельная сцена в портале ---------- */
(function scene() {
  const cv = $("scene"); if (!cv) return;
  const W = 100, H = 120; cv.width = W; cv.height = H;
  const g = cv.getContext("2d");
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const stars = Array.from({ length: 46 }, () => [Math.floor(rnd() * W), Math.floor(rnd() * 55), rnd()]);
  const P = (x, y, c, w = 1, h = 1) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
  const mix = (a, b, t) => { const p = s => [1,3,5].map(i => parseInt(s.slice(i, i + 2), 16)); const A = p(a), B = p(b);
    return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(",")})`; };
  function island(x, y, w, top) {
    for (let i = 0; i < w; i++) P(x + i, y, top);
    for (let i = 0; i < w; i++) P(x + i, y + 1, "#b8701c");
    let row = 2, l = x, r = x + w;
    while (r - l > 1) { for (let i = l; i < r; i++) P(i, y + row, (i + row) % 3 ? "#4a2a14" : "#3a1f0e"); l += 1 + (row % 2); r -= 1 + ((row + 1) % 2); row++; }
  }
  function pyramid(cx, base, h, lit, shade) {
    for (let y = 0; y < h; y++) for (let x = -y; x <= y; x++) {
      const c = x < 0 ? shade : lit; P(cx + x, base - h + y, (base - h + y) % 3 === 0 ? mix(c, "#000000", .15) : c);
    }
  }
  function draw(t) {
    for (let y = 0; y < 90; y++) { const k = y / 90; P(0, y, k < .5 ? mix("#0b0612", "#3a1226", k * 2) : mix("#3a1226", "#ff7a1a", (k - .5) * 2), W, 1); }
    stars.forEach(([x, y, p]) => { g.globalAlpha = .35 + .65 * Math.abs(Math.sin(t / 900 + p * 10)); P(x, y, "#ffe9b8"); });
    g.globalAlpha = 1;
    for (let r = 26; r > 0; r -= 2) { g.globalAlpha = .05; g.beginPath(); g.arc(50, 32, r, 0, 7); g.fillStyle = "#ffc83a"; g.fill(); }
    g.globalAlpha = 1;
    island(4, 50, 14, "#e8a33a"); island(80, 40, 12, "#e8a33a"); island(66, 66, 8, "#d99030");
    for (let x = 0; x < W; x++) { const h = 80 + Math.round(Math.sin(x / 9) * 3 + Math.sin(x / 4) * 1.2); P(x, h, "#5a2414", 1, H - h); }
    pyramid(28, 96, 22, "#e08a2a", "#8a3e12");
    pyramid(70, 98, 30, "#f29a2e", "#9a4612");
    pyramid(49, 100, 13, "#d47a24", "#7a3410");
    for (let x = 0; x < W; x++) {
      const h = 98 + Math.round(Math.sin(x / 13 + 1) * 3 + Math.sin(x / 5) * 1);
      for (let y = h; y < H; y++) P(x, y, (x * 7 + y * 13) % 9 === 0 ? "#c8741a" : y === h ? "#ffb444" : "#e8952a");
    }
  }
  let last = 0;
  (function loop(t) { if (t - last > 120) { draw(t); last = t; } requestAnimationFrame(loop); })(0);
})();

/* ---------- Искры в hero ---------- */
(function embers() {
  const cv = $("embers"); if (!cv) return;
  const g = cv.getContext("2d"); let W, H; const parts = [];
  const resize = () => { W = cv.width = cv.offsetWidth; H = cv.height = cv.offsetHeight; };
  resize(); addEventListener("resize", resize);
  for (let i = 0; i < 40; i++) parts.push({ x: Math.random(), y: Math.random(), s: 2 + Math.random() * 3, v: .0004 + Math.random() * .0009, o: Math.random() });
  (function loop() {
    g.clearRect(0, 0, W, H);
    parts.forEach(p => {
      p.y -= p.v; if (p.y < -.02) { p.y = 1.02; p.x = Math.random(); }
      g.globalAlpha = .25 + .5 * Math.abs(Math.sin(p.o += .01));
      g.fillStyle = p.s > 3.5 ? "#ffc83a" : "#ff7a1a";
      g.fillRect(Math.round(p.x * W), Math.round(p.y * H), p.s, p.s);
    });
    requestAnimationFrame(loop);
  })();
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
    stage.style.setProperty("--glow", rgba(t.color, .42));
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
