// Override of packages/app/src/composer/agent-controls/index.tsx.
// shortcut: only the draft-controls prop type for now — the shared draft model imports it. The
// controls themselves (provider, model, mode, thinking, role pickers) move with the composer in
// batch 3 of step 3.
import type {
  AgentFeature,
  AgentMode,
  AgentModelDefinition,
  AgentProvider,
} from "@bytetrue/protocol/agent-types";
import type { AgentProviderDefinition } from "@bytetrue/protocol/provider-manifest";
import type { DraftAgentProfileControls } from "@/agent-profiles/internal/use-agent-profile-picker";
import type { ProviderSelectorProvider } from "@/provider-selection/provider-selection";

export interface DraftAgentControlsProps {
  providerDefinitions: AgentProviderDefinition[];
  selectedProvider: AgentProvider | null;
  /** Currently selected built-in role (e.g. "chief"), or empty string. */
  selectedRole: string;
  onSelectRole: (role: string) => void;
  /** Built-in roles the host offers. Empty hides the role picker entirely. */
  roleNames: readonly string[];
  modeOptions: AgentMode[];
  selectedMode: string;
  onSelectMode: (modeId: string) => void;
  models: AgentModelDefinition[];
  selectedModel: string;
  onSelectModel: (modelId: string) => void;
  isModelLoading: boolean;
  modelSelectorProviders: ProviderSelectorProvider[];
  isAllModelsLoading: boolean;
  onSelectProviderAndModel: (provider: AgentProvider, modelId: string) => void;
  thinkingOptions: NonNullable<AgentModelDefinition["thinkingOptions"]>;
  selectedThinkingOptionId: string;
  onSelectThinkingOption: (thinkingOptionId: string) => void;
  onApplyAgentProfile: DraftAgentProfileControls["applyProfile"];
  features?: AgentFeature[];
  onSetFeature?: (featureId: string, value: unknown) => void;
  onDropdownClose?: () => void;
  onModelSelectorOpen?: () => void;
  onRetryModelProvider?: (provider: AgentProvider) => void;
  isRetryingModelProvider?: boolean;
  disabled?: boolean;
  modelSelectorServerId?: string | null;
  isCompactLayout?: boolean;
}
