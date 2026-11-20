package com.toobitpulse.radar;

import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final int DARK_BAR_COLOR = Color.parseColor("#090D16");
    private static final int LIGHT_BAR_COLOR = Color.parseColor("#FFFFFF");

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Window window = getWindow();
        WindowCompat.setDecorFitsSystemWindows(window, false);
        applySystemBarStyle(window, false);

        View content = findViewById(android.R.id.content);
        if (content != null) {
            content.setBackgroundColor(DARK_BAR_COLOR);
            ViewCompat.setOnApplyWindowInsetsListener(content, (view, windowInsets) -> {
                Insets bars = windowInsets.getInsets(
                    WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()
                );
                Insets ime = windowInsets.getInsets(WindowInsetsCompat.Type.ime());
                int bottomInset = Math.max(bars.bottom, ime.bottom);
                view.setPadding(bars.left, bars.top, bars.right, bottomInset);
                return WindowInsetsCompat.CONSUMED;
            });
            ViewCompat.requestApplyInsets(content);
        }

        if (getBridge() != null && getBridge().getWebView() != null) {
            WebView webView = getBridge().getWebView();
            webView.addJavascriptInterface(new SystemUiBridge(content), "ToobitSystemUi");
        }
    }

    private void applySystemBarStyle(Window window, boolean lightTheme) {
        if (window == null) return;
        if (Build.VERSION.SDK_INT < 35) {
            window.setStatusBarColor(Color.TRANSPARENT);
            window.setNavigationBarColor(Color.TRANSPARENT);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setNavigationBarContrastEnforced(false);
        }
        WindowInsetsControllerCompat controller =
            WindowCompat.getInsetsController(window, window.getDecorView());
        if (controller != null) {
            controller.setAppearanceLightStatusBars(lightTheme);
            controller.setAppearanceLightNavigationBars(lightTheme);
        }
    }

    private final class SystemUiBridge {
        private final View contentView;

        SystemUiBridge(View contentView) {
            this.contentView = contentView;
        }

        @JavascriptInterface
        public void setLightMode(boolean lightTheme) {
            runOnUiThread(() -> {
                if (contentView != null) {
                    contentView.setBackgroundColor(lightTheme ? LIGHT_BAR_COLOR : DARK_BAR_COLOR);
                }
                applySystemBarStyle(getWindow(), lightTheme);
            });
        }
    }
}
