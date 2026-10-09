# QA tape for test isolation: the suite runs with TMUX empty and its own TMUX_TMPDIR and MESSHALL_HOME, and a heal
# cut off by close logs nothing, so the real daemon log gains no "healing seats failed" line.

Output demo/out/tmux-died-tests-isolated.mp4
Output demo/out/tmux-died-tests-isolated.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-tmux-died-tests"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "unset MESSHALL_HOME; L=~/Library/Logs/messhall/daemon.log; clear"
Enter
Show

Type "grep -c 'healing seats failed' $L; echo exit $?"
Sleep 500ms
Enter
Sleep 2s

Type "pnpm -s vitest run test/isolation.test.ts test/daemon/server.test.ts test/flock 2>&1 | grep -E 'isolation|heal still|Tests '; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@120s /Tests(.|\n)*exit [0-9]/
Sleep 2s

Type "grep -c 'healing seats failed' $L; echo exit $?"
Sleep 500ms
Enter
Sleep 6s
