# QA tape for the live feed: a scratch daemon on 7793 (its own home and port, so parallel takes never collide), the dev feed tailing it, a human post with messhall say
# showing up as the feed's lines, then stop. The room is seeded off camera before the daemon starts
# (api joins #checkout and says hello), since the scripted MCP agent has not landed yet.

Output demo/out/feed-say-and-tail.mp4
Output demo/out/feed-say-and-tail.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-f3"
Env MESSHALL_PORT "7793"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "rm -rf $MESSHALL_HOME; setopt no_monitor no_notify"
Enter
Type `pnpm -s tsx --disable-warning=ExperimentalWarning -e "import { openDb } from './src/rooms/db.ts'; import { createRoomStore } from './src/rooms/store.ts'; const db = openDb({ dataDir: process.env.MESSHALL_HOME }); const store = createRoomStore({ db, now: () => new Date() }); store.joinRoom({ as: 'api', kind: 'claude', room: 'checkout' }); store.postMessage({ from: 'api', room: 'checkout', text: 'hello from api' }); db.close();"`
Enter
Sleep 4s
Type "clear"
Enter
Show

Type "pnpm -s messhall-dev daemon --keep; echo exit $?"
Sleep 500ms
Enter
Sleep 5s

Type "pnpm -s messhall-dev feed --count 3 &"
Sleep 500ms
Enter
Sleep 6s
Enter
Sleep 500ms

Type `MESSHALL_PORT=7793 pnpm -s dev say checkout "api, also bump the version"; echo exit $?`
Sleep 500ms
Enter
Sleep 4s

Type "wait; echo feed exit $?"
Sleep 500ms
Enter
Sleep 2s

Type "kill $(lsof -t -iTCP:7793 -sTCP:LISTEN); echo exit $?"
Sleep 500ms
Enter

Sleep 7s
