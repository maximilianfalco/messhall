# QA tape for the room store: the scripted run's steps, then read-only queries on its db and a refused write.
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

Type "pnpm -s messhall-dev store --data-dir $MESSHALL_HOME/store | sed -n 1,10p; echo exit $pipestatus[1]"
Sleep 500ms
Enter
Sleep 7s

Hide
Type "clear"
Enter
Show

Type `pnpm -s messhall-dev db "select name, presence, cursor, done from members" --data-dir $MESSHALL_HOME/store; echo exit $?`
Sleep 500ms
Enter
Sleep 3s

Type `pnpm -s messhall-dev db "select id, from_name, kind, mentions, text from messages" --data-dir $MESSHALL_HOME/store; echo exit $?`
Sleep 500ms
Enter
Sleep 3s

Type `pnpm -s messhall-dev db "delete from messages" --data-dir $MESSHALL_HOME/store; echo exit $?`
Sleep 500ms
Enter

Sleep 6s
