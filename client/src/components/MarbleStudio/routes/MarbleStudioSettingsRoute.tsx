import { useMarbleContext } from "../context";
import { SettingsPanel } from "../components/SettingsPanel";

export function MarbleStudioSettingsRoute() {
  const { onApiKeySaved } = useMarbleContext();
  return <SettingsPanel onSaved={onApiKeySaved} />;
}
