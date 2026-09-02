package com.vvoyager3.qiguang;

import android.annotation.SuppressLint;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class QiguangWidgetProvider extends AppWidgetProvider {
    private static final String TOGGLE_PRIVACY = "com.vvoyager3.qiguang.widget.TOGGLE_PRIVACY";
    private static final String COMPLETE_TASK = "com.vvoyager3.qiguang.widget.COMPLETE_TASK";
    private static final String OPEN_ROUTE = "com.vvoyager3.qiguang.widget.OPEN_ROUTE";
    private static final int[] TASK_ROWS = {R.id.widget_task_1, R.id.widget_task_2, R.id.widget_task_3, R.id.widget_task_4};
    private static final int[] TASK_CHECKS = {R.id.widget_task_1_check, R.id.widget_task_2_check, R.id.widget_task_3_check, R.id.widget_task_4_check};
    private static final int[] TASK_TYPES = {R.id.widget_task_1_type, R.id.widget_task_2_type, R.id.widget_task_3_type, R.id.widget_task_4_type};
    private static final int[] TASK_TITLES = {R.id.widget_task_1_title, R.id.widget_task_2_title, R.id.widget_task_3_title, R.id.widget_task_4_title};

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
        } else if (COMPLETE_TASK.equals(action)) {
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
        int height = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 70);
        boolean compact = width < 180 || height < 195;
        boolean medium = !compact && (width < 300 || height < 310);
        int layout = compact ? R.layout.widget_qiguang_small : medium ? R.layout.widget_qiguang_medium : R.layout.widget_qiguang_large;
        int visibleTasks = compact ? 1 : medium ? 2 : 4;
        RemoteViews views = new RemoteViews(context.getPackageName(), layout);
        boolean privacy = context.getSharedPreferences(QiguangWidgetBridge.PREFS, Context.MODE_PRIVATE).getBoolean("private_" + id, false);
        try {
            JSONObject snapshot = new JSONObject(context.getSharedPreferences(QiguangWidgetBridge.PREFS, Context.MODE_PRIVATE).getString(QiguangWidgetBridge.SNAPSHOT, "{}"));
            String today = new SimpleDateFormat("yyyy-MM-dd", Locale.CHINA).format(new Date());
            boolean current = today.equals(snapshot.optString("localDate", ""));
            JSONArray tasks = current ? snapshot.optJSONArray("tasks") : null;
            if (tasks == null) tasks = new JSONArray();
            int count = tasks.length();
            views.setTextViewText(R.id.widget_title, context.getString(R.string.widget_title));
            views.setTextViewText(R.id.widget_count, count == 0 ? "" : context.getString(R.string.widget_count, count));
            views.setTextViewText(R.id.widget_privacy_toggle, context.getString(privacy ? R.string.widget_show : R.string.widget_hide));
            views.setViewVisibility(R.id.widget_private, privacy && count > 0 ? View.VISIBLE : View.GONE);
            views.setTextViewText(R.id.widget_private, context.getString(R.string.widget_private, count));
            views.setViewVisibility(R.id.widget_empty, !privacy && count == 0 ? View.VISIBLE : View.GONE);
            views.setTextViewText(R.id.widget_empty, context.getString(current ? R.string.widget_all_done : R.string.widget_sync));
            for (int index = 0; index < visibleTasks; index++) {
                JSONObject task = index < count ? tasks.optJSONObject(index) : null;
                boolean visible = !privacy && index < visibleTasks && task != null;
                views.setViewVisibility(TASK_ROWS[index], visible ? View.VISIBLE : View.GONE);
                if (!visible) continue;
                String taskId = task.optString("id", "");
                String title = task.optString("title", context.getString(R.string.widget_untitled));
                int targetCount = task.optInt("targetCount", 0);
                int progressCount = task.optInt("progressCount", 0);
                String countUnit = task.optString("countUnit", context.getString(R.string.widget_count_unit));
                String progress = targetCount > 1 ? progressCount + "/" + targetCount + countUnit : "";
                String taskType = taskType(context, task.optString("sourceType", ""), task.optString("type", "side"));
                views.setTextViewText(TASK_TYPES[index], progress.isEmpty() ? taskType : taskType + " · " + progress);
                views.setViewVisibility(TASK_TYPES[index], compact ? View.GONE : View.VISIBLE);
                views.setTextViewText(TASK_TITLES[index], title);
                views.setContentDescription(TASK_CHECKS[index], targetCount > 1
                        ? context.getString(R.string.widget_check_in_named, title, progress)
                        : context.getString(R.string.widget_complete_named, title));
                views.setOnClickPendingIntent(TASK_CHECKS[index], broadcast(context, id, COMPLETE_TASK, "quest_id", taskId));
                views.setOnClickPendingIntent(TASK_TITLES[index], route(context, id, "tasks", taskId));
            }
            int hidden = Math.max(0, count - visibleTasks);
            views.setViewVisibility(R.id.widget_more, !privacy && !compact && hidden > 0 ? View.VISIBLE : View.GONE);
            views.setTextViewText(R.id.widget_more, context.getString(R.string.widget_more, hidden));
            views.setOnClickPendingIntent(R.id.widget_privacy_toggle, broadcast(context, id, TOGGLE_PRIVACY, "unused", ""));
            views.setOnClickPendingIntent(R.id.widget_header, route(context, id, "tasks", ""));
            views.setOnClickPendingIntent(R.id.widget_more, route(context, id, "tasks", ""));
            views.setOnClickPendingIntent(R.id.widget_root, route(context, id, "tasks", ""));
        } catch (Exception ignored) {
            views.setViewVisibility(R.id.widget_empty, View.VISIBLE);
            views.setTextViewText(R.id.widget_empty, context.getString(R.string.widget_sync));
        }
        manager.updateAppWidget(id, views);
    }

    private static String taskType(Context context, String sourceType, String legacyType) {
        if ("habit".equals(sourceType) || (sourceType.isEmpty() && "bonus".equals(legacyType))) {
            return context.getString(R.string.widget_type_bonus);
        }
        if (!sourceType.isEmpty()) return context.getString(R.string.widget_type_main);
        if ("main".equals(legacyType)) return context.getString(R.string.widget_type_main);
        return context.getString(R.string.widget_type_side);
    }

    private static PendingIntent route(Context context, int id, String route, String questId) {
        Intent intent = new Intent(context, QiguangWidgetProvider.class).setAction(OPEN_ROUTE)
            .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id).putExtra("route", route).putExtra("quest_id", questId);
        return PendingIntent.getBroadcast(context, (id + OPEN_ROUTE + route + questId).hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** Tiny builder keeps widget actions valid JSON without another dependency. */
    private static final class JSONObjectBuilder {
        private final JSONObject value = new JSONObject();
        JSONObjectBuilder put(String key, String item) { try { value.put(key, item == null ? "" : item); } catch (Exception ignored) {} return this; }
        @Override public String toString() { return value.toString(); }
    }
}
