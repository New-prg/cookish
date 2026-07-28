package ru.listok.purchases;

import android.content.Intent;
import android.content.IntentSender;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.JavascriptInterface;

import androidx.annotation.Nullable;
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

import org.json.JSONObject;

import java.util.Arrays;
import java.util.concurrent.TimeUnit;

public class MainActivity extends BridgeActivity {
    private static final int GOOGLE_AUTH_REQUEST = 9104;
    private static final String PERIODIC_SYNC_WORK = "listok-sheets-periodic-sync";
    private static final String IMMEDIATE_SYNC_WORK = "listok-sheets-immediate-sync";

    @Override
    public void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        bridge.getWebView().addJavascriptInterface(new GoogleAuthorizationBridge(), "NativeGoogle");
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
        public void openUrl(String url) {
            runOnUiThread(() -> {
                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
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
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, @Nullable Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != GOOGLE_AUTH_REQUEST) return;
        try {
            AuthorizationResult result = Identity.getAuthorizationClient(this)
                .getAuthorizationResultFromIntent(data);
            sendGoogleResult(result);
        } catch (ApiException error) {
            sendGoogleError(error.getMessage());
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
}
