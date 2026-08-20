package ru.listok.purchases;

import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.webkit.JavascriptInterface;

import androidx.annotation.Nullable;
import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;
import com.google.zxing.integration.android.IntentIntegrator;
import com.google.zxing.integration.android.IntentResult;

import org.json.JSONObject;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import ru.listok.purchases.update.AndroidInstaller;
import ru.listok.purchases.update.AppUpdate;
import ru.listok.purchases.update.UpdateStatus;
import ru.listok.purchases.update.UrlHttpClient;

public class MainActivity extends BridgeActivity {
    private OnBackPressedCallback webBackCallback;
    private AppUpdate appUpdate;
    private ExecutorService updateExecutor;

    @Override
    public void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        updateExecutor = Executors.newSingleThreadExecutor();
        appUpdate = new AppUpdate(
            new UrlHttpClient(),
            new AndroidInstaller(this),
            getCacheDir(),
            installedVersionName(),
            installedVersionCode(),
            updateExecutor,
            this::sendAppUpdateStatus
        );
        bridge.getWebView().addJavascriptInterface(new NativeAppBridge(), "NativeCookish");
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
        public void checkForAppUpdate() {
            appUpdate.check();
        }

        @JavascriptInterface
        public void installLatestUpdate() {
            runOnUiThread(() -> appUpdate.installLatest());
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
    }

    private void sendAppUpdateStatus(UpdateStatus update) {
        JSONObject payload = new JSONObject();
        try {
            payload.put("status", update.status);
            payload.put("message", update.message);
            payload.put("installedVersion", update.installedVersion);
            payload.put("installedVersionCode", update.installedVersionCode);
            if (update.latestVersion != null) payload.put("latestVersion", update.latestVersion);
            if (update.releaseUrl != null) payload.put("releaseUrl", update.releaseUrl);
            if (update.notes != null) payload.put("notes", update.notes);
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

    @Override
    public void onResume() {
        super.onResume();
        if (appUpdate != null) appUpdate.resumeAfterPermission();
    }

    @Override
    public void onDestroy() {
        if (updateExecutor != null) updateExecutor.shutdownNow();
        super.onDestroy();
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
