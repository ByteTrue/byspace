---
kind: issue
title: "Wails v3 Android 客户端：build/android 宿主、局域网明文 ws:// 放行与 APK 打包"
type: feature
created: 2026-10-29
---

# 003: Wails v3 Android 客户端：build/android 宿主、局域网明文 ws:// 放行与 APK 打包

## 目标与范围

基于 Wails v3（`v3.0.0`）的 Android 架构，从同一套 Go 代码与 `internal/webui/dist` 延伸出 Android 原生 APK：

1. **Android 运行时分支**：
   - `main_android.go`（`//go:build android && !nogui`）在 `init()` 中调用 `application.RegisterAndroidMain(main)`，无需外部 overlay 生成器即可直接通过 `go build -buildmode=c-shared` 编译出 `libwails.so`。
   - `runtime.GOOS == "android"` 时，`internal/gui.Run` 仅挂载 `webui.NewHandler("").WithoutPrecompression()` 到 Wails `AssetOptions.Handler`，不在手机端启动本地 `server.Server` daemon。
2. **局域网明文 `ws://` 直连与深链放行**：
   - `build/android/app/src/main/java/com/wails/app/MainActivity.java`：开启 `WebSettings.MIXED_CONTENT_ALWAYS_ALLOW`，并解析 `byspace://` 启动与 `onNewIntent` 深链转发至 `https://wails.localhost/#offer=...`；
   - `build/android/app/src/main/AndroidManifest.xml`：开启 `android:usesCleartextTraffic="true"` 与 `byspace://` VIEW `<intent-filter>`；
   - `packages/app/src/utils/test-daemon-connection.ts`：在 `readBrowserConnectionContext()` 中识别 `wails.localhost` 原生 WebView 宿主，放行从 `https://wails.localhost` 发起的非 TLS 局域网 Direct TCP (`ws://`) 连接。
3. **构建脚本与 Makefile 集成**：
   - `scripts/build-android.sh` 与 `make build-android`：使用 Android NDK 编译 `arm64-v8a/libwails.so` 并调用 Gradle 产出签名 APK `bin/byspace-android-arm64.apk`。

## 执行记录与验证

- **实现落点**：
  - `main_android.go`、`scripts/build-android.sh`、`build/android/**`
  - `packages/app/src/utils/test-daemon-connection.ts` & `packages/app/src/utils/test-daemon-connection.test.ts`
- **验证证据**：
  - `npx vitest run packages/app/src/utils/test-daemon-connection.test.ts --bail=1` 13/13 全绿。
  - `make build-android` 成功产出 `bin/byspace-android-arm64.apk`（30MB），通过 `apksigner verify`（v2 签名）与 `aapt2 dump badging`（`package: name='com.bytetrue.byspace'`）。
  - 在本机 Android 模拟器（`agent-phone`）中真实安装并启动 `com.bytetrue.byspace/com.wails.app.MainActivity`：
    1. 未连接主机时正常渲染 `Welcome to BySpace` 引导页（`/tmp/byspace-android-welcome.png`）；
    2. 连接宿主机隔离 Go Daemon 后正常渲染完整 Compact 工作台主页（`/tmp/byspace-android-connected.png`，`[JNI] page finished: https://wails.localhost/open-project`）。
