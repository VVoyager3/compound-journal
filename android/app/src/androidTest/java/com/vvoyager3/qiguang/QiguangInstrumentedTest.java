package com.vvoyager3.qiguang;

import static org.junit.Assert.assertEquals;

import android.content.Context;
import android.content.SharedPreferences;

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

    @Test
    public void widgetBridgeRejectsInvalidSnapshotsAndConsumesEachActionOnce() {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        SharedPreferences preferences = context.getSharedPreferences(QiguangWidgetBridge.PREFS, Context.MODE_PRIVATE);
        String previousSnapshot = preferences.getString(QiguangWidgetBridge.SNAPSHOT, null);
        String previousAction = preferences.getString(QiguangWidgetBridge.PENDING_ACTION, null);
        QiguangWidgetBridge bridge = new QiguangWidgetBridge(context);
        try {
            String valid = "{\"version\":1,\"main\":null}";
            bridge.updateSnapshot(valid);
            assertEquals(valid, preferences.getString(QiguangWidgetBridge.SNAPSHOT, ""));
            bridge.updateSnapshot("{\"version\":2}");
            bridge.updateSnapshot("not-json");
            assertEquals(valid, preferences.getString(QiguangWidgetBridge.SNAPSHOT, ""));

            String action = "{\"type\":\"open\",\"route\":\"tasks\"}";
            preferences.edit().putString(QiguangWidgetBridge.PENDING_ACTION, action).commit();
            assertEquals(action, bridge.consumeAction());
            assertEquals("", bridge.consumeAction());
        } finally {
            SharedPreferences.Editor restore = preferences.edit();
            if (previousSnapshot == null) restore.remove(QiguangWidgetBridge.SNAPSHOT); else restore.putString(QiguangWidgetBridge.SNAPSHOT, previousSnapshot);
            if (previousAction == null) restore.remove(QiguangWidgetBridge.PENDING_ACTION); else restore.putString(QiguangWidgetBridge.PENDING_ACTION, previousAction);
            restore.commit();
            QiguangWidgetProvider.refreshAll(context);
        }
    }
}
