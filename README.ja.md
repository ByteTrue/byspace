<p align="center">
  <img src="packages/app/assets/images/icon.png" width="64" height="64" alt="BySpace logo">
</p>

<h1 align="center">BySpace</h1>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.ja.md">日本語</a>
</p>

<p align="center">
  <a href="https://github.com/ByteTrue/byspace/stargazers">
    <img src="https://img.shields.io/github/stars/ByteTrue/byspace?style=flat&logo=github" alt="GitHub stars">
  </a>
  <a href="https://github.com/ByteTrue/byspace/releases">
    <img src="https://img.shields.io/github/v/release/ByteTrue/byspace?style=flat&logo=github" alt="GitHub release">
  </a>
</p>

<p align="center">Claude Code、Codex、Copilot、OpenCode、Pi のエージェントを、ひとつのインターフェースで。</p>

---

自分のマシンでエージェントを並列実行。スマートフォンからでもデスクからでも、開発を進めてリリースできます。

- **セルフホスト:** エージェントはあなたのマシン上で動作し、完全な開発環境を使用します。自分のツール・設定・スキルをそのまま活用できます。
- **マルチプロバイダー:** Claude Code、Codex、Copilot、OpenCode、Pi を同一のインターフェースで利用。タスクに合ったモデルを選べます。
- **音声コントロール:** 音声モードでタスクを口述したり問題を話し合ったりできます。ハンズフリーが必要なときに便利です。
- **クロスデバイス:** ブラウザ Web/PWA と CLI に対応。机で作業を始め、スマートフォンのブラウザで確認し、ターミナルから自動化できます。
- **プライバシー優先:** BySpace にはテレメトリー・トラッキング・強制ログインは一切ありません。

## はじめかた

BySpace はコーディングエージェントを管理するローカルサーバー（デーモン）を起動します。ホストされた Web アプリと CLI がこのデーモンに接続します。

### 前提条件

エージェント CLI をひとつ以上インストールし、認証情報を設定しておく必要があります。

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code)
- [Codex](https://github.com/openai/codex)
- [GitHub Copilot](https://github.com/features/copilot/cli/)
- [OpenCode](https://github.com/anomalyco/opencode)
- [Pi](https://pi.dev)

### CLI / ヘッドレス

Stable チャンネルをインストールまたは更新します。

```bash
npm install -g @bytetrue/byspace@latest
byspace
```

最新の Beta チャンネルをインストールまたは更新します。

```bash
npm install -g @bytetrue/byspace@beta
byspace
```

デーモンがすでに動作中の場合は、チャンネルの切り替えまたは更新後に再起動します。

```bash
byspace daemon restart
byspace daemon status
```

ターミナルには対応するチャンネルのペアリングリンクが表示されます。Stable は npm `latest`、[byspace.pages.dev](https://byspace.pages.dev)、`byspace-relay` を使用し、Beta は npm `beta`、[byspace-beta.pages.dev](https://byspace-beta.pages.dev)、`byspace-relay-beta` を使用します。

詳しいセットアップと設定については以下を参照してください。

- [ドキュメント](https://byspace.pages.dev/docs)
- [設定リファレンス](https://byspace.pages.dev/docs/configuration)

## CLI

アプリでできることはすべてターミナルからも実行できます。

```bash
byspace run --provider claude/opus-4.6 "implement user authentication"
byspace run --provider codex/gpt-5.4 --worktree feature-x "implement feature X"

byspace ls                           # 実行中のエージェントを一覧表示
byspace attach abc123                # ライブ出力をストリーミング
byspace send abc123 "also add tests" # 追加タスクを送信

# リモートデーモンで実行
byspace --host workstation.local:6777 run "run the full test suite"
```

詳細は[完全な CLI リファレンス](https://byspace.pages.dev/docs/cli)を参照してください。

## スキル

スキルはエージェントに BySpace を使って他のエージェントをオーケストレーションする方法を教えます。

```bash
npx skills add ByteTrue/byspace
```

どのエージェントとの会話でも使用できます。

- `/byspace-handoff` — エージェント間で作業を引き継ぎます。私はこれを使って Claude で計画し、Codex に実装を引き継いでいます。
- `/byspace-loop` — 明確な受け入れ基準に沿ってエージェントをループさせます（Ralph loops とも呼ばれます）。検証役を追加することもできます。
- `/byspace-advisor` — 単一のエージェントをアドバイザーとして起動し、作業を委任せずにセカンドオピニオンを得ます。
- `/byspace-committee` — 対照的な2つのエージェントで委員会を構成し、一歩引いた視点で根本原因を分析して計画を作成します。

## 開発

モノレポのパッケージ構成：

- `packages/server`: BySpace デーモン（エージェントプロセスのオーケストレーション、WebSocket API、MCP サーバー）
- `packages/app`: ブラウザ Web/PWA クライアント（Expo + React Native Web）
- `packages/cli`: デーモンおよびエージェントワークフロー向け `byspace` CLI
- `packages/relay`: リモート接続用リレーパッケージ

メンテナー向けワークフローはリポジトリローカルのスキルとして定義されています。

- `upstream-sync` — 固定した Paseo リリーススナップショットからクリーンに再構築します。
- `release-beta` — npm、Web、Relay を一つの Beta チャンネルとしてリリースします。
- `release-stable` — Stable チャンネルをリリースまたは昇格します。
- `harden-byspace-release` — パッケージング、CI/CD、チャンネル分離、復旧を監査します。

よく使うコマンド：

```bash
# すべてのローカル開発サービスを起動
npm run dev

# 個別のサービスを起動
npm run dev:server
npm run dev:app

# サーバースタックをビルド
npm run build:server

# リポジトリ全体のチェック
npm run typecheck
```

---

<p align="center">
  <a href="https://star-history.com/#ByteTrue/byspace&Date">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=ByteTrue/byspace&type=Date&theme=dark">
      <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=ByteTrue/byspace&type=Date">
      <img src="https://api.star-history.com/svg?repos=ByteTrue/byspace&type=Date" alt="ByteTrue/byspace のスター履歴チャート" width="600" style="max-width: 100%;">
    </picture>
  </a>
</p>

## ライセンス

AGPL-3.0
