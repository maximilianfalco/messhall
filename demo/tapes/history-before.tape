# QA tape for older pages: a scratch daemon on 7770 with its own home, a room with twelve posts, then the latest
# page, the page just below its first id with before, and before and after together refused.

Output demo/out/history-before.mp4
Output demo/out/history-before.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-history"
Env MESSHALL_PORT "7770"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type@1ms `rm -rf $MESSHALL_HOME; setopt no_monitor no_notify; pnpm -s messhall-dev daemon --keep > /dev/null && pnpm -s dev room new long > /dev/null && for i in {1..12}; do pnpm -s dev say long "post $i" > /dev/null; done; page() { curl -s -H "x-messhall-key: $(cat $MESSHALL_HOME/human-key)" "http://127.0.0.1:$MESSHALL_PORT/api/rooms/long/messages?$1" "${@:2}"; }; clear`
Enter
Sleep 25s
Show

Type "page 'limit=4' | jq -c '.messages[] | [.id, .text]'; echo exit $pipestatus[1]"
Sleep 500ms
Enter
Sleep 3s

Type "page 'before=9&limit=4' | jq -c '.messages[] | [.id, .text]'; echo exit $pipestatus[1]"
Sleep 500ms
Enter
Sleep 3s

Type "page 'before=5&limit=200' | jq -c '.messages[] | [.id, .text]'; echo exit $pipestatus[1]"
Sleep 500ms
Enter
Sleep 3s

Type `page 'after=1&before=9' -w ' http %{http_code}\n'; echo exit $?`
Sleep 500ms
Enter
Sleep 3s

Sleep 7s

Hide
Type "kill $(lsof -t -iTCP:7770 -sTCP:LISTEN)"
Enter
Sleep 1s
