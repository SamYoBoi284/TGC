package com.sam.tgc;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.annotation.NonNull;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.CustomCredential;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.exceptions.GetCredentialException;
import com.google.android.libraries.identity.googleid.GetGoogleIdOption;
import androidx.webkit.WebViewAssetLoader;

import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;
import com.google.android.libraries.identity.googleid.GoogleIdTokenParsingException;

import org.json.JSONObject;

import java.util.concurrent.Executor;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final String APP_ORIGIN = "https://appassets.androidplatform.net";
    private WebView webView;
    private WebViewAssetLoader assetLoader;
    private CredentialManager credentialManager;
    private final Executor callbackExecutor = Executors.newSingleThreadExecutor();
    private CancellationSignal signInCancellation;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.rgb(10, 7, 16));
        getWindow().setNavigationBarColor(Color.rgb(10, 7, 16));
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(10, 7, 16));
        setContentView(webView);

        ViewCompat.setOnApplyWindowInsetsListener(webView, (view, windowInsets) -> {
            Insets bars = windowInsets.getInsets(
                WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
            );
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return windowInsets;
        });
        ViewCompat.requestApplyInsets(webView);

        assetLoader = new WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
            .build();
        credentialManager = CredentialManager.create(this);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);

        webView.addJavascriptInterface(new NativeGoogleSignInBridge(), "TGCNativeAuth");
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public android.webkit.WebResourceResponse shouldInterceptRequest(
                    WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !APP_ORIGIN.equals(request.getUrl().getScheme() + "://" + request.getUrl().getHost());
            }
        });

        if (savedInstanceState == null) {
            webView.loadUrl(APP_ORIGIN + "/assets/www/index.html");
        } else {
            webView.restoreState(savedInstanceState);
        }
    }

    private final class NativeGoogleSignInBridge {
        @JavascriptInterface
        public void signIn() {
            runOnUiThread(() -> beginNativeGoogleSignIn());
        }
    }

    private void beginNativeGoogleSignIn() {
        if (isFinishing() || webView == null) return;
        if (BuildConfig.GOOGLE_WEB_CLIENT_ID.isEmpty()) {
            deliverAuthResult(null, "Google sign-in is not configured yet. Add the TGC_GOOGLE_WEB_CLIENT_ID repository secret after setting up the Web OAuth client in Firebase.");
            return;
        }

        GetGoogleIdOption googleIdOption = new GetGoogleIdOption.Builder()
            .setFilterByAuthorizedAccounts(false)
            .setServerClientId(BuildConfig.GOOGLE_WEB_CLIENT_ID)
            .setAutoSelectEnabled(false)
            .build();
        GetCredentialRequest request = new GetCredentialRequest.Builder()
            .addCredentialOption(googleIdOption)
            .build();

        signInCancellation = new CancellationSignal();
        credentialManager.getCredentialAsync(
            this,
            request,
            signInCancellation,
            callbackExecutor,
            new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                @Override
                public void onResult(GetCredentialResponse response) {
                    Credential credential = response.getCredential();
                    if (credential instanceof CustomCredential
                            && GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL.equals(
                                ((CustomCredential) credential).getType())) {
                        try {
                            GoogleIdTokenCredential googleCredential =
                                GoogleIdTokenCredential.createFrom(credential.getData());
                            deliverAuthResult(googleCredential.getIdToken(), null);
                        } catch (GoogleIdTokenParsingException e) {
                            deliverAuthResult(null, "Google returned a credential that could not be read.");
                        }
                    } else {
                        deliverAuthResult(null, "Google returned an unsupported sign-in credential.");
                    }
                }

                @Override
                public void onError(@NonNull GetCredentialException e) {
                    deliverAuthResult(null, e.getMessage() != null
                        ? e.getMessage() : "Google sign-in was cancelled or failed.");
                }
            }
        );
    }

    private void deliverAuthResult(String idToken, String error) {
        runOnUiThread(() -> {
            if (webView == null || isFinishing()) return;
            String tokenJson = idToken == null ? "null" : JSONObject.quote(idToken);
            String errorJson = error == null ? "null" : JSONObject.quote(error);
            webView.evaluateJavascript(
                "window.__tgcNativeAuthResult && window.__tgcNativeAuthResult(" +
                    tokenJson + "," + errorJson + ");",
                null
            );
        });
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        if (webView != null) webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (signInCancellation != null) signInCancellation.cancel();
        if (webView != null) {
            webView.removeJavascriptInterface("TGCNativeAuth");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
