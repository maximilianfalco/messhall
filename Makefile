.PHONY: install lint lint-js lint-types format format-check test check app app-run app-test app-clean dmg

lint: ## Run all code standard checks
	pnpm exec concurrently --names "js,types,format-check" -c "auto" "make lint-js" "make lint-types" "make format-check"
lint-js: ## Run standards checks on all of our JS and TS code
	pnpm exec oxlint --config oxlint.config.ts .
lint-types: ## Verify that our codebase does not have any TS type issues
	pnpm exec tsc --noEmit
format-check: ## Run Oxfmt formatter check across JS/TS files
	pnpm exec oxfmt --config oxfmt.config.ts --check
format: ## Automatically fix linting and formatting issues across JS/TS files
	-pnpm exec oxlint --config oxlint.config.ts --fix
	pnpm exec oxfmt --config oxfmt.config.ts --write
test: ## Run the unit tests
	pnpm exec vitest run
check: lint test ## Run all code standards, lint checks and tests

## Build the CLI and link `messhall` onto your PATH (pnpm link --global).
install:
	@if [ ! -d .git ] && [ -z "$(FORCE)" ]; then \
		echo "make install from a worktree would repoint the global messhall. Run it from the main checkout, or FORCE=1 make install." >&2; exit 1; \
	fi
	pnpm build
	pnpm link --global
	@echo "messhall is on your PATH. Run make install again after pulling."

## The Mac app. Needs Xcode installed (not selected), see app/scripts/bundle.sh.
APP_ENV := $(if $(DEVELOPER_DIR),,$(if $(wildcard /Applications/Xcode.app),DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer,))
app: ## Build the Debug Mac app into app/build/Messhall.app, in one of 2 shared build slots
	bash app/scripts/slot.sh bash app/scripts/bundle.sh
app-run: app ## Build and launch the Mac app against MESSHALL_PORT (7707 by default)
	app/build/Messhall.app/Contents/MacOS/Messhall
app-clean: ## Quit a worktree's Mac app, unregister it and delete its app/build: make app-clean WORKTREE=.worktrees/<name>
	bash app/scripts/clean.sh $(WORKTREE)
app-test: ## Run the Mac app's Swift tests, in one of 2 shared build slots
	$(APP_ENV) bash app/scripts/slot.sh swift test --package-path app/Messhall
dmg: ## Build app/build/Messhall.dmg, a Release app that carries node and the messhall CLI
	bash app/scripts/slot.sh bash app/scripts/dmg.sh
