package ru.sphinxland.sitesync;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import org.bukkit.configuration.ConfigurationSection;
import org.bukkit.configuration.file.YamlConfiguration;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;

/**
 * Читает кланы ApexClan из его yml-файлов (по файлу на клан: clan-name, leader, mods, clan-members…).
 * Только чтение — сами файлы не меняются. Файлы ищутся по всей папке плагина, поэтому не важно,
 * в какой подпапке ApexClan их хранит.
 */
final class ApexClans {

    record Member(UUID uuid, String role, long joined) {}

    record Clan(String name, boolean open, long created, List<Member> members, JsonObject game) {}

    private static final Pattern NAME = Pattern.compile("^[A-Za-z0-9А-Яа-яЁё_]{2,16}$");
    private static final Pattern HEX = Pattern.compile("#([0-9a-fA-F]{6})");
    private static final Pattern LEGACY = Pattern.compile("[&§]([0-9a-fA-F])");
    private static final String[] LEGACY_COLORS = {"#000000", "#0000AA", "#00AA00", "#00AAAA", "#AA0000", "#AA00AA",
            "#FFAA00", "#AAAAAA", "#555555", "#5555FF", "#55FF55", "#55FFFF", "#FF5555", "#FF55FF", "#FFFF55", "#FFFFFF"};
    private static final DateTimeFormatter CREATED = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    private final File folder;

    ApexClans(File folder) {
        this.folder = folder;
    }

    File folder() {
        return folder;
    }

    List<Clan> readAll() throws IOException {
        if (!folder.isDirectory()) throw new IOException("папка ApexClan не найдена: " + folder.getPath());
        String defaultColor = YamlConfiguration.loadConfiguration(new File(folder, "config.yml"))
                .getString("settings.placeholders.default_color", "&e");
        List<Clan> out = new ArrayList<>();
        Set<String> names = new LinkedHashSet<>();
        try (Stream<Path> files = Files.walk(folder.toPath(), 3)) {
            for (Path p : (Iterable<Path>) files.filter(f -> f.toString().endsWith(".yml"))::iterator) {
                YamlConfiguration y;
                try {
                    y = YamlConfiguration.loadConfiguration(p.toFile());
                } catch (Exception e) {
                    continue; // файл как раз перезаписывается — заберём в следующий раз
                }
                if (!y.isString("clan-name") || !y.isList("clan-members")) continue; // настройки, сундуки и т.п.
                Clan c = parse(y, defaultColor);
                if (c != null && names.add(c.name().toLowerCase(Locale.ROOT))) out.add(c);
            }
        }
        return out;
    }

    private static Clan parse(YamlConfiguration y, String defaultColor) {
        String name = y.getString("clan-name", "").trim();
        if (!NAME.matcher(name).matches()) return null;
        UUID leader = uuid(y.getString("leader"));
        Set<UUID> mods = new LinkedHashSet<>();
        for (String s : y.getStringList("mods")) {
            UUID u = uuid(s);
            if (u != null) mods.add(u);
        }
        ConfigurationSection joins = y.getConfigurationSection("join-dates");
        List<Member> members = new ArrayList<>();
        Set<UUID> seen = new LinkedHashSet<>();
        for (String s : y.getStringList("clan-members")) {
            UUID u = uuid(s);
            if (u == null || !seen.add(u)) continue;
            String role = u.equals(leader) ? "owner" : mods.contains(u) ? "officer" : "member";
            long joined = joins != null ? joins.getLong(u.toString(), 0) : 0;
            members.add(new Member(u, role, joined));
        }

        String join = y.getString("join_type", "INVITE_ONLY");
        boolean open = join.equalsIgnoreCase("OPEN") || join.equalsIgnoreCase("PUBLIC");
        long created = 0;
        try {
            created = LocalDateTime.parse(y.getString("creation-date", ""), CREATED).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli();
        } catch (Exception ignored) {
        }

        JsonObject game = new JsonObject();
        game.add("colors", colors(y.getString("metadata.custom_tag", ""), defaultColor));
        game.addProperty("xp", y.getLong("xp"));
        game.addProperty("prestige", y.getLong("prestige"));
        game.addProperty("kills", y.getLong("total-kills"));
        game.addProperty("deaths", y.getLong("total-deaths"));
        game.addProperty("verified", y.getBoolean("verified"));
        game.addProperty("join", join.toUpperCase(Locale.ROOT));
        String desc = y.getString("description", "").trim();
        if (!desc.isEmpty()) game.addProperty("description", desc.length() > 600 ? desc.substring(0, 600) : desc);
        return new Clan(name, open, created, members, game);
    }

    /** Цвета тега: градиент или &#RRGGBB — все hex по порядку, иначе обычный цвет (&e) — один hex. */
    static JsonArray colors(String tag, String defaultColor) {
        JsonArray arr = new JsonArray();
        Matcher m = HEX.matcher(tag == null ? "" : tag);
        while (m.find() && arr.size() < 6) arr.add("#" + m.group(1).toLowerCase(Locale.ROOT));
        if (arr.isEmpty()) {
            Matcher l = LEGACY.matcher((tag == null ? "" : tag) + " " + defaultColor);
            if (l.find()) arr.add(LEGACY_COLORS[Integer.parseInt(l.group(1), 16)].toLowerCase(Locale.ROOT));
        }
        return arr;
    }

    private static UUID uuid(String s) {
        try {
            return s == null ? null : UUID.fromString(s.trim());
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    /** UUID игрока в режиме без лицензии — так его считают сервер и ApexClan. */
    static UUID offlineUuid(String nick) {
        return UUID.nameUUIDFromBytes(("OfflinePlayer:" + nick).getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }

    static String iso(long millis) {
        return millis > 0 ? Instant.ofEpochMilli(millis).toString() : null;
    }
}
