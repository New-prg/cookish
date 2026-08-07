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
    public static final String PREFERENCES = "cookish_background_sync";
    public static final String KEY_STATE = "state_json";
    public static final String KEY_SPREADSHEET_ID = "spreadsheet_id";
    public static final String KEY_EMAIL = "email";
    public static final String KEY_LAST_BACKGROUND_SYNC_AT = "last_background_sync_at";
    public static final String KEY_LAST_BACKGROUND_SYNC_ERROR = "last_background_sync_error";

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
            preferences.edit()
                .putLong(KEY_LAST_BACKGROUND_SYNC_AT, System.currentTimeMillis())
                .remove(KEY_LAST_BACKGROUND_SYNC_ERROR)
                .apply();
            return Result.success();
        } catch (GoogleAuthException | IOException error) {
            preferences.edit()
                .putString(KEY_LAST_BACKGROUND_SYNC_ERROR, "Не удалось синхронизировать данные в фоне.")
                .apply();
            return Result.retry();
        } catch (JSONException error) {
            preferences.edit()
                .putString(KEY_LAST_BACKGROUND_SYNC_ERROR, "Повреждены локальные данные фоновой синхронизации.")
                .apply();
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

        List<JSONArray> products = mergeSingleRows(remote.products, local.products, 4);
        Map<String, RequestBlock> requests = new HashMap<>(remote.requests);
        for (Map.Entry<String, RequestBlock> entry : local.requests.entrySet()) {
            RequestBlock remoteBlock = requests.get(entry.getKey());
            requests.put(
                entry.getKey(),
                remoteBlock == null ? entry.getValue() : mergeRequestBlocks(remoteBlock, entry.getValue())
            );
        }
        Map<String, List<JSONArray>> rationDays = mergeRationDays(remote.rationDays, local.rationDays);

        JSONArray productValues = new JSONArray()
            .put(row("id", "Наименование", "Категория", "Единица", "Обновлён", "Кем обновлён", "Пищевая ценность JSON", "Источник данных", "Штрихкод", "Состав", "Удалён"));
        for (JSONArray product : products) productValues.put(product);

        JSONArray requestValues = new JSONArray()
            .put(row("request_id", "product_id", "Запрошено", "Статус", "Создан", "Закрыт", "Автор", "Обновлён", "Кем обновлён", "Удалён", "Объём рациона", "Размер упаковки", "Единица объёма"));
        JSONArray responseValues = new JSONArray()
            .put(row("response_id", "request_id", "product_id", "purchased_product_id", "Куплено", "Цена позиции", "Ответ создан", "Автор ответа", "Ответ обновлён", "Кем обновлён", "Удалён", "Режим"));
        for (RequestBlock block : requests.values()) {
            for (JSONArray request : block.requestRows) requestValues.put(request);
            for (JSONArray response : block.responseRows) responseValues.put(response);
        }

        JSONArray rationValues = new JSONArray()
            .put(row(
                "Дата", "meal_id", "Приём пищи", "item_id", "product_id", "Продукт",
                "Порядок приёма", "Порядок продукта", "Обновлён", "Кем обновлён",
                "Владелец рациона", "Размер порции", "Размер упаковки", "Плановое время"
            ));
        for (List<JSONArray> dayRows : rationDays.values()) {
            for (JSONArray rationRow : dayRows) rationValues.put(rationRow);
        }

        clearRemote(token, spreadsheetId, remote.hasRationSheet);
        JSONArray data = new JSONArray()
            .put(range("Продукты!A1:K", productValues))
            .put(range("Запросы!A1:M", requestValues))
            .put(range("Покупки!A1:L", responseValues));
        if (remote.hasRationSheet) {
            data.put(range("Рацион!A1:N", rationValues));
        }
        post(
            "https://sheets.googleapis.com/v4/spreadsheets/" + spreadsheetId + "/values:batchUpdate",
            token,
            new JSONObject().put("valueInputOption", "USER_ENTERED").put("data", data)
        );
    }

    private RemoteValues readRemote(String token, String spreadsheetId)
        throws IOException, JSONException {
        boolean hasRationSheet = true;
        JSONObject response;
        try {
            response = get(
                "https://sheets.googleapis.com/v4/spreadsheets/" + spreadsheetId +
                    "/values:batchGet?ranges=" + encode("Продукты!A2:N") +
                    "&ranges=" + encode("Запросы!A2:N") +
                    "&ranges=" + encode("Покупки!A2:L") +
                    "&ranges=" + encode("Рацион!A2:N"),
                token
            );
        } catch (IOException error) {
            hasRationSheet = false;
            response = get(
                "https://sheets.googleapis.com/v4/spreadsheets/" + spreadsheetId +
                    "/values:batchGet?ranges=" + encode("Продукты!A2:N") +
                    "&ranges=" + encode("Запросы!A2:N") +
                    "&ranges=" + encode("Покупки!A2:L"),
                token
            );
        }
        JSONArray valueRanges = response.optJSONArray("valueRanges");
        JSONArray productRows = valuesAt(valueRanges, 0);
        JSONArray requestRows = valuesAt(valueRanges, 1);
        JSONArray purchaseRows = valuesAt(valueRanges, 2);
        JSONArray rationRows = hasRationSheet ? valuesAt(valueRanges, 3) : new JSONArray();

        RemoteValues result = new RemoteValues();
        result.hasRationSheet = hasRationSheet;
        for (int index = 0; index < productRows.length(); index++) {
            JSONArray row = productRows.optJSONArray(index);
            if (row != null && !stringAt(row, 0).isEmpty()) {
                result.products.add(normalizeProductRow(row));
            }
        }

        JSONArray normalizedRequestRows = new JSONArray();
        for (int index = 0; index < requestRows.length(); index++) {
            JSONArray requestRow = requestRows.optJSONArray(index);
            if (requestRow != null && !stringAt(requestRow, 0).isEmpty()) {
                normalizedRequestRows.put(normalizeRequestRow(requestRow));
            }
        }
        Map<String, List<JSONArray>> groupedRequests = groupRows(normalizedRequestRows, 0, 1);
        for (Map.Entry<String, List<JSONArray>> entry : groupedRequests.entrySet()) {
            List<JSONArray> rows = entry.getValue();
            String updatedAt = rows.isEmpty() ? "" : timestamp(stringAt(rows.get(0), 7));
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
        result.rationDays.putAll(groupRationRows(rationRows));
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
                product.optString("updatedAt"),
                product.optString("updatedBy"),
                product.isNull("nutrition") ? "" : product.optJSONObject("nutrition").toString(),
                product.isNull("nutrition") ? "" : product.optJSONObject("nutrition").optString("source"),
                product.optString("barcode"),
                product.optString("ingredients"),
                product.optString("deletedAt")
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
                    "open".equals(request.optString("status")) ? "Активен" : "Выполнен",
                    request.optString("createdAt"),
                    request.optString("completedAt"),
                    request.optString("createdBy", "local"),
                    request.optString("updatedAt", request.optString("createdAt")),
                    request.optString("updatedBy", request.optString("createdBy", "local")),
                    request.optString("deletedAt"),
                    item.optDouble("plannedAmount", 0),
                    item.optDouble("packageSize", 0),
                    item.optString("measureUnit")
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
                            item.optString("purchasedProductId", item.optString("productId")),
                            item.optDouble("quantity", 0),
                            item.optDouble("price", 0),
                            response.optString("createdAt"),
                            response.optString("createdBy", "local"),
                            response.optString("updatedAt", response.optString("createdAt")),
                            response.optString("updatedBy", response.optString("createdBy", "local")),
                            response.optString("deletedAt"),
                            item.optString("completionMode", "filled")
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

        JSONObject rationDays = state.optJSONObject("rationDays");
        if (rationDays != null) {
            JSONArray keys = rationDays.names();
            if (keys != null) {
                for (int dayIndex = 0; dayIndex < keys.length(); dayIndex++) {
                    JSONObject day = rationDays.optJSONObject(keys.optString(dayIndex));
                    if (day == null) continue;
                    String date = day.optString("date");
                    String owner = day.optString("owner", "local").trim().toLowerCase();
                    if (date.isEmpty()) continue;
                    String storageKey = owner + "|" + date;
                    List<JSONArray> dayRows = new ArrayList<>();
                    JSONArray meals = day.optJSONArray("meals");
                    if (meals == null || meals.length() == 0) {
                        dayRows.add(row(
                            date, "__empty__", "", "", "", "", 0, 0,
                            day.optString("updatedAt"),
                            day.optString("updatedBy", "local"),
                            owner, "", "", ""
                        ));
                    } else {
                        for (int mealIndex = 0; mealIndex < meals.length(); mealIndex++) {
                            JSONObject meal = meals.optJSONObject(mealIndex);
                            if (meal == null) continue;
                            JSONArray mealItems = meal.optJSONArray("items");
                            if (mealItems == null || mealItems.length() == 0) {
                                dayRows.add(row(
                                    date,
                                    meal.optString("id"),
                                    meal.optString("name", "Приём пищи"),
                                    "", "", "",
                                    mealIndex, 0,
                                    day.optString("updatedAt"),
                                    day.optString("updatedBy", "local"),
                                    owner, "", "",
                                    meal.optString("time")
                                ));
                                continue;
                            }
                            for (int itemIndex = 0; itemIndex < mealItems.length(); itemIndex++) {
                                JSONObject item = mealItems.optJSONObject(itemIndex);
                                if (item == null) continue;
                                dayRows.add(row(
                                    date,
                                    meal.optString("id"),
                                    meal.optString("name", "Приём пищи"),
                                    item.optString("id"),
                                    item.optString("productId"),
                                    item.optString("name"),
                                    mealIndex,
                                    itemIndex,
                                    day.optString("updatedAt"),
                                    day.optString("updatedBy", "local"),
                                    owner,
                                    item.optDouble("portionSize", 0),
                                    item.optDouble("packageSize", 0),
                                    meal.optString("time")
                                ));
                            }
                        }
                    }
                    result.rationDays.put(storageKey, dayRows);
                }
            }
        }
        return result;
    }

    private static Map<String, List<JSONArray>> groupRationRows(JSONArray rationRows) {
        Map<String, List<JSONArray>> grouped = new LinkedHashMap<>();
        if (rationRows == null) return grouped;
        for (int index = 0; index < rationRows.length(); index++) {
            JSONArray row = rationRows.optJSONArray(index);
            if (row == null) continue;
            String date = stringAt(row, 0);
            String mealId = stringAt(row, 1);
            if (date.isEmpty() || mealId.isEmpty()) continue;
            String owner = stringAt(row, 10).trim().toLowerCase();
            if (owner.isEmpty()) owner = "remote";
            String key = owner + "|" + date;
            grouped.computeIfAbsent(key, ignored -> new ArrayList<>()).add(row);
        }
        return grouped;
    }

    private static Map<String, List<JSONArray>> mergeRationDays(
        Map<String, List<JSONArray>> remoteDays,
        Map<String, List<JSONArray>> localDays
    ) {
        Map<String, List<JSONArray>> merged = new LinkedHashMap<>(remoteDays);
        for (Map.Entry<String, List<JSONArray>> entry : localDays.entrySet()) {
            List<JSONArray> remote = merged.get(entry.getKey());
            if (remote == null || rationDayUpdatedAt(entry.getValue()).compareTo(rationDayUpdatedAt(remote)) >= 0) {
                merged.put(entry.getKey(), entry.getValue());
            }
        }
        return merged;
    }

    private static String rationDayUpdatedAt(List<JSONArray> rows) {
        String latest = "";
        for (JSONArray row : rows) {
            String value = timestamp(stringAt(row, 8));
            if (value.compareTo(latest) > 0) latest = value;
        }
        return latest;
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
            String creator = stringAt(first, 6);
            boolean active = !"Выполнен".equals(stringAt(first, 3)) && stringAt(first, 9).isEmpty();
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

    private void clearRemote(String token, String spreadsheetId, boolean includeRation)
        throws IOException, JSONException {
        JSONArray ranges = new JSONArray()
            .put("Продукты!A:N")
            .put("Запросы!A:N")
            .put("Покупки!A:L");
        if (includeRation) ranges.put("Рацион!A:N");
        post(
            "https://sheets.googleapis.com/v4/spreadsheets/" + spreadsheetId + "/values:batchClear",
            token,
            new JSONObject().put("ranges", ranges)
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
            String version = timestamp(stringAt(row, 8));
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
        return rows.isEmpty() ? "" : timestamp(stringAt(rows.get(0), 8));
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
        boolean legacyStockSchema = source.length() >= 14 || (
            source.length() >= 8 && isNumeric(source.opt(4)) && !stringAt(source, 7).isEmpty()
        );
        return row(
            stringAt(source, 0),
            stringAt(source, 1),
            stringAt(source, 2),
            stringAt(source, 3),
            stringAt(source, legacyStockSchema ? 7 : 4),
            stringAt(source, legacyStockSchema ? 8 : 5),
            stringAt(source, legacyStockSchema ? 9 : 6),
            stringAt(source, legacyStockSchema ? 10 : 7),
            stringAt(source, legacyStockSchema ? 11 : 8),
            stringAt(source, legacyStockSchema ? 12 : 9),
            stringAt(source, legacyStockSchema ? 13 : 10)
        );
    }

    private static JSONArray normalizeRequestRow(JSONArray source) {
        String statusAtThree = stringAt(source, 3);
        String statusAtFour = stringAt(source, 4);
        boolean statusAtThreeKnown = "Активен".equals(statusAtThree) || "Выполнен".equals(statusAtThree);
        boolean statusAtFourKnown = "Активен".equals(statusAtFour) || "Выполнен".equals(statusAtFour);
        boolean legacyStockSchema = source.length() >= 14 || (!statusAtThreeKnown && statusAtFourKnown);
        int offset = legacyStockSchema ? 1 : 0;
        return row(
            stringAt(source, 0),
            stringAt(source, 1),
            doubleAt(source, 2),
            stringAt(source, 3 + offset),
            stringAt(source, 4 + offset),
            stringAt(source, 5 + offset),
            stringAt(source, 6 + offset),
            stringAt(source, 7 + offset),
            stringAt(source, 8 + offset),
            stringAt(source, 9 + offset),
            doubleAt(source, 10 + offset),
            doubleAt(source, 11 + offset),
            stringAt(source, 12 + offset)
        );
    }

    private static JSONArray normalizeResponseRow(
        JSONArray source,
        Map<String, RequestBlock> requests
    ) {
        if (source == null || stringAt(source, 0).isEmpty()) return null;
        boolean modern = source.length() >= 5 && requests.containsKey(stringAt(source, 1));
        boolean extended = modern && source.length() >= 11;
        String requestId = modern ? stringAt(source, 1) : stringAt(source, 0);
        RequestBlock request = requests.get(requestId);
        if (request == null || request.requestRows.isEmpty()) return null;
        JSONArray requestRow = request.requestRows.get(0);
        String createdAt = modern ? stringAt(source, extended ? 6 : 5) : stringAt(requestRow, 5);
        if (createdAt.isEmpty()) createdAt = stringAt(requestRow, 7);
        if (createdAt.isEmpty()) createdAt = stringAt(requestRow, 4);
        String creator = modern ? stringAt(source, extended ? 7 : 6) : stringAt(requestRow, 8);
        if (creator.isEmpty()) creator = stringAt(requestRow, 6);
        String updatedAt = modern ? stringAt(source, extended ? 8 : 7) : stringAt(requestRow, 7);
        if (updatedAt.isEmpty()) updatedAt = createdAt;
        return row(
            modern ? stringAt(source, 0) : "response_legacy_" + requestId,
            requestId,
            modern ? stringAt(source, 2) : stringAt(source, 1),
            extended ? stringAt(source, 3) : modern ? stringAt(source, 2) : stringAt(source, 1),
            modern ? doubleAt(source, extended ? 4 : 3) : doubleAt(source, 2),
            modern ? doubleAt(source, extended ? 5 : 4) : doubleAt(source, 3),
            createdAt,
            creator,
            updatedAt,
            modern ? stringAt(source, extended ? 9 : 8) : creator,
            modern ? stringAt(source, extended ? 10 : 9) : "",
            extended ? stringAt(source, 11) : "filled"
        );
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

    private static boolean isNumeric(Object value) {
        if (value instanceof Number) return true;
        if (value == null || String.valueOf(value).trim().isEmpty()) return false;
        try {
            Double.parseDouble(String.valueOf(value));
            return true;
        } catch (NumberFormatException ignored) {
            return false;
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
        final Map<String, List<JSONArray>> rationDays = new LinkedHashMap<>();
        boolean hasRationSheet = false;
    }

    private static final class LocalValues {
        final List<JSONArray> products = new ArrayList<>();
        final Map<String, RequestBlock> requests = new HashMap<>();
        final Map<String, List<JSONArray>> rationDays = new LinkedHashMap<>();
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
