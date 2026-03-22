.PHONY: help build setup test verify run stop restart logs bootstrap-ceo dev-up dev-down dev-logs shell

COMPOSE ?= docker compose
APP_SERVICE ?= app
RUNTIME_SERVICES ?= db server
ALL_RUNTIME_SERVICES ?= db server server-dev
BASE_URL ?= http://localhost:3100

help:
	@printf '%s\n' \
		'make build   - Build the contributor container image' \
		'make setup   - Install workspace dependencies in the container' \
		'make test    - Run typecheck, tests, and build in the container' \
		'make run     - Restore packaged Docker mode at http://localhost:3100' \
		'make bootstrap-ceo - Generate the first admin invite for the running Docker app stack' \
		'make dev-up  - Start hot-reload Docker dev mode on http://localhost:3100 using shared state' \
		'make dev-down - Stop the hot-reload Docker dev mode' \
		'make dev-logs - Follow hot-reload Docker dev mode logs' \
		'make stop    - Stop the app stack containers' \
		'make restart - Restart the app stack containers' \
		'make logs    - Follow app stack logs' \
		'make verify  - Build, install, then run the full verification path' \
		'make shell   - Open a shell in the contributor container'

build:
	$(COMPOSE) build $(APP_SERVICE)

setup:
	$(COMPOSE) run --rm $(APP_SERVICE) bin/setup-container

test:
	$(COMPOSE) run --rm $(APP_SERVICE) bin/test-container

run:
	$(COMPOSE) --profile dev stop server-dev
	$(COMPOSE) up -d --build $(RUNTIME_SERVICES)

bootstrap-ceo:
	BASE_URL=$(BASE_URL) ./bin/bootstrap-ceo

dev-up:
	./bin/dev-up

dev-down:
	$(COMPOSE) --profile dev stop server-dev

dev-logs:
	$(COMPOSE) --profile dev logs -f server-dev

stop:
	$(COMPOSE) --profile dev stop $(ALL_RUNTIME_SERVICES)

restart:
	$(COMPOSE) --profile dev restart $(ALL_RUNTIME_SERVICES)

logs:
	$(COMPOSE) --profile dev logs -f $(ALL_RUNTIME_SERVICES)

verify: build setup test

shell:
	$(COMPOSE) run --rm $(APP_SERVICE) sh
