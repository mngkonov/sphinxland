# Сфинксляндия — сайт Minecraft-сервера

Сайт: https://mngkonov.github.io/sphinxland/ · Админка: https://mngkonov.github.io/sphinxland/admin.html

## Страницы

| Файл | Что это |
|---|---|
| `index.html` | Главная: IP, онлайн, о сервере, старт, новости, профиль, правила, донат, команда, FAQ, соцсети |
| `guide.html` | «Как начать»: подключение с ПК и телефона, первая ночь, кланы, торговля, помощь, команды |
| `rules.html` | Полный свод правил |
| `news.html` | Все новости |
| `players.html` | Список игроков с профилями и публичная страница игрока (`players.html?nick=Ник`) |
| `account.html` | Личный кабинет: регистрация, вход, настройки профиля |
| `donate.html` | Привилегии |
| `admin.html` | Админка: весь текст сайта меняется там, без кода |

Весь контент — в `data/content.js`, его правит админка.

## Как включить профили игроков (один раз, ~10 минут)

Регистрация на сайте — по желанию игрока. Пока Supabase не подключён, в кабинете написано «Скоро откроется».

1. Зарегистрируйся на https://supabase.com и создай проект (бесплатный тариф, регион — Frankfurt / ближайший).
2. **SQL Editor → New query** → вставь содержимое `supabase/schema.sql` → **Run**.
3. **Authentication → URL Configuration**:
   - Site URL: `https://mngkonov.github.io/sphinxland/account.html`
   - Redirect URLs: добавь `https://mngkonov.github.io/sphinxland/**`
4. **Authentication → Emails** (по желанию): переведи шаблоны писем на русский.
5. **Project Settings → API**: скопируй **Project URL** и **публичный ключ** (`anon` / `publishable`).
6. Админка → **Основное → Профили игроков** → вставь оба значения → **Опубликовать**.

> ⚠️ Секретный ключ (`service_role` / `sb_secret_…`) на сайт вставлять нельзя — админка не даст его опубликовать.

### Что может администрация

В Supabase → **Table Editor → profiles** можно:
- выдать привилегию: в поле `rank` вписать `scarab`, `priest`, `pharaoh` или `sphinx` (id из раздела «Донат»);
- отметить ник подтверждённым: `verified = true`;
- удалить профиль на чужой ник.

Поля `rank`, `verified`, `stats`, `last_seen` игрок сам изменить не может.

### Статистика с сервера (следующий шаг)

Профиль уже умеет показывать поле `stats` (JSON): `playtime` (минуты), `joins`, `deaths`, `mob_kills`,
`player_kills`, `blocks_mined`, `blocks_placed`, `distance`, и `last_seen`. Заполнять их будет плагин
на сервере через секретный ключ — он хранится только на сервере.
