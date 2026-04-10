import { createContext, useContext } from "react";

interface WorkflowActions {
  deleteNode: (id: string) => void;
}

export const WorkflowActionsContext = createContext<WorkflowActions>({ deleteNode: () => {} });

export const useWorkflowActions = () => useContext(WorkflowActionsContext);
