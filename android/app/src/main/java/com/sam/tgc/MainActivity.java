package com.sam.tgc;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.speech.RecognizerIntent;
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
import androidx.webkit.WebViewAssetLoader;

import com.google.android.libraries.identity.googleid.GetGoogleIdOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Locale;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final String APP_ORIGIN = "https://appassets.androidplatform.net";
    private static final int REQUEST_SPEECH_INPUT = 8107;
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
            Insets ime = windowInsets.getInsets(WindowInsetsCompat.Type.ime());
            // Apply insets once at the native WebView boundary. Include the keyboard when taller than the navigation bar.
            view.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
            return WindowInsetsCompat.CONSUMED;
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
        webView.addJavascriptInterface(new NativeVoiceBridge(), "TGCNativeVoice");
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

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                if (url != null && url.startsWith(APP_ORIGIN + "/")) installVoiceInputUi();
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

    private void installVoiceInputUi() {
        if (webView == null || isFinishing()) return;
        String script = "(function() {" +
            "if (window.__tgcVoiceUiInstalled) return;" +
            "window.__tgcVoiceUiInstalled = true;" +
            "var activeTarget = null, savedRange = null;" +
            "function makeButton(label) {" +
                "var b = document.createElement('button'); b.type = 'button';" +
                "b.className = 'tgcNativeVoiceButton'; b.textContent = '🎤';" +
                "b.setAttribute('aria-label', label); b.title = label;" +
                "b.style.cssText = 'flex:0 0 auto;min-width:32px;height:30px;margin-left:6px;padding:0 9px;border:1px solid var(--color-border-subtle,#51445f);border-radius:8px;background:rgba(104,67,145,.22);color:var(--color-text-soft-white,#f4effa);font-size:15px;cursor:pointer;';" +
                "b.addEventListener('mousedown', function(e) { e.preventDefault(); });" +
                "b.addEventListener('click', function() {" +
                    "var editor = b.closest('.richEditor');" +
                    "activeTarget = editor ? editor.querySelector('.richEditorSurface') : document.getElementById('dumpCaptureInput');" +
                    "savedRange = null;" +
                    "if (activeTarget && activeTarget.isContentEditable) {" +
                        "var sel = window.getSelection();" +
                        "if (sel && sel.rangeCount && activeTarget.contains(sel.anchorNode)) savedRange = sel.getRangeAt(0).cloneRange();" +
                    "}" +
                    "if (!activeTarget) return;" +
                    "if (window.TGCNativeVoice && window.TGCNativeVoice.requestSpeechRecognition) {" +
                        "window.TGCNativeVoice.requestSpeechRecognition();" +
                    "} else { window.__tgcVoiceResult('', 'Voice input is available in the Android app only.'); }" +
                "});" +
                "return b;" +
            "}" +
            "function attach() {" +
                "document.querySelectorAll('.richEditorToolbar').forEach(function(toolbar) {" +
                    "if (!toolbar.querySelector('.tgcNativeVoiceButton')) toolbar.appendChild(makeButton('Dictate into entry'));" +
                "});" +
                "var dump = document.getElementById('dumpCapturePanel');" +
                "if (dump && !dump.querySelector('.tgcNativeVoiceButton')) {" +
                    "var b = makeButton('Dictate into brain dump');" +
                    "b.style.alignSelf = 'flex-end'; b.style.margin = '8px 0 0';" +
                    "var input = document.getElementById('dumpCaptureInput');" +
                    "if (input) input.insertAdjacentElement('afterend', b);" +
                "}" +
            "}" +
            "window.__tgcVoiceResult = function(text, error) {" +
                "var target = activeTarget;" +
                "if (error) {" +
                    "var status = document.getElementById('entriesSaveStatus') || document.getElementById('dumpSaveStatus');" +
                    "if (status) status.textContent = error;" +
                    "return;" +
                "}" +
                "if (!target || !text) return;" +
                "if (target.isContentEditable) {" +
                    "target.focus(); var range = savedRange;" +
                    "if (!range || !target.contains(range.commonAncestorContainer)) {" +
                        "range = document.createRange(); range.selectNodeContents(target); range.collapse(false);" +
                    "}" +
                    "var prefix = range.startContainer && range.startContainer.textContent ? range.startContainer.textContent.slice(0, range.startOffset) : '';" +
                    "var suffix = range.startContainer && range.startContainer.textContent ? range.startContainer.textContent.slice(range.startOffset) : '';" +
                    "var insert = (prefix && !/\\s$/.test(prefix) ? ' ' : '') + text + (suffix && !/^\\s/.test(suffix) ? ' ' : '');" +
                    "range.deleteContents(); var node = document.createTextNode(insert); range.insertNode(node);" +
                    "range.setStartAfter(node); range.collapse(true); var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);" +
                    "target.dispatchEvent(new Event('input', {bubbles:true}));" +
                "} else if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') {" +
                    "var start = target.selectionStart == null ? target.value.length : target.selectionStart;" +
                    "var end = target.selectionEnd == null ? start : target.selectionEnd;" +
                    "var before = target.value.slice(0,start), after = target.value.slice(end);" +
                    "var insert = (before && !/\\s$/.test(before) ? ' ' : '') + text + (after && !/^\\s/.test(after) ? ' ' : '');" +
                    "target.setRangeText(insert, start, end, 'end'); target.dispatchEvent(new Event('input', {bubbles:true})); target.focus();" +
                "}" +
            "};" +
            "attach(); new MutationObserver(attach).observe(document.documentElement, {childList:true,subtree:true});" +
        "})();";
        webView.evaluateJavascript(script, null);
    }

    private final class NativeGoogleSignInBridge {
        @JavascriptInterface
        public void signIn() {
            runOnUiThread(() -> beginNativeGoogleSignIn());
        }
    }

    private final class NativeVoiceBridge {
        @JavascriptInterface
        public void requestSpeechRecognition() {
            runOnUiThread(() -> beginSpeechRecognition());
        }
    }

    private void beginSpeechRecognition() {
        if (isFinishing() || webView == null) return;
        Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag());
        intent.putExtra(RecognizerIntent.EXTRA_PROMPT, "Speak your entry. Review the transcript before it is saved.");
        intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false);
        try {
            startActivityForResult(intent, REQUEST_SPEECH_INPUT);
        } catch (ActivityNotFoundException error) {
            deliverVoiceResult(null, "Speech recognition isn't available on this device. Install or enable a compatible speech recognition service.");
        } catch (RuntimeException error) {
            deliverVoiceResult(null, "Couldn't start voice input. Check microphone access and try again.");
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQUEST_SPEECH_INPUT) return;
        if (resultCode != RESULT_OK || data == null) return;
        ArrayList<String> matches = data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
        if (matches == null || matches.isEmpty() || matches.get(0) == null || matches.get(0).trim().isEmpty()) {
            deliverVoiceResult(null, "No speech was recognized. Nothing was added.");
            return;
        }
        deliverVoiceResult(matches.get(0).trim(), null);
    }

    private void deliverVoiceResult(String text, String error) {
        runOnUiThread(() -> {
            if (webView == null || isFinishing()) return;
            String textJson = text == null ? "null" : JSONObject.quote(text);
            String errorJson = error == null ? "null" : JSONObject.quote(error);
            webView.evaluateJavascript(
                "window.__tgcVoiceResult && window.__tgcVoiceResult(" + textJson + "," + errorJson + ");",
                null
            );
        });
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
        com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption signInOption =
            new com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption.Builder(
                BuildConfig.GOOGLE_WEB_CLIENT_ID)
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
            webView.removeJavascriptInterface("TGCNativeVoice");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}