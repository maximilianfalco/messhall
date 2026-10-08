# QA tape for taking back a post: edit_post and remove_post are listed, then the store and tool tests run
# (replace the text, the 5 minute window, taken back reads, no second ring, search follows the edit).

Output demo/out/edit-post.mp4
Output demo/out/edit-post.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-edit-post"

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms

Hide
Type "rm -rf $MESSHALL_HOME; clear"
Enter
Show

Type "pnpm -s messhall-dev mcp | grep -A1 -E '^(edit_post|remove_post)'; echo exit $pipestatus[1]"
Sleep 500ms
Enter
Sleep 4s

Type `pnpm -s messhall-dev mcp --tool edit_post --as api --room demo --input '{"room":"demo","text":"hold off"}'; echo exit $?`
Sleep 500ms
Enter
Sleep 4s

Hide
Type "clear"
Enter
Show

Type "pnpm -s vitest run test/rooms/editPost.test.ts test/mcp/editPost.test.ts --reporter verbose 2>&1 | grep -E '✓|×|Tests'; echo exit $pipestatus[1]"
Sleep 500ms
Enter
Sleep 8s

Sleep 8s
