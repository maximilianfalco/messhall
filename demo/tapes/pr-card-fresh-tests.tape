# QA tape for fresh PR cards: the refresh pick per state, and a hung gh killed at the timeout while other reads run

Output demo/out/pr-card-fresh-tests.mp4
Output demo/out/pr-card-fresh-tests.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-pr-card-fresh"
Env DEVELOPER_DIR "/Applications/Xcode.app/Contents/Developer"

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

Type "bash app/scripts/slot.sh swift test --package-path app/Messhall --filter 'PullRequestRefreshTests|GHRunnerTests' 2>&1 | grep -E '✔ Test [a-z]|✘|Test run'; echo exit $?"
Sleep 500ms
Enter
Sleep 30s
