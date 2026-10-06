# QA tape for the room store: a scripted run on a scratch store, then a read-only query on its db.
# The store lives under the scratch MESSHALL_HOME, never the real data dir.

Output demo/out/store-scripted-run.mp4
Output demo/out/store-scripted-run.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "rm -rf $MESSHALL_HOME/store; clear"
Enter
Show

Type "pnpm -s messhall-dev store --data-dir $MESSHALL_HOME/store; echo exit $?"
Sleep 500ms
Enter
Sleep 9s

Hide
Type "clear"
Enter
Show

Type `pnpm -s messhall-dev db "select name, presence, cursor, done from members" --data-dir $MESSHALL_HOME/store; echo exit $?`
Sleep 500ms
Enter
Sleep 2s

Type `pnpm -s messhall-dev db "delete from messages" --data-dir $MESSHALL_HOME/store; echo exit $?`
Sleep 500ms
Enter

Sleep 6s
