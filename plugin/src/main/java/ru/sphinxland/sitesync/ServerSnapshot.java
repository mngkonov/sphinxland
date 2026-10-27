package ru.sphinxland.sitesync;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import org.bukkit.Server;
import org.bukkit.World;

import java.lang.management.ManagementFactory;
import java.time.Instant;

/** Снимок состояния сервера для страницы «Статистика». Вызывать в основном потоке. */
final class ServerSnapshot {

    private ServerSnapshot() {
    }

    static JsonObject take(Server s, boolean running) {
        JsonObject o = new JsonObject();
        o.addProperty("id", 1);
        o.addProperty("running", running);
        o.addProperty("online", running ? s.getOnlinePlayers().size() : 0);
        o.addProperty("max_players", s.getMaxPlayers());
        if (running) {
            Double tps = tps(s);
            if (tps != null) o.addProperty("tps", tps);
            try {
                o.addProperty("mspt", round(s.getAverageTickTime())); // Paper
            } catch (Throwable ignored) {
            }
            JsonArray worlds = new JsonArray();
            for (World w : s.getWorlds()) {
                JsonObject wo = new JsonObject();
                wo.addProperty("name", w.getName());
                wo.addProperty("env", w.getEnvironment().name());
                wo.addProperty("players", w.getPlayers().size());
                wo.addProperty("chunks", w.getLoadedChunks().length);
                try {
                    wo.addProperty("entities", w.getEntityCount()); // Paper
                } catch (Throwable ignored) {
                }
                worlds.add(wo);
            }
            o.add("worlds", worlds);
        }
        o.addProperty("started_at", Instant.ofEpochMilli(ManagementFactory.getRuntimeMXBean().getStartTime()).toString());
        try {
            o.addProperty("version", s.getMinecraftVersion()); // Paper
        } catch (Throwable t) {
            o.addProperty("version", s.getBukkitVersion());
        }
        o.addProperty("updated_at", Instant.now().toString());
        return o;
    }

    /** TPS за последнюю минуту (не больше 20) или null, если сервер его не отдаёт. */
    static Double tps(Server s) {
        try {
            return round(Math.min(20.0, s.getTPS()[0])); // Paper
        } catch (Throwable t) {
            return null;
        }
    }

    private static double round(double v) {
        return Math.round(v * 100.0) / 100.0;
    }
}
