# The Immortal Knight — Online PvP Server

Authoritative WebSocket server for the 1v1 online PvP mode. The server owns all match state:
HP, mana, positions, timing, hit resolution, winner/loser and rematch state. Clients only send
key input and draw what the server sends back. There is no local-only or fake multiplayer.

## Requirements

- Node.js 18 or newer
- npm
- A host that accepts WebSocket traffic (VPS, Render, Railway, Fly.io, or similar)

## Install and run

```bash
cd pvp-server
npm install          # installs the single dependency: ws
npm start            # listens on PORT (default 8080)
```

Environment variables:

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | TCP port the HTTP/WebSocket server listens on |
| `ALLOWED_ORIGINS` | empty (any origin) | Comma-separated list of page origins allowed to connect, e.g. `https://yourgame.example` |

Health check: `GET /health` returns a small JSON status.

## Public address (TLS is required for hosted games)

Browsers and Android WebView block plain `ws://` from an `https://` page. Put the server behind a
TLS-terminating proxy (Caddy, nginx, or the platform's built-in HTTPS) and give players the
`wss://` address, for example `wss://pvp.yourdomain.example`.

Minimal Caddy example:

```
pvp.yourdomain.example {
    reverse_proxy 127.0.0.1:8080
}
```

Caddy forwards WebSocket upgrades automatically. For nginx, add `proxy_set_header Upgrade $http_upgrade;`
and `proxy_set_header Connection "upgrade";` to the location block.

## Connecting from the game

1. Open the game and choose **ÇEVRİMİÇİ PvP**.
2. Enter the server address (`wss://…` or `ws://127.0.0.1:8080` for local testing).
3. **ODA KUR** creates a room and shows a 6-digit code. The second player enters that code with **KATIL**.
4. Both players pick a character and weapon, then press ready. The server runs the countdown and the fight.

The server address is the only value the client stores (browser `localStorage`). Match data is never stored on the client.

## Tests

```bash
npm test             # 19 real-WebSocket checks + 600-message fuzz run
```

Browser tests (optional, need Playwright and Chromium; see `test/browser/`):

```bash
npm install --no-save playwright
CHROME_PATH=/path/to/chromium node test/browser/e2e.js /path/to/The_Immortal_Knight_FINAL_PvP.html ws://127.0.0.1:8080 ./out
CHROME_PATH=/path/to/chromium node test/browser/e2e_lost.js /path/to/The_Immortal_Knight_FINAL_PvP.html 8812 ./server.js ./out
CHROME_PATH=/path/to/chromium node test/browser/story_smoke.js /path/to/The_Immortal_Knight_FINAL_PvP.html
```

`e2e.js` and `e2e_audio.js` need a server already running on the given address (`e2e_audio.js` also needs
a Chromium that can decode AAC; see TEST_REPORT.md).

## Audio

The announcer recordings are embedded in `The_Immortal_Knight_FINAL_PvP.html` as base64 AAC.
The `audio/` folder contains the same AAC files for reference and for hosting if you prefer separate files.
`battleenterance.aac` from the ZIP is not part of the specification and is not included.

## Android WebView / APK

The game is a single HTML file, so it can be shipped as an asset of a WebView app.

1. Place `The_Immortal_Knight_FINAL_PvP.html` in `app/src/main/assets/`.
2. In `AndroidManifest.xml` add `<uses-permission android:name="android.permission.INTERNET" />`.
3. Configure the WebView:

```kotlin
webView.settings.apply {
    javaScriptEnabled = true          // required
    domStorageEnabled = true          // required for saved progress and the server address
    mediaPlaybackRequiresUserGesture = false  // announcer voices start from a user tap anyway
}
webView.loadUrl("file:///android_asset/The_Immortal_Knight_FINAL_PvP.html")
```

4. Use `wss://` for the server. Android 9+ blocks cleartext `ws://` by default; do not enable
   `usesCleartextTraffic` for a public release.
5. Build the APK with Android Studio (Build > Build Bundle(s) / APK(s) > Build APK(s)) and install on a device.

Not verified in this environment: no Android device or emulator was used for testing. Treat the APK steps as
untested until you run them on a device.
