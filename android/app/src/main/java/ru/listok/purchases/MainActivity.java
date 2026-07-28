package ru.listok.purchases;

import android.content.Intent;
import android.content.IntentSender;
import android.os.Bundle;
import android.webkit.JavascriptInterface;

import androidx.annotation.Nullable;

import com.getcapacitor.BridgeActivity;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.Scope;

import org.json.JSONObject;

import java.util.Arrays;

public class MainActivity extends BridgeActivity {
    private static final int GOOGLE_AUTH_REQUEST = 9104;

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
