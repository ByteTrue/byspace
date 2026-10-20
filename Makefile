# Go 侧构建入口。Node 侧仍用 root package.json 的 npm scripts，二者互不影响：
#   make build-full  → 打前端 + embed + 单二进制（Go 版唯一交付物）
#   npm run dev      → Node daemon（现行发布版）
#
# 布局遵循 Go 项目惯例：cmd/<binary>/main.go 是入口，internal/ 是私有实现。
# 参考 coder/coder（cmd + site）、go-gitea/gitea（cmd + web_src）、pocketbase（cmd + ui）。

VERSION ?= 0.20.2-go
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
