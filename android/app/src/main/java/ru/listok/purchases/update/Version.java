package ru.listok.purchases.update;

public final class Version {
    private Version() {}

    public static String normalize(String version) {
        String normalized = version == null ? "" : version.trim();
        return normalized.startsWith("v") ? normalized.substring(1) : normalized;
    }

    public static int compare(String left, String right) {
        String[] leftParts = normalize(left).split("\\.");
        String[] rightParts = normalize(right).split("\\.");
        for (int index = 0; index < 3; index++) {
            int leftValue = index < leftParts.length ? parsePart(leftParts[index]) : 0;
            int rightValue = index < rightParts.length ? parsePart(rightParts[index]) : 0;
            if (leftValue != rightValue) return Integer.compare(leftValue, rightValue);
        }
        return 0;
    }

    public static boolean isRelease(String version) {
        return normalize(version).matches("\\d+\\.\\d+\\.\\d+");
    }

    private static int parsePart(String value) {
        String digits = value.replaceFirst("[^0-9].*$", "");
        try {
            return digits.isEmpty() ? 0 : Integer.parseInt(digits);
        } catch (NumberFormatException ignored) {
            return 0;
        }
    }
}
