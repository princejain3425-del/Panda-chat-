import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { Platform } from "react-native";

import { storage } from "@/src/utils/storage";
import { apiFetch, ApiError } from "@/src/api";
import { User } from "@/src/types";

const TOKEN_KEY = "sagechat.session_token";

type AuthState = {
  loading: boolean;
  user: User | null;
  token: string | null;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const initialCheckDone = useRef(false);

  const applyToken = useCallback(async (t: string) => {
    await storage.secureSet(TOKEN_KEY, t);
    setToken(t);
    try {
      const me = await apiFetch<User>("/api/auth/me", { token: t });
      setUser(me);
    } catch (e) {
      console.warn("Failed to fetch user", e);
      await storage.secureRemove(TOKEN_KEY);
      setToken(null);
      setUser(null);
    }
  }, []);

  const processSessionId = useCallback(async (sessionId: string) => {
    try {
      const res = await apiFetch<{ user: User; session_token: string }>(
        "/api/auth/session",
        {
          method: "POST",
          body: { session_token: sessionId },
        },
      );
      await storage.secureSet(TOKEN_KEY, res.session_token);
      setToken(res.session_token);
      setUser(res.user);
    } catch (e) {
      console.warn("Session verify failed", e);
    }
  }, []);

  // Cold start: check stored token
  useEffect(() => {
    if (initialCheckDone.current) return;
    initialCheckDone.current = true;
    (async () => {
      const stored = await storage.secureGet<string>(TOKEN_KEY, "");
      if (stored) {
        try {
          const me = await apiFetch<User>("/api/auth/me", { token: stored });
          setUser(me);
          setToken(stored);
        } catch (e) {
          if (e instanceof ApiError && e.status === 401) {
            await storage.secureRemove(TOKEN_KEY);
          }
        }
      }
      setLoading(false);
    })();
  }, []);

  const parseSessionIdFromUrl = (url: string | null | undefined): string | null => {
    if (!url) return null;
    // Support both #session_id= and ?session_id=
    const hashMatch = url.match(/[#&]session_id=([^&]+)/);
    if (hashMatch) return decodeURIComponent(hashMatch[1]);
    const queryMatch = url.match(/[?&]session_id=([^&]+)/);
    if (queryMatch) return decodeURIComponent(queryMatch[1]);
    return null;
  };

  const signInWithGoogle = useCallback(async () => {
    const redirectUrl =
      Platform.OS === "web"
        ? (typeof window !== "undefined" ? window.location.origin + "/" : "")
        : Linking.createURL("");
    const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;

    if (Platform.OS === "web") {
      if (typeof window !== "undefined") {
        window.location.href = authUrl;
      }
      return;
    }

    const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
    if (result.type === "success" && result.url) {
      const sid = parseSessionIdFromUrl(result.url);
      if (sid) {
        await processSessionId(sid);
      }
    }
  }, [processSessionId]);

  // Web: parse session_id from URL on mount (deep link)
  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (typeof window === "undefined") return;
    const url = window.location.href;
    const sid = parseSessionIdFromUrl(url);
    if (sid) {
      processSessionId(sid).then(() => {
        try {
          window.history.replaceState(null, "", window.location.pathname);
        } catch {}
      });
    }
  }, [processSessionId]);

  // Mobile: cold start deep link + hot link listener
  useEffect(() => {
    if (Platform.OS === "web") return;
    (async () => {
      const initial = await Linking.getInitialURL();
      const sid = parseSessionIdFromUrl(initial);
      if (sid) await processSessionId(sid);
    })();
    const sub = Linking.addEventListener("url", ({ url }) => {
      const sid = parseSessionIdFromUrl(url);
      if (sid) processSessionId(sid);
    });
    return () => sub.remove();
  }, [processSessionId]);

  const signOut = useCallback(async () => {
    try {
      if (token) await apiFetch("/api/auth/logout", { method: "POST", token });
    } catch {}
    await storage.secureRemove(TOKEN_KEY);
    setToken(null);
    setUser(null);
  }, [token]);

  const refreshUser = useCallback(async () => {
    if (!token) return;
    try {
      const me = await apiFetch<User>("/api/auth/me", { token });
      setUser(me);
    } catch {}
  }, [token]);

  const value = useMemo<AuthState>(
    () => ({ loading, user, token, signInWithGoogle, signOut, refreshUser }),
    [loading, user, token, signInWithGoogle, signOut, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
