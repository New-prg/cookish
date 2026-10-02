package ru.listok.purchases.ai;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;

/**
 * Performs the test assistant's HTTP requests natively, so the WebView origin
 * does not depend on the provider's CORS rules. Only the AI provider host is
 * reachable through this bridge. Request and response bodies are never logged:
 * the Authorization header carries the person's key.
 */
public final class AiHttp {
    public static final String HOST = "routerai.ru";
    private static final long MAX_RESPONSE_BYTES = 4L * 1024L * 1024L;
    private static final int MIN_TIMEOUT_MS = 1_000;
    private static final int MAX_TIMEOUT_MS = 180_000;

    private AiHttp() {}

    public static boolean isAllowed(String url) {
        if (url == null) return false;
        try {
            URI uri = new URI(url);
            return "https".equals(uri.getScheme())
                && HOST.equals(uri.getHost())
                && uri.getUserInfo() == null
                && (uri.getPort() == -1 || uri.getPort() == 443);
        } catch (Exception ignored) {
            return false;
        }
    }

    /** Takes {method, url, headers, body, timeoutMs}; returns {status, body} or {error}. */
    public static String execute(String payload) {
        HttpURLConnection connection = null;
        try {
            JSONObject request = new JSONObject(payload);
            String url = request.optString("url", "");
            String method = request.optString("method", "GET");
            if (!isAllowed(url) || !("GET".equals(method) || "POST".equals(method))) return error("blocked");
            int timeout = Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, request.optInt("timeoutMs", 120_000)));
            connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setRequestMethod(method);
            connection.setConnectTimeout(Math.min(timeout, 20_000));
            connection.setReadTimeout(timeout);
            connection.setUseCaches(false);
            connection.setInstanceFollowRedirects(false);
            JSONObject headers = request.optJSONObject("headers");
            if (headers != null) {
                Iterator<String> names = headers.keys();
                while (names.hasNext()) {
                    String name = names.next();
                    connection.setRequestProperty(name, headers.optString(name, ""));
                }
            }
            if ("POST".equals(method)) {
                byte[] bytes = request.optString("body", "").getBytes(StandardCharsets.UTF_8);
                connection.setDoOutput(true);
                connection.setFixedLengthStreamingMode(bytes.length);
                try (OutputStream output = connection.getOutputStream()) {
                    output.write(bytes);
                }
            }
            int status = connection.getResponseCode();
            InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            String body = stream == null ? "" : readText(stream);
            JSONObject result = new JSONObject();
            result.put("status", status);
            result.put("body", body);
            return result.toString();
        } catch (SocketTimeoutException timeout) {
            return error("timeout");
        } catch (Exception failure) {
            return error("network");
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    static String error(String kind) {
        return "{\"error\":\"" + kind + "\"}";
    }

    private static String readText(InputStream input) throws Exception {
        try (InputStream source = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[16 * 1024];
            long total = 0;
            int count;
            while ((count = source.read(buffer)) != -1) {
                total += count;
                if (total > MAX_RESPONSE_BYTES) throw new IllegalStateException("response too large");
                output.write(buffer, 0, count);
            }
            return output.toString("UTF-8");
        }
    }
}
