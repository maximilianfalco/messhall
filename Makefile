.PHONY: install lint lint-js lint-types format format-check test check

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
