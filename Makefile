VERSION ?= 0.20.2-go
LDFLAGS := -s -w -X main.version=$(VERSION)

.PHONY: build build-web build-full test clean

## build: Compile the single Go binary (uses whatever assets are currently in internal/webui/dist)
build:
	CGO_ENABLED=0 go build -ldflags "$(LDFLAGS)" -o bin/byspace .

## build-web: Export the Expo Web app and stage precompressed assets into internal/webui/dist for //go:embed
build-web:
	npm run build:daemon-web-ui
	rm -rf internal/webui/dist/*
	cp -R packages/server/dist/server/web-ui/. internal/webui/dist/
	find internal/webui/dist/_expo -name "*.js" -size +1M -delete
	touch internal/webui/dist/.keep

## build-full: Build the web UI and embed it into the single Go binary
build-full: build-web build

## test: Run all Go unit and integration tests
test:
	go test ./...

clean:
	rm -rf bin/byspace internal/webui/dist/*
	touch internal/webui/dist/.keep
