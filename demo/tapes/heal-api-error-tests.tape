# QA tape for an API error: reading the error off a pane, waiting while the API is down, one line per error, the
# stalled status and putting the seat's own status back.

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Framerate 20

Output demo/out/heal-api-error-tests.mp4
Output demo/out/heal-api-error-tests.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-heal-api-error-tests"

Hide
Type "clear"
Enter
Show

Type "pnpm -s vitest run test/flock/tmux.test.ts test/flock/spawner.test.ts --reporter verbose 2>&1 | grep -E '✓|×' | grep -E 'apiError|unsticking' | sed -E 's/test[^>]*> //; s/ [0-9]+ms$//' | cut -c1-118; echo exit $pipestatus[1]"
Sleep 500ms
Enter
Wait+Screen@60s /exit [0-9]/
Sleep 10s
