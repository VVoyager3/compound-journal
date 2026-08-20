package com.vvoyager3.qiguang;

import android.annotation.SuppressLint;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.InputStream;

public class QiguangWidgetProvider extends AppWidgetProvider {
    private static final String TOGGLE_PRIVACY = "com.vvoyager3.qiguang.widget.TOGGLE_PRIVACY";
    private static final String COMPLETE_MAIN = "com.vvoyager3.qiguang.widget.COMPLETE_MAIN";
    private static final String OPEN_ROUTE = "com.vvoyager3.qiguang.widget.OPEN_ROUTE";

    static void refreshAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, QiguangWidgetProvider.class));
        for (int id : ids) render(context, manager, id);
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) render(context, manager, id);
    }

    @Override
    public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle options) {
        render(context, manager, id);
    }

    @Override
    public void onDeleted(Context context, int[] ids) {
        android.content.SharedPreferences.Editor editor = context.getSharedPreferences(QiguangWidgetBridge.PREFS, Context.MODE_PRIVATE).edit();
        for (int id : ids) editor.remove("private_" + id);
        editor.apply();
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        String action = intent.getAction();
        int id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        if (TOGGLE_PRIVACY.equals(action) && id != AppWidgetManager.INVALID_APPWIDGET_ID) {
            boolean current = context.getSharedPreferences(QiguangWidgetBridge.PREFS, Context.MODE_PRIVATE).getBoolean("private_" + id, false);
            context.getSharedPreferences(QiguangWidgetBridge.PREFS, Context.MODE_PRIVATE).edit().putBoolean("private_" + id, !current).apply();
            render(context, AppWidgetManager.getInstance(context), id);
        } else if (COMPLETE_MAIN.equals(action)) {
            queueActionAndOpen(context, new JSONObjectBuilder().put("type", "complete").put("questId", intent.getStringExtra("quest_id")).toString());
        } else if (OPEN_ROUTE.equals(action)) {
            queueActionAndOpen(context, new JSONObjectBuilder().put("type", "open").put("route", intent.getStringExtra("route")).put("questId", intent.getStringExtra("quest_id")).toString());
        }
    }

    @SuppressLint("ApplySharedPref") // Persist before launching so process replacement cannot lose the tap.
    private static void queueActionAndOpen(Context context, String action) {
        context.getSharedPreferences(QiguangWidgetBridge.PREFS, Context.MODE_PRIVATE).edit().putString(QiguangWidgetBridge.PENDING_ACTION, action).commit();
        Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (launch == null) return;
        launch.putExtra("from_widget", true);
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        context.startActivity(launch);
    }

    private static PendingIntent broadcast(Context context, int id, String action, String key, String value) {
        Intent intent = new Intent(context, QiguangWidgetProvider.class).setAction(action).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id).putExtra(key, value);
        return PendingIntent.getBroadcast(context, (id + action + value).hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void render(Context context, AppWidgetManager manager, int id) {
        Bundle options = manager.getAppWidgetOptions(id);
        int width = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 110);
        int layout = width < 180 ? R.layout.widget_qiguang_small : width < 300 ? R.layout.widget_qiguang_medium : R.layout.widget_qiguang_large;
        RemoteViews views = new RemoteViews(context.getPackageName(), layout);
        boolean privacy = context.getSharedPreferences(QiguangWidgetBridge.PREFS, Context.MODE_PRIVATE).getBoolean("private_" + id, false);
        try {
            JSONObject snapshot = new JSONObject(context.getSharedPreferences(QiguangWidgetBridge.PREFS, Context.MODE_PRIVATE).getString(QiguangWidgetBridge.SNAPSHOT, "{}"));
            JSONObject main = snapshot.optJSONObject("main");
            JSONObject xp = snapshot.optJSONObject("xp");
            String title = main == null ? "今天还没有 MAIN" : main.optString("title", "今天还没有 MAIN");
            String minimum = main == null ? "打开栖光安排一个最小行动" : main.optString("minimumAction", "");
            Bitmap avatar = width >= 180 ? loadAvatar(context, snapshot.optString("avatar", "")) : null;
            if (avatar != null) views.setImageViewBitmap(R.id.widget_avatar, avatar);
            views.setTextViewText(R.id.widget_name, snapshot.optString("companionName", "小栖") + " · " + snapshot.optString("companionState", "陪伴"));
            views.setTextViewText(R.id.widget_main, title);
            views.setTextViewText(R.id.widget_minimum, minimum);
            views.setTextViewText(R.id.widget_xp, xp == null ? "Lv.1" : "Lv." + xp.optInt("level", 1) + " · " + xp.optInt("currentXp", 0) + "/" + xp.optInt("nextLevelXp", 30) + " XP");
            JSONArray bonus = snapshot.optJSONArray("bonus");
            StringBuilder bonusText = new StringBuilder();
            if (bonus != null) for (int index = 0; index < bonus.length(); index++) {
                JSONObject item = bonus.optJSONObject(index);
                if (item != null) bonusText.append(index == 0 ? "" : "\n").append("BONUS · ").append(item.optString("title"));
            }
            views.setTextViewText(R.id.widget_bonus, bonusText.length() == 0 ? "暂无 BONUS" : bonusText.toString());
            views.setViewVisibility(R.id.widget_private, privacy ? View.VISIBLE : View.GONE);
            for (int viewId : new int[]{R.id.widget_main, R.id.widget_minimum, R.id.widget_xp, R.id.widget_bonus}) {
                views.setViewVisibility(viewId, privacy ? View.GONE : View.VISIBLE);
            }
            views.setViewVisibility(R.id.widget_complete, privacy || main == null ? View.GONE : View.VISIBLE);
            if (!privacy && main != null) views.setOnClickPendingIntent(R.id.widget_complete, broadcast(context, id, COMPLETE_MAIN, "quest_id", main.optString("id", "")));
            views.setOnClickPendingIntent(R.id.widget_privacy_toggle, broadcast(context, id, TOGGLE_PRIVACY, "unused", ""));
            views.setOnClickPendingIntent(R.id.widget_tasks, route(context, id, "tasks", main == null ? "" : main.optString("id", "")));
            views.setOnClickPendingIntent(R.id.widget_record, broadcast(context, id, OPEN_ROUTE, "route", "record"));
            views.setOnClickPendingIntent(R.id.widget_root, broadcast(context, id, OPEN_ROUTE, "route", "today"));
        } catch (Exception ignored) {
            views.setTextViewText(R.id.widget_main, "打开栖光同步今天的行动");
        }
        manager.updateAppWidget(id, views);
    }

    private static PendingIntent route(Context context, int id, String route, String questId) {
        Intent intent = new Intent(context, QiguangWidgetProvider.class).setAction(OPEN_ROUTE)
            .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id).putExtra("route", route).putExtra("quest_id", questId);
        return PendingIntent.getBroadcast(context, (id + OPEN_ROUTE + route + questId).hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static Bitmap loadAvatar(Context context, String avatar) {
        if (!"male".equals(avatar) && !"female".equals(avatar)) return null;
        try {
            String prefix = "avatar-" + avatar + "-original-";
            for (String name : context.getAssets().list("public/assets")) {
                if (name.startsWith(prefix) && name.endsWith(".jpg")) {
                    String path = "public/assets/" + name;
                    BitmapFactory.Options bounds = new BitmapFactory.Options();
                    bounds.inJustDecodeBounds = true;
                    try (InputStream stream = context.getAssets().open(path)) { BitmapFactory.decodeStream(stream, null, bounds); }
                    BitmapFactory.Options scaled = new BitmapFactory.Options();
                    while (bounds.outWidth / scaled.inSampleSize > 256 || bounds.outHeight / scaled.inSampleSize > 256) scaled.inSampleSize *= 2;
                    try (InputStream stream = context.getAssets().open(path)) { return BitmapFactory.decodeStream(stream, null, scaled); }
                }
            }
        } catch (Exception ignored) {
            // Keep the launcher image when an old or incomplete bundle has no matching portrait.
        }
        return null;
    }

    /** Tiny builder keeps widget actions valid JSON without another dependency. */
    private static final class JSONObjectBuilder {
        private final JSONObject value = new JSONObject();
        JSONObjectBuilder put(String key, String item) { try { value.put(key, item == null ? "" : item); } catch (Exception ignored) {} return this; }
        @Override public String toString() { return value.toString(); }
    }
}
