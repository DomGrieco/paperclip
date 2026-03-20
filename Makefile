.PHONY: help build setup test verify shell

COMPOSE ?= docker compose
APP_SERVICE ?= app

help:
	@printf '%s\n' \
		'make build   - Build the contributor container image' \
		'make setup   - Install workspace dependencies in the container' \
		'make test    - Run typecheck, tests, and build in the container' \
		'make verify  - Build, install, then run the full verification path' \
		'make shell   - Open a shell in the contributor container'

build:
	$(COMPOSE) build $(APP_SERVICE)

setup:
	$(COMPOSE) run --rm $(APP_SERVICE) bin/setup-container

test:
	$(COMPOSE) run --rm $(APP_SERVICE) bin/test-container

verify: build setup test

shell:
	$(COMPOSE) run --rm $(APP_SERVICE) sh
