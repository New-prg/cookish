package ru.listok.purchases;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Intent;
import android.content.IntentSender;
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
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import com.getcapacitor.BridgeActivity;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.Scope;
import com.google.zxing.integration.android.IntentIntegrator;
import com.google.zxing.integration.android.IntentResult;

import org.json.JSONObject;

import java.util.Arrays;
import java.util.concurrent.TimeUnit;

public class MainActivity extends BridgeActivity {
    private static final int GOOGLE_AUTH_REQUEST = 9104;
    private static final String PERIODIC_SYNC_WORK = "cookish-sheets-periodic-sync";
    private static final String IMMEDIATE_SYNC_WORK = "cookish-sheets-immediate-sync";
    private boolean backgroundAccessRequestPending = false;
    private OnBackPressedCallback webBackCallback;

    @Override
    public void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        SheetsSyncWorker.createNotificationChannel(this);
        bridge.getWebView().addJavascriptInterface(new GoogleAuthorizationBridge(), "NativeGoogle");
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

    private final class GoogleAuthorizationBridge {
        @JavascriptInterface
        public void authorize() {
            runOnUiThread(() -> {
                AuthorizationRequest request = AuthorizationRequest.builder()
                    .setRequestedScopes(Arrays.asList(
                        new Scope("openid"),
                        new Scope("https://www.googleapis.com/auth/userinfo.email"),
                        new Scope("https://www.googleapis.com/auth/userinfo.profile"),
                        new Scope("https://www.googleapis.com/auth/spreadsheets")
                    ))
                    .build();

                Identity.getAuthorizationClient(MainActivity.this)
                    .authorize(request)
                    .addOnSuccessListener(result -> {
                        if (result.hasResolution() && result.getPendingIntent() != null) {
                            try {
                                startIntentSenderForResult(
                                    result.getPendingIntent().getIntentSender(),
                                    GOOGLE_AUTH_REQUEST,
                                    null,
                                    0,
                                    0,
                                    0
                                );
                            } catch (IntentSender.SendIntentException error) {
                                sendGoogleError(error.getMessage());
                            }
                        } else {
                            sendGoogleResult(result);
                        }
                    })
                    .addOnFailureListener(error -> sendGoogleError(error.getMessage()));
            });
        }

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
        sendBackgroundAccessStatus();
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
        if (requestCode != GOOGLE_AUTH_REQUEST) return;
        try {
            AuthorizationResult result = Identity.getAuthorizationClient(this)
                .getAuthorizationResultFromIntent(data);
            sendGoogleResult(result);
        } catch (ApiException error) {
            sendGoogleError(error.getMessage());
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

    private void sendGoogleResult(AuthorizationResult result) {
        String token = result.getAccessToken();
        if (token == null || token.isEmpty()) {
            sendGoogleError("Google не вернул токен доступа.");
            return;
        }
        evaluateGoogleCallback(
            "{\"ok\":true,\"accessToken\":" + JSONObject.quote(token) + "}"
        );
    }

    private void sendGoogleError(String message) {
        String error = message == null ? "Авторизация Google не выполнена." : message;
        evaluateGoogleCallback(
            "{\"ok\":false,\"error\":" + JSONObject.quote(error) + "}"
        );
    }

    private void evaluateGoogleCallback(String payload) {
        runOnUiThread(() -> bridge.getWebView().evaluateJavascript(
            "window.__onNativeGoogleAuth(" + JSONObject.quote(payload) + ")",
            null
        ));
    }

    private void evaluateBarcodeCallback(String payload) {
        runOnUiThread(() -> bridge.getWebView().evaluateJavascript(
            "window.__onNativeBarcodeScan && window.__onNativeBarcodeScan(" +
                JSONObject.quote(payload) + ")",
            null
        ));
    }
}
