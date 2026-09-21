import sharp from "sharp";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(__dirname, "..");

// 导入单一事实来源的品牌矢量路径
const { BYSPACE_LOGO_PATH, BYSPACE_LOGO_VIEWBOX } =
  await import("../packages/app/src/components/icons/byspace-logo-path.ts");

const S = 1024;
const RX = 228; // 标准 App Icon 平滑圆角半径

/**
 * 构建基础 SVG 模板
 * @param {object} opts
 * @param {boolean} [opts.rounded=true] 是否带圆角背景 (false 为全出血全黑底)
 * @param {number} [opts.scale=1.0] 缩放比例 (maskable 安全区使用)
 * @param {"none" | "running" | "attention"} [opts.status="none"]
 */
function makeSvg({ rounded = true, scale = 1.0, status = "none" } = {}) {
  const bg = rounded
    ? `<rect width="${S}" height="${S}" rx="${RX}" fill="#000000"/>`
    : `<rect width="${S}" height="${S}" fill="#000000"/>`;

  let glyphTransform = "";
  if (scale !== 1.0) {
    const offset = ((1 - scale) * S) / 2;
    glyphTransform = `transform="translate(${offset.toFixed(1)}, ${offset.toFixed(1)}) scale(${scale.toFixed(4)})"`;
  }

  let badge = "";
  if (status === "running") {
    // 右下角 running 状态指示灯 (蓝)
    badge = `<circle cx="834" cy="834" r="176" fill="#3b82f6"/>`;
  } else if (status === "attention") {
    // 右下角 attention 状态指示灯 (绿)
    badge = `<circle cx="834" cy="834" r="176" fill="#22c55e"/>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${BYSPACE_LOGO_VIEWBOX}">
${bg}
<g ${glyphTransform}>
  <path d="${BYSPACE_LOGO_PATH}" fill="#FFFFFF"/>
</g>
${badge}
</svg>`;
}

async function renderPng(svgStr, size, outPath) {
  await sharp(Buffer.from(svgStr)).resize(size, size).png().toFile(outPath);
  console.log(`Generated: ${outPath} (${size}x${size})`);
}

async function main() {
  console.log("Generating BySpace icons from vector mark...");

  // 1. 标准圆角应用图标与大尺寸资产
  const appIconSvg = makeSvg({ rounded: true });
  await renderPng(appIconSvg, 1024, resolve(root, "packages/app/assets/images/icon.png"));
  await renderPng(appIconSvg, 512, resolve(root, "packages/app/public/pwa-icon-512.png"));
  await renderPng(appIconSvg, 192, resolve(root, "packages/app/public/pwa-icon-192.png"));
  await renderPng(
    appIconSvg,
    96,
    resolve(root, "packages/app/assets/images/notification-icon.png"),
  );

  // 2. 全出血 Apple Touch Icon (180x180, iOS 规范: 纯黑无透明圆角，避免黑色脏硬边)
  const appleTouchSvg = makeSvg({ rounded: false });
  await renderPng(appleTouchSvg, 180, resolve(root, "packages/app/public/apple-touch-icon.png"));

  // 3. PWA 自适应遮罩图标 Maskable (必须全出血全黑底，内容缩放至 ~82% 严格落在中央安全区内)
  const maskableSvg = makeSvg({ rounded: false, scale: 0.82 });
  await renderPng(maskableSvg, 512, resolve(root, "packages/app/public/pwa-maskable-512.png"));
  await renderPng(maskableSvg, 192, resolve(root, "packages/app/public/pwa-maskable-192.png"));

  // 4. Favicon 家族 (48x48 PNG + SVG)
  // none 状态
  const favNoneSvg = makeSvg({ rounded: true, status: "none" });
  await renderPng(favNoneSvg, 48, resolve(root, "packages/app/assets/images/favicon.png"));
  await renderPng(favNoneSvg, 48, resolve(root, "packages/app/assets/images/favicon-light.png"));
  await renderPng(favNoneSvg, 48, resolve(root, "packages/app/assets/images/favicon-dark.png"));
  writeFileSync(resolve(root, "packages/app/assets/images/favicon-light.svg"), favNoneSvg);
  writeFileSync(resolve(root, "packages/app/assets/images/favicon-dark.svg"), favNoneSvg);

  // running 状态 (右下角蓝点)
  const favRunningSvg = makeSvg({ rounded: true, status: "running" });
  await renderPng(
    favRunningSvg,
    48,
    resolve(root, "packages/app/assets/images/favicon-light-running.png"),
  );
  await renderPng(
    favRunningSvg,
    48,
    resolve(root, "packages/app/assets/images/favicon-dark-running.png"),
  );
  writeFileSync(
    resolve(root, "packages/app/assets/images/favicon-light-running.svg"),
    favRunningSvg,
  );
  writeFileSync(
    resolve(root, "packages/app/assets/images/favicon-dark-running.svg"),
    favRunningSvg,
  );

  // attention 状态 (右下角绿点)
  const favAttentionSvg = makeSvg({ rounded: true, status: "attention" });
  await renderPng(
    favAttentionSvg,
    48,
    resolve(root, "packages/app/assets/images/favicon-light-attention.png"),
  );
  await renderPng(
    favAttentionSvg,
    48,
    resolve(root, "packages/app/assets/images/favicon-dark-attention.png"),
  );
  writeFileSync(
    resolve(root, "packages/app/assets/images/favicon-light-attention.svg"),
    favAttentionSvg,
  );
  writeFileSync(
    resolve(root, "packages/app/assets/images/favicon-dark-attention.svg"),
    favAttentionSvg,
  );

  // 5. README.md 顶层 Logo (assets/logo.svg)
  // 带圆角黑底卡片，确保在 GitHub 浅色和深色主题下都完美可见
  writeFileSync(resolve(root, "assets/logo.svg"), appIconSvg);
  console.log("Generated: assets/logo.svg");

  console.log("All BySpace icon assets generated successfully!");
}

main().catch((err) => {
  console.error("Icon generation failed:", err);
  process.exit(1);
});
