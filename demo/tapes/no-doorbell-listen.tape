# QA tape for the no-doorbell join text: shows the new text a plain claude reads, and the test that pins it.
# Scratch home only, no daemon.

Output demo/out/no-doorbell-listen.mp4
Output demo/out/no-doorbell-listen.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-no-doorbell-listen"

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

Type "pnpm -s tsx -e \"import {DOORBELL_OFF} from './src/mcp/constants.ts'; console.log(DOORBELL_OFF)\" | fold -s -w 110; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@60s /exit [0-9]/
Sleep 3s

Type "pnpm -s vitest run test/mcp/doorbellCheck.test.ts 2>&1 | tail -6; echo exit $?"
Sleep 500ms
Enter
Wait+Screen@120s /exit [0-9]+\n.*\n.*exit [0-9]/
Sleep 8s
