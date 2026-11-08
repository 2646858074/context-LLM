.DEFAULT_GOAL := verify

GO ?= go
MACOS_BINARY := dist/context_llm_macos_amd64

.PHONY: verify fmt-check vet race test build build-all

verify: fmt-check vet race

fmt-check:
	@unformatted="$$(gofmt -l main.go internal)"; \
	if [ -n "$$unformatted" ]; then \
		echo "Go files need formatting:"; \
		echo "$$unformatted"; \
		exit 1; \
	fi

vet:
	$(GO) vet ./...

race:
	$(GO) test -race ./...

test:
	$(GO) test ./...

build:
	./build.sh

build-all:
	./build.sh all
