.PHONY: up down reset smoke logs test

# copies .env if missing, builds, starts everything, waits for health
up:
	@if [ ! -f .env ]; then cp .env.example .env; echo "Created .env from .env.example"; fi
	@./scripts/generate-dev-keys.sh
	docker compose up --build -d
	@echo "Waiting for services to become healthy..."
	@./scripts/wait-for-healthy.sh
	@echo "Platform is up."

down:
	docker compose down

reset:
	docker compose down -v
	$(MAKE) up

smoke:
	./scripts/smoke.sh

logs:
	docker compose logs -f

# runs the full Sprint 1 test suite
test:
	@echo "Running Sprint 1 tests..."
	@node scripts/run-unit-tests.js
