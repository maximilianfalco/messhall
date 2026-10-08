# QA tape for the join prompt, live: a real Claude Code in tmux with the messhall dev channel runs
# /mcp__messhall__join dev. It joins #dev under its folder name, answers the doorbell test ring and says so.
# Scratch home and port 7862.

Output demo/out/join-prompt-channel.mp4
Output demo/out/join-prompt-channel.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-join-prompt-channel"
Env MESSHALL_PORT "7862"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "bash demo/tapes/join-prompt-setup.sh $MESSHALL_HOME 7862; clear"
Enter
Sleep 15s
Type "tmux new-session -d -s join-channel -c $(cat $MESSHALL_HOME/cwd) 'claude --mcp-config $MESSHALL_HOME/mcp.json --strict-mcp-config --dangerously-load-development-channels server:messhall --allowedTools mcp__messhall --debug-file $MESSHALL_HOME/channel.log'"
Enter
Sleep 15s
Type "tmux send-keys -t join-channel Down Enter; sleep 6; tmux send-keys -t join-channel Enter; sleep 12"
Enter
Sleep 25s
Type "clear"
Enter
Show

Type "tmux attach -t join-channel"
Enter
Sleep 3s
Type "/mcp__messhall__join dev"
Sleep 2s
Enter
Sleep 45s
Ctrl+B
Type "d"
Sleep 2s

Hide
Type "tmux kill-session -t join-channel; kill $(lsof -tiTCP:7862 -sTCP:LISTEN); echo exit $?"
Enter
Sleep 3s
