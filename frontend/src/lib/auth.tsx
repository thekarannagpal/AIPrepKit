"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";
import { apiGet, apiPost } from "./api";

interface User {
  id: string;
  email: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchMe = async () => {
      try {
        const res = await apiGet<{ user: User }>("/api/auth/me");
        setUser(res.user);
      } catch (err: any) {
        if (err?.error?.code !== "UNAUTHENTICATED") {
          console.error(err);
        }
        setUser(null);
      } finally {
        setLoading(false);
      }
    };
    fetchMe();
  }, []);

  const login = async (email: string, password: string) => {
    const res = await apiPost<{ user: User }>("/api/auth/login", {
      email,
      password,
    });
    setUser(res.user);
  };

  const register = async (email: string, password: string) => {
    const res = await apiPost<{ user: User }>("/api/auth/register", {
      email,
      password,
    });
    setUser(res.user);
  };

  const logout = async () => {
    await apiPost("/api/auth/logout");
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}