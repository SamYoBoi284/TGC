package com.sam.tgc;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Handler;
import android.os.Looper;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class TgcUpdater {
    private static final String RELEASE_API =
            "https://api.github.com/repos/SamYoBoi284/TGC/releases/latest";
    private static final String APK_ASSET = "tgc-android-release.apk";
    private static final String CHECKSUM_ASSET = "tgc-android-release.apk.sha256";
    private static final ExecutorService IO = Executors.newSingleThreadExecutor();
    private static final Handler MAIN = new Handler(Looper.getMainLooper());

    private TgcUpdater() {}

    public static final class ReleaseInfo {
        public final String version;
        public final String tag;
        public final String notes;
        public final String apkUrl;
        public final String checksumUrl;

        ReleaseInfo(String version, String tag, String notes, String apkUrl, String checksumUrl) {
            this.version = version;
            this.tag = tag;
            this.notes = notes;
            this.apkUrl = apkUrl;
            this.checksumUrl = checksumUrl;
        }
    }

    public interface CheckCallback {
        void onResult(ReleaseInfo release, boolean updateAvailable);
        void onError(Exception error);
    }

    public interface DownloadCallback {
        void onProgress(int percent, long downloaded, long total);
        void onComplete(File apk);
        void onError(Exception error);
    }

    public static void checkLatest(Context context, CheckCallback callback) {
        Context app = context.getApplicationContext();
        IO.execute(() -> {
            HttpURLConnection connection = null;
            try {
                connection = open(RELEASE_API);
                if (connection.getResponseCode() != HttpURLConnection.HTTP_OK) {
                    throw new IllegalStateException("GitHub release check returned HTTP "
                            + connection.getResponseCode());
                }
                JSONObject release = new JSONObject(readAll(connection.getInputStream()));
                String tag = release.optString("tag_name", "");
                String version = tag.startsWith("v") ? tag.substring(1) : tag;
                JSONArray assets = release.optJSONArray("assets");
                String apkUrl = null;
                String checksumUrl = null;
                if (assets != null) {
                    for (int i = 0; i < assets.length(); i++) {
                        JSONObject asset = assets.optJSONObject(i);
                        if (asset == null) continue;
                        String name = asset.optString("name", "");
                        if (APK_ASSET.equals(name)) apkUrl = asset.optString("browser_download_url", null);
                        if (CHECKSUM_ASSET.equals(name)) checksumUrl = asset.optString("browser_download_url", null);
                    }
                }
                if (tag.isEmpty()) throw new IllegalStateException("The latest release has no version tag.");
                if (apkUrl == null || checksumUrl == null) {
                    throw new IllegalStateException("The latest release does not contain the APK and SHA-256 checksum assets.");
                }
                ReleaseInfo info = new ReleaseInfo(version, tag, release.optString("body", ""), apkUrl, checksumUrl);
                boolean newer = compareVersions(version, BuildConfig.VERSION_NAME) > 0;
                MAIN.post(() -> callback.onResult(info, newer));
            } catch (Exception error) {
                MAIN.post(() -> callback.onError(error));
            } finally {
                if (connection != null) connection.disconnect();
            }
        });
    }

    public static boolean isNetworkAllowed(Context context) {
        ConnectivityManager manager = (ConnectivityManager)
                context.getSystemService(Context.CONNECTIVITY_SERVICE);
        if (manager == null) return false;
        Network network = manager.getActiveNetwork();
        if (network == null) return false;
        NetworkCapabilities caps = manager.getNetworkCapabilities(network);
        return caps != null
                && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
    }

    public static void downloadAndVerify(Context context, ReleaseInfo release, DownloadCallback callback) {
        Context app = context.getApplicationContext();
        IO.execute(() -> {
            HttpURLConnection apkConnection = null;
            File partial = null;
            try {
                if (!isNetworkAllowed(app)) {
                    throw new IllegalStateException("The current network is blocked by your update download policy.");
                }
                String expected = fetchChecksum(release.checksumUrl);
                File directory = new File(app.getCacheDir(), "updates");
                if (!directory.exists() && !directory.mkdirs()) {
                    throw new IllegalStateException("Could not create the update cache directory.");
                }
                partial = new File(directory, "tgc-android-release.apk.part");
                File apk = new File(directory, APK_ASSET);
                apkConnection = open(release.apkUrl);
                int response = apkConnection.getResponseCode();
                if (response != HttpURLConnection.HTTP_OK) {
                    throw new IllegalStateException("APK download returned HTTP " + response);
                }
                long total = apkConnection.getContentLengthLong();
                long downloaded = 0L;
                byte[] buffer = new byte[32 * 1024];
                try (InputStream in = new BufferedInputStream(apkConnection.getInputStream());
                     FileOutputStream out = new FileOutputStream(partial)) {
                    int count;
                    int lastPercent = -1;
                    while ((count = in.read(buffer)) != -1) {
                        if (!isNetworkAllowed(app)) {
                            throw new IllegalStateException("The active network changed to one blocked by the update download policy.");
                        }
                        out.write(buffer, 0, count);
                        downloaded += count;
                        int percent = total > 0 ? (int) Math.min(100, downloaded * 100 / total) : -1;
                        if (percent != lastPercent) {
                            lastPercent = percent;
                            long done = downloaded;
                            MAIN.post(() -> callback.onProgress(percent, done, total));
                        }
                    }
                    out.getFD().sync();
                }
                String actual = sha256(partial);
                if (!actual.equalsIgnoreCase(expected)) {
                    partial.delete();
                    throw new SecurityException("The downloaded APK failed SHA-256 verification.");
                }
                if (apk.exists() && !apk.delete()) {
                    partial.delete();
                    throw new IllegalStateException("Could not replace the cached update APK.");
                }
                if (!partial.renameTo(apk)) {
                    partial.delete();
                    throw new IllegalStateException("Could not finalize the downloaded APK.");
                }
                MAIN.post(() -> callback.onComplete(apk));
            } catch (Exception error) {
                if (partial != null && partial.exists()) partial.delete();
                MAIN.post(() -> callback.onError(error));
            } finally {
                if (apkConnection != null) apkConnection.disconnect();
            }
        });
    }

    private static HttpURLConnection open(String address) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection();
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(30000);
        connection.setRequestProperty("Accept", "application/vnd.github+json");
        connection.setRequestProperty("User-Agent", "TGC-Android-Updater");
        connection.setInstanceFollowRedirects(true);
        return connection;
    }

    private static String fetchChecksum(String address) throws Exception {
        HttpURLConnection connection = null;
        try {
            connection = open(address);
            if (connection.getResponseCode() != HttpURLConnection.HTTP_OK) {
                throw new IllegalStateException("Checksum download returned HTTP " + connection.getResponseCode());
            }
            String line = readAll(connection.getInputStream()).trim();
            String checksum = line.split("\\s+")[0].toLowerCase(Locale.ROOT);
            if (!checksum.matches("[0-9a-f]{64}")) {
                throw new IllegalStateException("Release SHA-256 file is malformed.");
            }
            return checksum;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static String sha256(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new BufferedInputStream(new java.io.FileInputStream(file))) {
            byte[] buffer = new byte[32 * 1024];
            int count;
            while ((count = in.read(buffer)) != -1) digest.update(buffer, 0, count);
        }
        StringBuilder result = new StringBuilder(64);
        for (byte value : digest.digest()) result.append(String.format(Locale.ROOT, "%02x", value & 0xff));
        return result.toString();
    }

    private static String readAll(InputStream stream) throws Exception {
        StringBuilder result = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, java.nio.charset.StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) result.append(line).append('\n');
        }
        return result.toString();
    }

    private static int compareVersions(String left, String right) {
        String[] a = left.split("[^0-9]+");
        String[] b = right.split("[^0-9]+");
        int count = Math.max(a.length, b.length);
        for (int i = 0; i < count; i++) {
            int av = i < a.length && !a[i].isEmpty() ? parsePart(a[i]) : 0;
            int bv = i < b.length && !b[i].isEmpty() ? parsePart(b[i]) : 0;
            if (av != bv) return Integer.compare(av, bv);
        }
        return 0;
    }

    private static int parsePart(String value) {
        try { return Integer.parseInt(value); } catch (NumberFormatException ignored) { return 0; }
    }
}
