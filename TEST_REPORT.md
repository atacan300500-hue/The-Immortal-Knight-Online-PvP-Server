# The Immortal Knight — FINAL PvP Release: Test and Bug-Fix Report

## Scope of testing

All results below come from runs in this environment: a headless Chromium (Playwright), a real Node.js
server with real WebSocket clients, and the Chapter 3 story frame check. Each browser test used two
independent browser contexts (two players).

Not performed:
- No internet deployment was tested. The server was tested only on localhost.
- No Android device, emulator, or APK build was tested.
- AAC playback was not verified: the test Chromium cannot decode AAC ("Unable to decode audio data").
  The final HTML embeds the AAC files and decodes them with the Web Audio API. Real Chrome and Android
  WebView are expected to decode them, but this has not been confirmed. The announcer sequencing was
  verified on a copy of the build that uses WAV files with identical timing.

## Results

| Area | Test | Result |
|---|---|---|
| Server | 19 real-WebSocket checks (rooms, invalid codes, lobby, countdown, fight, KO, rematch, opponent leave) | 19/19 pass |
| Server | 600 malformed or mixed messages during a live fight | Server keeps responding; fight keeps running |
| Rooms | Create room, 6-digit code, wrong code rejected, second player joins | Pass |
| Selection | Character and weapon choices shown to both players | Pass |
| Countdown | Labels 1, 2, 3, START in order from server time | Pass |
| Combat sync | 183 of 183 shared ticks show identical HP on both clients | Pass |
| Combat | Hurt state, specials, spells, random input for ~400 snapshots | Pass, no page errors |
| Victory / defeat | Winner sees ZAFER, loser sees YENİLGİ | Pass |
| Rematch | Both return to lobby, new match starts, data reset | Pass |
| Disconnect (mid-fight) | Page closed during fight: remaining player wins with "Rakip oyundan ayrıldı." | Pass |
| Disconnect (after match) | Opponent leaves results screen: "Rakip ayrıldı." shown in lobby | Pass (after fix below) |
| Server stopped | Both clients show "BAĞLANTI KOPTU" | Pass |
| Audio sequence | Countdown plays once, entrance plays 4.5 s later, once, no duplicates on repeat events | Pass (WAV copy) |
| Audio critics | Random announcements, 9 s cooldown, no overlap, not during countdown or entrance | Pass (WAV copy) |
| Audio end | Winner gets one victory line, loser gets one defeat line, neither gets the other's | Pass (WAV copy) |
| Audio rematch | Countdown and entrance play once per new match | Pass (WAV copy) |
| Story mode | Menu → PvP → back; story run starts with no page errors | Pass (WAV and FINAL) |
| Story regression | Chapter 3 frozen-frame hash `9006:2313448843` | Matches the reference |
| Mobile layout | Landscape phone viewport 844×390: no horizontal scroll, lobby renders | Pass |
| Mobile portrait | Game shows its "rotate to landscape" screen (original behavior) | Expected |

## Bugs fixed in this release

1. **Undefined result function** in the result screen caused page errors. Renamed the calls to the defined function.
2. **Opponent-left notice not visible.** The notice was set after the waiting screen drew, and was cleared
   on draw, so a later redraw dropped it. It now stays until the player creates or joins a room, and clears
   when an opponent is present again.
3. **Simultaneous KO decided by array order.** The first lethal hit now records the winner on the server.
4. **Final KO snapshot missing.** The server now sends a snapshot after every fight step.
5. **Spawn points overlapped the bottom-right touch buttons.** Moved to x=170 (Kaelen) and x=290 (Vael).
6. **Server crash risk from room errors.** Each room tick is wrapped in try/catch and ends the room safely.
7. **Countdown timing.** Countdown uses server time (`countdownAt`) and the client applies a clock offset, so both players see the same countdown.
8. **Low-HP announcement lost.** The low-HP line was marked as used even when the random roll skipped it. It now retries on the next update until it plays.

## Known limitations

- Audio decoding (AAC) is unverified in headless Chromium.
- The internet deployment and Android APK path are untested.
- `npm install` could not be run in this sandbox because the npm registry was unreachable at the time of
  the final check. The server was run with `ws` 8.21.3 (within `^8.18.0`), and the test suite passed with it.
- The client source modules are embedded in the HTML and are not shipped separately.
