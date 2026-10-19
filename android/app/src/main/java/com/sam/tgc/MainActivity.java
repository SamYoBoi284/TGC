package com.sam.tgc;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.ProgressDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.widget.Toast;
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
import androidx.core.content.FileProvider;
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

import java.io.File;
import java.util.ArrayList;
import java.util.Locale;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final String APP_ORIGIN = "https://appassets.androidplatform.net";
    private static final int REQUEST_SPEECH_INPUT = 8107;
    private static final int REQUEST_INSTALL_UPDATE = 8111;
    private File pendingUpdateApk;
    private WebView webView;
    private int nativeTopInsetDp;
    private int nativeBottomInsetDp;
    private int nativeLeftInsetDp;
    private int nativeRightInsetDp;
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
            boolean imeVisible = windowInsets.isVisible(WindowInsetsCompat.Type.ime());
            float density = getResources().getDisplayMetrics().density;
            nativeTopInsetDp = Math.round(bars.top / density);
            nativeLeftInsetDp = Math.round(bars.left / density);
            nativeRightInsetDp = Math.round(bars.right / density);
            // adjustResize already shrinks the WebView for the keyboard. Do not add the IME inset again.
            nativeBottomInsetDp = imeVisible ? 0 : Math.round(bars.bottom / density);
            // Keep the WebView edge-to-edge; the app shell receives CSS safe-area values instead.
            view.setPadding(0, 0, 0, 0);
            applyNativeInsetsToWebView();
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
        webView.addJavascriptInterface(new NativeUpdateBridge(), "TGCNativeUpdates");
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
                if (url != null && url.startsWith(APP_ORIGIN + "/")) {
                    applyNativeInsetsToWebView();
                    installAndroidExperienceUi();
                    installVoiceInputUi();
                    installUpdateUi();
                }
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


    private void applyNativeInsetsToWebView() {
        if (webView == null || isFinishing()) return;
        String script = "(function() {" +
            "var root = document.documentElement;" +
            "if (!root) return;" +
            "root.style.setProperty('--tgc-native-inset-top', '" + nativeTopInsetDp + "px');" +
            "root.style.setProperty('--tgc-native-inset-bottom', '" + nativeBottomInsetDp + "px');" +
            "root.style.setProperty('--tgc-native-inset-left', '" + nativeLeftInsetDp + "px');" +
            "root.style.setProperty('--tgc-native-inset-right', '" + nativeRightInsetDp + "px');" +
        "})();";
        webView.evaluateJavascript(script, null);
    }

    /**
     * Android-only visual polish. Kept in the native wrapper so the separate
     * web/Electron app and its shared assets remain untouched.
     */
    private void installAndroidExperienceUi() {
        if (webView == null || isFinishing()) return;
        String script = "(function() {" +
            "if (window.__tgcAndroidExperienceUiInstalled) return;" +
            "window.__tgcAndroidExperienceUiInstalled = true;" +
            "var style = document.createElement('style'); style.id = 'tgcAndroidExperienceStyles';" +
            "style.textContent = " +
                "' :root { --tgc-motion-fast: 140ms; --tgc-motion-normal: 240ms; }' +" +
                "' button, .sidebarNavItem, .dockItem { -webkit-tap-highlight-color: transparent; }' +" +
                "' button { transition: transform var(--tgc-motion-fast) cubic-bezier(.2,.75,.25,1), filter var(--tgc-motion-fast) ease, border-color var(--tgc-motion-normal) ease, background-color var(--tgc-motion-normal) ease, box-shadow var(--tgc-motion-normal) ease; }' +" +
                "' button:active, .sidebarNavItem:active, .dockItem:active { transform: scale(.975); filter: brightness(1.12); }' +" +
                "' button:focus-visible, .sidebarNavItem:focus-visible, .dockItem:focus-visible { outline: 2px solid var(--color-violet-electric, #8b5cf6); outline-offset: 2px; }' +" +
                "' .sidebarNavItem { transition: transform var(--tgc-motion-fast) ease, background-color var(--tgc-motion-normal) ease, color var(--tgc-motion-normal) ease, box-shadow var(--tgc-motion-normal) ease; }' +" +
                "' .sidebarNavItem.sidebarNavItemActive { box-shadow: inset 0 0 0 1px var(--color-border-strong, rgba(139,92,246,.32)), 0 3px 14px rgba(89,52,135,.10); }' +" +
                "' .dockItem { transition: transform var(--tgc-motion-fast) cubic-bezier(.2,.75,.25,1), background-color var(--tgc-motion-normal) ease, box-shadow var(--tgc-motion-normal) ease; }' +" +
                "' .dockItem:active { box-shadow: 0 0 0 2px var(--color-border-strong, rgba(139,92,246,.32)); }' +" +
                "' #appBrandGlyph { display: inline-block; transform-origin: center; animation: tgcAndroidGlyphBreath 4.8s ease-in-out infinite; }' +" +
                "' @keyframes tgcAndroidGlyphBreath { 0%,100% { opacity: .82; text-shadow: 0 0 0 rgba(139,92,246,0); } 50% { opacity: 1; text-shadow: 0 0 12px rgba(139,92,246,.42); } }' +" +
                "' .authGateCard { animation: tgcAndroidEnter 360ms cubic-bezier(.2,.75,.25,1) both; }' +" +
                "' @keyframes tgcAndroidEnter { from { opacity: 0; transform: translateY(8px) scale(.99); } to { opacity: 1; transform: translateY(0) scale(1); } }' +" +
                "' @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; scroll-behavior: auto !important; transition-duration: .01ms !important; } }' +" +
                "' #appShell { box-sizing: border-box; height: 100dvh; padding: var(--tgc-native-inset-top, 0px) var(--tgc-native-inset-right, 0px) var(--tgc-native-inset-bottom, 0px) var(--tgc-native-inset-left, 0px); }' +" +
                "' #authGateScreen { box-sizing: border-box; padding: var(--tgc-native-inset-top, 0px) var(--tgc-native-inset-right, 0px) var(--tgc-native-inset-bottom, 0px) var(--tgc-native-inset-left, 0px); }' +" +
                "' #appHeader { position: relative; background: linear-gradient(110deg, rgba(37,22,52,.99), rgba(12,8,20,.98) 68%); box-shadow: 0 6px 24px rgba(0,0,0,.22); }' +" +
                "' #appHeader::after { content: \"\"; position: absolute; left: 0; right: 0; bottom: -1px; height: 1px; background: linear-gradient(90deg, transparent, rgba(166,111,255,.9), rgba(80,215,255,.45), transparent); pointer-events: none; }' +" +
                "' #appBrandGlyph { filter: drop-shadow(0 0 7px rgba(154,96,255,.72)); animation: tgcAndroidGlyphBreath 3.2s ease-in-out infinite; }' +" +
                "' #appSidebar { background: linear-gradient(180deg, rgba(25,16,36,.99), rgba(12,8,20,.99)); }' +" +
                "' .sidebarNavItem { position: relative; overflow: hidden; margin: 2px 0; }' +" +
                "' .sidebarNavItem.sidebarNavItemActive { background: linear-gradient(100deg, rgba(125,72,190,.34), rgba(60,35,84,.2)); box-shadow: inset 0 0 0 1px rgba(166,111,255,.42), 0 4px 18px rgba(89,52,135,.2); }' +" +
                "' .sidebarNavItem.sidebarNavItemActive::before { content: \"\"; position: absolute; left: 0; top: 18%; bottom: 18%; width: 3px; border-radius: 0 4px 4px 0; background: linear-gradient(180deg, #b58aff, #50d7ff); box-shadow: 0 0 12px rgba(154,96,255,.7); }' +" +
                "' #appMain { background-image: radial-gradient(ellipse at 12% 0%, rgba(115,66,166,.12), transparent 48%); }' +"
                "' #appDock { bottom: calc(var(--footer-height) + var(--space-md) + var(--tgc-native-inset-bottom, 0px)); }' +" +
                "' .homeWidget, .entryCard, .ideaCard, .milestoneCard, .timelineCard, .settingsSection { border-color: rgba(154,96,255,.22); box-shadow: 0 8px 28px rgba(0,0,0,.14); transition: border-color 220ms ease, box-shadow 220ms ease, transform 180ms ease; }' +" +
                "' .homeWidget:active, .entryCard:active, .ideaCard:active, .milestoneCard:active, .timelineCard:active { border-color: rgba(166,111,255,.55); }' +" +
                "' button:active, .sidebarNavItem:active, .dockItem:active { transform: scale(.965); filter: brightness(1.2); box-shadow: 0 0 0 1px rgba(166,111,255,.35), 0 0 18px rgba(115,66,166,.2); }' +" +
                "' @media (hover: none) and (pointer: coarse) { #appHeader { padding-top: 0; } #appSidebar, #appMain { overscroll-behavior-y: contain; } }';" +
            "document.head.appendChild(style);" +
            // Sync AI-style edge swipe: a deliberate rightward swipe from the left edge returns to the sidebar menu.
            "var shell = document.getElementById('appShell'), edgeTouch = null;" +
            "document.addEventListener('touchstart', function(e) {" +
                "if (!shell || !window.matchMedia('(hover: none) and (pointer: coarse)').matches || !e.touches || e.touches.length !== 1) { edgeTouch = null; return; }" +
                "var t = e.touches[0], target = e.target;" +
                "if (t.clientX > 32 || (target && target.closest && target.closest('input, textarea, select, button, a, .richEditorSurface'))) { edgeTouch = null; return; }" +
                "edgeTouch = {x: t.clientX, y: t.clientY};" +
            "}, {passive:true});" +
            "document.addEventListener('touchend', function(e) {" +
                "if (!edgeTouch || !e.changedTouches || !e.changedTouches.length) return;" +
                "var t = e.changedTouches[0], dx = t.clientX - edgeTouch.x, dy = Math.abs(t.clientY - edgeTouch.y); edgeTouch = null;" +
                "if (dx >= 72 && dx > dy * 1.35 && shell && shell.classList.contains('mobileRouteOpen')) shell.classList.remove('mobileRouteOpen');" +
            "}, {passive:true});" +
        "})();";
        webView.evaluateJavascript(script, null);
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
            "function insertReviewed(text) {" +
                "var target = activeTarget; if (!target || !text) return;" +
                "if (target.isContentEditable) {" +
                    "target.focus(); var range = savedRange;" +
                    "if (!range || !target.contains(range.commonAncestorContainer)) { range = document.createRange(); range.selectNodeContents(target); range.collapse(false); }" +
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
            "}" +
            "function showReview(transcript) {" +
                "document.getElementById('tgcVoiceReview')?.remove();" +
                "var overlay = document.createElement('div'); overlay.id = 'tgcVoiceReview';" +
                "overlay.setAttribute('role','dialog'); overlay.setAttribute('aria-modal','true'); overlay.setAttribute('aria-labelledby','tgcVoiceReviewTitle');" +
                "overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(5,3,10,.82);backdrop-filter:blur(8px);';" +
                "var card = document.createElement('section');" +
                "card.style.cssText = 'width:min(520px,100%);max-height:90%;overflow:auto;padding:20px;border:1px solid var(--color-border-subtle,#51445f);border-radius:16px;background:var(--color-bg-elevated,#17111f);color:var(--color-text-soft-white,#f4effa);box-shadow:0 18px 60px rgba(0,0,0,.45);';" +
                "var heading = document.createElement('h2'); heading.id='tgcVoiceReviewTitle'; heading.textContent='Review voice transcript'; heading.style.cssText='margin:0 0 8px;font-size:18px;';" +
                "var hint = document.createElement('p'); hint.textContent='Edit anything that needs correcting. Nothing is added to your chronicle until you choose Insert transcript.'; hint.style.cssText='margin:0 0 12px;line-height:1.5;opacity:.8;font-size:13px;';" +
                "var field = document.createElement('textarea'); field.setAttribute('aria-label','Recognized transcript'); field.value=transcript;" +
                "field.style.cssText='box-sizing:border-box;width:100%;min-height:130px;resize:vertical;padding:12px;border:1px solid var(--color-border-subtle,#51445f);border-radius:10px;background:rgba(0,0,0,.2);color:inherit;font:inherit;line-height:1.5;';" +
                "var actions = document.createElement('div'); actions.style.cssText='display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;margin-top:14px;';" +
                "var cancel = document.createElement('button'); cancel.type='button'; cancel.textContent='Cancel';" +
                "cancel.style.cssText='padding:9px 14px;border:1px solid var(--color-border-subtle,#51445f);border-radius:8px;background:transparent;color:inherit;cursor:pointer;';" +
                "var insert = document.createElement('button'); insert.type='button'; insert.textContent='Insert transcript';" +
                "insert.style.cssText='padding:9px 14px;border:1px solid #8b5ac7;border-radius:8px;background:rgba(104,67,145,.4);color:inherit;cursor:pointer;font-weight:600;';" +
                "cancel.addEventListener('click',function(){overlay.remove();});" +
                "insert.addEventListener('click',function(){var value=field.value.trim(); if(!value){field.focus();return;} overlay.remove(); insertReviewed(value);});" +
                "actions.append(cancel,insert); card.append(heading,hint,field,actions); overlay.appendChild(card); document.body.appendChild(overlay);" +
                "field.focus(); field.setSelectionRange(field.value.length,field.value.length);" +
            "}" +
            "window.__tgcVoiceResult = function(text, error) {" +
                "var target = activeTarget;" +
                "if (error) { var status = target && target.id === 'dumpCaptureInput' ? document.getElementById('dumpSaveStatus') : document.getElementById('entriesSaveStatus'); if (status) status.textContent = error; return; }" +
                "if (!target || !text) return; showReview(text);" +
            "};" +
            "attach(); new MutationObserver(attach).observe(document.documentElement, {childList:true,subtree:true});" +
        "})();";
        webView.evaluateJavascript(script, null);
    }


    private void installUpdateUi() {
        if (webView == null || isFinishing()) return;
        String script = "(function(){var h=document.getElementById('appHeaderActions');if(!h||h.querySelector('#tgcUpdateBtn'))return;var b=document.createElement('button');b.id='tgcUpdateBtn';b.type='button';b.textContent='↻';b.title='Check for updates';b.setAttribute('aria-label','Check for updates');b.style.cssText='min-width:38px;height:36px;margin-left:8px;padding:0 10px;border:1px solid rgba(166,111,255,.45);border-radius:10px;background:rgba(125,72,190,.22);color:var(--color-text-soft-white,#f4effa);font-size:20px;font-weight:700;cursor:pointer';b.onclick=function(){if(window.TGCNativeUpdates)window.TGCNativeUpdates.checkForUpdates()};h.appendChild(b)})();";
        webView.evaluateJavascript(script, null);
    }

    private final class NativeUpdateBridge {
        @JavascriptInterface
        public void checkForUpdates() {
            runOnUiThread(() -> checkForUpdatesFromUi());
        }
    }

    private void checkForUpdatesFromUi() {
        if (isFinishing()) return;
        Toast.makeText(this, "Checking for TGC updates...", Toast.LENGTH_SHORT).show();
        TgcUpdater.checkLatest(this, new TgcUpdater.CheckCallback() {
            @Override public void onResult(TgcUpdater.ReleaseInfo release, boolean updateAvailable) {
                if (isFinishing()) return;
                if (!updateAvailable) {
                    new AlertDialog.Builder(MainActivity.this)
                        .setTitle("TGC is up to date")
                        .setMessage("Installed version: " + BuildConfig.VERSION_NAME + "\nLatest release: " + release.version)
                        .setPositiveButton("OK", null)
                        .setNeutralButton("Release notes", (dialog, which) -> openReleasePage(release.tag))
                        .show();
                    return;
                }
                String notes = release.notes == null || release.notes.trim().isEmpty()
                    ? "No release notes were provided." : release.notes;
                new AlertDialog.Builder(MainActivity.this)
                    .setTitle("TGC update " + release.version + " available")
                    .setMessage(notes + "\n\nInstalled version: " + BuildConfig.VERSION_NAME)
                    .setNegativeButton("Later", null)
                    .setNeutralButton("Release page", (dialog, which) -> openReleasePage(release.tag))
                    .setPositiveButton("Download & install", (dialog, which) -> downloadUpdate(release))
                    .show();
            }
            @Override public void onError(Exception error) {
                if (isFinishing()) return;
                new AlertDialog.Builder(MainActivity.this)
                    .setTitle("Could not check for updates")
                    .setMessage(error.getMessage() == null ? "Check your internet connection and try again." : error.getMessage())
                    .setPositiveButton("OK", null).show();
            }
        });
    }

    private void openReleasePage(String tag) {
        try {
            String url = "latest".equals(tag)
                ? "https://github.com/SamYoBoi284/TGC/releases/latest"
                : "https://github.com/SamYoBoi284/TGC/releases/tag/" + Uri.encode(tag);
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (RuntimeException ignored) {
            Toast.makeText(this, "Could not open the release page.", Toast.LENGTH_SHORT).show();
        }
    }

    private void downloadUpdate(TgcUpdater.ReleaseInfo release) {
        ProgressDialog progress = new ProgressDialog(this);
        progress.setTitle("Downloading TGC update");
        progress.setMessage("Verifying the APK before installation...");
        progress.setProgressStyle(ProgressDialog.STYLE_HORIZONTAL);
        progress.setMax(100);
        progress.setProgress(0);
        progress.setCancelable(false);
        progress.setButton(ProgressDialog.BUTTON_NEGATIVE, "Hide", (dialog, which) -> dialog.dismiss());
        progress.show();
        TgcUpdater.downloadAndVerify(this, release, new TgcUpdater.DownloadCallback() {
            @Override public void onProgress(int percent, long downloaded, long total) {
                if (progress.isShowing() && percent >= 0) progress.setProgress(percent);
                if (progress.isShowing() && total > 0) {
                    progress.setMessage("Downloaded "
                        + android.text.format.Formatter.formatShortFileSize(MainActivity.this, downloaded)
                        + " of " + android.text.format.Formatter.formatShortFileSize(MainActivity.this, total)
                        + "\nVerifying SHA-256...");
                }
            }
            @Override public void onComplete(File apk) {
                if (progress.isShowing()) progress.dismiss();
                installVerifiedUpdate(apk);
            }
            @Override public void onError(Exception error) {
                if (progress.isShowing()) progress.dismiss();
                if (isFinishing()) return;
                new AlertDialog.Builder(MainActivity.this)
                    .setTitle("Update download failed")
                    .setMessage(error.getMessage() == null ? "The update could not be downloaded or verified." : error.getMessage())
                    .setPositiveButton("OK", null).show();
            }
        });
    }

    private void installVerifiedUpdate(File apk) {
        if (apk == null || !apk.isFile()) {
            Toast.makeText(this, "The verified update APK is missing.", Toast.LENGTH_LONG).show();
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getPackageManager().canRequestPackageInstalls()) {
            pendingUpdateApk = apk;
            new AlertDialog.Builder(this)
                .setTitle("Allow TGC to install updates")
                .setMessage("Android needs permission to install the update downloaded by TGC. Enable Allow from this source, then return here.")
                .setNegativeButton("Cancel", (dialog, which) -> pendingUpdateApk = null)
                .setPositiveButton("Open settings", (dialog, which) -> startActivityForResult(
                    new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName())),
                    REQUEST_INSTALL_UPDATE))
                .show();
            return;
        }
        try {
            Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".updates", apk);
            Intent install = new Intent(Intent.ACTION_VIEW);
            install.setDataAndType(uri, "application/vnd.android.package-archive");
            install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(install);
        } catch (RuntimeException error) {
            new AlertDialog.Builder(this)
                .setTitle("Could not open Android installer")
                .setMessage(error.getMessage() == null ? "Open the release page to install the APK manually." : error.getMessage())
                .setPositiveButton("Release page", (dialog, which) -> openReleasePage("latest"))
                .setNegativeButton("Cancel", null).show();
        }
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
        if (requestCode == REQUEST_INSTALL_UPDATE) {
            File apk = pendingUpdateApk;
            pendingUpdateApk = null;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                    && getPackageManager().canRequestPackageInstalls() && apk != null) {
                installVerifiedUpdate(apk);
            } else if (apk != null) {
                Toast.makeText(this, "Installation permission was not enabled.", Toast.LENGTH_LONG).show();
            }
            return;
        }
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
            webView.removeJavascriptInterface("TGCNativeUpdates");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}