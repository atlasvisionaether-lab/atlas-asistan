"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const FIELDS = [
  { key: "name", label: "Product name", placeholder: "Price Per Ounce Calculator" },
  { key: "problem", label: "Problem", placeholder: "Comparing unit prices across brands is tedious" },
  { key: "target", label: "Target audience", placeholder: "grocery shoppers" },
  { key: "price", label: "Price", placeholder: "$9 one-time" },
] as const;

export default function CreateForm() {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({
    name: "",
    problem: "",
    target: "",
    price: "",
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/factory/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ kind: "err", text: data.error ?? `Request failed (${res.status})` });
      } else {
        setMessage({
          kind: "ok",
          text: `Created products/${data.product.slug} (${data.product.files} files)`,
        });
        setValues({ name: "", problem: "", target: "", price: "" });
        router.refresh();
      }
    } catch (err) {
      setMessage({ kind: "err", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="grid gap-4 rounded-lg border border-slate-800 bg-slate-900/60 p-5 sm:grid-cols-2"
    >
      {FIELDS.map((f) => (
        <label key={f.key} className="flex flex-col gap-1">
          <span className="text-sm font-medium text-slate-300">{f.label}</span>
          <input
            required
            value={values[f.key]}
            onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            placeholder={f.placeholder}
            className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none"
          />
        </label>
      ))}
      <div className="sm:col-span-2 flex items-center gap-4">
        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50"
        >
          {loading ? "Creating..." : "Create micro-SaaS"}
        </button>
        {message && (
          <p className={message.kind === "ok" ? "text-sm text-emerald-400" : "text-sm text-red-400"}>
            {message.text}
          </p>
        )}
      </div>
    </form>
  );
}
