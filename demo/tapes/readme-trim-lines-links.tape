# QA tape for the short README: line count before and after, and every relative link in the readme and docs resolves

Output demo/out/readme-trim-lines-links.mp4
Output demo/out/readme-trim-lines-links.gif

Env MESSHALL_HOME "/tmp/messhall-tape-home-readme-trim"

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

Type "echo main; git --no-pager show origin/main:README.md | wc -l; echo branch; wc -l < README.md; echo exit $?"
Sleep 500ms
Enter
Sleep 3s

Type "clear"
Enter
Type "for f in README.md SETUP.md docs/*.md; do for l in $(grep -oE '[]][(][^)#: ]+' $f | cut -c3- | grep -v ^http); do [ -e $(dirname $f)/$l ] || echo missing $f $l; done; done; grep -c '^## Supported agents' docs/agents.md; echo exit $?"
Sleep 500ms
Enter
Sleep 5s
