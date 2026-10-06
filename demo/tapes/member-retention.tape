# QA tape for member retention: the scripted run drops an agent left for 5 minutes, the member table no longer has it
# while its posts keep their sender, then the store tests for clearing stale members.

Output demo/out/member-retention.mp4
Output demo/out/member-retention.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-member-retention"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "rm -rf $MESSHALL_HOME/store; mkdir -p $MESSHALL_HOME; clear"
Enter
Show

Type "pnpm -s messhall-dev store --data-dir $MESSHALL_HOME/store | sed -n 1,20p; echo exit $pipestatus[1]"
Sleep 500ms
Enter
Sleep 8s

Hide
Type "clear"
Enter
Show

Type "pnpm -s vitest run test/rooms/store.test.ts -t 'clearing stale members' --reporter verbose | grep -E 'stale|Tests'; echo exit $pipestatus[1]"
Sleep 500ms
Enter
Sleep 10s
