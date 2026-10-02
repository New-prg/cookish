package ru.listok.purchases.ai;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;

import org.junit.Test;

import java.util.List;

public class GestureRectsTest {
    @Test
    public void convertsCssPixelsByDensity() {
        List<int[]> rects = GestureRects.parse("[{\"x\":380,\"y\":300,\"width\":32,\"height\":160}]", 2.5f);
        assertEquals(1, rects.size());
        assertArrayEquals(new int[] {950, 750, 1030, 1150}, rects.get(0));
    }

    @Test
    public void capsTheHeightAtTwoHundredDp() {
        List<int[]> rects = GestureRects.parse("[{\"x\":0,\"y\":0,\"width\":10,\"height\":500}]", 1f);
        assertArrayEquals(new int[] {0, 0, 10, 200}, rects.get(0));
    }

    @Test
    public void ignoresBrokenInputAndClearsWithAnEmptyList() {
        assertEquals(0, GestureRects.parse("[]", 2f).size());
        assertEquals(0, GestureRects.parse("not json", 2f).size());
        assertEquals(0, GestureRects.parse("[{\"x\":1}]", 2f).size());
        assertEquals(0, GestureRects.parse(null, 2f).size());
    }
}
