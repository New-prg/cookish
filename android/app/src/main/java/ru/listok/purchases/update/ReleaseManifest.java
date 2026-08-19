package ru.listok.purchases.update;

import org.json.JSONArray;
import org.json.JSONObject;

public final class ReleaseManifest {
    public final String version;
    public final String downloadUrl;
    public final String sha256;
    public final String releaseUrl;
    public final String notes;
    public final long size;

    public ReleaseManifest(
        String version,
        String downloadUrl,
        String sha256,
        String releaseUrl,
        String notes,
        long size
    ) {
        this.version = version;
        this.downloadUrl = downloadUrl;
        this.sha256 = sha256;
        this.releaseUrl = releaseUrl;
        this.notes = notes;
        this.size = size;
    }

    public static ReleaseManifest parse(String json, String assetName, String downloadPrefix) throws Exception {
        JSONObject release = new JSONObject(json);
        String latestVersion = Version.normalize(release.optString("tag_name"));
        if (!Version.isRelease(latestVersion)) {
            throw new IllegalStateException("У последнего релиза некорректный номер версии.");
        }

        JSONObject apkAsset = null;
        JSONArray assets = release.optJSONArray("assets");
        if (assets != null) {
            for (int index = 0; index < assets.length(); index++) {
                JSONObject candidate = assets.optJSONObject(index);
                if (candidate != null && assetName.equals(candidate.optString("name"))) {
                    apkAsset = candidate;
                    break;
                }
            }
        }
        if (apkAsset == null) {
            throw new IllegalStateException("В последнем релизе нет файла " + assetName + ".");
        }

        String downloadUrl = apkAsset.optString("browser_download_url");
        if (!downloadUrl.startsWith(downloadPrefix)) {
            throw new IllegalStateException("GitHub вернул недопустимую ссылку на APK.");
        }
        String digest = apkAsset.optString("digest");
        if (digest.startsWith("sha256:")) digest = digest.substring(7);
        if (!digest.isEmpty() && !digest.matches("[a-fA-F0-9]{64}")) {
            throw new IllegalStateException("GitHub вернул некорректную контрольную сумму APK.");
        }

        String notes = release.optString("body");
        if (notes.length() > 1200) notes = notes.substring(0, 1200) + "…";
        return new ReleaseManifest(
            latestVersion,
            downloadUrl,
            digest.toLowerCase(),
            release.optString("html_url"),
            notes,
            apkAsset.optLong("size", 0)
        );
    }
}
