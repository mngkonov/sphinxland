package ru.sphinxland.sitesync;

import java.io.File;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.List;
import java.util.Properties;

/** Читает базу AuthMe (SQLite) только для чтения — сама база не меняется. */
final class AuthMeReader {

    record Row(String nick, long regdate, long lastlogin) {}

    private final File file;
    private final String table, colName, colReal, colReg, colLast;

    AuthMeReader(File file, String table, String colName, String colReal, String colReg, String colLast) {
        this.file = file;
        this.table = table;
        this.colName = colName;
        this.colReal = colReal;
        this.colReg = colReg;
        this.colLast = colLast;
    }

    File file() {
        return file;
    }

    List<Row> readAll() throws SQLException {
        if (!file.isFile()) throw new SQLException("файл базы AuthMe не найден: " + file.getPath());
        try {
            Class.forName("org.sqlite.JDBC"); // драйвер SQLite встроен в Paper
        } catch (ClassNotFoundException e) {
            throw new SQLException("в сервере нет драйвера SQLite (org.sqlite.JDBC)");
        }
        Properties props = new Properties();
        props.setProperty("open_mode", "1"); // SQLITE_OPEN_READONLY
        String sql = "SELECT " + q(colName) + ", " + q(colReal) + ", " + q(colReg) + ", " + q(colLast) + " FROM " + q(table);
        try (Connection c = DriverManager.getConnection("jdbc:sqlite:" + file.getAbsolutePath(), props);
             Statement st = c.createStatement();
             ResultSet rs = st.executeQuery(sql)) {
            List<Row> out = new ArrayList<>();
            while (rs.next()) {
                String real = rs.getString(2);
                String nick = real != null && !real.isBlank() ? real : rs.getString(1);
                if (nick == null || nick.isBlank()) continue;
                out.add(new Row(nick.trim(), rs.getLong(3), rs.getLong(4)));
            }
            return out;
        }
    }

    private static String q(String id) {
        return "\"" + id.replace("\"", "\"\"") + "\"";
    }
}
