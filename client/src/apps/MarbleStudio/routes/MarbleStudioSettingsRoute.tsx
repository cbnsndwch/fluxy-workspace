import { SettingsPanel } from '../components/SettingsPanel';
import { useMarbleContext } from '../context';

export function MarbleStudioSettingsRoute() {
    const { onApiKeySaved } = useMarbleContext();
    return <SettingsPanel onSaved={onApiKeySaved} />;
}
