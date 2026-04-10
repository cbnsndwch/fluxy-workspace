export interface MarbleWorld {
  id: number;
  name: string;
  prompt: string;
  prompt_type: string;
  model: string;
  world_id: string | null;
  operation_id: string | null;
  status: "pending" | "generating" | "done" | "error";
  error_msg: string | null;
  assets_json: string | null;
  thumbnail_url: string | null;
  caption: string | null;
  created_at: string;
}

export interface ApiKeyStatus {
  hasKey: boolean;
  keyHint: string | null;
}

export interface MarbleStudioContext {
  worlds: MarbleWorld[];
  loading: boolean;
  apiKeyStatus: ApiKeyStatus;
  onGenerated: (world: MarbleWorld) => void;
  onDelete: (id: number) => void;
  onApiKeySaved: () => void;
  updateWorld: (world: MarbleWorld) => void;
  onSync: () => Promise<void>;
}

export type PromptMode = "text" | "image" | "multi-image" | "video" | "presets";

export interface ImageSlot {
  id: string;
  url: string;
  azimuth: string;
}
