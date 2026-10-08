# LINKFIRE (working title)

1v1 mobile shooter for two Android phones over a local Wi-Fi hotspot. No internet, server or account.
Core loop: **hotspot → join → loadout → 1v1 → 5 kills → rematch**.

## Build the APK (GitHub)
1. Create a new GitHub repo and push this folder to `main`.
2. Open **Actions → Build APK** (it also runs on every push). When it finishes, download the
   `linkfire-debug-apk` artifact, unzip it and install `app-debug.apk` on both phones.
Or open the folder in Android Studio and press Run.

## Play
1. Phone 1: turn on the Wi-Fi hotspot. Open the game → LOCAL MATCH → CREATE ROOM.
2. Phone 2: connect to that hotspot in Wi-Fi settings (if Android says "no internet", stay connected).
   Open the game → LOCAL MATCH → JOIN ROOM → CONNECT. It finds the host automatically.
   If it can't, type the "Room address" shown on phone 1 into the IP box.
3. Both pick a weapon + 2 abilities and tap READY. First to 5 kills wins (5 min max, tie = sudden death).

## Test on a PC without phones
Open `app/src/main/assets/index.html` in **two Chrome tabs**: tab 1 CREATE ROOM, tab 2 JOIN ROOM → CONNECT.
Keys: WASD move, mouse aim + click fire, R reload, Q swap weapon, 1/2 abilities.

## Where to change things
| What | File |
| --- | --- |
| Game name | `GAME_NAME` in `assets/js/data.js` and `app_name` in `res/values/strings.xml` |
| Weapons, abilities, rules, maps | `assets/js/data.js` (add a map = add an entry to `MAPS`) |
| Controls, HUD, match logic, networking logic | `assets/js/game.js` |
| Sockets (host/join/send) | `app/src/main/java/.../NetBridge.kt` |
| Colours / menus | `assets/css/style.css`, `assets/index.html` |

## How the networking works
- One TCP connection, newline-delimited JSON, TCP_NODELAY. Host listens on port 47821 (all interfaces,
  including the hotspot). The guest connects to the Wi-Fi gateway address, which is the host's hotspot IP.
- The app binds itself to the Wi-Fi network so Android doesn't send traffic over mobile data when the hotspot has no internet.
- Each phone owns its own movement/aim (~30 msgs/s). The **host decides** hits, damage, HP, shields,
  ability validity and cooldowns, deaths, respawns, score, timer and match state, and sends a ~30 Hz snapshot.
- Bullets are not streamed: a "fire" message (origin, angle, seed) lets both phones simulate the same bullets.
- Measured in simulation: ~4 KB/s host → guest, ~1.2 KB/s guest → host.
- Heartbeat every 1 s; no traffic for 4.5 s counts as a disconnect. The host's room stays open for a new opponent.

## Known limits of this first version
- Movement is trusted from each phone (fine between friends; not cheat-proof).
- If a player drops mid-match the match ends; there is no reconnect-and-resume yet.
- Cosmetics (skins, kill effects, emotes), extra maps and a map picker are not built yet; the data layout is ready for them.
- Not yet run on real hardware. The Kotlin was not compiled in my environment, so the first GitHub build is the real check.
