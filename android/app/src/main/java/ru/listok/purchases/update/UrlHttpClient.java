package ru.listok.purchases.update;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;

public final class UrlHttpClient implements HttpClient {
    @Override
    public String get(String url, String userAgent) throws Exception {
        HttpURLConnection connection = open(url, userAgent);
        connection.setConnectTimeout(15_000);
        connection.setReadTimeout(20_000);
        connection.setRequestProperty("Accept", "application/vnd.github+json");
        connection.setRequestProperty("X-GitHub-Api-Version", "2022-11-28");
        connection.setUseCaches(false);
        try {
            int responseCode = connection.getResponseCode();
            if (responseCode != HttpURLConnection.HTTP_OK) {
                throw new IllegalStateException(
                    responseCode == HttpURLConnection.HTTP_NOT_FOUND
                        ? "Пока нет опубликованных версий."
                        : "GitHub вернул ошибку " + responseCode + "."
                );
            }
            return readText(connection.getInputStream(), 2L * 1024L * 1024L);
        } finally {
            connection.disconnect();
        }
    }

    @Override
    public String download(String url, File destination, String userAgent, long maxBytes) throws Exception {
        HttpURLConnection connection = open(url, userAgent);
        connection.setInstanceFollowRedirects(true);
        connection.setConnectTimeout(20_000);
        connection.setReadTimeout(60_000);
        try {
            int responseCode = connection.getResponseCode();
            if (responseCode != HttpURLConnection.HTTP_OK) {
                throw new IllegalStateException("Не удалось скачать APK: ошибка " + responseCode + ".");
            }
            long contentLength = connection.getContentLengthLong();
            if (contentLength > maxBytes) {
                throw new IllegalStateException("Файл обновления слишком большой.");
            }
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            long total = 0;
            try (
                InputStream input = connection.getInputStream();
                FileOutputStream output = new FileOutputStream(destination)
            ) {
                byte[] buffer = new byte[64 * 1024];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    total += count;
                    if (total > maxBytes) {
                        throw new IllegalStateException("Файл обновления слишком большой.");
                    }
                    digest.update(buffer, 0, count);
                    output.write(buffer, 0, count);
                }
                output.getFD().sync();
            }
            if (total == 0 || (contentLength > 0 && total != contentLength)) {
                throw new IllegalStateException("APK загрузился не полностью.");
            }
            return AppUpdate.hex(digest.digest());
        } finally {
            connection.disconnect();
        }
    }

    private static HttpURLConnection open(String url, String userAgent) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setRequestProperty("User-Agent", userAgent);
        return connection;
    }

    private static String readText(InputStream input, long limit) throws Exception {
        try (InputStream source = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[16 * 1024];
            long total = 0;
            int count;
            while ((count = source.read(buffer)) != -1) {
                total += count;
                if (total > limit) throw new IllegalStateException("Ответ сервера слишком большой.");
                output.write(buffer, 0, count);
            }
            return output.toString("UTF-8");
        }
    }
}
