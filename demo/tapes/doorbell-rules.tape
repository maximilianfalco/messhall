# QA tape for the doorbell rules: a member active in the last 5 s gets a delayed ring, not none,
# and the Claude ringer drops the messhall lead. Tests only, scratch home and port 7790.

Output demo/out/doorbell-rules.mp4
Output demo/out/doorbell-rules.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-doorbell"
Env MESSHALL_PORT "7790"

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

Type "pnpm -s test test/doorbell test/channels --reporter verbose 2>&1 | grep -E 'delay|activeLately|active in the last|notification with|real client|Test Files|Tests '; echo exit $pipestatus[1]"
Sleep 500ms
Enter
Sleep 10s
