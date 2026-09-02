package com.vvoyager3.qiguang;

import android.content.Intent;
import android.os.Bundle;
import androidx.activity.OnBackPressedCallback;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private OnBackPressedCallback webBackCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        SplashScreen.installSplashScreen(this);
        registerPlugin(QiguangAiPlugin.class);
        super.onCreate(savedInstanceState);
        bridge.getWebView().addJavascriptInterface(new QiguangWidgetBridge(this), "qiguangWidgetBridge");
        webBackCallback = new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                bridge.getWebView().evaluateJavascript(
                    "(() => { const dialogs = document.querySelectorAll('dialog[open]'); const dialog = dialogs[dialogs.length - 1]; if (dialog) { dialog.dispatchEvent(new Event('cancel', { cancelable: true })); return true; } const back = document.querySelector('.secondary-back'); if (back) { back.click(); return true; } return false; })()",
                    handled -> {
                        if ("true".equals(handled)) return;
                        setEnabled(false);
                        getOnBackPressedDispatcher().onBackPressed();
                        setEnabled(true);
                    }
                );
            }
        };
        getOnBackPressedDispatcher().addCallback(this, webBackCallback);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (intent.getBooleanExtra("from_widget", false) && bridge != null) {
            bridge.getWebView().post(() -> bridge.getWebView().evaluateJavascript(
                "window.dispatchEvent(new Event('qiguang-widget-action'))",
                null
            ));
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        if (bridge != null) {
            bridge.getWebView().post(() -> bridge.getWebView().evaluateJavascript(
                "window.dispatchEvent(new Event('qiguang-native-resume'))",
                null
            ));
        }
    }
}
