package com.compoundjournal.app

import org.junit.Assert.assertEquals
import org.junit.Test

class ShareTextTest {
    @Test fun acceptsOnlySendText() {
        assertEquals("https://example.com", sharedText("android.intent.action.SEND", "text/plain", "https://example.com"))
        assertEquals("富文本", sharedText("android.intent.action.SEND", "text/plain", StringBuilder("富文本")))
        assertEquals(12_000, sharedText("android.intent.action.SEND", "text/plain", "x".repeat(12_100)).length)
        assertEquals("", sharedText("android.intent.action.VIEW", null, null))
    }
}
