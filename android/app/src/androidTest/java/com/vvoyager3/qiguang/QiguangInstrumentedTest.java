package com.vvoyager3.qiguang;

import static org.junit.Assert.assertEquals;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class QiguangInstrumentedTest {
    @Test
    public void installedApplicationUsesTheProductionPackageIdentity() {
        assertEquals(
            "com.vvoyager3.qiguang",
            InstrumentationRegistry.getInstrumentation().getTargetContext().getPackageName()
        );
    }
}
