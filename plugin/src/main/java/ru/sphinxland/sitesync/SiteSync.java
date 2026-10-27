package ru.sphinxland.sitesync;

import org.bukkit.ChatColor;
import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.configuration.file.FileConfiguration;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerCommandPreprocessEvent;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.java.JavaPlugin;

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
 */
public final class SiteSync extends JavaPlugin implements Listener {

    /** Те же правила ника, что и на сайте (с префиксом Floodgate). */
    private static final Pattern NICK = Pattern.compile("^[.*]?[A-Za-z0-9_][A-Za-z0-9_ ]{1,14}[A-Za-z0-9_]$");
    private static final Set<String> REGISTER = Set.of("register", "reg");
    private static final Set<String> LOGIN = Set.of("login", "l", "log");
    private static final Set<String> CHANGE = Set.of("changepassword", "cp");
    private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("dd.MM HH:mm").withZone(ZoneId.systemDefault());

    record Result(String userId, boolean created) {}

    private Supabase sb;
    private AuthMeReader authme;
    private String domain, prefix, siteUrl, msgReady, msgWeak;
    private final Set<String> conflicts = ConcurrentHashMap.newKeySet();
    private final Set<String> skipped = ConcurrentHashMap.newKeySet();
    private final AtomicBoolean syncing = new AtomicBoolean();
    private final SecureRandom random = new SecureRandom();
    private volatile String lastSync = "ещё не было";

    @Override
    public void onEnable() {
        saveDefaultConfig();
        FileConfiguration c = getConfig();
        String url = c.getString("supabase.url", "").trim();
        String key = c.getString("supabase.service-key", "").trim();
        if (url.isEmpty() || key.isEmpty() || key.startsWith("sb_publishable_")) {
            getLogger().severe("Заполни supabase.url и supabase.service-key (СЕКРЕТНЫЙ ключ) в plugins/SiteSync/config.yml и перезапусти сервер.");
            getServer().getPluginManager().disablePlugin(this);
            return;
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

        getServer().getPluginManager().registerEvents(this, this);
        long every = Math.max(1, c.getLong("sync-interval-minutes", 10)) * 60L * 20L;
        getServer().getScheduler().runTaskTimerAsynchronously(this, this::fullSync, 20L * 15, every);
        getLogger().info("SiteSync запущен: база AuthMe — " + db.getPath() + ", синхронизация каждые " + every / 1200 + " мин.");
    }

    /* ---------- Пароль из команд AuthMe ---------- */

    @EventHandler(priority = EventPriority.MONITOR)
    public void onCommand(PlayerCommandPreprocessEvent e) {
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
            getLogger().info("Ник «" + nick + "» не подходит под правила сайта (3–16 символов: латиница, цифры, _) — пропускаю.");
            return new Result(null, false);
        }
        Supabase.Profile existing = sb.findProfile(nick);
        if (existing != null) {
            if ("game".equals(existing.source())) return new Result(existing.id(), false);
            conflicts.add(key);
            getLogger().warning("Ник «" + nick + "» уже занят профилем, который зарегистрировали на сайте по почте. Аккаунт из игры не создаю.");
            return new Result(null, false);
        }
        String platform = isBedrock(nick) ? "bedrock" : "java";
        String email = email(nick);
        String userId;
        try {
            userId = sb.createUser(email, randomPassword(), nick, platform);
        } catch (Supabase.ApiException e) {
            String m = e.getMessage().toLowerCase(Locale.ROOT);
            if (e.status != 422 || !(m.contains("already") || m.contains("exists"))) throw e;
            userId = sb.findUserIdByEmail(email); // аккаунт остался от прошлой неудачной попытки
            if (userId == null) throw e;
        }
        try {
            sb.insertProfile(userId, nick, platform, iso(regdate), iso(lastlogin));
        } catch (Supabase.ApiException e) {
            if (e.status == 409) {
                conflicts.add(key);
                try { sb.deleteUser(userId); } catch (Supabase.ApiException ignored) { }
                getLogger().warning("Ник «" + nick + "» успели занять на сайте — аккаунт из игры не создан.");
                return new Result(null, false);
            }
            throw e;
        }
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
        if (!syncing.compareAndSet(false, true)) return;
        int created = 0, updated = 0, failed = 0;
        try {
            List<AuthMeReader.Row> rows = authme.readAll();
            Map<String, Supabase.Profile> game = sb.gameProfiles();
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
