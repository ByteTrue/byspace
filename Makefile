# Go 侧构建入口。前端仍由 npm workspace 构建，两者分工：
#   make build       → 编译单二进制（用 internal/webui/dist 里现有的资产）
#   make build-full  → 打前端 + embed + 单二进制（唯一交付物）
#
# 版本号只有 package.json 一处来源，发布脚本用同一份版本写进 ldflags。
#
# 布局遵循 Go 项目惯例：cmd/<binary>/main.go 是入口，internal/ 是私有实现。
# 参考 coder/coder（cmd + site）、go-gitea/gitea（cmd + web_src）、pocketbase（cmd + ui）。

VERSION ?= $(shell node -p "require('./package.json').version" 2>/dev/null || echo dev)
LDFLAGS := -s -w -X main.version=$(VERSION)
BINARY  := bin/byspace

.PHONY: build build-web build-full test vet clean

## build: 编译单二进制（用 internal/webui/dist 里现有的资产）
build:
	CGO_ENABLED=0 go build -ldflags "$(LDFLAGS)" -o $(BINARY) ./cmd/byspace

## build-web: 导出 Expo Web，预压缩资产直接写进 internal/webui/dist 供 //go:embed
build-web:
	npm run build:daemon-web-ui
	find internal/webui/dist/_expo -name "*.js" -size +1M -delete
	touch internal/webui/dist/.keep

## build-full: 打前端并嵌入单二进制
build-full: build-web build

## test: Go 单元与集成测试
test:
	go test ./...

## vet: 静态检查
vet:
	go vet ./...

## clean: 清掉构建产物
clean:
	rm -f $(BINARY)
	rm -rf internal/webui/dist/*
	touch internal/webui/dist/.keep
