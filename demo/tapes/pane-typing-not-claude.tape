# QA tape for pane typing into a pane that is not claude: a plain shell's title never shows claude idle or working,
# so nudge types nothing and exits 1.

Output demo/out/pane-typing-not-claude.mp4
Output demo/out/pane-typing-not-claude.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-pane-typing-not-claude"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "tmux new-session -d -s messhall-tape-shell zsh -f; clear"
Enter
Show

Type "tmux display-message -p -t messhall-tape-shell '#{pane_title}'; echo exit $?"
Sleep 500ms
Enter
Sleep 2s
Type "pnpm -s messhall-dev nudge messhall-tape-shell 'carry on'; echo exit $?"
Sleep 500ms
Enter
Sleep 8s
Type "tmux capture-pane -p -t messhall-tape-shell | grep -c 'carry on'; echo exit $?"
Sleep 500ms
Enter
Sleep 6s

Hide
Type "tmux kill-session -t messhall-tape-shell; clear"
Enter
