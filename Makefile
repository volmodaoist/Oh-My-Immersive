.DEFAULT_GOAL := help
.PHONY: help build test lint check install

# Export the raw value rather than interpolating a user path into shell code.
export OH_MY_IMMERSIVE_VAULT := $(value vault)

help:
	@node scripts/install.mjs --help

build:
	npm run build

test:
	npm test

lint:
	npm run lint

check:
	npm test
	npm run build
	npm run lint

install:
	node scripts/install.mjs
