# Unistyles on Web

BySpace's browser UI uses React Native Web and [`react-native-unistyles` v3](https://www.unistyl.es/) for theme-aware styles. Follow these rules when adding or changing styles.

## `useUnistyles()` is banned in new code

Do not add `useUnistyles()` calls. Existing calls are migration debt, not examples to copy. The hook subscribes the component to every Unistyles runtime change and returns fresh values that defeat memo boundaries in frequently rendered trees.

Reviewers should reject new calls. Use these patterns instead:

1. `StyleSheet.create((theme) => ...)` for normal theme-aware styles.
2. `withUnistyles` for a leaf component's theme-aware non-`style` props.
3. Static constants or imports for values that are intentionally not theme-reactive.

If none fits, fix the ownership boundary rather than subscribing a larger component with the hook.

## Default: a style factory

Keep theme-dependent paint, typography, and spacing in a Unistyles factory:

```tsx
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

const styles = StyleSheet.create((theme) => ({
  container: {
    backgroundColor: theme.colors.surface0,
    padding: theme.spacing[4],
  },
}));

<View style={styles.container} />;
```

Do not import the compatibility `theme` value from `@/styles/theme` for live UI colors; it is a static dark-theme default. Imports such as `baseColors`, theme-name constants, and `type Theme` are fine when deliberately static or type-only.

Do not register an existing Unistyles style inside another `StyleSheet.create`. Reuse the original style directly:

```tsx
// Wrong: sharedStyles.row already has a registered identity.
const styles = StyleSheet.create({ row: sharedStyles.row });

// Right.
<View style={sharedStyles.row} />;
```

## Theme-aware leaf props

For icons and other leaf components whose color or tint is a regular prop, wrap the leaf with `withUnistyles` and pass a `uniProps` mapping:

```tsx
import { ChevronDown } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";

const ThemedChevronDown = withUnistyles(ChevronDown);
const mutedIconProps = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

<ThemedChevronDown size={16} uniProps={mutedIconProps} />;
```

Keep `withUnistyles` on leaves. On Web, wrapping layout containers can emit child-selector rules whose value-based class hashes collide with ordinary views. Put themed backgrounds on a normal wrapper `View`; keep `ScrollView.contentContainerStyle` focused on layout.

```tsx
<View style={styles.container}>
  <ScrollView contentContainerStyle={styles.content}>{children}</ScrollView>
</View>
```

## High-churn styles on Web

Unistyles turns ordinary style objects into CSS rules. Continuously changing values such as measured dimensions, pointer-driven positions, drag transforms, or scroll geometry can therefore grow `#unistyles-web` for the lifetime of the page.

Mark only the changing object with `inlineUnistylesStyle`:

```tsx
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";

const styles = StyleSheet.create({
  thumb: { position: "absolute" },
});

<View style={[styles.thumb, inlineUnistylesStyle({ height, transform: [{ translateY }] })]} />;
```

Ordinary styles remain Unistyles classes; the marked object stays inline. Use this escape hatch only for high-churn values. Do not introduce raw DOM wrappers unless the feature is genuinely DOM infrastructure.

Preserve registered style entries as arrays. Do not flatten caller-provided Unistyles styles and pass the combined object back to a React Native Web component: multiple `unistyles_*` metadata identities in one object trigger warnings. If a reusable component owns dynamic geometry, expose that geometry as a dedicated prop and apply the inline escape hatch inside the component. `FloatingSurface.frameStyle` in `packages/app/src/components/ui/floating.tsx` is the reference pattern.

## Runtime appearance updates

User font and syntax-theme preferences are applied centrally by `packages/app/src/screens/settings/appearance/apply-appearance.ts`, which patches every registered theme. Components should continue reading those values through style factories or `withUnistyles`; do not thread appearance settings through component props.

Parsed or memoized content that needs to repaint after those patches belongs under `packages/app/src/components/appearance-style-boundary.tsx`. High-churn appearance previews use `inlineUnistylesStyle` rather than generating a CSS rule for every draft value.

## Current reference files

| Pattern                                 | Reference                                                          |
| --------------------------------------- | ------------------------------------------------------------------ |
| Theme tokens and registered themes      | `packages/app/src/styles/theme.ts`                                 |
| Theme-aware style factory               | `packages/app/src/styles/settings.ts`                              |
| `withUnistyles` + `uniProps` leaf props | `packages/app/src/git/workspace-actions.tsx`                       |
| Web inline-style marker                 | `packages/app/src/styles/unistyles-inline-style.web.ts`            |
| Reusable dynamic-geometry seam          | `packages/app/src/components/ui/floating.tsx`                      |
| Central appearance patching             | `packages/app/src/screens/settings/appearance/apply-appearance.ts` |

## References

- [Unistyles v3 documentation](https://www.unistyl.es/)
- [`useUnistyles` reference](https://www.unistyl.es/v3/references/use-unistyles)
- [`withUnistyles` reference](https://www.unistyl.es/v3/references/with-unistyles)
- [Babel plugin](https://www.unistyl.es/v3/other/babel-plugin)
