# QA tape for pane typing under launchd: with no utf-8 locale and no TMUX, tmux prints the ✳ of a claude title
# as `_`, so every pane read as not claude. With -u, as the daemon's tmux runner now passes, the ✳ comes through.

Output demo/out/pane-typing-locale.mp4
Output demo/out/pane-typing-locale.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-pane-typing-locale"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "clear"
Enter
Show

Type "env -i HOME=$HOME PATH=/usr/bin:/bin /opt/homebrew/bin/tmux list-panes -a -F '#{session_name} #{pane_title}' | grep '^messhall-B' | head -3; echo exit $?"
Sleep 500ms
Enter
Sleep 3s
Type "env -i HOME=$HOME PATH=/usr/bin:/bin /opt/homebrew/bin/tmux -u list-panes -a -F '#{session_name} #{pane_title}' | grep '^messhall-B' | head -3; echo exit $?"
Sleep 500ms
Enter
Sleep 3s
Type "pnpm -s vitest run test/flock/tmux.test.ts -t 'no utf-8 locale' 2>&1 | grep -E '✓|×|Tests'; echo exit $?"
Sleep 500ms
Enter
Sleep 12s
