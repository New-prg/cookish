package ru.listok.purchases.update;

import java.io.File;

public interface Installer {
    boolean canInstallPackages();

    void requestInstallPermission();

    void install(File apk) throws Exception;
}
