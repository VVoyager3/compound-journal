package com.vvoyager3.qiguang;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "QiguangAi")
public class QiguangAiPlugin extends Plugin {
    private static final int MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void configuration(PluginCall call) {
        JSObject result = new JSObject();
        result.put("configured", !BuildConfig.QIGUANG_MINIMAX_API_KEY.trim().isEmpty());
        result.put("model", BuildConfig.QIGUANG_MINIMAX_MODEL);
        call.resolve(result);
    }

    @PluginMethod
    public void request(PluginCall call) {
        JSObject payload = call.getObject("payload");
        if (BuildConfig.QIGUANG_MINIMAX_API_KEY.trim().isEmpty()) {
            call.reject("这台设备尚未配置 MiniMax 密钥。");
            return;
        }
        if (payload == null) {
            call.reject("模型请求不能为空。");
            return;
        }
        executor.execute(() -> {
            try {
                call.resolve(send(payload));
            } catch (Exception error) {
                call.reject("MiniMax 中国区接口暂时无法连接。", error);
            }
        });
    }

    private JSObject send(JSObject payload) throws Exception {
        URL url = new URL(BuildConfig.QIGUANG_MINIMAX_API_URL);
        if (!"https".equalsIgnoreCase(url.getProtocol())) throw new IllegalArgumentException("MiniMax 接口必须使用 HTTPS。");
        payload.put("model", BuildConfig.QIGUANG_MINIMAX_MODEL);
        byte[] requestBody = payload.toString().getBytes(StandardCharsets.UTF_8);
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        try {
            connection.setRequestMethod("POST");
            connection.setConnectTimeout(15_000);
            connection.setReadTimeout(50_000);
            connection.setDoOutput(true);
            connection.setRequestProperty("Authorization", "Bearer " + BuildConfig.QIGUANG_MINIMAX_API_KEY);
            connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            connection.setRequestProperty("Accept", "application/json");
            connection.setFixedLengthStreamingMode(requestBody.length);
            try (OutputStream output = connection.getOutputStream()) {
                output.write(requestBody);
            }
            int status = connection.getResponseCode();
            InputStream input = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            JSObject result = new JSObject();
            result.put("status", status);
            result.put("data", input == null ? "" : readLimited(input));
            return result;
        } finally {
            connection.disconnect();
        }
    }

    private String readLimited(InputStream input) throws Exception {
        try (InputStream source = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int total = 0;
            for (int count; (count = source.read(buffer)) != -1;) {
                total += count;
                if (total > MAX_RESPONSE_BYTES) throw new IllegalStateException("模型响应超过 2MB。");
                output.write(buffer, 0, count);
            }
            return new String(output.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    @Override
    protected void handleOnDestroy() {
        executor.shutdownNow();
    }
}
