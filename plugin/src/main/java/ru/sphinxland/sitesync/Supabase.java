package ru.sphinxland.sitesync;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Минимальный клиент Supabase: Auth Admin API (создание аккаунтов, пароли)
 * и REST-таблица profiles. Работает с секретным ключом — только на сервере.
 */
final class Supabase {

    record Profile(String id, String nickname, String source, String lastSeen) {}

    static final class ApiException extends Exception {
        final int status;

        ApiException(int status, String message) {
            super(message);
            this.status = status;
        }
    }

    private final String url;
    private final String key;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();

    Supabase(String url, String key) {
        this.url = url.trim().replaceAll("/(rest|auth)/v1.*$", "").replaceAll("/+$", "");
        this.key = key.trim();
    }

    private JsonElement call(String method, String path, JsonElement body, String... headers) throws ApiException {
        HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(url + path))
                .timeout(Duration.ofSeconds(20))
                .header("apikey", key)
                .header("Authorization", "Bearer " + key)
                .header("Content-Type", "application/json");
        for (int i = 0; i + 1 < headers.length; i += 2) b.header(headers[i], headers[i + 1]);
        b.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body.toString()));
        try {
            HttpResponse<String> r = http.send(b.build(), HttpResponse.BodyHandlers.ofString());
            String text = r.body() == null ? "" : r.body();
            if (r.statusCode() >= 300) throw new ApiException(r.statusCode(), text.length() > 300 ? text.substring(0, 300) + "…" : text);
            return text.isBlank() ? JsonNull.INSTANCE : JsonParser.parseString(text);
        } catch (ApiException e) {
            throw e;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new ApiException(0, "прервано");
        } catch (Exception e) {
            throw new ApiException(0, e.getClass().getSimpleName() + ": " + e.getMessage());
        }
    }

    private static String enc(String s) {
        return URLEncoder.encode(s, StandardCharsets.UTF_8);
    }

    private static String str(JsonObject o, String k) {
        return o.has(k) && !o.get(k).isJsonNull() ? o.get(k).getAsString() : null;
    }

    private static Profile profile(JsonObject o) {
        return new Profile(str(o, "id"), str(o, "nickname"), str(o, "source"), str(o, "last_seen"));
    }

    /** Профиль по нику без учёта регистра или null. */
    Profile findProfile(String nick) throws ApiException {
        // ilike считает «_» любым символом — поэтому сверяем ник точно уже здесь
        JsonArray arr = call("GET", "/rest/v1/profiles?select=id,nickname,source,last_seen&nickname=ilike." + enc(nick), null).getAsJsonArray();
        for (JsonElement e : arr) {
            Profile p = profile(e.getAsJsonObject());
            if (nick.equalsIgnoreCase(p.nickname())) return p;
        }
        return null;
    }

    /** Все профили, созданные из игры: ник в нижнем регистре → профиль. */
    Map<String, Profile> gameProfiles() throws ApiException {
        Map<String, Profile> out = new HashMap<>();
        int from = 0, page = 1000;
        while (true) {
            JsonArray arr = call("GET", "/rest/v1/profiles?select=id,nickname,source,last_seen&source=eq.game&order=created_at", null,
                    "Range-Unit", "items", "Range", from + "-" + (from + page - 1)).getAsJsonArray();
            for (JsonElement e : arr) {
                Profile p = profile(e.getAsJsonObject());
                out.put(p.nickname().toLowerCase(Locale.ROOT), p);
            }
            if (arr.size() < page) return out;
            from += page;
        }
    }

    /** Создаёт аккаунт (почта сразу подтверждена) и возвращает его id. */
    String createUser(String email, String password, String nick, String platform) throws ApiException {
        JsonObject b = new JsonObject();
        b.addProperty("email", email);
        b.addProperty("password", password);
        b.addProperty("email_confirm", true);
        JsonObject md = new JsonObject();
        md.addProperty("nickname", nick);
        md.addProperty("platform", platform);
        md.addProperty("source", "game");
        b.add("user_metadata", md);
        return call("POST", "/auth/v1/admin/users", b).getAsJsonObject().get("id").getAsString();
    }

    record AuthUser(String id, String nickname) {}

    /** Аккаунт по почте (с ником из метаданных) или null — нужно, если прошлая попытка создала аккаунт, но не профиль. */
    AuthUser findUserByEmail(String email) throws ApiException {
        for (int page = 1; page <= 100; page++) {
            JsonObject r = call("GET", "/auth/v1/admin/users?page=" + page + "&per_page=500", null).getAsJsonObject();
            JsonArray users = r.getAsJsonArray("users");
            if (users == null || users.isEmpty()) return null;
            for (JsonElement u : users) {
                JsonObject o = u.getAsJsonObject();
                if (!email.equalsIgnoreCase(str(o, "email"))) continue;
                JsonObject md = o.has("user_metadata") && o.get("user_metadata").isJsonObject() ? o.getAsJsonObject("user_metadata") : new JsonObject();
                return new AuthUser(str(o, "id"), str(md, "nickname"));
            }
            if (users.size() < 500) return null;
        }
        return null;
    }

    void setPassword(String userId, String password) throws ApiException {
        JsonObject b = new JsonObject();
        b.addProperty("password", password);
        call("PUT", "/auth/v1/admin/users/" + enc(userId), b);
    }

    void deleteUser(String userId) throws ApiException {
        call("DELETE", "/auth/v1/admin/users/" + enc(userId), null);
    }

    void insertProfile(String id, String nick, String platform, String createdAt, String lastSeen) throws ApiException {
        JsonObject b = new JsonObject();
        b.addProperty("id", id);
        b.addProperty("nickname", nick);
        b.addProperty("platform", platform);
        b.addProperty("source", "game");
        b.addProperty("verified", true); // ник доказан регистрацией на сервере
        if (createdAt != null) b.addProperty("created_at", createdAt);
        if (lastSeen != null) b.addProperty("last_seen", lastSeen);
        call("POST", "/rest/v1/profiles", b, "Prefer", "return=minimal");
    }

    /** Живые данные с сервера: статус «в игре», время, статистика и скин (null — не трогать). */
    void updateLive(String id, boolean online, String lastSeen, JsonObject stats, String skin) throws ApiException {
        JsonObject b = new JsonObject();
        b.addProperty("online", online);
        b.addProperty("last_seen", lastSeen);
        if (stats != null) b.add("stats", stats);
        if (skin != null) b.addProperty("skin", skin);
        call("PATCH", "/rest/v1/profiles?id=eq." + enc(id), b, "Prefer", "return=minimal");
    }

    /** Снимает статус «в игре» со всех (при запуске и остановке плагина — на случай падения сервера). */
    void resetOnline() throws ApiException {
        JsonObject b = new JsonObject();
        b.addProperty("online", false);
        call("PATCH", "/rest/v1/profiles?online=is.true", b, "Prefer", "return=minimal");
    }

    void updateLastSeen(String id, String lastSeen) throws ApiException {
        JsonObject b = new JsonObject();
        b.addProperty("last_seen", lastSeen);
        call("PATCH", "/rest/v1/profiles?id=eq." + enc(id), b, "Prefer", "return=minimal");
    }
}
