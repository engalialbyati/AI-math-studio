package app.mathstudio.tablet;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.inputmethod.EditorInfo;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;
import android.widget.Toast;

import com.google.zxing.client.android.Intents;
import com.journeyapps.barcodescanner.ScanOptions;

// Math Studio on the tablet. Two ways in, both remembered:
// - Your Math Studio server: type its address (or scan a sign-in code from a signed-in PC);
//   Google sign-in happens in the browser, which returns here through mathstudio://auth.
// - A PC on the same Wi-Fi: scan its "Connect tablet" code; strokes mirror to the PC live.
public class MainActivity extends Activity {
    private static final int SCAN_REQUEST = 1;
    private static final String PREFS = "pairing";
    private static final String KEY_URL = "url";

    private WebView web;
    private View pairView;
    private TextView message;
    private Button retry;
    private boolean loadFailed;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        web = findViewById(R.id.web);
        pairView = findViewById(R.id.pair);
        message = findViewById(R.id.message);
        retry = findViewById(R.id.retry);
        EditText address = findViewById(R.id.address);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true); // canvas copy and pairing token
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                loadFailed = false;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    loadFailed = true;
                    showPairing("Can't reach Math Studio. Check the internet connection (or, for a PC, that it is running on the same Wi-Fi).", true);
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (!loadFailed) showCanvas();
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                // Google does not allow sign-in inside an app's web view: use the browser.
                if ("/auth/google".equals(u.getPath())) {
                    startActivity(new Intent(Intent.ACTION_VIEW, u.buildUpon().appendQueryParameter("app", "1").build()));
                    return true;
                }
                // Links leaving Math Studio open in the normal browser.
                Uri saved = Uri.parse(savedUrl() == null ? "" : savedUrl());
                if (u.getHost() != null && u.getHost().equals(saved.getHost())) return false;
                startActivity(new Intent(Intent.ACTION_VIEW, u));
                return true;
            }
        });

        findViewById(R.id.scan).setOnClickListener(v -> startScan());
        retry.setOnClickListener(v -> open(savedUrl()));
        address.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_GO) {
                accept(v.getText().toString().trim());
                return true;
            }
            return false;
        });

        if (!handleAuth(getIntent())) {
            String url = savedUrl();
            if (url != null) open(url);
            else showPairing(null, false);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleAuth(intent);
    }

    // mathstudio://auth?url=<one-time sign-in link> from the browser, for the saved server only.
    private boolean handleAuth(Intent intent) {
        Uri data = intent == null ? null : intent.getData();
        if (data == null || !"mathstudio".equals(data.getScheme())) return false;
        String link = data.getQueryParameter("url");
        String saved = savedUrl();
        if (link == null || saved == null) return false;
        Uri l = Uri.parse(link);
        Uri s = Uri.parse(saved);
        if (!"/auth/link".equals(l.getPath()) || l.getHost() == null || !l.getHost().equals(s.getHost())
                || !String.valueOf(l.getScheme()).equals(s.getScheme())) return false;
        open(link);
        return true;
    }

    private String savedUrl() {
        return getSharedPreferences(PREFS, MODE_PRIVATE).getString(KEY_URL, null);
    }

    private void startScan() {
        ScanOptions options = new ScanOptions()
                .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
                .setPrompt("Scan the code from Connect tablet in Math Studio")
                .setBeepEnabled(false)
                .setOrientationLocked(false);
        startActivityForResult(options.createScanIntent(this), SCAN_REQUEST);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != SCAN_REQUEST || resultCode != RESULT_OK || data == null) return;
        String text = data.getStringExtra(Intents.Scan.RESULT);
        if (text != null) accept(text.trim());
    }

    // Accepts a PC pairing link (http://<pc>:<port>/?pair=<token>), a sign-in code from a server
    // (https://<server>/auth/link?token=...), or a server address typed by hand.
    private void accept(String text) {
        if (!text.contains("://")) text = "https://" + text;
        Uri u = Uri.parse(text);
        boolean web = ("http".equals(u.getScheme()) || "https".equals(u.getScheme())) && u.getHost() != null;
        if (!web) {
            Toast.makeText(this, "That is not a Math Studio code or address.", Toast.LENGTH_LONG).show();
            return;
        }
        boolean pairing = u.getQueryParameter("pair") != null;
        // Remember the server itself, not a one-time sign-in link.
        String home = pairing ? text : u.buildUpon().path("/").clearQuery().fragment(null).build().toString();
        SharedPreferences.Editor e = getSharedPreferences(PREFS, MODE_PRIVATE).edit();
        e.putString(KEY_URL, home).apply();
        open(pairing || !"/auth/link".equals(u.getPath()) ? home : text);
    }

    private void open(String url) {
        if (url == null) return;
        message.setText("Connecting to the PC…");
        retry.setVisibility(View.GONE);
        web.loadUrl(url);
    }

    private void showCanvas() {
        pairView.setVisibility(View.GONE);
        web.setVisibility(View.VISIBLE);
        hideSystemBars();
    }

    private void showPairing(String text, boolean canRetry) {
        web.setVisibility(View.GONE);
        pairView.setVisibility(View.VISIBLE);
        if (text != null) message.setText(text);
        retry.setVisibility(canRetry ? View.VISIBLE : View.GONE);
    }

    private void hideSystemBars() {
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.systemBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && web.getVisibility() == View.VISIBLE) hideSystemBars();
    }

    @Override
    public void onBackPressed() {
        if (web.getVisibility() != View.VISIBLE) {
            super.onBackPressed();
            return;
        }
        new AlertDialog.Builder(this)
                .setTitle("Math Studio")
                .setItems(new String[]{"Reload", "Scan a new QR code", "Exit"}, (d, which) -> {
                    if (which == 0) web.reload();
                    else if (which == 1) startScan();
                    else finish();
                })
                .show();
    }
}
