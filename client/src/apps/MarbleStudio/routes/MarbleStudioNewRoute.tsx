import { GenerationForm } from '../components/GenerationForm';
import { useMarbleContext } from '../context';

export function MarbleStudioNewRoute() {
    const { onGenerated } = useMarbleContext();
    return <GenerationForm onGenerated={onGenerated} />;
}
