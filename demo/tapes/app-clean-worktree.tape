# QA tape for make app-clean in the pickup close step: from the main checkout, clean the scratch worktree's
# running build and remove the worktree, then show no process, no registration and a clean check.

Output demo/out/app-clean-worktree.mp4
Output demo/out/app-clean-worktree.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-app-clean"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "cd ../.. && L=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister && clear"
Enter
Show

Type "make -C .worktrees/f10-app-build-cleanup app-clean WORKTREE=$PWD/.worktrees/scratch-app-clean && git worktree remove .worktrees/scratch-app-clean; echo exit $?"
Sleep 500ms
Enter
Sleep 4s

Type "pgrep -f scratch-app-clean/app/build; echo exit $?"
Sleep 500ms
Enter
Sleep 2s

Type "$L -dump | grep -c scratch-app-clean; echo exit $?"
Sleep 500ms
Enter
Sleep 6s

Type "pnpm -s -C .worktrees/f10-app-build-cleanup messhall-dev check; echo exit $?"
Sleep 500ms
Enter
Sleep 16s
