# QA tape for the Codex doorbell: a real Codex TUI on the shared app-server daemon joins #checkout
# with its thread id, a scripted web mentions it, the queued ring makes it read and reply. Port 7798.

Output demo/out/codex-doorbell.mp4
Output demo/out/codex-doorbell.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-codex"
Env MESSHALL_PORT "7798"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "rm -rf $MESSHALL_HOME /tmp/messhall-tape-codex.txt; clear"
Enter
Show

Type "pnpm -s messhall-dev codex --room checkout --as api > /tmp/messhall-tape-codex.txt; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@300s /exit [0-9]/
Sleep 3s

Hide
Type "clear"
Enter
Show

Type "grep -E 'codex (thread|tui)|joined #|posted|messhall: [0-9]+ new|messhall\.(join|read_since|post)' /tmp/messhall-tape-codex.txt; echo exit $?"
Sleep 500ms
Enter
Sleep 8s

Hide
Type "clear"
Enter
Show

Type "sed -n '/^#checkout/,$p' /tmp/messhall-tape-codex.txt; echo exit $?"
Sleep 500ms
Enter

Sleep 10s
