/* =========================================================
   Сфинксляндия — админка.
   Читает и сохраняет data/content.js в репозитории через GitHub API.
   Картинки загружаются в img/uploads/.
   ========================================================= */

const CONTENT_PATH = "data/content.js";
const UPLOAD_DIR = "img/uploads";
const LS_CFG = "sl-admin-cfg", LS_DRAFT = "sl-admin-draft";

const $ = id => document.getElementById(id);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? "" : v);
  }
  kids.flat().forEach(c => c != null && e.append(c instanceof Node ? c : document.createTextNode(c)));
  return e;
};
const uid = () => Math.random().toString(36).slice(2, 8);
const today = () => new Date().toISOString().slice(0, 10);

let cfg = {}, data = null, sha = null, dirty = false, current = "main";
const openItems = new WeakSet();

/* ---------- Схема разделов ---------- */
const URL_HINT = "Полная ссылка, начиная с https://";
const SECTIONS = [
  { id: "main", title: "Основное", intro: "Адреса сервера, версия и ссылки на соцсети. Пустая ссылка на сайте показывается как «Скоро».",
    cards: [
      { title: "Сервер", fields: [{ row: [
        { path: "server.java", label: "IP Java", ph: "185.9.145.230:32696" },
        { path: "server.bedrock", label: "IP Bedrock", ph: "185.9.145.230:19132" },
        { path: "server.version", label: "Версия игры", ph: "26.2" } ] }] },
      { title: "Соцсети", fields: [
        { row: [{ path: "links.discord", label: "Discord", type: "url", ph: "https://discord.gg/…" }, { path: "links.telegram", label: "Telegram", type: "url", ph: "https://t.me/…" }] },
        { row: [{ path: "links.youtube", label: "YouTube", type: "url", ph: "https://youtube.com/@…" }, { path: "links.twitch", label: "Twitch", type: "url", ph: "https://twitch.tv/…" }] } ] },
    ] },
  { id: "hero", title: "Главный экран", intro: "Большой заголовок в начале сайта и баннер доната на главной.",
    cards: [
      { title: "Заголовок", fields: [
        { path: "hero.badge", label: "Подпись над заголовком" },
        { row: [{ path: "hero.line1", label: "Строка 1 (белая)" }, { path: "hero.line2", label: "Строка 2 (белая)" }, { path: "hero.accent", label: "Строка 3 (оранжевая)" }] },
        { path: "hero.text", label: "Описание", type: "textarea" } ] },
      { title: "Баннер доната", fields: [
        { path: "banner.label", label: "Надпись сверху" },
        { row: [{ path: "banner.title", label: "Заголовок" }, { path: "banner.accent", label: "Выделенное слово" }] },
        { path: "banner.text", label: "Текст", type: "textarea" } ] },
    ] },
  { id: "features", title: "О сервере", intro: "Плитки в разделе «О сервере». Первая плитка — большая. Можно загрузить скриншот на фон.",
    cards: [{ title: "Плитки", list: { path: "features", add: "Добавить плитку", title: x => x.title,
      newItem: () => ({ label: "", title: "Новая плитка", text: "", image: "" }),
      fields: [{ row: [{ key: "label", label: "Метка", ph: "04 — Ивенты" }, { key: "title", label: "Заголовок" }] }, { key: "text", label: "Текст", type: "textarea" }, { key: "image", label: "Фон (скриншот)", type: "image" }] } }] },
  { id: "news", title: "Новости", intro: "На главной показываются 3 последние новости, все — на странице «Новости». Сортировка по дате.",
    cards: [{ title: "Новости", list: { path: "news", add: "Добавить новость", addTop: true, title: x => x.title, sub: x => x.date,
      newItem: () => ({ id: "n" + uid(), date: today(), title: "Новая новость", text: "", image: "" }),
      fields: [{ row: [{ key: "title", label: "Заголовок" }, { key: "date", label: "Дата", type: "date" }] }, { key: "text", label: "Текст", type: "textarea", rows: 6 }, { key: "image", label: "Картинка", type: "image" }] } }] },
  { id: "rules", title: "Правила", intro: "Короткие правила на главной и полный свод на странице «Правила». Нумерация проставляется сама.",
    cards: [
      { title: "Кратко на главной", list: { path: "rulesShort", add: "Добавить правило", title: x => x.title,
        newItem: () => ({ title: "", text: "" }),
        fields: [{ key: "title", label: "Заголовок" }, { key: "text", label: "Текст" }] } },
      { title: "Полные правила", list: { path: "rules", add: "Добавить раздел", title: x => x.title, sub: x => `${(x.items || []).length} пунктов`,
        newItem: () => ({ title: "Новый раздел", items: [] }),
        fields: [{ key: "title", label: "Название раздела" },
          { key: "items", label: "Пункты", type: "list", add: "Добавить пункт", title: x => x.text, newItem: () => ({ text: "", punish: "" }),
            fields: [{ key: "text", label: "Правило", type: "textarea", rows: 3 }, { key: "punish", label: "Наказание (необязательно)" }] }] } },
    ] },
  { id: "faq", title: "FAQ", intro: "Частые вопросы на главной.",
    cards: [{ title: "Вопросы", list: { path: "faq", add: "Добавить вопрос", title: x => x.q,
      newItem: () => ({ q: "Новый вопрос", a: "" }),
      fields: [{ key: "q", label: "Вопрос" }, { key: "a", label: "Ответ", type: "textarea" }] } }] },
  { id: "donate", title: "Донат", intro: "Привилегии на странице доната. Помни: продавать игровое преимущество запрещено правилами Mojang — только косметика.",
    cards: [
      { title: "Оплата", fields: [
        { path: "donate.shopUrl", label: "Ссылка на магазин", type: "url", hint: "EasyDonate, TradeMC и т.п. Используется, если у привилегии нет своей ссылки." },
        { path: "donate.supportUrl", label: "Ссылка «Просто поддержать»", type: "url", hint: "Boosty, DonationAlerts и т.п." },
        { row: [{ path: "donate.currency", label: "Валюта", ph: "₽" }, { path: "donate.period", label: "Срок", ph: "навсегда" }] } ] },
      { title: "Привилегии (от младшей к старшей)", list: { path: "donate.tiers", add: "Добавить привилегию", title: x => x.name, sub: x => x.price ? `${x.price} ₽` : "",
        newItem: () => ({ id: "t" + uid(), name: "Новая", price: 0, color: "#ffc83a", tag: "", sub: "", url: "", perks: [] }),
        fields: [
          { row: [{ key: "name", label: "Название" }, { key: "price", label: "Цена", type: "number" }, { key: "color", label: "Цвет", type: "color" }] },
          { row: [{ key: "sub", label: "Подзаголовок" }, { key: "tag", label: "Метка (напр. «Хит»)" }] },
          { key: "perks", label: "Бонусы — каждый с новой строки", type: "lines" },
          { key: "url", label: "Своя ссылка на оплату (необязательно)", type: "url" } ] } },
    ] },
];

/* ---------- Утилиты ---------- */
function resolve(path, create = true) {
  const keys = path.split("."), last = keys.pop();
  let o = data;
  for (const k of keys) { if (o[k] == null && create) o[k] = {}; o = o[k]; }
  return [o, last];
}
function setDirty(v = true) {
  dirty = v; $("dirty").classList.toggle("on", v);
  try { v ? localStorage.setItem(LS_DRAFT, JSON.stringify({ sha, data })) : localStorage.removeItem(LS_DRAFT); } catch {}
}
function toast(text, err) {
  const t = $("toast"); t.textContent = text; t.classList.toggle("err", !!err); t.classList.add("show");
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), err ? 5000 : 2500);
}
function busy(text) { $("busy").classList.toggle("hidden", !text); if (text) $("busy-text").textContent = text; }

const b64enc = str => { const b = new TextEncoder().encode(str); let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
const b64dec = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, "")), c => c.charCodeAt(0)));

/* ---------- GitHub API ---------- */
async function gh(path, opts = {}) {
  const r = await fetch("https://api.github.com" + path, {
    ...opts, cache: "no-store",
    headers: { Authorization: "Bearer " + cfg.token, Accept: "application/vnd.github+json", ...(opts.body ? { "Content-Type": "application/json" } : {}) },
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(body.message || r.statusText); e.status = r.status; throw e; }
  return body;
}
const contentsUrl = p => `/repos/${cfg.repo}/contents/${p}`;
async function loadContent() {
  const f = await gh(contentsUrl(CONTENT_PATH) + "?ref=" + encodeURIComponent(cfg.branch));
  const text = b64dec(f.content);
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  return { sha: f.sha, data: JSON.parse(json) };
}
async function putFile(path, base64, message, fileSha) {
  return gh(contentsUrl(path), { method: "PUT", body: JSON.stringify({ message, content: base64, branch: cfg.branch, ...(fileSha ? { sha: fileSha } : {}) }) });
}

/* ---------- Вход ---------- */
function guessRepo() {
  const h = location.hostname;
  if (!h.endsWith(".github.io")) return "";
  const owner = h.split(".")[0], seg = location.pathname.split("/")[1];
  return seg && !seg.includes(".") ? `${owner}/${seg}` : `${owner}/${owner}.github.io`;
}
function loadCfg() { try { return JSON.parse(localStorage.getItem(LS_CFG)) || {}; } catch { return {}; } }

async function login(c) {
  cfg = c; $("login-err").textContent = "";
  busy("Входим…");
  try {
    const user = await gh("/user");
    const res = await loadContent();
    sha = res.sha; data = res.data;
    try {
      const d = JSON.parse(localStorage.getItem(LS_DRAFT) || "null");
      if (d && d.sha === sha && JSON.stringify(d.data) !== JSON.stringify(data) &&
          confirm("Найдены неопубликованные изменения с прошлого раза. Восстановить их?")) { data = d.data; dirty = true; }
    } catch {}
    try { localStorage.setItem(LS_CFG, JSON.stringify(cfg)); } catch {}
    $("u-avatar").src = user.avatar_url; $("u-login").textContent = user.login; cfg.login = user.login;
    $("login").classList.add("hidden"); $("app").classList.remove("hidden");
    buildNav(); show(current); setDirty(dirty);
  } catch (e) {
    $("login").classList.remove("hidden"); $("app").classList.add("hidden");
    $("login-err").textContent =
      e.status === 401 ? "Неверный или просроченный токен." :
      e.status === 404 ? "Не найден репозиторий, ветка или файл data/content.js. Проверь данные и доступ токена." :
      "Ошибка: " + e.message;
  } finally { busy(); }
}
$("login-form").addEventListener("submit", e => {
  e.preventDefault();
  login({ token: $("f-token").value.trim(), repo: $("f-repo").value.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\/$/, ""), branch: $("f-branch").value.trim() || "main" });
});
$("logout").addEventListener("click", () => {
  if (dirty && !confirm("Есть неопубликованные изменения. Всё равно выйти?")) return;
  try { localStorage.removeItem(LS_CFG); localStorage.removeItem(LS_DRAFT); } catch {}
  location.reload();
});

/* ---------- Навигация ---------- */
function buildNav() {
  $("side-nav").replaceChildren(...SECTIONS.map(s =>
    el("button", { "data-id": s.id, onclick: () => { show(s.id); $("side").classList.remove("open"); } }, el("i"), s.title)));
}
function show(id) {
  current = id;
  const s = SECTIONS.find(x => x.id === id);
  document.querySelectorAll("#side-nav button").forEach(b => b.classList.toggle("active", b.dataset.id === id));
  $("sec-title").textContent = s.title;
  const root = $("content"); root.replaceChildren(el("p", { class: "section-intro" }, s.intro));
  s.cards.forEach(c => {
    const card = el("section", { class: "card" }, el("h2", {}, c.title));
    if (c.fields) renderFields(card, null, c.fields);
    if (c.list) { const [o, k] = resolve(c.list.path); if (!Array.isArray(o[k])) o[k] = []; card.append(renderList(o, k, c.list)); }
    root.append(card);
  });
  scrollTo(0, 0);
}
$("m-menu").addEventListener("click", () => $("side").classList.toggle("open"));

/* ---------- Поля ---------- */
function renderFields(parent, obj, fields, onChange) {
  fields.forEach(f => {
    if (f.row) { const g = el("div", { class: f.row.length === 3 ? "grid-3" : "grid-2" }); renderFields(g, obj, f.row, onChange); parent.append(g); }
    else parent.append(renderField(obj, f, onChange));
  });
}
function renderField(obj, f, onChange) {
  const [o, k] = f.path ? resolve(f.path) : [obj, f.key];
  const set = v => { o[k] = v; setDirty(); onChange && onChange(); };
  const label = el("span", { class: "field__label" }, f.label);
  const hint = f.hint ? el("span", { class: "field__hint" }, f.hint) : null;
  const t = f.type || "text";

  if (t === "list") {
    if (!Array.isArray(o[k])) o[k] = [];
    return el("div", { class: "field" }, label, renderList(o, k, f, onChange));
  }
  if (t === "image") return el("div", { class: "field" }, label, imageField(o, k, set), hint);

  let input;
  if (t === "textarea" || t === "lines") {
    input = el("textarea", { class: "textarea", rows: f.rows || 4, placeholder: f.ph });
    input.value = t === "lines" ? (o[k] || []).join("\n") : (o[k] ?? "");
    input.addEventListener("input", () => set(t === "lines" ? input.value.split("\n") : input.value));
  } else if (t === "color") {
    const pick = el("input", { class: "input", type: "color" }), txt = el("input", { class: "input", placeholder: "#ffc83a" });
    pick.value = /^#[0-9a-f]{6}$/i.test(o[k]) ? o[k] : "#ffc83a"; txt.value = o[k] || "";
    pick.addEventListener("input", () => { txt.value = pick.value; set(pick.value); });
    txt.addEventListener("input", () => { if (/^#[0-9a-f]{6}$/i.test(txt.value)) pick.value = txt.value; set(txt.value); });
    return el("label", { class: "field" }, label, el("div", { class: "color-row" }, pick, txt), hint);
  } else {
    input = el("input", { class: "input", type: t === "number" ? "number" : t === "date" ? "date" : t === "url" ? "url" : "text", placeholder: f.ph || (t === "url" ? "https://…" : null) });
    input.value = o[k] ?? "";
    input.addEventListener("input", () => set(t === "number" ? (input.value === "" ? 0 : Number(input.value)) : input.value));
  }
  return el("label", { class: "field" }, label, input, hint);
}

/* ---------- Списки ---------- */
function renderList(o, k, spec, parentChange) {
  const wrap = el("div");
  const draw = () => {
    const arr = o[k];
    const list = el("div", { class: "list" });
    arr.forEach((item, i) => {
      const titleText = () => (spec.title && spec.title(item)) || "Без названия";
      const title = el("span", { class: "item__title" }, titleText());
      const sub = spec.sub ? el("small", {}, spec.sub(item) || "") : null;
      if (sub) title.append(sub);
      const refresh = () => { title.firstChild.textContent = titleText(); if (sub) sub.textContent = spec.sub(item) || ""; parentChange && parentChange(); };
      const tool = (txt, fn, cls = "", dis = false) => el("button", { class: "icon-btn " + cls, type: "button", title: txt, disabled: dis,
        onclick: e => { e.preventDefault(); e.stopPropagation(); fn(); } }, txt === "Выше" ? "↑" : txt === "Ниже" ? "↓" : "✕");
      const det = el("details", { class: "item" },
        el("summary", {}, title, el("span", { class: "item__tools" },
          tool("Выше", () => { [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]; setDirty(); draw(); }, "", i === 0),
          tool("Ниже", () => { [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]]; setDirty(); draw(); }, "", i === arr.length - 1),
          tool("Удалить", () => { if (confirm(`Удалить «${titleText()}»?`)) { arr.splice(i, 1); setDirty(); draw(); parentChange && parentChange(); } }, "danger"))));
      if (openItems.has(item)) det.open = true;
      det.addEventListener("toggle", () => det.open ? openItems.add(item) : openItems.delete(item));
      const body = el("div", { class: "item__body" });
      renderFields(body, item, spec.fields, refresh);
      det.append(body);
      list.append(det);
    });
    const add = el("button", { class: "add-btn", type: "button", onclick: () => {
      const item = spec.newItem(); openItems.add(item);
      spec.addTop ? arr.unshift(item) : arr.push(item); setDirty(); draw(); parentChange && parentChange();
    } }, "+ " + (spec.add || "Добавить"));
    wrap.replaceChildren(list, add);
  };
  draw();
  return wrap;
}

/* ---------- Картинки ---------- */
function imageField(o, k, set) {
  const prev = el("div", { class: "img-prev" }, "Нет картинки");
  const path = el("input", { class: "input", placeholder: "img/uploads/… или https://…" });
  const showPrev = src => { prev.style.backgroundImage = src ? `url("${src.replace(/"/g, "%22")}")` : ""; prev.classList.toggle("has", !!src); };
  path.value = o[k] || ""; showPrev(o[k]);
  path.addEventListener("input", () => { set(path.value.trim()); showPrev(path.value.trim()); });
  const file = el("input", { type: "file", accept: "image/*", class: "hidden" });
  file.addEventListener("change", async () => {
    const f = file.files[0]; file.value = ""; if (!f) return;
    try {
      busy("Загружаем картинку…");
      const { blob, ext } = await compress(f);
      const dataUrl = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
      const name = `${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}-${uid()}.${ext}`;
      await putFile(`${UPLOAD_DIR}/${name}`, dataUrl.split(",")[1], `Админка: картинка ${name} (${cfg.login || "admin"})`);
      path.value = `${UPLOAD_DIR}/${name}`; set(path.value); showPrev(dataUrl);
      toast("Картинка загружена. Не забудь нажать «Опубликовать»");
    } catch (e) { toast("Не удалось загрузить: " + e.message, true); }
    finally { busy(); }
  });
  const actions = el("div", { class: "img-actions" },
    el("button", { class: "btn btn--dark", type: "button", onclick: () => file.click() }, "Загрузить"),
    el("button", { class: "btn btn--dark", type: "button", onclick: () => { path.value = ""; set(""); showPrev(""); } }, "Убрать"));
  return el("div", { class: "img-field" }, prev, el("div", {}, path, actions, file,
    el("span", { class: "field__hint" }, "JPG/PNG. Большие картинки сжимаются автоматически.")));
}
async function compress(file) {
  if (/gif|svg/.test(file.type)) return { blob: file, ext: file.type.includes("gif") ? "gif" : "svg" };
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
  const max = 1600, s = Math.min(1, max / Math.max(img.width, img.height));
  if (s === 1 && file.size < 400 * 1024) return { blob: file, ext: (file.type.split("/")[1] || "png").replace("jpeg", "jpg") };
  const c = el("canvas"); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
  const g = c.getContext("2d"); g.fillStyle = "#07060a"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
  const blob = await new Promise(r => c.toBlob(r, "image/jpeg", .85));
  return { blob, ext: "jpg" };
}

/* ---------- Публикация ---------- */
function cleaned() {
  const d = JSON.parse(JSON.stringify(data));
  (d.donate?.tiers || []).forEach(t => t.perks = (t.perks || []).map(p => String(p).trim()).filter(Boolean));
  return d;
}
async function publish() {
  if (!dirty) { toast("Нет изменений для публикации"); return; }
  const text = "/* Контент сайта. Редактируется через admin.html — вручную менять не нужно. */\nwindow.SITE = " + JSON.stringify(cleaned(), null, 2) + ";\n";
  const msg = `Админка: обновление сайта (${cfg.login || "admin"})`;
  busy("Публикуем…");
  try {
    const r = await putFile(CONTENT_PATH, b64enc(text), msg, sha);
    sha = r.content.sha; setDirty(false);
    toast("Опубликовано! Сайт обновится через 1–2 минуты");
  } catch (e) {
    if (e.status === 409 || e.status === 422) {
      busy();
      if (confirm("Пока ты редактировал, кто-то другой опубликовал изменения.\n\nОК — перезаписать их твоей версией.\nОтмена — ничего не делать (можно скопировать правки и обновить страницу).")) {
        busy("Публикуем…");
        try { const f = await gh(contentsUrl(CONTENT_PATH) + "?ref=" + encodeURIComponent(cfg.branch));
          const r = await putFile(CONTENT_PATH, b64enc(text), msg, f.sha); sha = r.content.sha; setDirty(false); toast("Опубликовано!"); }
        catch (e2) { toast("Ошибка публикации: " + e2.message, true); }
      }
    } else toast(e.status === 401 || e.status === 403 ? "Нет прав на запись. Проверь токен и доступ к репозиторию." : "Ошибка публикации: " + e.message, true);
  } finally { busy(); }
}
$("publish").addEventListener("click", publish);
addEventListener("keydown", e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && data) { e.preventDefault(); publish(); } });
addEventListener("beforeunload", e => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });

/* ---------- Старт ---------- */
(function init() {
  const saved = loadCfg();
  $("f-repo").value = saved.repo || guessRepo();
  $("f-branch").value = saved.branch || "main";
  if (saved.token) login(saved);
})();
