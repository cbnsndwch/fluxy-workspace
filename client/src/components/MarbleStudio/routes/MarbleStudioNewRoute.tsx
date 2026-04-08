import { useMarbleContext } from "../context";
import { GenerationForm } from "../components/GenerationForm";

export function MarbleStudioNewRoute() {
  const { onGenerated } = useMarbleContext();
  return <GenerationForm onGenerated={onGenerated} />;
}
