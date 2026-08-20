package ru.listok.purchases.update;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Executor;

import org.junit.Before;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class AppUpdateTest {
    @Rule
    public TemporaryFolder folder = new TemporaryFolder();

    private final List<UpdateStatus> statuses = new ArrayList<>();
    private FakeHttp http;
    private FakeInstaller installer;
    private AppUpdate updates;

    @Before
    public void setUp() throws Exception {
        http = new FakeHttp();
        installer = new FakeInstaller();
        Executor immediate = Runnable::run;
        updates = new AppUpdate(
            http,
            installer,
            folder.getRoot(),
            "5.3.0",
            5003000,
            immediate,
            statuses::add
        );
    }

    @Test
    public void newerReleaseIsAvailable() {
        http.releaseJson = releaseJson("v5.4.0", "aa".repeat(32), "https://github.com/New-prg/cookish/releases/download/v5.4.0/Cookish.apk");
        updates.check();
        UpdateStatus last = statuses.get(statuses.size() - 1);
        assertEquals("available", last.status);
        assertEquals("5.4.0", last.latestVersion);
    }

    @Test
    public void sameVersionIsUpToDate() {
        http.releaseJson = releaseJson("v5.3.0", "aa".repeat(32), "https://github.com/New-prg/cookish/releases/download/v5.3.0/Cookish.apk");
        updates.check();
        assertEquals("upToDate", statuses.get(statuses.size() - 1).status);
    }

    @Test
    public void invalidManifestIsAnError() {
        http.releaseJson = "{\"tag_name\":\"nightly\",\"assets\":[]}";
        updates.check();
        UpdateStatus last = statuses.get(statuses.size() - 1);
        assertEquals("error", last.status);
        assertTrue(last.message.contains("версии"));
    }

    @Test
    public void networkErrorIsReported() {
        http.failGet = true;
        updates.check();
        UpdateStatus last = statuses.get(statuses.size() - 1);
        assertEquals("error", last.status);
        assertTrue(last.message.contains("сеть"));
    }

    @Test
    public void checksumMismatchFailsInstall() throws Exception {
        String digest = "bb".repeat(32);
        http.releaseJson = releaseJson("v5.4.0", digest, "https://github.com/New-prg/cookish/releases/download/v5.4.0/Cookish.apk");
        http.apkBytes = "apk-bytes".getBytes(StandardCharsets.UTF_8);
        updates.check();
        updates.installLatest();
        UpdateStatus last = statuses.get(statuses.size() - 1);
        assertEquals("error", last.status);
        assertTrue(last.message.contains("Контрольная сумма"));
    }

    @Test
    public void missingInstallPermissionAsksTheUser() {
        installer.canInstall = false;
        http.releaseJson = releaseJson("v5.4.0", "aa".repeat(32), "https://github.com/New-prg/cookish/releases/download/v5.4.0/Cookish.apk");
        updates.check();
        updates.installLatest();
        UpdateStatus last = statuses.get(statuses.size() - 1);
        assertEquals("permissionRequired", last.status);
        assertTrue(installer.permissionRequested);
    }

    @Test
    public void compareTreatsPatchAsNewer() {
        assertTrue(Version.compare("5.3.1", "5.3.0") > 0);
        assertTrue(Version.compare("v5.4.0", "5.3.9") > 0);
        assertEquals(0, Version.compare("5.3.0", "v5.3.0"));
    }

    private static String releaseJson(String tag, String sha256, String url) {
        return "{"
            + "\"tag_name\":\"" + tag + "\","
            + "\"html_url\":\"https://github.com/New-prg/cookish/releases/tag/" + tag + "\","
            + "\"body\":\"notes\","
            + "\"assets\":[{"
            + "\"name\":\"Cookish.apk\","
            + "\"browser_download_url\":\"" + url + "\","
            + "\"digest\":\"sha256:" + sha256 + "\","
            + "\"size\":12"
            + "}]"
            + "}";
    }

    private static final class FakeHttp implements HttpClient {
        String releaseJson = "";
        byte[] apkBytes = new byte[0];
        boolean failGet;

        @Override
        public String get(String url, String userAgent) throws Exception {
            if (failGet) throw new IllegalStateException("Нет сети.");
            return releaseJson;
        }

        @Override
        public String download(String url, File destination, String userAgent, long maxBytes) throws Exception {
            Files.write(destination.toPath(), apkBytes);
            return AppUpdate.sha256(apkBytes);
        }
    }

    private static final class FakeInstaller implements Installer {
        boolean canInstall = true;
        boolean permissionRequested;
        File installed;

        @Override
        public boolean canInstallPackages() {
            return canInstall;
        }

        @Override
        public void requestInstallPermission() {
            permissionRequested = true;
        }

        @Override
        public void install(File apk) {
            installed = apk;
        }
    }
}
