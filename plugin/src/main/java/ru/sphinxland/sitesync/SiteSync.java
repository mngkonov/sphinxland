package ru.sphinxland.sitesync;

import com.google.gson.JsonObject;

import org.bukkit.ChatColor;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.configuration.file.FileConfiguration;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerCommandPreprocessEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.scheduler.BukkitTask;

import java.io.File;
import java.security.SecureRandom;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Base64;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Pattern;

/**
 * SiteSync: игрок регистрируется на сервере через AuthMe — и у него сразу появляется
 * аккаунт и профиль на сайте. Вход на сайт — по нику и тому же паролю, что в игре.
 *
 * Как это работает:
 *  1. Раз в N минут плагин читает базу AuthMe (SQLite, только чтение) и создаёт
 *     на сайте профили для всех зарегистрированных игроков, обновляет «последний раз в игре».
 *  2. Когда игрок вводит /register, /login или /changepassword, плагин запоминает
 *     введённый пароль, через пару секунд сверяет его с AuthMe (AuthMeApi.checkPassword)
 *     и, если пароль верный, ставит такой же пароль аккаунту на сайте.
 *     Пароль нигде не сохраняется и не пишется в лог, на сайт он уходит по HTTPS.
 *  3. При входе и выходе игрока (и раз в N минут, пока он онлайн) отправляет на сайт
 *     статус «в игре», скин из профиля (его подставляет SkinsRestorer) и статистику.
 */
public final class SiteSync extends JavaPlugin implements Listener {

    /** Те же правила ника, что и на сайте (с префиксом Floodgate). */
    private static final Pattern NICK = Pattern.compile("^[.*]?[A-Za-z0-9_.][A-Za-z0-9_. ]{1,14}[A-Za-z0-9_.]$");
    private static final Set<String> REGISTER = Set.of("register", "reg");
    private static final Set<String> LOGIN = Set.of("login", "l", "log");
    private static final Set<String> CHANGE = Set.of("changepassword", "cp");
    private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("dd.MM HH:mm").withZone(ZoneId.systemDefault());

    record Result(String userId, boolean created) {}

    /* Настройки перечитываются командой /sitesync reload — без перезапуска сервера */
    private volatile Supabase sb;
    private volatile AuthMeReader authme;
    private volatile String domain, prefix, siteUrl, msgReady, msgWeak;
    private volatile boolean ready;
    private BukkitTask timer;
    private final Set<String> conflicts = ConcurrentHashMap.newKeySet();
    private final Set<String> skipped = ConcurrentHashMap.newKeySet();
    /** ник в нижнем регистре → id профиля из игры (чтобы не искать его при каждом входе) */
    private final Map<String, String> gameIds = new ConcurrentHashMap<>();
    private final AtomicBoolean syncing = new AtomicBoolean();
    private final SecureRandom random = new SecureRandom();
    private volatile String lastSync = "ещё не было";

    @Override
    public void onEnable() {
        saveDefaultConfig();
        getServer().getPluginManager().registerEvents(this, this);
        loadSettings();
    }

    /**
     * Читает config.yml и (пере)запускает синхронизацию. Без ключа плагин не выключается,
     * а ждёт настройки: впиши ключ и введи /sitesync reload.
     * @return текст для того, кто перезагрузил
     */
    private String loadSettings() {
        reloadConfig();
        FileConfiguration c = getConfig();
        if (timer != null) {
            timer.cancel();
            timer = null;
        }
        conflicts.clear();
        skipped.clear();
        String url = c.getString("supabase.url", "").trim();
        String key = c.getString("supabase.service-key", "").trim();
        if (url.isEmpty() || key.isEmpty() || key.startsWith("sb_publishable_")) {
            ready = false;
            String m = "Нет настроек: впиши supabase.url и supabase.service-key (СЕКРЕТНЫЙ ключ) в plugins/SiteSync/config.yml и введи /sitesync reload.";
            getLogger().warning(m);
            return m;
        }
        sb = new Supabase(url, key);
        domain = c.getString("site.email-domain", "players.mngkonov.github.io").trim().toLowerCase(Locale.ROOT);
        prefix = c.getString("bedrock-prefix", ".");
        siteUrl = c.getString("site.url", "https://mngkonov.github.io/sphinxland/");
        if (!siteUrl.endsWith("/")) siteUrl += "/";
        msgReady = c.getString("messages.ready", "&6[Сайт] &fПрофиль на сайте готов: {url}account.html");
        msgWeak = c.getString("messages.weak-password", "&6[Сайт] &fСайт не принял пароль — смени его /changepassword.");

        File db = new File(c.getString("authme.database", "plugins/AuthMe/authme.db"));
        if (!db.isAbsolute()) db = new File(getDataFolder().getAbsoluteFile().getParentFile().getParentFile(), db.getPath());
        authme = new AuthMeReader(db, c.getString("authme.table", "authme"),
                c.getString("authme.columns.name", "username"), c.getString("authme.columns.realname", "realname"),
                c.getString("authme.columns.regdate", "regdate"), c.getString("authme.columns.lastlogin", "lastlogin"));

        long every = Math.max(1, c.getLong("sync-interval-minutes", 10)) * 60L * 20L;
        ready = true;
        gameIds.clear();
        timer = getServer().getScheduler().runTaskTimerAsynchronously(this, this::fullSync, 20L * 15, every);
        // Статус «в игре» мог остаться после падения сервера — сбрасываем и отмечаем тех, кто сейчас онлайн
        Supabase client = sb;
        getServer().getScheduler().runTaskLaterAsynchronously(this, () -> {
            try {
                client.resetOnline();
            } catch (Supabase.ApiException e) {
                getLogger().warning("Не удалось сбросить статусы «в игре»: " + e.getMessage());
            }
            pushOnlinePlayers();
        }, 40L);
        String m = "Работает: база AuthMe — " + db.getPath() + ", синхронизация каждые " + every / 1200 + " мин. (первая — через 15 сек.)";
        getLogger().info(m);
        return m;
    }

    @Override
    public void onDisable() {
        // Сервер останавливается — на сайте никто не должен остаться «в игре»
        if (ready && sb != null) {
            try {
                sb.resetOnline();
            } catch (Supabase.ApiException ignored) {
            }
        }
    }

    /* ---------- Вход и выход: статус, скин, статистика ---------- */

    @EventHandler(priority = EventPriority.MONITOR)
    public void onJoin(PlayerJoinEvent e) {
        if (!ready) return;
        UUID id = e.getPlayer().getUniqueId();
        // SkinsRestorer применяет скин чуть позже входа — ждём 3 секунды
        getServer().getScheduler().runTaskLater(this, () -> {
            Player p = getServer().getPlayer(id);
            if (p != null) pushLive(p, true);
        }, 60L);
    }

    @EventHandler(priority = EventPriority.MONITOR)
    public void onQuit(PlayerQuitEvent e) {
        if (ready) pushLive(e.getPlayer(), false);
    }

    /** Собирает данные в основном потоке и отправляет на сайт в фоне. */
    private void pushLive(Player p, boolean online) {
        if (!isEnabled()) return;
        String nick = p.getName();
        JsonObject stats = PlayerData.stats(p);
        String skin = PlayerData.skinHash(p);
        String now = Instant.now().toString();
        Supabase client = sb;
        getServer().getScheduler().runTaskAsynchronously(this, () -> {
            try {
                String id = gameId(client, nick);
                if (id != null) client.updateLive(id, online, now, stats, skin);
            } catch (Supabase.ApiException ex) {
                getLogger().warning("Не удалось обновить статус «" + nick + "» на сайте: " + ex.getMessage());
            }
        });
    }

    /** Обновляет всех, кто сейчас онлайн, — по одному игроку за тик, чтобы не нагружать сервер. */
    private void pushOnlinePlayers() {
        if (!isEnabled()) return;
        getServer().getScheduler().runTask(this, () -> {
            long delay = 0;
            for (Player p : getServer().getOnlinePlayers()) {
                UUID id = p.getUniqueId();
                getServer().getScheduler().runTaskLater(this, () -> {
                    Player pl = getServer().getPlayer(id);
                    if (pl != null) pushLive(pl, true);
                }, ++delay);
            }
        });
    }

    /** id профиля из игры по нику или null (профили, созданные на сайте по почте, не трогаем). */
    private String gameId(Supabase client, String nick) throws Supabase.ApiException {
        String key = nick.toLowerCase(Locale.ROOT);
        String id = gameIds.get(key);
        if (id != null) return id;
        Supabase.Profile p = client.findProfile(nick);
        if (p == null || !"game".equals(p.source())) return null;
        gameIds.put(key, p.id());
        return p.id();
    }

    /* ---------- Пароль из команд AuthMe ---------- */

    @EventHandler(priority = EventPriority.MONITOR)
    public void onCommand(PlayerCommandPreprocessEvent e) {
        if (!ready) return;
        String[] a = e.getMessage().trim().split("\\s+");
        if (a.length < 2 || a[0].length() < 2) return;
        String cmd = a[0].substring(1).toLowerCase(Locale.ROOT);
        int colon = cmd.indexOf(':');
        if (colon >= 0) cmd = cmd.substring(colon + 1);
        final String password;
        final boolean announce;
        if (REGISTER.contains(cmd)) {
            password = a[1];
            announce = true;
        } else if (LOGIN.contains(cmd)) {
            password = a[1];
            announce = false;
        } else if (CHANGE.contains(cmd) && a.length >= 3) {
            password = a[2];
            announce = true;
        } else {
            return;
        }
        Player p = e.getPlayer();
        String name = p.getName();
        UUID id = p.getUniqueId();
        // AuthMe обрабатывает команду асинхронно — проверяем результат чуть позже
        getServer().getScheduler().runTaskLaterAsynchronously(this, () -> afterAuth(name, id, password, announce, 1), 40L);
    }

    private void afterAuth(String name, UUID id, String password, boolean announce, int attempt) {
        Boolean ok = checkAuthMePassword(name, password);
        if (ok == null) return;
        if (!ok) {
            // AuthMe мог ещё не дописать регистрацию — пробуем ещё пару раз
            if (attempt < 3) getServer().getScheduler().runTaskLaterAsynchronously(this, () -> afterAuth(name, id, password, announce, attempt + 1), 60L);
            return;
        }
        try {
            long now = System.currentTimeMillis();
            Result r = ensureAccount(name, now, now);
            if (r.userId() == null) return;
            sb.setPassword(r.userId(), password);
            if (announce || r.created()) tell(id, msgReady.replace("{nick}", name).replace("{url}", siteUrl));
        } catch (Supabase.ApiException ex) {
            if (ex.status == 422 && ex.getMessage().toLowerCase(Locale.ROOT).contains("password")) {
                tell(id, msgWeak);
                getLogger().info("Сайт не принял пароль игрока " + name + " (слишком короткий или простой).");
            } else {
                getLogger().warning("Не удалось обновить аккаунт " + name + " на сайте: " + ex.getMessage());
            }
        }
    }

    /** Проверка пароля через API AuthMe (без зависимости при сборке). null — API недоступно. */
    private Boolean checkAuthMePassword(String name, String password) {
        try {
            Plugin am = getServer().getPluginManager().getPlugin("AuthMe");
            if (am == null) return null;
            Class<?> api = Class.forName("fr.xephi.authme.api.v3.AuthMeApi", true, am.getClass().getClassLoader());
            Object inst = api.getMethod("getInstance").invoke(null);
            return (Boolean) api.getMethod("checkPassword", String.class, String.class).invoke(inst, name, password);
        } catch (Throwable t) {
            getLogger().warning("Нет доступа к AuthMe API: " + t.getClass().getSimpleName());
            return null;
        }
    }

    /* ---------- Аккаунт на сайте ---------- */

    /** Находит профиль игрока на сайте или создаёт аккаунт + профиль. userId == null — создать нельзя. */
    private synchronized Result ensureAccount(String nick, long regdate, long lastlogin) throws Supabase.ApiException {
        String key = nick.toLowerCase(Locale.ROOT);
        if (conflicts.contains(key) || skipped.contains(key)) return new Result(null, false);
        if (!NICK.matcher(nick).matches()) {
            skipped.add(key);
            getLogger().info("Ник «" + nick + "» не подходит под правила сайта (3–16 символов: латиница, цифры, _ и точка) — пропускаю.");
            return new Result(null, false);
        }
        Supabase.Profile existing = sb.findProfile(nick);
        if (existing != null) {
            if ("game".equals(existing.source())) {
                gameIds.put(key, existing.id());
                return new Result(existing.id(), false);
            }
            conflicts.add(key);
            getLogger().warning("Ник «" + nick + "» уже занят профилем, который зарегистрировали на сайте по почте. Аккаунт из игры не создаю.");
            return new Result(null, false);
        }
        String platform = isBedrock(nick) ? "bedrock" : "java";
        String email = email(nick);
        String userId;
        boolean fresh = true;
        try {
            userId = sb.createUser(email, randomPassword(), nick, platform);
        } catch (Supabase.ApiException e) {
            String m = e.getMessage().toLowerCase(Locale.ROOT);
            if (e.status != 422 || !(m.contains("already") || m.contains("exists"))) throw e;
            // Почта уже занята. Это наш же аккаунт от прошлой неудачной попытки — или другой игрок,
            // чей ник отличается только точкой/пробелом («a.b» и «a b» дают одну почту). Чужой не трогаем.
            Supabase.AuthUser old = sb.findUserByEmail(email);
            if (old == null) throw e;
            if (old.nickname() == null || !old.nickname().equalsIgnoreCase(nick)) {
                conflicts.add(key);
                getLogger().warning("Для «" + nick + "» служебная почта совпала с аккаунтом «" + old.nickname()
                        + "» (ники отличаются только точкой или пробелом). Аккаунт не создаю — напиши разработчику сайта.");
                return new Result(null, false);
            }
            userId = old.id();
            fresh = false;
        }
        try {
            sb.insertProfile(userId, nick, platform, iso(regdate), iso(lastlogin));
        } catch (Supabase.ApiException e) {
            if (e.status == 409) {
                conflicts.add(key);
                // удаляем только аккаунт, который сами только что создали
                if (fresh) try { sb.deleteUser(userId); } catch (Supabase.ApiException ignored) { }
                getLogger().warning("Ник «" + nick + "» успели занять на сайте — аккаунт из игры не создан.");
                return new Result(null, false);
            }
            throw e;
        }
        gameIds.put(key, userId);
        getLogger().info("Создан профиль на сайте: " + nick);
        return new Result(userId, true);
    }

    /** Служебная почта аккаунта из игры. Та же формула — в account.js на сайте (nickEmail). */
    private String email(String nick) {
        String n = nick.toLowerCase(Locale.ROOT);
        if (isBedrock(nick)) n = "be-" + n.substring(prefix.length());
        return n.replaceAll("[^a-z0-9_]", "-") + "@" + domain;
    }

    private boolean isBedrock(String nick) {
        return !prefix.isEmpty() && nick.startsWith(prefix);
    }

    private String randomPassword() {
        byte[] b = new byte[24];
        random.nextBytes(b);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(b);
    }

    private static String iso(long millis) {
        return millis > 0 ? Instant.ofEpochMilli(millis).toString() : null;
    }

    /* ---------- Синхронизация базы AuthMe ---------- */

    private void fullSync() {
        if (!ready || !syncing.compareAndSet(false, true)) return;
        int created = 0, updated = 0, failed = 0;
        try {
            List<AuthMeReader.Row> rows = authme.readAll();
            Map<String, Supabase.Profile> game = sb.gameProfiles();
            game.forEach((k, p) -> gameIds.put(k, p.id()));
            for (AuthMeReader.Row r : rows) {
                try {
                    Supabase.Profile p = game.get(r.nick().toLowerCase(Locale.ROOT));
                    if (p == null) {
                        if (ensureAccount(r.nick(), r.regdate(), r.lastlogin()).created()) created++;
                    } else if (r.lastlogin() > 0 && (p.lastSeen() == null
                            || OffsetDateTime.parse(p.lastSeen()).toInstant().toEpochMilli() < r.lastlogin() - 60_000)) {
                        sb.updateLastSeen(p.id(), iso(r.lastlogin()));
                        updated++;
                    }
                } catch (Exception e) {
                    if (++failed <= 5) getLogger().warning("Синхронизация «" + r.nick() + "»: " + e.getMessage());
                }
            }
            lastSync = TIME.format(Instant.now()) + " — игроков в AuthMe: " + rows.size() + ", новых профилей: " + created
                    + ", обновлено: " + updated + (failed > 0 ? ", ошибок: " + failed : "");
            if (created > 0 || updated > 0 || failed > 0) getLogger().info("Синхронизация: " + lastSync);
            pushOnlinePlayers();
        } catch (Exception e) {
            lastSync = TIME.format(Instant.now()) + " — ошибка: " + e.getMessage();
            getLogger().warning("Синхронизация не удалась: " + e.getMessage());
        } finally {
            syncing.set(false);
        }
    }

    /* ---------- Команда /sitesync ---------- */

    @Override
    public boolean onCommand(CommandSender s, Command command, String label, String[] args) {
        if (args.length > 0 && args[0].equalsIgnoreCase("reload")) {
            s.sendMessage(color("&6[SiteSync] &f" + loadSettings()));
            return true;
        }
        if (!ready) {
            s.sendMessage(color("&6[SiteSync] &cНе настроен. &fВпиши ключ в plugins/SiteSync/config.yml и введи &e/sitesync reload"));
            return true;
        }
        if (args.length > 0 && args[0].equalsIgnoreCase("sync")) {
            s.sendMessage(color("&6[SiteSync] &fЗапускаю синхронизацию…"));
            getServer().getScheduler().runTaskAsynchronously(this, () -> {
                fullSync();
                getServer().getScheduler().runTask(this, () -> s.sendMessage(color("&6[SiteSync] &f" + lastSync)));
            });
            return true;
        }
        s.sendMessage(color("&6[SiteSync] &fПоследняя синхронизация: " + lastSync));
        s.sendMessage(color("&6[SiteSync] &fБаза AuthMe: " + authme.file().getPath()
                + (conflicts.isEmpty() ? "" : " &7· ников, занятых на сайте по почте: " + conflicts.size())));
        return true;
    }

    private void tell(UUID id, String message) {
        getServer().getScheduler().runTask(this, () -> {
            Player p = getServer().getPlayer(id);
            if (p != null) p.sendMessage(color(message));
        });
    }

    @SuppressWarnings("deprecation")
    private static String color(String s) {
        return ChatColor.translateAlternateColorCodes('&', s);
    }
}
