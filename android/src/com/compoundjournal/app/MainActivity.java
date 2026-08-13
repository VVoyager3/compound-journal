package com.compoundjournal.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

public final class MainActivity extends Activity {
    private static final int PICK_IMAGES = 7;
    private static final String APP_URL = "http://127.0.0.1:4173";

    private WebView webView;
    private ValueCallback<Uri[]> pendingFiles;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(244, 241, 232));
        int statusBarId = getResources().getIdentifier("status_bar_height", "dimen", "android");
        int statusBarHeight = statusBarId > 0 ? getResources().getDimensionPixelSize(statusBarId) : 0;
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(244, 241, 232));
        root.setPadding(0, statusBarHeight, 0, 0);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            int top = Math.max(statusBarHeight, insets.getSystemWindowInsetTop());
            view.setPadding(0, top, 0, 0);
            return insets;
        });
        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return openOutsideIfNeeded(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return openOutsideIfNeeded(Uri.parse(url));
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(
                    WebView view,
                    ValueCallback<Uri[]> callback,
                    FileChooserParams params) {
                if (pendingFiles != null) pendingFiles.onReceiveValue(null);
                pendingFiles = callback;

                Intent picker = new Intent(Intent.ACTION_OPEN_DOCUMENT)
                        .addCategory(Intent.CATEGORY_OPENABLE)
                        .setType("image/*")
                        .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                try {
                    startActivityForResult(Intent.createChooser(picker, "选择截图"), PICK_IMAGES);
                    return true;
                } catch (ActivityNotFoundException error) {
                    pendingFiles = null;
                    callback.onReceiveValue(null);
                    return false;
                }
            }
        });

        setContentView(root);
        root.requestApplyInsets();
        webView.loadUrl(APP_URL);
    }

    private boolean openOutsideIfNeeded(Uri uri) {
        if ("http".equals(uri.getScheme())
                && "127.0.0.1".equals(uri.getHost())
                && uri.getPort() == 4173) {
            return false;
        }

        String scheme = uri.getScheme();
        if ("http".equals(scheme) || "https".equals(scheme)) {
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
            } catch (ActivityNotFoundException error) {
                Toast.makeText(this, "无法打开链接", Toast.LENGTH_SHORT).show();
            }
        }
        return true;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != PICK_IMAGES || pendingFiles == null) return;

        Uri[] result = null;
        if (resultCode == RESULT_OK && data != null) {
            ClipData clips = data.getClipData();
            if (clips != null) {
                result = new Uri[clips.getItemCount()];
                for (int i = 0; i < clips.getItemCount(); i++) {
                    result[i] = clips.getItemAt(i).getUri();
                }
            } else if (data.getData() != null) {
                result = new Uri[] {data.getData()};
            }
        }

        pendingFiles.onReceiveValue(result);
        pendingFiles = null;
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (pendingFiles != null) pendingFiles.onReceiveValue(null);
        if (webView != null) webView.destroy();
        super.onDestroy();
    }
}
