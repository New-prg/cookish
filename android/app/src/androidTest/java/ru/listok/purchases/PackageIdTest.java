package ru.listok.purchases;

import static org.junit.Assert.assertEquals;

import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class PackageIdTest {
    @Test
    public void applicationIdIsCookish() {
        Context appContext = InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertEquals("ru.listok.purchases", appContext.getPackageName());
    }
}
