import { create } from "zustand";

export interface AuthUser {
  id: number;
  github_id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
  email: string | null;
}

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  setUser: (user: AuthUser | null) => void;
  setLoading: (v: boolean) => void;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: true,
  setUser: (user) => set({ user }),
  setLoading: (v) => set({ loading: v }),
  logout: async () => {
    await fetch("/app/api/auth/logout", { method: "POST" });
    localStorage.removeItem("session_token");
    // Full navigation so the root loader re-evaluates auth and redirects to /login
    window.location.href = "/login";
  },
}));
