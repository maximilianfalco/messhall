# QA tape for role settings profiles: what each role may run, and the spawner passing
# docs/briefs/<role>.settings.json with --settings. No daemon, scratch home.

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Framerate 10

Output demo/out/role-permissions-profiles.mp4
Output demo/out/role-permissions-profiles.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-rolepermissions"

Hide
Type "clear"
Enter
Show

Type "cat docs/briefs/worker.settings.json docs/briefs/reviewer.settings.json; echo exit $?"
Sleep 500ms
Enter
Sleep 4s

Type "pnpm -s vitest run test/flock/spawner.test.ts test/docs/briefs.test.ts -t 'settings profile' 2>&1 | tail -4; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@60s /exit [0-9]/
Sleep 6s
