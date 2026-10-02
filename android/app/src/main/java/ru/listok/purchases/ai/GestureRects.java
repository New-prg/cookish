package ru.listok.purchases.ai;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Converts the assistant handle's rectangles from CSS pixels (sent by the web
 * layer) into WebView pixels for View.setSystemGestureExclusionRects, so a
 * pull on the handle at the screen edge is not taken for the system back
 * gesture. Android honours at most 200 dp of exclusion per edge.
 */
public final class GestureRects {
    public static final int MAX_RECTS = 4;
    public static final int MAX_HEIGHT_DP = 200;

    private GestureRects() {}

    /** Returns {left, top, right, bottom} in pixels for each valid rectangle. */
    public static List<int[]> parse(String json, float density) {
        List<int[]> rects = new ArrayList<>();
        if (json == null || density <= 0) return rects;
        try {
            JSONArray array = new JSONArray(json);
            for (int index = 0; index < array.length() && rects.size() < MAX_RECTS; index++) {
                JSONObject rect = array.optJSONObject(index);
                if (rect == null) continue;
                double x = rect.optDouble("x", Double.NaN);
                double y = rect.optDouble("y", Double.NaN);
                double width = rect.optDouble("width", Double.NaN);
                double height = Math.min(rect.optDouble("height", Double.NaN), MAX_HEIGHT_DP);
                if (Double.isNaN(x) || Double.isNaN(y) || !(width > 0) || !(height > 0)) continue;
                int left = (int) Math.round(x * density);
                int top = (int) Math.round(y * density);
                rects.add(new int[] {
                    left,
                    top,
                    left + (int) Math.round(width * density),
                    top + (int) Math.round(height * density),
                });
            }
        } catch (Exception ignored) {
            rects.clear();
        }
        return rects;
    }
}
