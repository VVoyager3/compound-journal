package com.vvoyager3.qiguang;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.SharedPreferences;
import android.webkit.JavascriptInterface;

import org.json.JSONObject;

final class QiguangWidgetBridge {
    static final String PREFS = "qiguang_widget";
    static final String SNAPSHOT = "snapshot_v1";
    static final String PENDING_ACTION = "pending_action";
    private final Context context;

    QiguangWidgetBridge(Context context) {
        this.context = context.getApplicationContext();
    }

    @JavascriptInterface
    public void updateSnapshot(String value) {
        if (value == null || value.length() > 20_000) return;
        try {
            if (new JSONObject(value).optInt("version") != 1) return;
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(SNAPSHOT, value).apply();
            QiguangWidgetProvider.refreshAll(context);
        } catch (Exception ignored) {
            // A malformed WebView payload never replaces the last valid snapshot.
        }
    }

    @JavascriptInterface
    @SuppressLint("ApplySharedPref") // Must be removed before the same WebView can consume it again.
    public String consumeAction() {
        SharedPreferences preferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String value = preferences.getString(PENDING_ACTION, "");
        if (!value.isEmpty()) preferences.edit().remove(PENDING_ACTION).commit();
        return value;
    }
}
