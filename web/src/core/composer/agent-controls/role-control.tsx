import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { ReactElement } from "react";
import type { ComboboxOption } from "@/components/ui/combobox";
import { ComposerOptionControl } from "@/composer/agent-controls/option-control";
import { useComposerControlLayout } from "@/composer/agent-controls/layout-context";
import { AgentRoleIcon } from "@/agent-controls/icons";
import { formatAgentRoleLabel } from "@/agent-controls/labels";
import { NO_AGENT_ROLE_ID } from "@/agent-controls/roles";

/** "No role" leads the list because it is the default and a real choice; the
 * picker must never render it as an empty state. */
function buildAgentRoleOptions(
  t: (key: string) => string,
  roleNames: readonly string[],
): ComboboxOption[] {
  return [
    { id: NO_AGENT_ROLE_ID, label: t("agentControls.role.none") },
    ...roleNames.map((roleId) => ({ id: roleId, label: formatAgentRoleLabel(roleId) })),
  ];
}

export interface AgentRoleControlValue {
  /** Built-in roles this host offers. */
  roleNames: readonly string[];
  selectedRole: string;
  onSelectRole: (role: string) => void;
  disabled?: boolean;
}

/** Role picker for the draft composer. A list, not a toggle: "no role" is one
 * of the options, and the trigger reports which one is in effect. */
export function AgentRoleControl({
  roleNames,
  selectedRole,
  onSelectRole,
  disabled = false,
  surface = "toolbar",
  onClose,
}: AgentRoleControlValue & { surface?: "toolbar" | "sheet"; onClose?: () => void }): ReactElement {
  const { t } = useTranslation();
  const { presentation } = useComposerControlLayout();

  const options = useMemo(() => buildAgentRoleOptions(t, roleNames), [t, roleNames]);
  // A role the catalog does not list (a stale draft against a downgraded host)
  // still names itself on the trigger rather than reading as "no role".
  const selectedLabel =
    options.find((option) => option.id === selectedRole)?.label ??
    (selectedRole ? formatAgentRoleLabel(selectedRole) : t("agentControls.role.none"));
  const header = useMemo(() => ({ title: t("agentControls.role.select") }), [t]);

  return (
    <ComposerOptionControl
      icon={AgentRoleIcon}
      surface={surface}
      label={t("agentControls.role.select")}
      value={selectedLabel}
      showToolbarLabel={presentation.showRoleLabel}
      showCaret={surface === "toolbar" && presentation.showCarets}
      disabled={disabled}
      accessibilityLabel={t("agentControls.role.selectWithValue", { value: selectedLabel })}
      testID="agent-role-selector"
      options={options}
      selectedId={selectedRole}
      onSelect={onSelectRole}
      searchable={false}
      header={header}
      desktopMinWidth={200}
      onClose={onClose}
    />
  );
}
