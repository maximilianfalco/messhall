# QA tape for pane typing on a real Claude Code: the channel proof types its join prompt, then nudge pastes a long
# two line prompt with an ESC byte in it, and claude takes it as one message. Scratch home and port 7861.

Output demo/out/pane-typing-real-claude.mp4
Output demo/out/pane-typing-real-claude.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-pane-typing"
Env MESSHALL_PORT "7861"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "rm -rf $MESSHALL_HOME /tmp/messhall-tape-pane-typing.txt; clear"
Enter
Show

Type "pnpm -s messhall-dev channel --room checkout --as web --keep > /tmp/messhall-tape-pane-typing.txt; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@240s /exit [0-9]/
Sleep 1s
Type "grep -E 'prompt|post to reply|replied' /tmp/messhall-tape-pane-typing.txt; echo exit $?"
Sleep 500ms
Enter
Sleep 4s

Hide
Type "clear"
Enter
Show

Type `pnpm -s messhall-dev nudge messhall-channel-7861 $'this line is long on purpose, so it goes in as one bracketed paste and not as typed keys.\nsecond line. reply only with how many lines this message has, and any odd text you see.\e[2J'; echo exit $?`
Sleep 500ms
Enter
Wait+Screen@30s /exit [0-9]/
Sleep 8s
Type "tmux capture-pane -p -t messhall-channel-7861 | grep -v '^\s*$' | tail -12; echo exit $?"
Sleep 500ms
Enter
Sleep 8s

Hide
Type "tmux kill-session -t messhall-channel-7861; lsof -ti tcp:7861 | xargs kill; clear"
Enter
Sleep 2s
