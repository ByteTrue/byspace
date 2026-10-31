// Override of packages/app/src/agent-profiles/index.ts: the same barrel through `@/`, so the web
// glyph and editor apply.
// shortcut: without the settings section (step 4 ports settings).
export type { AgentProfile } from "@bytetrue/protocol/messages";
export type { MaterializedAgentProfile } from "@/agent-profiles/internal/materialize-profile";
export type { AgentProfileSeed } from "@/agent-profiles/internal/profile-form-model";
export {
  useAgentProfileEditor,
  type AgentProfileEditorControls,
} from "@/agent-profiles/agent-profile-editor";
export { useAgentProfiles } from "@/agent-profiles/internal/use-agent-profiles";
export {
  useAgentProfilePicker,
  type AgentProfileApplyTarget,
  type AgentProfilePicker,
  type AgentProfilePickerRow,
  type DraftAgentProfileControls,
} from "@/agent-profiles/internal/use-agent-profile-picker";
export { AgentProfileGlyph } from "@/agent-profiles/internal/agent-profile-glyph";
