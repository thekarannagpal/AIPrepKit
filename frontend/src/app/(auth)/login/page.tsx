"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/Field";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { useAuth } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      router.push("/kits");
    } catch (err: any) {
      setError(err?.error?.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 py-12">
      <Card>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <h1 className="text-2xl font-semibold">Login</h1>
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Input
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <Button type="submit" loading={loading}>
            Login
          </Button>
        </form>
      </Card>
    </div>
  );
}