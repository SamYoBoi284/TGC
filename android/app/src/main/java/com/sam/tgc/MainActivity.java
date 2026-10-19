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
import androidx.credentials.exceptions.NoCredentialException;
import com.google.android.libraries.identity.googleid.GetGoogleIdOption;
import androidx.webkit.WebViewAssetLoader;

import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;

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

        boolean restoredWebViewState = false;
        if (savedInstanceState != null) {
            // WebView.restoreState() can return null when its saved history
            // is unusable. Never leave the Activity displaying a blank screen
            // in that case; fall back to the bundled app entry point.
            restoredWebViewState = webView.restoreState(savedInstanceState) != null;
        }
        if (!restoredWebViewState) {
            webView.loadUrl(APP_ORIGIN + "/assets/www/index.html");
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
        requestGoogleCredential(request, true);
    }

    private void beginExplicitGoogleSignIn() {
        // Credential Manager can return NoCredentialException for the
        // account-discovery request on some devices. Retry with Google's
        // explicit button sign-in option so the user gets a sign-in chooser.
        com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption signInOption =
            new com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption.Builder()
                .setServerClientId(BuildConfig.GOOGLE_WEB_CLIENT_ID)
                .build();
        GetCredentialRequest request = new GetCredentialRequest.Builder()
            .addCredentialOption(signInOption)
            .build();
        requestGoogleCredential(request, false);
    }

    private void requestGoogleCredential(
            GetCredentialRequest request,
            boolean allowExplicitSignInFallback) {
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
                        GoogleIdTokenCredential googleCredential =
                            GoogleIdTokenCredential.createFrom(credential.getData());
                        deliverAuthResult(googleCredential.getIdToken(), null);
                    } else {
                        deliverAuthResult(null, "Google returned an unsupported sign-in credential.");
                    }
                }

                @Override
                public void onError(@NonNull GetCredentialException e) {
                    if (allowExplicitSignInFallback && e instanceof NoCredentialException) {
                        runOnUiThread(() -> beginExplicitGoogleSignIn());
                        return;
                    }
                    String message = e.getMessage();
                    if (e instanceof NoCredentialException) {
                        message = "No Google sign-in credential is available. Make sure a Google account is added to this Android device and Google Play services is up to date, then try again.";
                    }
                    deliverAuthResult(null, message != null
                        ? message : "Google sign-in was cancelled or failed.");
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
