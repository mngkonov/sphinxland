package ru.sphinxland.sitesync;

import com.google.gson.JsonObject;
import org.bukkit.Material;
import org.bukkit.Statistic;
import org.bukkit.entity.Player;

import java.net.URL;
import java.util.List;
import java.util.Locale;

/** Скин и статистика игрока для профиля на сайте. Вызывать в основном потоке сервера. */
final class PlayerData {

    /** Все способы перемещения, из которых складывается «пройдено». */
    private static final List<String> DISTANCE = List.of("WALK_ONE_CM", "SPRINT_ONE_CM", "CROUCH_ONE_CM", "SWIM_ONE_CM",
            "WALK_ON_WATER_ONE_CM", "WALK_UNDER_WATER_ONE_CM", "FLY_ONE_CM", "AVIATE_ONE_CM", "CLIMB_ONE_CM",
            "BOAT_ONE_CM", "HORSE_ONE_CM", "MINECART_ONE_CM", "PIG_ONE_CM", "STRIDER_ONE_CM");

    private PlayerData() {
    }

    /**
     * Хеш текстуры скина (textures.minecraft.net/texture/&lt;хеш&gt;) или null.
     * SkinsRestorer подставляет выбранный скин в профиль игрока — поэтому у пиратов
     * здесь их настоящий скин, а не скин лицензионного аккаунта с тем же ником.
     */
    static String skinHash(Player p) {
        try {
            URL u = p.getPlayerProfile().getTextures().getSkin();
            if (u == null) return null;
            String path = u.getPath();
            String hash = path.substring(path.lastIndexOf('/') + 1).toLowerCase(Locale.ROOT);
            return hash.matches("[0-9a-f]{20,80}") ? hash : null;
        } catch (Throwable t) {
            return null;
        }
    }

    /** Статистика Minecraft в том виде, который понимает сайт (поле profiles.stats). */
    static JsonObject stats(Player p) {
        JsonObject s = new JsonObject();
        s.addProperty("playtime", stat(p, "PLAY_ONE_MINUTE") / 20 / 60); // в тиках → минуты
        s.addProperty("joins", stat(p, "LEAVE_GAME"));
        s.addProperty("deaths", stat(p, "DEATHS"));
        s.addProperty("mob_kills", stat(p, "MOB_KILLS"));
        s.addProperty("player_kills", stat(p, "PLAYER_KILLS"));
        long mined = 0, placed = 0;
        for (Material m : Material.values()) {
            if (m.name().startsWith("LEGACY_") || !m.isBlock()) continue;
            mined += typed(p, Statistic.MINE_BLOCK, m);
            if (m.isItem()) placed += typed(p, Statistic.USE_ITEM, m); // «использовать» блок = поставить его
        }
        s.addProperty("blocks_mined", mined);
        s.addProperty("blocks_placed", placed);
        long cm = 0;
        for (String n : DISTANCE) cm += stat(p, n);
        s.addProperty("distance", cm / 100); // сантиметры → блоки
        return s;
    }

    private static long stat(Player p, String name) {
        try {
            return p.getStatistic(Statistic.valueOf(name));
        } catch (Exception e) {
            return 0; // такой статистики нет в этой версии игры
        }
    }

    private static long typed(Player p, Statistic st, Material m) {
        try {
            return p.getStatistic(st, m);
        } catch (Exception e) {
            return 0;
        }
    }
}
