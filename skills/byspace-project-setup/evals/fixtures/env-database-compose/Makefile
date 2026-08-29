.PHONY: dev test db-up

dev:
	go run ./cmd/api

test:
	go test ./...

db-up:
	docker compose up -d db
