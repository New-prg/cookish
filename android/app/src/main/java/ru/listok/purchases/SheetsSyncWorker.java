package ru.listok.purchases;

import android.accounts.Account;
import android.content.Context;
import android.content.SharedPreferences;

import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import com.google.android.gms.auth.GoogleAuthException;
import com.google.android.gms.auth.GoogleAuthUtil;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.ByteArrayOutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

public class SheetsSyncWorker extends Worker {
    public static final String PREFERENCES = "listok_background_sync";
    public static final String KEY_STATE = "state_json";
    public static final String KEY_SPREADSHEET_ID = "spreadsheet_id";
    public static final String KEY_EMAIL = "email";

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
            writeSpreadsheet(token, spreadsheetId, new JSONObject(stateJson));
            return Result.success();
        } catch (GoogleAuthException | IOException error) {
            return Result.retry();
        } catch (JSONException error) {
            return Result.failure();
        }
    }

    private void writeSpreadsheet(String token, String spreadsheetId, JSONObject state)
        throws IOException, JSONException {
        JSONArray products = state.optJSONArray("products");
        JSONArray requests = state.optJSONArray("requests");
        if (products == null) products = new JSONArray();
        if (requests == null) requests = new JSONArray();

        JSONArray productValues = new JSONArray()
            .put(row("id", "Наименование", "Категория", "Единица", "Остаток"));
        for (int index = 0; index < products.length(); index++) {
            JSONObject product = products.getJSONObject(index);
            productValues.put(row(
                product.optString("id"),
                product.optString("name"),
                product.optString("category"),
                product.optString("unit"),
                product.optDouble("quantity", 0)
            ));
        }

        JSONArray requestValues = new JSONArray()
            .put(row("request_id", "product_id", "Запрошено", "Остаток", "Статус", "Создан", "Закрыт"));
        JSONArray purchaseValues = new JSONArray()
            .put(row("request_id", "product_id", "Куплено", "Цена позиции"));
        for (int requestIndex = 0; requestIndex < requests.length(); requestIndex++) {
            JSONObject request = requests.getJSONObject(requestIndex);
            JSONArray items = request.optJSONArray("items");
            if (items == null) items = new JSONArray();
            for (int itemIndex = 0; itemIndex < items.length(); itemIndex++) {
                JSONObject item = items.getJSONObject(itemIndex);
                requestValues.put(row(
                    request.optString("id"),
                    item.optString("productId"),
                    item.optDouble("quantity", 0),
                    item.optDouble("stockAtRequest", 0),
                    "open".equals(request.optString("status")) ? "Активен" : "Выполнен",
                    request.optString("createdAt"),
                    request.optString("completedAt")
                ));
            }
            JSONArray purchases = request.optJSONArray("purchases");
            if (purchases == null) continue;
            for (int purchaseIndex = 0; purchaseIndex < purchases.length(); purchaseIndex++) {
                JSONObject purchase = purchases.getJSONObject(purchaseIndex);
                purchaseValues.put(row(
                    request.optString("id"),
                    purchase.optString("productId"),
                    purchase.optDouble("quantity", 0),
                    purchase.optDouble("price", 0)
                ));
            }
        }

        JSONObject clear = new JSONObject().put("ranges", new JSONArray()
            .put("Продукты!A:F")
            .put("Запросы!A:H")
            .put("Покупки!A:E"));
        post(
            "https://sheets.googleapis.com/v4/spreadsheets/" + spreadsheetId + "/values:batchClear",
            token,
            clear
        );

        JSONArray data = new JSONArray()
            .put(range("Продукты!A1:E", productValues))
            .put(range("Запросы!A1:G", requestValues))
            .put(range("Покупки!A1:D", purchaseValues));
        JSONObject update = new JSONObject()
            .put("valueInputOption", "USER_ENTERED")
            .put("data", data);
        post(
            "https://sheets.googleapis.com/v4/spreadsheets/" + spreadsheetId + "/values:batchUpdate",
            token,
            update
        );
    }

    private static JSONArray row(Object... values) {
        JSONArray result = new JSONArray();
        for (Object value : values) result.put(value);
        return result;
    }

    private static JSONObject range(String name, JSONArray values) throws JSONException {
        return new JSONObject().put("range", name).put("values", values);
    }

    private static void post(String address, String token, JSONObject body) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection();
        connection.setRequestMethod("POST");
        connection.setRequestProperty("Authorization", "Bearer " + token);
        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        connection.setConnectTimeout(15_000);
        connection.setReadTimeout(20_000);
        connection.setDoOutput(true);
        try (OutputStream output = connection.getOutputStream()) {
            output.write(body.toString().getBytes(StandardCharsets.UTF_8));
        }
        int status = connection.getResponseCode();
        if (status < 200 || status >= 300) {
            InputStream error = connection.getErrorStream();
            String message = error == null ? "Google Sheets HTTP " + status
                : readString(error);
            throw new IOException(message);
        }
        connection.disconnect();
    }

    private static String readString(InputStream input) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[4096];
        int count;
        while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
        return output.toString(StandardCharsets.UTF_8.name());
    }
}
