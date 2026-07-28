package ru.listok.purchases;

import android.Manifest;
import android.accounts.Account;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import com.google.android.gms.auth.GoogleAuthException;
import com.google.android.gms.auth.GoogleAuthUtil;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

public class SheetsSyncWorker extends Worker {
    public static final String PREFERENCES = "listok_background_sync";
    public static final String KEY_STATE = "state_json";
    public static final String KEY_SPREADSHEET_ID = "spreadsheet_id";
    public static final String KEY_EMAIL = "email";

    private static final String KEY_SEEN_REMOTE_IDS = "seen_remote_request_ids";
    private static final String KEY_REMOTE_TRACKING_READY = "remote_tracking_ready";
    private static final String NOTIFICATION_CHANNEL = "new_purchase_requests";
    private static final String SHEETS_SCOPE =
        "oauth2:https://www.googleapis.com/auth/spreadsheets";

    public SheetsSyncWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        SharedPreferences preferences = getApplicationContext()
            .getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
        String stateJson = preferences.getString(KEY_STATE, "");
        String spreadsheetId = preferences.getString(KEY_SPREADSHEET_ID, "");
        String email = preferences.getString(KEY_EMAIL, "");
        if (stateJson.isEmpty() || spreadsheetId.isEmpty() || email.isEmpty()) {
            return Result.success();
        }

        try {
            Account account = new Account(email, GoogleAuthUtil.GOOGLE_ACCOUNT_TYPE);
            String token = GoogleAuthUtil.getToken(getApplicationContext(), account, SHEETS_SCOPE);
            synchronize(token, spreadsheetId, email, new JSONObject(stateJson), preferences);
            return Result.success();
        } catch (GoogleAuthException | IOException error) {
            return Result.retry();
        } catch (JSONException error) {
            return Result.failure();
        }
    }

    private void synchronize(
        String token,
        String spreadsheetId,
        String currentEmail,
        JSONObject localState,
        SharedPreferences preferences
    ) throws IOException, JSONException {
        RemoteValues remote = readRemote(token, spreadsheetId);
        LocalValues local = buildLocal(localState);

        notifyNewRemoteRequests(remote, local, currentEmail, preferences);

        List<JSONArray> products = mergeSingleRows(remote.products, local.products, 7);
        Map<String, RequestBlock> requests = new HashMap<>(remote.requests);
        for (Map.Entry<String, RequestBlock> entry : local.requests.entrySet()) {
            RequestBlock remoteBlock = requests.get(entry.getKey());
            requests.put(
                entry.getKey(),
                remoteBlock == null ? entry.getValue() : mergeRequestBlocks(remoteBlock, entry.getValue())
            );
        }
        recomputeProductQuantities(products, requests);

        JSONArray productValues = new JSONArray()
            .put(row("id", "Наименование", "Категория", "Единица", "Базовый остаток", "База на дату", "Текущий остаток", "Обновлён", "Кем обновлён"));
        for (JSONArray product : products) productValues.put(product);

        JSONArray requestValues = new JSONArray()
            .put(row("request_id", "product_id", "Запрошено", "Остаток", "Статус", "Создан", "Закрыт", "Автор", "Обновлён", "Кем обновлён"));
        JSONArray responseValues = new JSONArray()
            .put(row("response_id", "request_id", "product_id", "Куплено", "Цена позиции", "Ответ создан", "Автор ответа", "Ответ обновлён", "Кем обновлён"));
        for (RequestBlock block : requests.values()) {
            for (JSONArray request : block.requestRows) requestValues.put(request);
            for (JSONArray response : block.responseRows) responseValues.put(response);
        }

        clearRemote(token, spreadsheetId);
        JSONArray data = new JSONArray()
            .put(range("Продукты!A1:I", productValues))
            .put(range("Запросы!A1:J", requestValues))
            .put(range("Покупки!A1:I", responseValues));
        post(
            "https://sheets.googleapis.com/v4/spreadsheets/" + spreadsheetId + "/values:batchUpdate",
            token,
            new JSONObject().put("valueInputOption", "USER_ENTERED").put("data", data)
        );
    }

    private RemoteValues readRemote(String token, String spreadsheetId)
        throws IOException, JSONException {
        String ranges =
            "ranges=" + encode("Продукты!A2:I") +
            "&ranges=" + encode("Запросы!A2:J") +
            "&ranges=" + encode("Покупки!A2:I");
        JSONObject response = get(
            "https://sheets.googleapis.com/v4/spreadsheets/" + spreadsheetId +
                "/values:batchGet?" + ranges,
            token
        );
        JSONArray valueRanges = response.optJSONArray("valueRanges");
        JSONArray productRows = valuesAt(valueRanges, 0);
        JSONArray requestRows = valuesAt(valueRanges, 1);
        JSONArray purchaseRows = valuesAt(valueRanges, 2);

        RemoteValues result = new RemoteValues();
        for (int index = 0; index < productRows.length(); index++) {
            JSONArray row = productRows.optJSONArray(index);
            if (row != null && !stringAt(row, 0).isEmpty()) {
                result.products.add(normalizeProductRow(row));
            }
        }

        Map<String, List<JSONArray>> groupedRequests = groupRows(requestRows, 0, 1);
        for (Map.Entry<String, List<JSONArray>> entry : groupedRequests.entrySet()) {
            List<JSONArray> rows = entry.getValue();
            String updatedAt = rows.isEmpty() ? "" : timestamp(stringAt(rows.get(0), 8));
            result.requests.put(
                entry.getKey(),
                new RequestBlock(rows, new ArrayList<>(), updatedAt)
            );
        }
        Map<String, List<JSONArray>> responsesByRequest = new HashMap<>();
        for (int index = 0; index < purchaseRows.length(); index++) {
            JSONArray normalized = normalizeResponseRow(
                purchaseRows.optJSONArray(index),
                result.requests
            );
            if (normalized == null) continue;
            responsesByRequest
                .computeIfAbsent(stringAt(normalized, 1), ignored -> new ArrayList<>())
                .add(normalized);
        }
        for (Map.Entry<String, List<JSONArray>> entry : responsesByRequest.entrySet()) {
            RequestBlock block = result.requests.get(entry.getKey());
            if (block == null) continue;
            result.requests.put(
                entry.getKey(),
                new RequestBlock(
                    block.requestRows,
                    dedupeResponseRows(entry.getValue()),
                    block.updatedAt
                )
            );
        }
        return result;
    }

    private LocalValues buildLocal(JSONObject state) throws JSONException {
        LocalValues result = new LocalValues();
        JSONArray products = state.optJSONArray("products");
        if (products == null) products = new JSONArray();
        for (int index = 0; index < products.length(); index++) {
            JSONObject product = products.getJSONObject(index);
            result.products.add(row(
                product.optString("id"),
                product.optString("name"),
                product.optString("category"),
                product.optString("unit"),
                product.optDouble("baseQuantity", product.optDouble("quantity", 0)),
                product.optString("baseUpdatedAt", product.optString("updatedAt")),
                product.optDouble("quantity", 0),
                product.optString("updatedAt"),
                product.optString("updatedBy")
            ));
        }

        JSONArray requests = state.optJSONArray("requests");
        if (requests == null) requests = new JSONArray();
        for (int requestIndex = 0; requestIndex < requests.length(); requestIndex++) {
            JSONObject request = requests.getJSONObject(requestIndex);
            List<JSONArray> requestRows = new ArrayList<>();
            List<JSONArray> responseRows = new ArrayList<>();
            JSONArray items = request.optJSONArray("items");
            if (items == null) items = new JSONArray();
            for (int itemIndex = 0; itemIndex < items.length(); itemIndex++) {
                JSONObject item = items.getJSONObject(itemIndex);
                requestRows.add(row(
                    request.optString("id"),
                    item.optString("productId"),
                    item.optDouble("quantity", 0),
                    item.optDouble("stockAtRequest", 0),
                    "open".equals(request.optString("status")) ? "Активен" : "Выполнен",
                    request.optString("createdAt"),
                    request.optString("completedAt"),
                    request.optString("createdBy", "local"),
                    request.optString("updatedAt", request.optString("createdAt")),
                    request.optString("updatedBy", request.optString("createdBy", "local"))
                ));
            }
            JSONArray responses = request.optJSONArray("responses");
            if (responses != null) {
                for (int responseIndex = 0; responseIndex < responses.length(); responseIndex++) {
                    JSONObject response = responses.getJSONObject(responseIndex);
                    JSONArray responseItems = response.optJSONArray("items");
                    if (responseItems == null) responseItems = new JSONArray();
                    for (int itemIndex = 0; itemIndex < responseItems.length(); itemIndex++) {
                        JSONObject item = responseItems.getJSONObject(itemIndex);
                        responseRows.add(row(
                            response.optString("id"),
                            request.optString("id"),
                            item.optString("productId"),
                            item.optDouble("quantity", 0),
                            item.optDouble("price", 0),
                            response.optString("createdAt"),
                            response.optString("createdBy", "local"),
                            response.optString("updatedAt", response.optString("createdAt")),
                            response.optString("updatedBy", response.optString("createdBy", "local"))
                        ));
                    }
                }
            }
            result.requests.put(
                request.optString("id"),
                new RequestBlock(
                    dedupeProductRows(requestRows),
                    dedupeResponseRows(responseRows),
                    timestamp(request.optString("updatedAt", request.optString("createdAt")))
                )
            );
        }
        return result;
    }

    private void notifyNewRemoteRequests(
        RemoteValues remote,
        LocalValues local,
        String currentEmail,
        SharedPreferences preferences
    ) {
        boolean trackingReady = preferences.getBoolean(KEY_REMOTE_TRACKING_READY, false);
        Set<String> seen = new HashSet<>(
            preferences.getStringSet(KEY_SEEN_REMOTE_IDS, new HashSet<>())
        );
        Map<String, String> productNames = new HashMap<>();
        for (JSONArray row : remote.products) {
            productNames.put(stringAt(row, 0), stringAt(row, 1));
        }

        for (Map.Entry<String, RequestBlock> entry : remote.requests.entrySet()) {
            String requestId = entry.getKey();
            RequestBlock block = entry.getValue();
            if (block.requestRows.isEmpty()) continue;
            JSONArray first = block.requestRows.get(0);
            String creator = stringAt(first, 7);
            boolean active = !"Выполнен".equals(stringAt(first, 4));
            boolean remoteUser = !creator.isEmpty()
                && !"local".equalsIgnoreCase(creator)
                && !creator.equalsIgnoreCase(currentEmail);
            if (
                trackingReady &&
                active &&
                remoteUser &&
                !local.requests.containsKey(requestId) &&
                !seen.contains(requestId)
            ) {
                showRequestNotification(
                    getApplicationContext(),
                    requestId,
                    summarize(block.requestRows, productNames),
                    creator
                );
            }
            if (remoteUser) seen.add(requestId);
        }
        preferences.edit()
            .putStringSet(KEY_SEEN_REMOTE_IDS, seen)
            .putBoolean(KEY_REMOTE_TRACKING_READY, true)
            .apply();
    }

    public static void createNotificationChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
            NOTIFICATION_CHANNEL,
            "Новые запросы",
            NotificationManager.IMPORTANCE_DEFAULT
        );
        channel.setDescription("Запросы на закупку от других участников");
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        manager.createNotificationChannel(channel);
    }

    public static void showRequestNotification(
        Context context,
        String requestId,
        String summary,
        String creator
    ) {
        createNotificationChannel(context);
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED
        ) return;

        Intent intent = new Intent(context, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            context,
            requestId.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        NotificationCompat.Builder notification = new NotificationCompat.Builder(
            context,
            NOTIFICATION_CHANNEL
        )
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(creator.isEmpty() ? "Новый запрос" : "Новый запрос от " + creator)
            .setContentText(summary)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(summary))
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT);
        NotificationManagerCompat.from(context).notify(requestId.hashCode(), notification.build());
    }

    private void clearRemote(String token, String spreadsheetId)
        throws IOException, JSONException {
        post(
            "https://sheets.googleapis.com/v4/spreadsheets/" + spreadsheetId + "/values:batchClear",
            token,
            new JSONObject().put("ranges", new JSONArray()
                .put("Продукты!A:J")
                .put("Запросы!A:K")
                .put("Покупки!A:J"))
        );
    }

    private static List<JSONArray> mergeSingleRows(
        List<JSONArray> remoteRows,
        List<JSONArray> localRows,
        int timestampIndex
    ) {
        Map<String, JSONArray> merged = new HashMap<>();
        for (JSONArray row : remoteRows) merged.put(stringAt(row, 0), row);
        for (JSONArray row : localRows) {
            String id = stringAt(row, 0);
            JSONArray remote = merged.get(id);
            if (remote == null || timestamp(stringAt(row, timestampIndex)).compareTo(
                timestamp(stringAt(remote, timestampIndex))
            ) >= 0) {
                merged.put(id, row);
            }
        }
        return new ArrayList<>(merged.values());
    }

    private static Map<String, List<JSONArray>> groupRows(
        JSONArray rows,
        int idIndex,
        int dedupeIndex
    ) {
        Map<String, LinkedHashMap<String, JSONArray>> grouped = new HashMap<>();
        for (int index = 0; index < rows.length(); index++) {
            JSONArray row = rows.optJSONArray(index);
            if (row == null) continue;
            String id = stringAt(row, idIndex);
            if (id.isEmpty()) continue;
            String dedupeId = stringAt(row, dedupeIndex);
            if (dedupeId.isEmpty()) continue;
            grouped.computeIfAbsent(id, ignored -> new LinkedHashMap<>()).put(dedupeId, row);
        }
        Map<String, List<JSONArray>> result = new HashMap<>();
        for (Map.Entry<String, LinkedHashMap<String, JSONArray>> entry : grouped.entrySet()) {
            result.put(entry.getKey(), new ArrayList<>(entry.getValue().values()));
        }
        return result;
    }

    private static RequestBlock mergeRequestBlocks(RequestBlock remote, RequestBlock local) {
        RequestBlock metadata = local.updatedAt.compareTo(remote.updatedAt) >= 0 ? local : remote;
        return new RequestBlock(
            metadata.requestRows,
            mergeResponseRows(remote.responseRows, local.responseRows),
            metadata.updatedAt
        );
    }

    private static List<JSONArray> mergeResponseRows(
        List<JSONArray> remoteRows,
        List<JSONArray> localRows
    ) {
        Map<String, List<JSONArray>> merged = responseBlocks(remoteRows);
        for (Map.Entry<String, List<JSONArray>> entry : responseBlocks(localRows).entrySet()) {
            List<JSONArray> remote = merged.get(entry.getKey());
            String localUpdatedAt = responseUpdatedAt(entry.getValue());
            if (remote == null || localUpdatedAt.compareTo(responseUpdatedAt(remote)) >= 0) {
                merged.put(entry.getKey(), entry.getValue());
            }
        }
        List<JSONArray> result = new ArrayList<>();
        for (List<JSONArray> rows : merged.values()) result.addAll(rows);
        return result;
    }

    private static Map<String, List<JSONArray>> responseBlocks(List<JSONArray> rows) {
        Map<String, LinkedHashMap<String, JSONArray>> grouped = new HashMap<>();
        Map<String, String> versions = new HashMap<>();
        for (JSONArray row : rows) {
            String responseId = stringAt(row, 0);
            String productId = stringAt(row, 2);
            if (responseId.isEmpty() || productId.isEmpty()) continue;
            String version = timestamp(stringAt(row, 7));
            String currentVersion = versions.get(responseId);
            if (currentVersion != null && version.compareTo(currentVersion) < 0) continue;
            if (currentVersion == null || version.compareTo(currentVersion) > 0) {
                grouped.put(responseId, new LinkedHashMap<>());
                versions.put(responseId, version);
            }
            grouped.get(responseId).put(productId, row);
        }
        Map<String, List<JSONArray>> result = new HashMap<>();
        for (Map.Entry<String, LinkedHashMap<String, JSONArray>> entry : grouped.entrySet()) {
            result.put(entry.getKey(), new ArrayList<>(entry.getValue().values()));
        }
        return result;
    }

    private static String responseUpdatedAt(List<JSONArray> rows) {
        return rows.isEmpty() ? "" : timestamp(stringAt(rows.get(0), 7));
    }

    private static List<JSONArray> dedupeProductRows(List<JSONArray> rows) {
        Map<String, JSONArray> unique = new LinkedHashMap<>();
        for (JSONArray row : rows) {
            String productId = stringAt(row, 1);
            if (!productId.isEmpty()) unique.put(productId, row);
        }
        return new ArrayList<>(unique.values());
    }

    private static List<JSONArray> dedupeResponseRows(List<JSONArray> rows) {
        List<JSONArray> result = new ArrayList<>();
        for (List<JSONArray> block : responseBlocks(rows).values()) result.addAll(block);
        return result;
    }

    private static JSONArray normalizeProductRow(JSONArray source) {
        boolean modern = source.length() >= 8;
        String updatedAt = modern ? stringAt(source, 7) : stringAt(source, 5);
        return row(
            stringAt(source, 0),
            stringAt(source, 1),
            stringAt(source, 2),
            stringAt(source, 3),
            doubleAt(source, 4),
            modern ? stringAt(source, 5) : updatedAt,
            modern ? doubleAt(source, 6) : doubleAt(source, 4),
            updatedAt,
            modern ? stringAt(source, 8) : stringAt(source, 6)
        );
    }

    private static JSONArray normalizeResponseRow(
        JSONArray source,
        Map<String, RequestBlock> requests
    ) {
        if (source == null || stringAt(source, 0).isEmpty()) return null;
        boolean modern = source.length() >= 5 && requests.containsKey(stringAt(source, 1));
        String requestId = modern ? stringAt(source, 1) : stringAt(source, 0);
        RequestBlock request = requests.get(requestId);
        if (request == null || request.requestRows.isEmpty()) return null;
        JSONArray requestRow = request.requestRows.get(0);
        String createdAt = modern ? stringAt(source, 5) : stringAt(requestRow, 6);
        if (createdAt.isEmpty()) createdAt = stringAt(requestRow, 8);
        if (createdAt.isEmpty()) createdAt = stringAt(requestRow, 5);
        String creator = modern ? stringAt(source, 6) : stringAt(requestRow, 9);
        if (creator.isEmpty()) creator = stringAt(requestRow, 7);
        String updatedAt = modern ? stringAt(source, 7) : stringAt(requestRow, 8);
        if (updatedAt.isEmpty()) updatedAt = createdAt;
        return row(
            modern ? stringAt(source, 0) : "response_legacy_" + requestId,
            requestId,
            modern ? stringAt(source, 2) : stringAt(source, 1),
            modern ? doubleAt(source, 3) : doubleAt(source, 2),
            modern ? doubleAt(source, 4) : doubleAt(source, 3),
            createdAt,
            creator,
            updatedAt,
            modern ? stringAt(source, 8) : creator
        );
    }

    private static void recomputeProductQuantities(
        List<JSONArray> products,
        Map<String, RequestBlock> requests
    ) throws JSONException {
        for (JSONArray product : products) {
            String productId = stringAt(product, 0);
            String baseAt = timestamp(stringAt(product, 5));
            double quantity = doubleAt(product, 4);
            for (RequestBlock request : requests.values()) {
                for (JSONArray response : request.responseRows) {
                    if (
                        productId.equals(stringAt(response, 2)) &&
                        timestamp(stringAt(response, 5)).compareTo(baseAt) > 0
                    ) {
                        quantity += doubleAt(response, 3);
                    }
                }
            }
            product.put(6, quantity);
        }
    }

    private static String summarize(
        List<JSONArray> rows,
        Map<String, String> productNames
    ) {
        List<String> values = new ArrayList<>();
        for (JSONArray row : rows) {
            String productId = stringAt(row, 1);
            String name = productNames.getOrDefault(productId, "Продукт");
            values.add(name + " — " + stringAt(row, 2));
        }
        return String.join("; ", values);
    }

    private static JSONArray valuesAt(JSONArray ranges, int index) {
        if (ranges == null) return new JSONArray();
        JSONObject range = ranges.optJSONObject(index);
        return range == null || range.optJSONArray("values") == null
            ? new JSONArray()
            : range.optJSONArray("values");
    }

    private static String stringAt(JSONArray row, int index) {
        Object value = row.opt(index);
        return value == null ? "" : String.valueOf(value);
    }

    private static double doubleAt(JSONArray row, int index) {
        Object value = row.opt(index);
        if (value instanceof Number) return ((Number) value).doubleValue();
        try {
            return value == null ? 0 : Double.parseDouble(String.valueOf(value));
        } catch (NumberFormatException ignored) {
            return 0;
        }
    }

    private static String timestamp(String value) {
        return value == null ? "" : value;
    }

    private static String encode(String value) {
        return Uri.encode(value);
    }

    private static JSONArray row(Object... values) {
        JSONArray result = new JSONArray();
        for (Object value : values) result.put(value);
        return result;
    }

    private static JSONObject range(String name, JSONArray values) throws JSONException {
        return new JSONObject().put("range", name).put("values", values);
    }

    private static JSONObject get(String address, String token)
        throws IOException, JSONException {
        HttpURLConnection connection = open(address, token, "GET");
        int status = connection.getResponseCode();
        InputStream stream = status >= 200 && status < 300
            ? connection.getInputStream()
            : connection.getErrorStream();
        String content = stream == null ? "" : readString(stream);
        connection.disconnect();
        if (status < 200 || status >= 300) throw new IOException(content);
        return new JSONObject(content);
    }

    private static void post(String address, String token, JSONObject body) throws IOException {
        HttpURLConnection connection = open(address, token, "POST");
        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        connection.setDoOutput(true);
        try (OutputStream output = connection.getOutputStream()) {
            output.write(body.toString().getBytes(StandardCharsets.UTF_8));
        }
        int status = connection.getResponseCode();
        if (status < 200 || status >= 300) {
            InputStream error = connection.getErrorStream();
            String message = error == null ? "Google Sheets HTTP " + status : readString(error);
            throw new IOException(message);
        }
        connection.disconnect();
    }

    private static HttpURLConnection open(String address, String token, String method)
        throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection();
        connection.setRequestMethod(method);
        connection.setRequestProperty("Authorization", "Bearer " + token);
        connection.setConnectTimeout(15_000);
        connection.setReadTimeout(20_000);
        return connection;
    }

    private static String readString(InputStream input) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[4096];
        int count;
        while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
        return output.toString(StandardCharsets.UTF_8.name());
    }

    private static final class RemoteValues {
        final List<JSONArray> products = new ArrayList<>();
        final Map<String, RequestBlock> requests = new HashMap<>();
    }

    private static final class LocalValues {
        final List<JSONArray> products = new ArrayList<>();
        final Map<String, RequestBlock> requests = new HashMap<>();
    }

    private static final class RequestBlock {
        final List<JSONArray> requestRows;
        final List<JSONArray> responseRows;
        final String updatedAt;

        RequestBlock(
            List<JSONArray> requestRows,
            List<JSONArray> responseRows,
            String updatedAt
        ) {
            this.requestRows = requestRows;
            this.responseRows = responseRows;
            this.updatedAt = updatedAt;
        }
    }
}
