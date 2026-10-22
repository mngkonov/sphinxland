-- =========================================================
-- Сфинксляндия — база профилей игроков (Supabase).
-- Запусти целиком: Supabase → SQL Editor → New query → Run.
-- Скрипт можно запускать повторно — он ничего не сломает.
-- =========================================================

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  nickname    text not null check (nickname ~ '^[A-Za-z0-9_][A-Za-z0-9_ ]{1,14}[A-Za-z0-9_]$'),
  platform    text not null default 'java' check (platform in ('java', 'bedrock')),
  bio         text check (char_length(bio) <= 300),
  clan        text check (char_length(clan) <= 32),
  discord     text check (char_length(discord) <= 40),
  public      boolean not null default true,
  -- Поля ниже меняют только администрация (в панели Supabase) или плагин сервера:
  rank        text,                         -- id привилегии: scarab, priest, pharaoh, sphinx
  verified    boolean not null default false, -- ник подтверждён на сервере
  stats       jsonb not null default '{}',  -- {"playtime": минуты, "deaths": 3, "blocks_mined": 1200, ...}
  last_seen   timestamptz,
  created_at  timestamptz not null default now()
);

-- Ник уникален без учёта регистра
create unique index if not exists profiles_nickname_key on public.profiles (lower(nickname));

-- ---------- Права: игрок видит публичные профили и правит только свой ----------
alter table public.profiles enable row level security;

drop policy if exists "profiles_read"   on public.profiles;
drop policy if exists "profiles_insert" on public.profiles;
drop policy if exists "profiles_update" on public.profiles;
drop policy if exists "profiles_delete" on public.profiles;

create policy "profiles_read"   on public.profiles for select using (public or auth.uid() = id);
create policy "profiles_insert" on public.profiles for insert to authenticated with check (auth.uid() = id);
create policy "profiles_update" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
create policy "profiles_delete" on public.profiles for delete to authenticated using (auth.uid() = id);

-- Игрок не может сам выдать себе привилегию, подтверждение или статистику
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to anon, authenticated;
grant insert (id, nickname, platform, bio, clan, discord, public) on public.profiles to authenticated;
grant update (nickname, platform, bio, clan, discord, public)     on public.profiles to authenticated;
grant delete on public.profiles to authenticated;

-- Смена ника снимает подтверждение
create or replace function public.profiles_guard() returns trigger language plpgsql as $$
begin
  if new.nickname is distinct from old.nickname then new.verified := false; end if;
  return new;
end $$;
drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles for each row execute function public.profiles_guard();

-- ---------- Функции для сайта ----------
-- Свободен ли ник (учитывает и скрытые профили)
create or replace function public.nickname_available(n text) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (select 1 from public.profiles where lower(nickname) = lower(trim(n)));
$$;
grant execute on function public.nickname_available(text) to anon, authenticated;

-- Удаление своего аккаунта целиком
create or replace function public.delete_me() returns void
language sql security definer set search_path = '' as $$
  delete from auth.users where id = auth.uid();
$$;
revoke execute on function public.delete_me() from public, anon;
grant execute on function public.delete_me() to authenticated;
