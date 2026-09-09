"use client";

import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function LoginForm({ callbackUrl }: { callbackUrl: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const res = await signIn("credentials", {
      email: String(fd.get("email") ?? ""),
      password: String(fd.get("password") ?? ""),
      redirect: false,
    });
    setLoading(false);
    if (!res || res.error) {
      setError("Credenziali non valide.");
      return;
    }
    router.push(callbackUrl);
    router.refresh();
  }

  const field =
    "w-full rounded-md border border-[var(--border-strong)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--accent)]";
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <input
        name="email"
        type="email"
        autoComplete="username"
        required
        placeholder="Email"
        className={field}
      />
      <input
        name="password"
        type="password"
        autoComplete="current-password"
        required
        placeholder="Password"
        className={field}
      />
      {error && <p className="text-sm text-[var(--danger)]">{error}</p>}
      <button type="submit" disabled={loading} className="btn btn-primary w-full justify-center">
        {loading ? "…" : "Accedi"}
      </button>
    </form>
  );
}
