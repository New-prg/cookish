package ru.listok.purchases.update;

import java.io.File;

public interface HttpClient {
    String get(String url, String userAgent) throws Exception;

    String download(String url, File destination, String userAgent, long maxBytes) throws Exception;
}
