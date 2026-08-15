package ru.listok.purchases;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.provider.Settings;
import android.webkit.JavascriptInterface;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.activity.OnBackPressedCallback;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import com.getcapacitor.BridgeActivity;
import com.google.zxing.integration.android.IntentIntegrator;
import com.google.zxing.integration.android.IntentResult;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

public class MainActivity extends BridgeActivity {
    private static final String PERIODIC_SYNC_WORK = "cookish-sheets-periodic-sync";
    private static final String IMMEDIATE_SYNC_WORK = "cookish-sheets-immediate-sync";
    private static final String UPDATE_API_URL =
        "https://api.github.com/repos/New-prg/cookish/releases/latest";
    private static final String UPDATE_DOWNLOAD_PREFIX =
        "https://github.com/New-prg/cookish/releases/download/";
    private static final String UPDATE_ASSET_NAME = "Cookish.apk";
    private static final long MAX_UPDATE_BYTES = 200L * 1024L * 1024L;
    private boolean backgroundAccessRequestPending = false;
    private boolean updateInstallPermissionPending = false;
    private OnBackPressedCallback webBackCallback;
    private final ExecutorService updateExecutor = Executors.newSingleThreadExecutor();
    private UpdateInfo pendingUpdate;

    @Override
    public void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        SheetsSyncWorker.createNotificationChannel(this);
        bridge.getWebView().addJavascriptInterface(new NativeAppBridge(), "NativeGoogle");
        webBackCallback = new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                handleWebBackPressed();
            }
        };
        getOnBackPressedDispatcher().addCallback(this, webBackCallback);
    }

    private void handleWebBackPressed() {
        if (bridge == null || bridge.getWebView() == null) {
            performDefaultBack();
            return;
        }
        bridge.getWebView().evaluateJavascript(
            "window.__handleNativeBack ? window.__handleNativeBack() : false",
            result -> {
                if (!"true".equals(result)) performDefaultBack();
            }
        );
    }

    private void performDefaultBack() {
        webBackCallback.setEnabled(false);
        getOnBackPressedDispatcher().onBackPressed();
        webBackCallback.setEnabled(true);
    }

    private final class NativeAppBridge {
        @JavascriptInterface
        public void scanBarcode() {
            runOnUiThread(() -> new IntentIntegrator(MainActivity.this)
                .setDesiredBarcodeFormats(IntentIntegrator.PRODUCT_CODE_TYPES)
                .setPrompt("Наведите камеру на штрихкод товара")
                .setBeepEnabled(false)
                .setCaptureActivity(PortraitCaptureActivity.class)
                .setOrientationLocked(true)
                .initiateScan());
        }

        @JavascriptInterface
        public void configureBackgroundSync(String stateJson, String spreadsheetId, String email) {
            getSharedPreferences(SheetsSyncWorker.PREFERENCES, MODE_PRIVATE)
                .edit()
                .putString(SheetsSyncWorker.KEY_STATE, stateJson)
                .putString(SheetsSyncWorker.KEY_SPREADSHEET_ID, spreadsheetId)
                .putString(SheetsSyncWorker.KEY_EMAIL, email)
                .apply();

            WorkManager manager = WorkManager.getInstance(getApplicationContext());
            if (spreadsheetId.isEmpty() || email.isEmpty()) {
                manager.cancelUniqueWork(PERIODIC_SYNC_WORK);
                manager.cancelUniqueWork(IMMEDIATE_SYNC_WORK);
                return;
            }

            Constraints constraints = new Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build();
            PeriodicWorkRequest periodic = new PeriodicWorkRequest.Builder(
                SheetsSyncWorker.class,
                15,
                TimeUnit.MINUTES
            ).setConstraints(constraints).build();
            OneTimeWorkRequest immediate = new OneTimeWorkRequest.Builder(SheetsSyncWorker.class)
                .setConstraints(constraints)
                .build();

            manager.enqueueUniquePeriodicWork(
                PERIODIC_SYNC_WORK,
                ExistingPeriodicWorkPolicy.UPDATE,
                periodic
            );
            manager.enqueueUniqueWork(
                IMMEDIATE_SYNC_WORK,
                ExistingWorkPolicy.REPLACE,
                immediate
            );
        }

        @JavascriptInterface
        public void getBackgroundAccessStatus() {
            runOnUiThread(() -> sendBackgroundAccessStatus());
        }

        @JavascriptInterface
        public void requestBackgroundAccess() {
            runOnUiThread(() -> {
                backgroundAccessRequestPending = true;
                if (!notificationsGranted()) {
                    requestNotificationPermission();
                    return;
                }
                requestBatteryOptimizationExemption();
                if (isBatteryOptimizationDisabled()) {
                    backgroundAccessRequestPending = false;
                    enqueueImmediateBackgroundSync();
                }
                sendBackgroundAccessStatus();
            });
        }

        @JavascriptInterface
        public void checkForAppUpdate() {
            MainActivity.this.checkForAppUpdate();
        }

        @JavascriptInterface
        public void installLatestUpdate() {
            runOnUiThread(() -> MainActivity.this.installLatestUpdate());
        }

        @JavascriptInterface
        public void openUrl(String url) {
            runOnUiThread(() -> {
                if (url == null) return;
                String trimmed = url.trim();
                if (!(trimmed.startsWith("https://") || trimmed.startsWith("http://"))) return;
                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(trimmed));
                startActivity(intent);
            });
        }

        @JavascriptInterface
        public void shareText(String title, String text) {
            runOnUiThread(() -> {
                Intent intent = new Intent(Intent.ACTION_SEND);
                intent.setType("text/plain");
                intent.putExtra(Intent.EXTRA_SUBJECT, title);
                intent.putExtra(Intent.EXTRA_TEXT, text);
                startActivity(Intent.createChooser(intent, "Поделиться таблицей"));
            });
        }

        @JavascriptInterface
        public void notifyRequest(String requestId, String summary, String creator) {
            SheetsSyncWorker.showRequestNotification(
                MainActivity.this,
                requestId,
                summary,
                creator
            );
        }
    }

    private void requestNotificationPermission() {
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED
        ) {
            ActivityCompat.requestPermissions(
                this,
                new String[]{Manifest.permission.POST_NOTIFICATIONS},
                9205
            );
        }
    }

    @SuppressLint("BatteryLife")
    private void requestBatteryOptimizationExemption() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M || isBatteryOptimizationDisabled()) return;
        try {
            Intent intent = new Intent(
                Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                Uri.parse("package:" + getPackageName())
            );
            startActivity(intent);
        } catch (RuntimeException error) {
            startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
        }
    }

    private boolean notificationsGranted() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) ==
                PackageManager.PERMISSION_GRANTED;
    }

    private boolean isBatteryOptimizationDisabled() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        PowerManager manager = (PowerManager) getSystemService(POWER_SERVICE);
        return manager != null && manager.isIgnoringBatteryOptimizations(getPackageName());
    }

    private void sendBackgroundAccessStatus() {
        if (bridge == null) return;
        boolean notifications = notificationsGranted();
        boolean battery = isBatteryOptimizationDisabled();
        SharedPreferences preferences = getSharedPreferences(
            SheetsSyncWorker.PREFERENCES,
            MODE_PRIVATE
        );
        long lastBackgroundSyncAt = preferences.getLong(
            SheetsSyncWorker.KEY_LAST_BACKGROUND_SYNC_AT,
            0
        );
        String lastBackgroundSyncError = preferences.getString(
            SheetsSyncWorker.KEY_LAST_BACKGROUND_SYNC_ERROR,
            ""
        );
        String payload = "{\"notificationsGranted\":" + notifications +
            ",\"batteryOptimizationDisabled\":" + battery +
            ",\"fullyGranted\":" + (notifications && battery) +
            ",\"lastBackgroundSyncAt\":" + lastBackgroundSyncAt +
            ",\"lastBackgroundSyncError\":" + JSONObject.quote(lastBackgroundSyncError) + "}";
        runOnUiThread(() -> bridge.getWebView().evaluateJavascript(
            "window.__onNativeBackgroundAccess && window.__onNativeBackgroundAccess(" + JSONObject.quote(payload) + ")",
            null
        ));
    }

    private void checkForAppUpdate() {
        updateExecutor.execute(() -> {
            HttpURLConnection connection = null;
            try {
                URL url = new URL(UPDATE_API_URL + "?t=" + System.currentTimeMillis());
                connection = (HttpURLConnection) url.openConnection();
                connection.setConnectTimeout(15_000);
                connection.setReadTimeout(20_000);
                connection.setRequestProperty("Accept", "application/vnd.github+json");
                connection.setRequestProperty("X-GitHub-Api-Version", "2022-11-28");
                connection.setRequestProperty("User-Agent", "Cookish-Android/" + installedVersionName());
                connection.setUseCaches(false);

                int responseCode = connection.getResponseCode();
                if (responseCode != HttpURLConnection.HTTP_OK) {
                    throw new IllegalStateException(
                        responseCode == HttpURLConnection.HTTP_NOT_FOUND
                            ? "Пока нет опубликованных версий."
                            : "GitHub вернул ошибку " + responseCode + "."
                    );
                }

                String response = readText(connection.getInputStream(), 2L * 1024L * 1024L);
                JSONObject release = new JSONObject(response);
                String latestVersion = normalizeVersion(release.optString("tag_name"));
                if (!latestVersion.matches("\\d+\\.\\d+\\.\\d+")) {
                    throw new IllegalStateException("У последнего релиза некорректный номер версии.");
                }

                JSONObject apkAsset = null;
                JSONArray assets = release.optJSONArray("assets");
                if (assets != null) {
                    for (int index = 0; index < assets.length(); index++) {
                        JSONObject candidate = assets.optJSONObject(index);
                        if (candidate != null && UPDATE_ASSET_NAME.equals(candidate.optString("name"))) {
                            apkAsset = candidate;
                            break;
                        }
                    }
                }
                if (apkAsset == null) {
                    throw new IllegalStateException("В последнем релизе нет файла " + UPDATE_ASSET_NAME + ".");
                }

                String downloadUrl = apkAsset.optString("browser_download_url");
                if (!downloadUrl.startsWith(UPDATE_DOWNLOAD_PREFIX)) {
                    throw new IllegalStateException("GitHub вернул недопустимую ссылку на APK.");
                }
                String digest = apkAsset.optString("digest");
                if (digest.startsWith("sha256:")) digest = digest.substring(7);
                if (!digest.isEmpty() && !digest.matches("[a-fA-F0-9]{64}")) {
                    throw new IllegalStateException("GitHub вернул некорректную контрольную сумму APK.");
                }

                String notes = release.optString("body");
                if (notes.length() > 1200) notes = notes.substring(0, 1200) + "…";
                UpdateInfo update = new UpdateInfo(
                    latestVersion,
                    downloadUrl,
                    digest.toLowerCase(),
                    release.optString("html_url"),
                    notes,
                    apkAsset.optLong("size", 0)
                );
                boolean available = compareVersions(latestVersion, installedVersionName()) > 0;
                pendingUpdate = available ? update : null;
                sendAppUpdateStatus(available ? "available" : "upToDate", "", update);
            } catch (Exception error) {
                sendAppUpdateStatus(
                    "error",
                    error.getMessage() == null ? "Не удалось проверить обновления." : error.getMessage(),
                    null
                );
            } finally {
                if (connection != null) connection.disconnect();
            }
        });
    }

    private void installLatestUpdate() {
        UpdateInfo update = pendingUpdate;
        if (update == null) {
            sendAppUpdateStatus("error", "Сначала проверьте наличие новой версии.", null);
            return;
        }
        if (
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            !getPackageManager().canRequestPackageInstalls()
        ) {
            updateInstallPermissionPending = true;
            sendAppUpdateStatus(
                "permissionRequired",
                "Разрешите Cookish устанавливать обновления, затем вернитесь в приложение.",
                update
            );
            Intent intent = new Intent(
                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:" + getPackageName())
            );
            startActivity(intent);
            return;
        }
        downloadAndInstallUpdate(update);
    }

    private void downloadAndInstallUpdate(UpdateInfo update) {
        updateInstallPermissionPending = false;
        sendAppUpdateStatus("downloading", "Загружаем обновление…", update);
        updateExecutor.execute(() -> {
            HttpURLConnection connection = null;
            File destination = null;
            try {
                URL url = new URL(update.downloadUrl);
                connection = (HttpURLConnection) url.openConnection();
                connection.setInstanceFollowRedirects(true);
                connection.setConnectTimeout(20_000);
                connection.setReadTimeout(60_000);
                connection.setRequestProperty("User-Agent", "Cookish-Android/" + installedVersionName());

                int responseCode = connection.getResponseCode();
                if (responseCode != HttpURLConnection.HTTP_OK) {
                    throw new IllegalStateException("Не удалось скачать APK: ошибка " + responseCode + ".");
                }
                long contentLength = connection.getContentLengthLong();
                if (contentLength > MAX_UPDATE_BYTES || update.size > MAX_UPDATE_BYTES) {
                    throw new IllegalStateException("Файл обновления слишком большой.");
                }

                File updateDirectory = new File(getCacheDir(), "updates");
                if (!updateDirectory.exists() && !updateDirectory.mkdirs()) {
                    throw new IllegalStateException("Не удалось подготовить папку обновления.");
                }
                File[] previousFiles = updateDirectory.listFiles();
                if (previousFiles != null) {
                    for (File previous : previousFiles) previous.delete();
                }
                destination = new File(updateDirectory, "Cookish-" + update.version + ".apk");

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
                        if (total > MAX_UPDATE_BYTES) {
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
                String actualDigest = hex(digest.digest());
                if (!update.sha256.isEmpty() && !update.sha256.equals(actualDigest)) {
                    throw new SecurityException("Контрольная сумма APK не совпала.");
                }

                File apk = destination;
                runOnUiThread(() -> openPackageInstaller(apk, update));
            } catch (Exception error) {
                if (destination != null) destination.delete();
                sendAppUpdateStatus(
                    "error",
                    error.getMessage() == null ? "Не удалось установить обновление." : error.getMessage(),
                    update
                );
            } finally {
                if (connection != null) connection.disconnect();
            }
        });
    }

    private void openPackageInstaller(File apk, UpdateInfo update) {
        try {
            Uri uri = FileProvider.getUriForFile(
                this,
                getPackageName() + ".fileprovider",
                apk
            );
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(intent);
            sendAppUpdateStatus("installing", "Подтвердите установку в Android.", update);
        } catch (RuntimeException error) {
            sendAppUpdateStatus("error", "Android не смог открыть установщик APK.", update);
        }
    }

    private void sendAppUpdateStatus(String status, String message, @Nullable UpdateInfo update) {
        JSONObject payload = new JSONObject();
        try {
            payload.put("status", status);
            payload.put("message", message);
            payload.put("installedVersion", installedVersionName());
            payload.put("installedVersionCode", installedVersionCode());
            if (update != null) {
                payload.put("latestVersion", update.version);
                payload.put("releaseUrl", update.releaseUrl);
                payload.put("notes", update.notes);
            }
        } catch (Exception ignored) {
            return;
        }
        String serialized = payload.toString();
        runOnUiThread(() -> {
            if (bridge == null || bridge.getWebView() == null) return;
            bridge.getWebView().evaluateJavascript(
                "window.__onNativeAppUpdate && window.__onNativeAppUpdate(" +
                    JSONObject.quote(serialized) + ")",
                null
            );
        });
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

    private static String normalizeVersion(String version) {
        String normalized = version == null ? "" : version.trim();
        return normalized.startsWith("v") ? normalized.substring(1) : normalized;
    }

    private String installedVersionName() {
        try {
            String version = getPackageManager()
                .getPackageInfo(getPackageName(), 0)
                .versionName;
            return version == null || version.isEmpty() ? "0.0.0" : version;
        } catch (PackageManager.NameNotFoundException ignored) {
            return "0.0.0";
        }
    }

    @SuppressWarnings("deprecation")
    private long installedVersionCode() {
        try {
            android.content.pm.PackageInfo info = getPackageManager()
                .getPackageInfo(getPackageName(), 0);
            return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                ? info.getLongVersionCode()
                : info.versionCode;
        } catch (PackageManager.NameNotFoundException ignored) {
            return 0;
        }
    }

    private static int compareVersions(String left, String right) {
        String[] leftParts = normalizeVersion(left).split("\\.");
        String[] rightParts = normalizeVersion(right).split("\\.");
        for (int index = 0; index < 3; index++) {
            int leftValue = index < leftParts.length ? parseVersionPart(leftParts[index]) : 0;
            int rightValue = index < rightParts.length ? parseVersionPart(rightParts[index]) : 0;
            if (leftValue != rightValue) return Integer.compare(leftValue, rightValue);
        }
        return 0;
    }

    private static int parseVersionPart(String value) {
        String digits = value.replaceFirst("[^0-9].*$", "");
        try {
            return digits.isEmpty() ? 0 : Integer.parseInt(digits);
        } catch (NumberFormatException ignored) {
            return 0;
        }
    }

    private static String hex(byte[] bytes) {
        StringBuilder result = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) result.append(String.format("%02x", value & 0xff));
        return result.toString();
    }

    private static final class UpdateInfo {
        final String version;
        final String downloadUrl;
        final String sha256;
        final String releaseUrl;
        final String notes;
        final long size;

        UpdateInfo(
            String version,
            String downloadUrl,
            String sha256,
            String releaseUrl,
            String notes,
            long size
        ) {
            this.version = version;
            this.downloadUrl = downloadUrl;
            this.sha256 = sha256;
            this.releaseUrl = releaseUrl;
            this.notes = notes;
            this.size = size;
        }
    }

    private void enqueueImmediateBackgroundSync() {
        SharedPreferences preferences = getSharedPreferences(
            SheetsSyncWorker.PREFERENCES,
            MODE_PRIVATE
        );
        if (
            preferences.getString(SheetsSyncWorker.KEY_SPREADSHEET_ID, "").isEmpty() ||
            preferences.getString(SheetsSyncWorker.KEY_EMAIL, "").isEmpty()
        ) return;
        Constraints constraints = new Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build();
        OneTimeWorkRequest immediate = new OneTimeWorkRequest.Builder(SheetsSyncWorker.class)
            .setConstraints(constraints)
            .build();
        WorkManager.getInstance(getApplicationContext()).enqueueUniqueWork(
            IMMEDIATE_SYNC_WORK,
            ExistingWorkPolicy.REPLACE,
            immediate
        );
    }

    @Override
    public void onResume() {
        super.onResume();
        if (backgroundAccessRequestPending && notificationsGranted() && isBatteryOptimizationDisabled()) {
            backgroundAccessRequestPending = false;
            enqueueImmediateBackgroundSync();
        }
        if (updateInstallPermissionPending) {
            if (
                Build.VERSION.SDK_INT < Build.VERSION_CODES.O ||
                getPackageManager().canRequestPackageInstalls()
            ) {
                UpdateInfo update = pendingUpdate;
                if (update != null) downloadAndInstallUpdate(update);
            } else {
                sendAppUpdateStatus(
                    "permissionRequired",
                    "Разрешите Cookish устанавливать обновления, затем вернитесь в приложение.",
                    pendingUpdate
                );
            }
        }
        sendBackgroundAccessStatus();
    }

    @Override
    public void onDestroy() {
        updateExecutor.shutdownNow();
        super.onDestroy();
    }

    @Override
    public void onRequestPermissionsResult(
        int requestCode,
        @NonNull String[] permissions,
        @NonNull int[] grantResults
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == 9205) {
            if (notificationsGranted()) {
                requestBatteryOptimizationExemption();
            } else {
                backgroundAccessRequestPending = false;
            }
            sendBackgroundAccessStatus();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, @Nullable Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        IntentResult barcodeResult = IntentIntegrator.parseActivityResult(
            requestCode,
            resultCode,
            data
        );
        if (barcodeResult != null) {
            if (barcodeResult.getContents() == null) {
                evaluateBarcodeCallback("{\"ok\":false,\"cancelled\":true}");
            } else {
                vibrateBarcodeSuccess();
                evaluateBarcodeCallback(
                    "{\"ok\":true,\"barcode\":" +
                        JSONObject.quote(barcodeResult.getContents()) + "}"
                );
            }
            return;
        }
    }

    @SuppressWarnings("deprecation")
    private void vibrateBarcodeSuccess() {
        Vibrator vibrator;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            VibratorManager manager = (VibratorManager) getSystemService(VIBRATOR_MANAGER_SERVICE);
            vibrator = manager == null ? null : manager.getDefaultVibrator();
        } else {
            vibrator = (Vibrator) getSystemService(VIBRATOR_SERVICE);
        }
        if (vibrator == null || !vibrator.hasVibrator()) return;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            vibrator.vibrate(VibrationEffect.createOneShot(120, VibrationEffect.DEFAULT_AMPLITUDE));
        } else {
            vibrator.vibrate(120);
        }
    }

    private void evaluateBarcodeCallback(String payload) {
        runOnUiThread(() -> bridge.getWebView().evaluateJavascript(
            "window.__onNativeBarcodeScan && window.__onNativeBarcodeScan(" +
                JSONObject.quote(payload) + ")",
            null
        ));
    }
}
