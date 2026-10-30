# Go 侧构建与全平台分发入口（对齐 Magpie 同构单入口 + -tags nogui 分离 + 二进制直发）：
#   make build                 → 编译无头单二进制（-tags nogui, CGO_ENABLED=0，供 CLI / Daemon / Docker 使用）
#   make build-app             → 编译带 Wails v3 桌面 GUI 的单二进制（macOS / Windows / Linux）
#   make app                   → 打包 macOS BySpace.app bundle 及 dist/byspace-darwin-<arch>.zip
#   make dmg                   → 打包 macOS dist/byspace-darwin-<arch>.dmg 安装镜像
#   make build-android         → 编译 libwails.so (android/arm64) 并打包侧载 APK (bin/byspace-android-arm64.apk)
#   make release-cli           → 交叉编译全平台 CLI 二进制 (dist/byspace-cli-<os>-<arch>)
#   make release-windows       → 交叉编译 Windows Wails v3 桌面客户端 (dist/byspace-windows-<arch>.exe)
#   make release-linux-desktop → 在 Linux 宿主上编译 Wails v3 桌面客户端 (dist/byspace-linux-<arch>)
#   make checksums             → 生成 dist/SHA256SUMS

VERSION    ?= $(shell node -p "require('./package.json').version" 2>/dev/null || echo dev)
GOARCH     ?= $(shell go env GOARCH)
LDFLAGS    := -s -w -X main.version=$(VERSION) -X github.com/ByteTrue/byspace/internal/cli.DefaultVersion=$(VERSION)
BINARY     := bin/byspace
APP_BINARY := bin/byspace-app
CLI_TARGETS := darwin/arm64 darwin/amd64 linux/amd64 linux/arm64 windows/amd64 windows/arm64 android/arm64

ifeq ($(shell uname -s),Darwin)
  export CGO_CFLAGS  = -mmacosx-version-min=13.0
  export CGO_LDFLAGS = -mmacosx-version-min=13.0
endif

.PHONY: build build-app app dmg build-android release-cli release-windows release-linux-desktop checksums build-web build-full test vet clean

## build: 编译无头单二进制（-tags nogui，零 CGO）
build:
	CGO_ENABLED=0 go build -tags nogui -trimpath -ldflags "$(LDFLAGS)" -o $(BINARY) .

## build-app: 编译带 Wails v3 桌面客户端的单二进制
build-app:
	CGO_ENABLED=1 GOARCH=$(GOARCH) go build -trimpath -ldflags "$(LDFLAGS)" -o $(APP_BINARY) .

## app: 构建 macOS BySpace.app bundle 并打包 dist/byspace-darwin-$(GOARCH).zip
app: build-app
	@rm -rf BySpace.app build/darwin/BySpace.iconset
	@mkdir -p BySpace.app/Contents/MacOS BySpace.app/Contents/Resources build/darwin/BySpace.iconset dist
	@cp $(APP_BINARY) BySpace.app/Contents/MacOS/byspace
	@for s in 16 32 128 256 512; do \
		sips -z $$s $$s internal/gui/icon.png --out build/darwin/BySpace.iconset/icon_$${s}x$${s}.png >/dev/null 2>&1; \
		sips -z $$((s*2)) $$((s*2)) internal/gui/icon.png --out build/darwin/BySpace.iconset/icon_$${s}x$${s}@2x.png >/dev/null 2>&1; \
	done
	@iconutil -c icns build/darwin/BySpace.iconset -o BySpace.app/Contents/Resources/BySpace.icns && rm -rf build/darwin/BySpace.iconset
	@sed 's/@VERSION@/$(VERSION)/g' build/darwin/Info.plist > BySpace.app/Contents/Info.plist
	@ditto -c -k --sequesterRsrc --keepParent BySpace.app dist/byspace-darwin-$(GOARCH).zip
	@echo "● Built BySpace.app and dist/byspace-darwin-$(GOARCH).zip"

## dmg: 构建 macOS dist/byspace-darwin-$(GOARCH).dmg 安装镜像
dmg: app
	@rm -rf build/darwin/dmg dist/byspace-darwin-$(GOARCH).dmg
	@mkdir -p build/darwin/dmg dist
	@cp -R BySpace.app build/darwin/dmg/
	@ln -s /Applications build/darwin/dmg/Applications
	@hdiutil create -volname BySpace -srcfolder build/darwin/dmg -ov -format UDZO dist/byspace-darwin-$(GOARCH).dmg >/dev/null
	@rm -rf build/darwin/dmg
	@echo "● Built dist/byspace-darwin-$(GOARCH).dmg"

## build-android: 编译 Wails v3 Android 侧载客户端 APK (bin/byspace-android-arm64.apk)
build-android:
	VERSION="$(VERSION)" bash ./build/android/build.sh
	@mkdir -p dist && cp bin/byspace-android-arm64.apk dist/byspace-android-arm64.apk

## release-cli: 交叉编译全平台无头 CLI 二进制到 dist/
release-cli:
	@mkdir -p dist
	@for t in $(CLI_TARGETS); do \
		os=$${t%/*}; arch=$${t#*/}; ext=""; [ $$os = windows ] && ext=.exe; \
		echo "  $$os/$$arch (cli)"; \
		CGO_ENABLED=0 GOOS=$$os GOARCH=$$arch go build -tags nogui -trimpath -ldflags="$(LDFLAGS)" -o dist/byspace-cli-$$os-$$arch$$ext . || exit 1; \
	done

WINVER = $(shell echo $(VERSION) | sed -E 's/^v//; s/[^0-9.].*//')

## release-windows: 交叉编译 Windows Wails v3 桌面客户端到 dist/ (含 PE 图标/版本/DPI Manifest)
release-windows:
	@mkdir -p dist
	@go run github.com/tc-hib/go-winres@v0.3.3 make --in build/windows/winres.json --arch amd64,arm64 --out rsrc \
		--file-version "$(or $(WINVER),0.0.0)" --product-version "$(or $(WINVER),0.0.0)"
	@for arch in amd64 arm64; do \
		echo "  windows/$$arch (desktop app)"; \
		CGO_ENABLED=0 GOOS=windows GOARCH=$$arch go build -trimpath -ldflags="$(LDFLAGS) -H windowsgui" -o dist/byspace-windows-$$arch.exe . || exit 1; \
	done; rm -f rsrc_windows_*.syso

## release-linux-desktop: 在 Linux 宿主上编译 Wails v3 桌面客户端 (需 libgtk-3-dev libwebkit2gtk-4.1-dev)
release-linux-desktop:
	@mkdir -p dist
	CGO_ENABLED=1 GOOS=linux GOARCH=$(GOARCH) go build -trimpath -ldflags="$(LDFLAGS)" -o dist/byspace-linux-$(GOARCH) .
	@echo "● Built dist/byspace-linux-$(GOARCH)"

## checksums: 生成 dist/SHA256SUMS
checksums:
	@cd dist && (command -v sha256sum >/dev/null 2>&1 && sha256sum byspace-* || shasum -a 256 byspace-*) > SHA256SUMS

## build-web: 导出 Expo Web，预压缩资产直接写进 internal/webui/dist 供 //go:embed
build-web:
	npm run build:daemon-web-ui
	find internal/webui/dist/_expo -name "*.js" -size +1M -delete
	touch internal/webui/dist/.keep

## build-full: 打前端并嵌入单二进制
build-full: build-web build

## test: Go 单元与集成测试（默认 -tags nogui 无头快速测试）
test:
	go test -tags nogui ./...

## vet: 静态检查
vet:
	go vet -tags nogui ./...

## clean: 清掉构建产物
clean:
	rm -rf $(BINARY) $(APP_BINARY) bin/byspace-android-arm64.apk BySpace.app rsrc_windows_*.syso dist
	rm -rf internal/webui/dist/*
	touch internal/webui/dist/.keep
