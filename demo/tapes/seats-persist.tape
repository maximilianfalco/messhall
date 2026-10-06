# QA tape for seats that persist: a follow seat with a seat key gets the worker role, the scratch daemon restarts
# and the seat comes back as worker, then the seat is killed with -9, turns away and stays, a stranger with another
# key is refused the name, and the same key sits down again with its role. Scratch home and port 7798.

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Framerate 20

Output demo/out/seats-persist.mp4
Output demo/out/seats-persist.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-seats-persist"
Env MESSHALL_PORT "7798"

Hide
Type "rm -rf $MESSHALL_HOME /tmp/seats-web.fifo; setopt no_monitor no_notify; pnpm -s messhall-dev daemon --keep > /dev/null; alias members='pnpm -s messhall-dev room demo | sed -n 4,7p'; clear"
Enter
Sleep 6s
Show

Type "pnpm -s messhall-dev agent web --room demo --seat seat-web --follow --post-fifo /tmp/seats-web.fifo & seat=$!"
Sleep 500ms
Enter
Sleep 6s

Type "pnpm -s messhall-dev agent orchestrator --room demo --say '@web your role: worker' --assign web=worker > /dev/null; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@60s /exit 0/
Sleep 2s

Type "kill $(lsof -t -iTCP:7798 -sTCP:LISTEN); sleep 2; pnpm -s messhall-dev daemon --keep | grep health; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@90s /reconnected after/
Sleep 2s

Type "echo 'back after the restart' > /tmp/seats-web.fifo; sleep 1; members; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@30s /web .* worker .* active/
Sleep 3s

Hide
Type "clear"
Enter
Show

Type "pkill -9 -f 'seat seat-web --follow'; until members | grep -q 'worker *away'; do sleep 5; done; members; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@150s /worker +away/
Sleep 3s

Type "pnpm -s messhall-dev agent web --room demo --seat someone-else --say 'is this seat free?' | sed -n 1,2p; echo exit $pipestatus[1]"
Sleep 500ms
Enter
Wait+Screen@60s /name taken/
Sleep 3s

Type "pnpm -s messhall-dev agent web --room demo --seat seat-web --follow --post-fifo /tmp/seats-web.fifo > /dev/null & seat=$!"
Sleep 500ms
Enter
Sleep 6s

Type "echo 'back after the crash' > /tmp/seats-web.fifo; sleep 1; members; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@30s /web .* worker .* active/
Sleep 2s

Type "pnpm -s messhall-dev room demo | grep -E 'away|reconnected|back after'; echo exit $?"
Sleep 500ms
Enter
Sleep 10s

Hide
Type "pkill -f 'seat seat-web --follow'; kill $(lsof -t -iTCP:7798 -sTCP:LISTEN); rm -f /tmp/seats-web.fifo"
Enter
Sleep 1s
