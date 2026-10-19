"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { Button } from "./Button";

export function Navbar() {
  const { user, logout, loading } = useAuth();

  return (
    <nav className="border-b border-slate-800 bg-slate-950/95 sticky top-0 z-40 backdrop-blur">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href="/" className="font-semibold text-lg">
            AI Prepkit
          </Link>
          {!loading && user && (
            <>
              <Link href="/kits" className="text-slate-300 hover:text-slate-100">
                Kits
              </Link>
              <Link href="/compare" className="text-slate-300 hover:text-slate-100">
                Compare
              </Link>
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          {!loading && user ? (
            <>
              <span className="text-sm text-slate-400 hidden sm:inline">
                {user.email}
              </span>
              <Button variant="ghost" onClick={logout}>
                Logout
              </Button>
            </>
          ) : (
            <>
              <Link href="/login">
                <Button variant="ghost">Login</Button>
              </Link>
              <Link href="/register">
                <Button variant="primary">Register</Button>
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}