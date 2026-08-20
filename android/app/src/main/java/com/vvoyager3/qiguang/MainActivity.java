package com.vvoyager3.qiguang;

import android.content.Intent;
import android.os.Bundle;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        SplashScreen.installSplashScreen(this);
        super.onCreate(savedInstanceState);
        bridge.getWebView().addJavascriptInterface(new QiguangWidgetBridge(this), "qiguangWidgetBridge");
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (intent.getBooleanExtra("from_widget", false) && bridge != null) {
            bridge.getWebView().post(() -> bridge.getWebView().reload());
        }
    }
}
