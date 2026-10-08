# QA tape for the join prompt, live: a real Claude Code in tmux without the dev channel runs
# /mcp__messhall__join dev. Nothing can ring it, so the join says in one line this chat cannot be rung.
# Scratch home and port 7863.

Output demo/out/join-prompt-plain.mp4
Output demo/out/join-prompt-plain.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-join-prompt-plain"
Env MESSHALL_PORT "7863"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "bash demo/tapes/join-prompt-setup.sh $MESSHALL_HOME 7863; clear"
Enter
Sleep 15s
Type "tmux new-session -d -s join-plain -c $(cat $MESSHALL_HOME/cwd) 'claude --mcp-config $MESSHALL_HOME/mcp.json --strict-mcp-config --allowedTools mcp__messhall --debug-file $MESSHALL_HOME/plain.log'"
Enter
Sleep 15s
Type "tmux send-keys -t join-plain Down Enter; sleep 8"
Enter
Sleep 10s
Type "clear"
Enter
Show

Type "tmux attach -t join-plain"
Enter
Sleep 3s
Type "/mcp__messhall__join dev"
Sleep 2s
Enter
Sleep 75s
Ctrl+B
Type "d"
Sleep 2s

Hide
Type "tmux kill-session -t join-plain; kill $(lsof -tiTCP:7863 -sTCP:LISTEN); echo exit $?"
Enter
Sleep 3s
