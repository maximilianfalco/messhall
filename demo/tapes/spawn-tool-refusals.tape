# QA tape for the spawn tool: an orchestrator asking for another orchestrator, and a cwd that is not a folder,
# are refused with the next step and start nothing. Scratch home and port 7873.

Set Shell zsh
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Framerate 10

Output demo/out/spawn-tool-refusals.mp4
Output demo/out/spawn-tool-refusals.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-spawntoolrefusals"
Env MESSHALL_PORT "7873"

Hide
Type "rm -rf $MESSHALL_HOME; mkdir -p /tmp/messhall-tape-spawntool-api; pnpm -s messhall-dev daemon --keep > /dev/null; pnpm -s dev room new demo > /dev/null; clear"
Enter
Sleep 8s
Show

Type `pnpm -s tsx demo/tapes/spawn-tool-orchestrator.ts '{"room":"demo","name":"boss-2","role":"orchestrator","cwd":"/tmp/messhall-tape-spawntool-api"}'; echo exit $?`
Sleep 500ms
Enter
Wait+Screen@30s /exit [0-9]/
Sleep 2s

Type `pnpm -s tsx demo/tapes/spawn-tool-orchestrator.ts '{"room":"demo","name":"api","role":"worker","cwd":"/tmp/nope"}'; echo exit $?`
Sleep 500ms
Enter
Wait+Screen@30s /exit [0-9](.|\n)*exit [0-9]/
Sleep 2s

Type "pnpm -s dev flock; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@30s /exit [0-9](.|\n)*exit [0-9](.|\n)*exit [0-9]/
Sleep 6s

Hide
Type "kill $(lsof -t -iTCP:7873 -sTCP:LISTEN)"
Enter
Sleep 1s
