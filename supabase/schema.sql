-- =========================================================
-- Сфинксляндия — база профилей и кланов (Supabase).
-- Запусти целиком: Supabase → SQL Editor → New query → Run.
-- Скрипт можно запускать повторно — он обновляет базу и ничего не ломает.
-- =========================================================

-- ---------------------------------------------------------
-- ПРОФИЛИ
-- ---------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  nickname    text not null,
  platform    text not null default 'java' check (platform in ('java', 'bedrock')),
  bio         text check (char_length(bio) <= 300),
  discord     text check (char_length(discord) <= 40),
  public      boolean not null default true,
  -- Поля ниже меняют только администрация (в панели Supabase), плагин сервера или функции кланов:
  rank        text,                           -- id привилегии из раздела «Донат»
  verified    boolean not null default false, -- ник подтверждён на сервере
  stats       jsonb not null default '{}',    -- {"playtime": минуты, "deaths": 3, ...}
  last_seen   timestamptz,
  created_at  timestamptz not null default now()
);
create unique index if not exists profiles_nickname_key on public.profiles (lower(nickname));

-- Ник: 3–16 символов (латиница, цифры, _ и точка — у пиратов бывают ники с точкой);
-- у Bedrock-игроков (Floodgate) впереди может стоять префикс «.» или «*»
alter table public.profiles drop constraint if exists profiles_nickname_check;
alter table public.profiles add constraint profiles_nickname_check
  check (nickname ~ '^[.*]?[A-Za-z0-9_.][A-Za-z0-9_. ]{1,14}[A-Za-z0-9_.]$');

-- Откуда профиль: 'site' — регистрация по почте, 'game' — создан плагином SiteSync из AuthMe
alter table public.profiles add column if not exists source text not null default 'site';
alter table public.profiles drop constraint if exists profiles_source_check;
alter table public.profiles add constraint profiles_source_check check (source in ('site', 'game'));

-- Данные с сервера (пишет только плагин SiteSync): скин из SkinsRestorer и статус «в игре»
alter table public.profiles add column if not exists skin text;  -- хеш текстуры скина (textures.minecraft.net/texture/<хеш>)
alter table public.profiles drop constraint if exists profiles_skin_check;
alter table public.profiles add constraint profiles_skin_check check (skin ~ '^[0-9a-f]{20,80}$');
alter table public.profiles add column if not exists online boolean not null default false;

-- ---------------------------------------------------------
-- КЛАНЫ
-- ---------------------------------------------------------
create table if not exists public.clans (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 3 and 24),
  tag         text not null check (tag ~ '^[A-ZА-ЯЁ0-9]{4}$'),  -- ровно 4 буквы/цифры
  description text check (char_length(description) <= 600),
  flag        text not null check (flag ~ '^[0-9a-f]{96}$'),   -- пиксельный флаг 8×12, цвет = 16 красителей
  open        boolean not null default true,                    -- true: вступают сразу, false: по заявке
  members     int not null default 0,
  created_at  timestamptz not null default now()
);
create unique index if not exists clans_name_key on public.clans (lower(name));
create unique index if not exists clans_tag_key  on public.clans (tag);

-- Участие в клане хранится в профиле: один игрок — один клан
alter table public.profiles add column if not exists clan_id uuid references public.clans(id) on delete set null;
alter table public.profiles add column if not exists clan_role text check (clan_role in ('owner', 'officer', 'member'));
alter table public.profiles add column if not exists clan_joined_at timestamptz;
alter table public.profiles drop column if exists clan;  -- старое текстовое поле «Клан» заменено настоящими кланами
create index if not exists profiles_clan_idx on public.profiles (clan_id);

create table if not exists public.clan_requests (
  clan_id     uuid not null references public.clans(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  message     text check (char_length(message) <= 300),
  created_at  timestamptz not null default now(),
  primary key (clan_id, user_id)
);

-- ---------------------------------------------------------
-- ПРАВА
-- ---------------------------------------------------------
alter table public.profiles      enable row level security;
alter table public.clans         enable row level security;
alter table public.clan_requests enable row level security;

drop policy if exists "profiles_read"   on public.profiles;
drop policy if exists "profiles_insert" on public.profiles;
drop policy if exists "profiles_update" on public.profiles;
drop policy if exists "profiles_delete" on public.profiles;
create policy "profiles_read"   on public.profiles for select using (public or auth.uid() = id);
create policy "profiles_insert" on public.profiles for insert to authenticated with check (auth.uid() = id);
create policy "profiles_update" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
create policy "profiles_delete" on public.profiles for delete to authenticated using (auth.uid() = id);

drop policy if exists "clans_read" on public.clans;
create policy "clans_read" on public.clans for select using (true);

drop policy if exists "requests_read_own" on public.clan_requests;
create policy "requests_read_own" on public.clan_requests for select to authenticated using (auth.uid() = user_id);

-- Игрок правит только «свои» поля профиля. Клан, привилегия, подтверждение и статистика — нельзя.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to anon, authenticated;
grant insert (id, nickname, platform, bio, discord, public) on public.profiles to authenticated;
grant update (nickname, platform, bio, discord, public)     on public.profiles to authenticated;
grant delete on public.profiles to authenticated;

-- Кланы и заявки меняются только через функции ниже
revoke all on public.clans, public.clan_requests from anon, authenticated;
grant select on public.clans to anon, authenticated;
grant select on public.clan_requests to authenticated;

-- ---------------------------------------------------------
-- ТРИГГЕРЫ
-- ---------------------------------------------------------
-- Смена ника снимает подтверждение; уход из клана очищает роль; вход — ставит дату
create or replace function public.profiles_guard() returns trigger language plpgsql as $$
begin
  -- Ник аккаунта из игры привязан ко входу на сайт — сам игрок его не меняет
  if old.source = 'game' and new.nickname is distinct from old.nickname
     and coalesce(auth.jwt() ->> 'role', '') = 'authenticated' then
    raise exception 'Ник аккаунта из игры меняется только на сервере';
  end if;
  if new.nickname is distinct from old.nickname and old.source <> 'game' then new.verified := false; end if;
  if new.clan_id is null then
    new.clan_role := null; new.clan_joined_at := null;
  elsif new.clan_id is distinct from old.clan_id then
    new.clan_joined_at := now();
  end if;
  return new;
end $$;
drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles for each row execute function public.profiles_guard();

-- Пересчёт клана: число участников, пустой клан удаляется, без владельца — владельцем становится
-- старший офицер, а если офицеров нет — самый давний участник
create or replace function public.clan_sync(cid uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if cid is null or not exists (select 1 from public.clans where id = cid) then return; end if;
  select count(*) into n from public.profiles where clan_id = cid;
  if n = 0 then delete from public.clans where id = cid; return; end if;
  update public.clans set members = n where id = cid and members <> n;
  if not exists (select 1 from public.profiles where clan_id = cid and clan_role = 'owner') then
    update public.profiles set clan_role = 'owner' where id = (
      select id from public.profiles where clan_id = cid
      order by (clan_role = 'officer') desc, clan_joined_at asc nulls last limit 1);
  end if;
end $$;

create or replace function public.profiles_clan_trg() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then perform public.clan_sync(old.clan_id); return old; end if;
  if old.clan_id is distinct from new.clan_id then
    perform public.clan_sync(old.clan_id); perform public.clan_sync(new.clan_id);
  elsif old.clan_role is distinct from new.clan_role then
    perform public.clan_sync(new.clan_id);
  end if;
  return new;
end $$;
drop trigger if exists profiles_clan on public.profiles;
create trigger profiles_clan after update of clan_id, clan_role or delete on public.profiles
  for each row execute function public.profiles_clan_trg();

-- ---------------------------------------------------------
-- ФУНКЦИИ ДЛЯ САЙТА
-- ---------------------------------------------------------
-- Свободен ли ник (учитывает и скрытые профили)
create or replace function public.nickname_available(n text) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.profiles where lower(nickname) = lower(trim(n)));
$$;

-- Удаление своего аккаунта целиком (клан передаётся следующему участнику автоматически)
create or replace function public.delete_me() returns void
language sql security definer set search_path = '' as $$
  delete from auth.users where id = auth.uid();
$$;

-- Создать клан (создатель становится владельцем)
create or replace function public.create_clan(p_name text, p_tag text, p_description text, p_flag text, p_open boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare me public.profiles; cid uuid;
begin
  select * into me from public.profiles where id = auth.uid() for update;
  if not found then raise exception 'Сначала создай профиль на сайте'; end if;
  if me.clan_id is not null then raise exception 'Ты уже состоишь в клане — сначала выйди из него'; end if;
  insert into public.clans (name, tag, description, flag, open)
    values (trim(p_name), upper(trim(p_tag)), nullif(trim(p_description), ''), lower(p_flag), coalesce(p_open, true))
    returning id into cid;
  update public.profiles set clan_id = cid, clan_role = 'owner' where id = me.id;
  delete from public.clan_requests where user_id = me.id;
  return cid;
end $$;

-- Изменить клан (владелец и офицеры)
create or replace function public.update_clan(p_clan uuid, p_name text, p_tag text, p_description text, p_flag text, p_open boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid();
  if not found or me.clan_id is distinct from p_clan or me.clan_role not in ('owner', 'officer') then
    raise exception 'Менять клан могут только владелец и офицеры'; end if;
  update public.clans set name = trim(p_name), tag = upper(trim(p_tag)), description = nullif(trim(p_description), ''),
    flag = lower(p_flag), open = coalesce(p_open, open) where id = p_clan;
end $$;

-- Вступить (открытый клан) или подать заявку (закрытый). Возвращает 'joined' или 'requested'
create or replace function public.join_clan(p_clan uuid, p_message text) returns text
language plpgsql security definer set search_path = '' as $$
declare me public.profiles; c public.clans;
begin
  select * into me from public.profiles where id = auth.uid() for update;
  if not found then raise exception 'Сначала создай профиль на сайте'; end if;
  if me.clan_id is not null then raise exception 'Ты уже состоишь в клане — сначала выйди из него'; end if;
  select * into c from public.clans where id = p_clan;
  if not found then raise exception 'Клан не найден'; end if;
  if c.open then
    update public.profiles set clan_id = p_clan, clan_role = 'member' where id = me.id;
    delete from public.clan_requests where user_id = me.id;
    return 'joined';
  end if;
  if (select count(*) from public.clan_requests where user_id = me.id) >= 5 then
    raise exception 'Можно держать не больше 5 заявок одновременно'; end if;
  insert into public.clan_requests (clan_id, user_id, message) values (p_clan, me.id, nullif(trim(p_message), ''))
    on conflict (clan_id, user_id) do update set message = excluded.message, created_at = now();
  return 'requested';
end $$;

-- Отозвать свою заявку
create or replace function public.cancel_clan_request(p_clan uuid) returns void
language sql security definer set search_path = '' as $$
  delete from public.clan_requests where clan_id = p_clan and user_id = auth.uid();
$$;

-- Заявки клана (видят владелец и офицеры)
create or replace function public.clan_request_list(p_clan uuid)
returns table (user_id uuid, nickname text, platform text, message text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and clan_id = p_clan and clan_role in ('owner', 'officer')) then
    raise exception 'Заявки видят только владелец и офицеры'; end if;
  return query select r.user_id, p.nickname, p.platform, r.message, r.created_at
    from public.clan_requests r join public.profiles p on p.id = r.user_id
    where r.clan_id = p_clan order by r.created_at;
end $$;

-- Принять или отклонить заявку. Возвращает 'accepted', 'declined' или 'busy' (игрок уже в другом клане)
create or replace function public.answer_clan_request(p_clan uuid, p_user uuid, p_accept boolean) returns text
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and clan_id = p_clan and clan_role in ('owner', 'officer')) then
    raise exception 'Отвечать на заявки могут только владелец и офицеры'; end if;
  delete from public.clan_requests where clan_id = p_clan and user_id = p_user;
  if not found then raise exception 'Заявка не найдена — возможно, её уже отозвали'; end if;
  if not p_accept then return 'declined'; end if;
  update public.profiles set clan_id = p_clan, clan_role = 'member' where id = p_user and clan_id is null;
  if not found then return 'busy'; end if;
  delete from public.clan_requests where user_id = p_user;
  return 'accepted';
end $$;

-- Участники клана (публично: ник, роль, дата вступления)
drop function if exists public.clan_member_list(uuid);  -- поменялся список колонок
create or replace function public.clan_member_list(p_clan uuid)
returns table (user_id uuid, nickname text, platform text, role text, joined_at timestamptz, rank text, is_public boolean, skin text, online boolean)
language sql stable security definer set search_path = '' as $$
  select id, nickname, platform, clan_role, clan_joined_at, rank, public, skin, online from public.profiles
  where clan_id = p_clan
  order by case clan_role when 'owner' then 0 when 'officer' then 1 else 2 end, clan_joined_at;
$$;

-- Выйти из клана (если уходит владелец — клан переходит к офицеру или самому давнему участнику)
create or replace function public.leave_clan() returns void
language sql security definer set search_path = '' as $$
  update public.profiles set clan_id = null where id = auth.uid();
$$;

-- Исключить участника (владелец — любого, офицер — только обычных участников)
create or replace function public.kick_clan_member(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare me public.profiles; t public.profiles;
begin
  select * into me from public.profiles where id = auth.uid();
  select * into t from public.profiles where id = p_user;
  if me.clan_id is null or t.clan_id is distinct from me.clan_id or t.id = me.id then raise exception 'Нельзя исключить этого игрока'; end if;
  if not (me.clan_role = 'owner' or (me.clan_role = 'officer' and t.clan_role = 'member')) then
    raise exception 'Недостаточно прав'; end if;
  update public.profiles set clan_id = null where id = p_user;
end $$;

-- Назначить роль: 'officer', 'member' или 'owner' (передать клан). Только владелец
create or replace function public.set_clan_role(p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.clan_role is distinct from 'owner' then raise exception 'Роли назначает только владелец'; end if;
  if p_role not in ('owner', 'officer', 'member') or p_user = me.id then raise exception 'Неверная роль'; end if;
  if not exists (select 1 from public.profiles where id = p_user and clan_id = me.clan_id) then raise exception 'Игрок не в твоём клане'; end if;
  if p_role = 'owner' then
    update public.profiles set clan_role = 'officer' where id = me.id;
  end if;
  update public.profiles set clan_role = p_role where id = p_user;
end $$;

-- Распустить клан (только владелец)
create or replace function public.disband_clan() returns void
language plpgsql security definer set search_path = '' as $$
declare me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.clan_role is distinct from 'owner' then raise exception 'Распустить клан может только владелец'; end if;
  delete from public.clans where id = me.clan_id;
end $$;

-- Кто может вызывать функции (по умолчанию в Postgres их может вызвать кто угодно — закрываем)
revoke execute on function public.clan_sync(uuid), public.profiles_clan_trg(),
  public.nickname_available(text), public.delete_me(), public.create_clan(text, text, text, text, boolean),
  public.update_clan(uuid, text, text, text, text, boolean), public.join_clan(uuid, text), public.cancel_clan_request(uuid),
  public.clan_request_list(uuid), public.answer_clan_request(uuid, uuid, boolean), public.clan_member_list(uuid),
  public.leave_clan(), public.kick_clan_member(uuid), public.set_clan_role(uuid, text), public.disband_clan()
  from public, anon, authenticated;
grant execute on function public.nickname_available(text), public.clan_member_list(uuid) to anon, authenticated;
grant execute on function public.delete_me(), public.create_clan(text, text, text, text, boolean),
  public.update_clan(uuid, text, text, text, text, boolean), public.join_clan(uuid, text), public.cancel_clan_request(uuid),
  public.clan_request_list(uuid), public.answer_clan_request(uuid, uuid, boolean),
  public.leave_clan(), public.kick_clan_member(uuid), public.set_clan_role(uuid, text), public.disband_clan()
  to authenticated;

-- Сайт сразу видит новые таблицы и колонки
notify pgrst, 'reload schema';
