.PHONY: up down reset smoke logs

# copies .env if it's missing, builds, starts everything, waits for health
up:
	@if [ ! -f .env ]; then cp .env.example .env; echo "Created .env from .env.example"; fi
	docker compose up --build -d
	@echo "Waiting for services to become healthy..."
	@./scripts/wait-for-healthy.sh
	@echo "Platform is up. Gateway: http://localhost:$${GATEWAY_PORT:-8080}  Console: http://localhost:$${CONSOLE_PORT:-4173}"

down:
	docker compose down

# tears down containers AND volumes, then boots clean
reset:
	docker compose down -v
	$(MAKE) up

smoke:
	./scripts/smoke.sh

logs:
	docker compose logs -f
