package ru.listok.purchases.update;

import java.io.File;
import java.security.MessageDigest;
import java.util.concurrent.Executor;

public final class AppUpdate {
    public static final String LATEST_RELEASE_URL =
        "https://api.github.com/repos/New-prg/cookish/releases/latest";
    public static final String DOWNLOAD_PREFIX =
        "https://github.com/New-prg/cookish/releases/download/";
    public static final String ASSET_NAME = "Cookish.apk";
    public static final long MAX_BYTES = 200L * 1024L * 1024L;

    public interface Listener {
        void onStatus(UpdateStatus status);
    }

    private final HttpClient http;
    private final Installer installer;
    private final File cacheDir;
    private final String installedVersion;
    private final long installedVersionCode;
    private final Executor executor;
    private final Listener listener;

    private ReleaseManifest pending;
    private boolean permissionPending;

    public AppUpdate(
        HttpClient http,
        Installer installer,
        File cacheDir,
        String installedVersion,
        long installedVersionCode,
        Executor executor,
        Listener listener
    ) {
        this.http = http;
        this.installer = installer;
        this.cacheDir = cacheDir;
        this.installedVersion = installedVersion;
        this.installedVersionCode = installedVersionCode;
        this.executor = executor;
        this.listener = listener;
    }

    public void check() {
        emit("checking", "", pending);
        executor.execute(() -> {
            try {
                String json = http.get(
                    LATEST_RELEASE_URL + "?t=" + System.currentTimeMillis(),
                    userAgent()
                );
                ReleaseManifest release = ReleaseManifest.parse(json, ASSET_NAME, DOWNLOAD_PREFIX);
                boolean available = Version.compare(release.version, installedVersion) > 0;
                pending = available ? release : null;
                emit(available ? "available" : "upToDate", "", release);
            } catch (Exception error) {
                emit(
                    "error",
                    error.getMessage() == null ? "Не удалось проверить обновления." : error.getMessage(),
                    null
                );
            }
        });
    }

    public void installLatest() {
        ReleaseManifest update = pending;
        if (update == null) {
            emit("error", "Сначала проверьте наличие новой версии.", null);
            return;
        }
        if (!installer.canInstallPackages()) {
            permissionPending = true;
            emit(
                "permissionRequired",
                "Разрешите Cookish устанавливать обновления, затем вернитесь в приложение.",
                update
            );
            installer.requestInstallPermission();
            return;
        }
        downloadAndInstall(update);
    }

    public void resumeAfterPermission() {
        if (!permissionPending) return;
        if (!installer.canInstallPackages()) {
            emit(
                "permissionRequired",
                "Разрешите Cookish устанавливать обновления, затем вернитесь в приложение.",
                pending
            );
            return;
        }
        if (pending != null) downloadAndInstall(pending);
    }

    private void downloadAndInstall(ReleaseManifest update) {
        permissionPending = false;
        emit("downloading", "Загружаем обновление…", update);
        executor.execute(() -> {
            File destination = null;
            try {
                File updateDirectory = new File(cacheDir, "updates");
                if (!updateDirectory.exists() && !updateDirectory.mkdirs()) {
                    throw new IllegalStateException("Не удалось подготовить папку обновления.");
                }
                File[] previousFiles = updateDirectory.listFiles();
                if (previousFiles != null) {
                    for (File previous : previousFiles) previous.delete();
                }
                destination = new File(updateDirectory, "Cookish-" + update.version + ".apk");
                String actualDigest = http.download(update.downloadUrl, destination, userAgent(), MAX_BYTES);
                if (!update.sha256.isEmpty() && !update.sha256.equals(actualDigest)) {
                    throw new SecurityException("Контрольная сумма APK не совпала.");
                }
                if (update.size > MAX_BYTES) {
                    throw new IllegalStateException("Файл обновления слишком большой.");
                }
                installer.install(destination);
                emit("installing", "Подтвердите установку в Android.", update);
            } catch (Exception error) {
                if (destination != null) destination.delete();
                emit(
                    "error",
                    error.getMessage() == null ? "Не удалось установить обновление." : error.getMessage(),
                    update
                );
            }
        });
    }

    private String userAgent() {
        return "Cookish-Android/" + installedVersion;
    }

    private void emit(String status, String message, ReleaseManifest release) {
        listener.onStatus(UpdateStatus.of(
            status,
            message,
            installedVersion,
            installedVersionCode,
            release
        ));
    }

    public static String hex(byte[] bytes) {
        StringBuilder result = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) result.append(String.format("%02x", value & 0xff));
        return result.toString();
    }

    public static String sha256(byte[] bytes) throws Exception {
        return hex(MessageDigest.getInstance("SHA-256").digest(bytes));
    }
}
