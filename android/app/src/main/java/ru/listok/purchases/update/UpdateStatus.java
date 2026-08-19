package ru.listok.purchases.update;

public final class UpdateStatus {
    public final String status;
    public final String message;
    public final String installedVersion;
    public final long installedVersionCode;
    public final String latestVersion;
    public final String releaseUrl;
    public final String notes;

    public UpdateStatus(
        String status,
        String message,
        String installedVersion,
        long installedVersionCode,
        String latestVersion,
        String releaseUrl,
        String notes
    ) {
        this.status = status;
        this.message = message == null ? "" : message;
        this.installedVersion = installedVersion;
        this.installedVersionCode = installedVersionCode;
        this.latestVersion = latestVersion;
        this.releaseUrl = releaseUrl;
        this.notes = notes;
    }

    public static UpdateStatus of(
        String status,
        String message,
        String installedVersion,
        long installedVersionCode,
        ReleaseManifest release
    ) {
        return new UpdateStatus(
            status,
            message,
            installedVersion,
            installedVersionCode,
            release == null ? null : release.version,
            release == null ? null : release.releaseUrl,
            release == null ? null : release.notes
        );
    }
}
