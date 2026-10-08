# QA tape for the dmg shipping the room templates: dmg.sh copies the Templates folder, pinned by a test and checked in a real build.

Output demo/out/dmg-templates.mp4
Output demo/out/dmg-templates.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-dmg-templates"

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
Type "grep -n 'cp -R app/Messhall/Resources' app/scripts/dmg.sh; echo exit $?"
Enter
Sleep 2s
Type "pnpm -s vitest run test/app/dmgResources.test.ts 2>&1 | tail -6; echo exit $?"
Enter
Sleep 6s
Type "make dmg >/dev/null 2>&1; ls app/build/Messhall.app/Contents/Resources/Templates; echo exit $?"
Enter
Sleep 240s
Sleep 5s
