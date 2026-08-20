package com.vvoyager3.qiguang;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class QiguangBuildConfigTest {
    @Test
    public void personalBuildKeepsTheExpectedIdentityAndSafeAiEndpoint() {
        assertEquals("com.vvoyager3.qiguang", BuildConfig.APPLICATION_ID);
        assertTrue(BuildConfig.QIGUANG_MINIMAX_API_URL.startsWith("https://"));
        assertFalse(BuildConfig.QIGUANG_MINIMAX_MODEL.trim().isEmpty());
    }
}
