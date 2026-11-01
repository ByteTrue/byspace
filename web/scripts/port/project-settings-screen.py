"""Port packages/app's screens/project-settings-screen.tsx to web/src/overrides: one project's
settings (default host, isolation and base branch, the setup agent, worktree setup and teardown,
scripts and their edit modal, metadata prompts, save). Same logic, DOM + Tailwind view."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _port import Port  # noqa: E402

FIELD = "rounded-md border bg-muted px-3 py-2 text-sm leading-[normal] text-foreground placeholder:text-muted-foreground"

p = Port("screens/project-settings-screen.tsx")
p.rep('''import { Pressable, Text, View } from "react-native";
''', "")
p.rep('''import { StyleSheet } from "react-native-unistyles";
''', '''import { cn } from "cn";
''')
p.rep('from "lucide-react-native";', 'from "lucide-react";')

# NoEditableTarget / BackToProjectsButton
p.rep('''    <View style={styles.noTargetContainer}>
      {showBackToProjects ? <BackToProjectsButton onPress={onBackToProjects} /> : null}
      <Text style={styles.noTargetText}>{t("settings.project.noEditableTarget")}</Text>''',
      '''    <div className="flex flex-col items-start gap-3 p-4">
      {showBackToProjects ? <BackToProjectsButton onPress={onBackToProjects} /> : null}
      <span className="text-sm leading-[normal] text-muted-foreground">
        {t("settings.project.noEditableTarget")}
      </span>''')
p.rep('''      leftIcon={ArrowLeft}
      style={styles.backButton}''', '''      leftIcon={ArrowLeft}
      className="self-start px-0"''')

# Body header
p.rep('''    <View role="main" style={styles.body}>''', '''    <div role="main" className="flex flex-col gap-2 p-4">''')
p.rep('''      <View style={styles.headerBlock}>
        <View style={styles.titleRow}>''', '''      <div className="mt-2 mb-4 flex flex-col gap-2">
        <div className="flex flex-row items-center gap-3">''')
p.rep('''          <Text style={styles.projectTitle} numberOfLines={1}>
            {selectedHost.projectName}
          </Text>
          <Pressable
            testID="project-edit-button"
            accessibilityRole="button"
            accessibilityLabel={t("settings.project.edit.title")}
            onPress={openEditSheet}
            hitSlop={8}
            style={styles.editButton}
          >
            <Pencil size={ICON_SIZE} color={styles.iconColor.color} />
          </Pressable>''', '''          <span className="shrink truncate text-sm leading-[normal] font-medium text-foreground">
            {selectedHost.projectName}
          </span>
          <button
            type="button"
            data-testid="project-edit-button"
            aria-label={t("settings.project.edit.title")}
            onClick={openEditSheet}
            className="p-1 text-muted-foreground"
          >
            <Pencil size={ICON_SIZE} />
          </button>''')

# Loading states
p.rep('''      <View style={styles.centered}>
        <LoadingSpinner color={ResolveSpinnerColor()} />
      </View>''', '''      <div className="flex flex-1 flex-col items-center justify-center p-6 text-muted-foreground">
        <LoadingSpinner />
      </div>''', count=2)
p.rep('''function ResolveSpinnerColor(): string {
  return styles.spinnerColor.color;
}

''', "")
p.rep('''    <View style={styles.errorBlock}>''', '''    <div className="mt-2 flex flex-col">''')

# Scripts group trailing "+"
p.rep('''      <Pressable
        onPress={handleAddScript}
        hitSlop={8}
        style={settingsStyles.sectionHeaderLink}
        accessibilityRole="button"
        accessibilityLabel={t("settings.project.scripts.actions.add")}
        testID="scripts-add-button"
      >
        <Plus size={ICON_SIZE} color={styles.iconColor.color} />
      </Pressable>''', '''      <button
        type="button"
        onClick={handleAddScript}
        className={cn(settingsStyles.sectionHeaderLink, "text-muted-foreground")}
        aria-label={t("settings.project.scripts.actions.add")}
        data-testid="scripts-add-button"
      >
        <Plus size={ICON_SIZE} />
      </button>''')
p.rep('''    <View>
      <ProjectSetupAgentCard''', '''    <div className="flex flex-col">
      <ProjectSetupAgentCard''')
p.rep('''              <Text style={styles.emptyScripts}>{t("settings.project.scripts.empty")}</Text>''',
      '''              <span className="text-sm leading-[normal] text-muted-foreground">
                {t("settings.project.scripts.empty")}
              </span>''')
p.rep('''<View style={styles.calloutWrap}>''', '''<div className="mt-3 flex flex-col">''', count=3)
p.rep('''      <View style={styles.footer}>''', '''      <div className="mt-4 flex flex-row justify-end">''')

# Title icon
p.rep('''      textStyle={styles.titleIconFallbackText}''', '''      textStyle={TITLE_ICON_TEXT}''')

# Script row
p.rep('''  const rowStyle = isFirst ? styles.scriptRow : styles.scriptRowWithBorder;

  return (
    <View style={rowStyle} testID={`script-row-${script.id}`}>
      <Pressable style={styles.scriptRowMain} onPress={handleEdit}>
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {script.name || t("settings.project.scripts.untitled")}
        </Text>
        <Text style={settingsStyles.rowHint} numberOfLines={1}>
          {scriptHint(script, t)}
        </Text>
      </Pressable>''', '''  return (
    <div
      className={cn("flex flex-row items-center justify-between p-4", !isFirst && "border-t")}
      data-testid={`script-row-${script.id}`}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 flex-col gap-1 text-left"
        onClick={handleEdit}
      >
        <span className={cn(settingsStyles.rowTitle, "truncate")}>
          {script.name || t("settings.project.scripts.untitled")}
        </span>
        <span className={cn(settingsStyles.rowHint, "truncate")}>{scriptHint(script, t)}</span>
      </button>''')
p.rep('''          style={styles.scriptKebab}
        >
          <MoreVertical size={ICON_SIZE} color={styles.chevronColor.color} />''', '''          className="p-1 text-muted-foreground"
        >
          <MoreVertical size={ICON_SIZE} />''')

# Script edit modal
p.rep('''<View style={styles.modalSection}>''', '''<div className="flex flex-col gap-2">''', count=3)
p.rep('''<Text style={styles.modalLabel}>''', '''<span className="text-xs leading-[normal] text-muted-foreground">''', count=2)
p.rep('''          placeholderTextColor={styles.placeholderColor.color}
''', "", count=2)
p.rep('''          style={styles.modalInput}''', f'''          className="{FIELD}"''')
p.rep('''          style={styles.modalMultilineInput}''', f'''          className="min-h-[100px] {FIELD}"''')
p.rep('''style={styles.fieldError}''', '''className="text-xs leading-[normal] text-red-300"''', count=2)
p.rep('''        <View style={styles.serviceToggleRow}>
          <View style={styles.serviceToggleText}>
            <Text style={styles.serviceToggleLabel}>
              {t("settings.project.scripts.runAsService")}
            </Text>
            <Text style={styles.modalHint}>{t("settings.project.scripts.serviceHint")}</Text>
          </View>''', '''        <div className="flex flex-row items-center gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-sm leading-[normal] font-medium text-foreground">
              {t("settings.project.scripts.runAsService")}
            </span>
            <span className="text-xs leading-[normal] text-muted-foreground">
              {t("settings.project.scripts.serviceHint")}
            </span>
          </div>''')
p.rep('''      <View style={styles.modalFooter}>''', '''      <div className="mt-2 flex flex-row justify-end gap-2">''')

p.dom_tags()
p.dom_attrs()
p.cut_from("const styles = StyleSheet.create")
p.s += '''
const TITLE_ICON_TEXT = { fontSize: 14, fontWeight: 500 } as const;
'''
p.check()
p.write("one project's settings, scripts and their edit modal; DOM view.",
        "project-settings-screen.py")
