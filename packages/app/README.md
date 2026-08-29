# BySpace Web app

The only graphical BySpace client is the browser Web/PWA app. It uses Expo Router and React Native Web; package names containing `react-native` do not imply native iOS or Android support.

## Development

From the repository root:

```bash
npm run dev:app
```

Build the production Web export with:

```bash
npm run build:web --workspace=@bytetrue/byspace-app
```

The output is written to `packages/app/dist`. The same export is deployed to Cloudflare Pages and can be bundled into the daemon for self-hosting.
