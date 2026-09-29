.PHONY: help install up down reset smoke logs test test-unit

help:            ## list targets
	@grep -E '^[a-z-]+:.*## ' Makefile | sed 's/:.*## /\t/'

install:         ## install locked npm dependencies for every package and service
	node scripts/install-dependencies.js

up:              ## create .env and keys if missing, build, start, wait for health
	@node scripts/setup-dev.js
	docker compose up -d --wait postgres redis
	docker compose exec -T postgres sh /docker-entrypoint-initdb.d/002_registry_role.sh
	docker compose exec -T postgres sh /docker-entrypoint-initdb.d/003_curriculum_role.sh
	docker compose up --build -d
	@echo "Waiting for services to become healthy..."
	@./scripts/wait-for-healthy.sh
	@echo "Platform is up."

down:            ## stop the stack (keeps data)
	docker compose down

reset:           ## delete all data volumes, then start again
	docker compose down -v
	$(MAKE) up

smoke:           ## end-to-end smoke test against the running stack
	./scripts/smoke.sh

logs:            ## follow all service logs
	docker compose logs -f

test:            ## full Sprint 1 gate in an isolated Compose project (Docker)
	python3 scripts/run-sprint1.py

test-unit:       ## component tests only; run make install first
	node scripts/generate-test-keys.js
	node scripts/run-unit-tests.js
