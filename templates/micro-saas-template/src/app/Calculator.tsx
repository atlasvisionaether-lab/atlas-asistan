"use client";

import { useState } from "react";
import {
  formatUnitPrice,
  type CalcResult,
  type Unit,
} from "@/lib/calculate";

interface Row {
  label: string;
  price: string;
  size: string;
  unit: Unit;
}

const UNITS: Unit[] = ["g", "kg", "ml", "l", "oz", "lb", "fl-oz", "count"];

function emptyRow(): Row {
  return { label: "", price: "", size: "", unit: "g" };
}

export default function Calculator() {
  const [rows, setRows] = useState<Row[]>([emptyRow(), emptyRow()]);
  const [results, setResults] = useState<CalcResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function updateRow(index: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  async function onCalculate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const items = rows
        .filter((r) => r.label.trim() !== "")
        .map((r) => ({
          label: r.label,
          price: Number.parseFloat(r.price),
          size: Number.parseFloat(r.size),
          unit: r.unit,
        }));
      const res = await fetch("/api/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Request failed (${res.status})`);
      } else {
        setResults(data.results);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
      <form onSubmit={onCalculate} className="space-y-3">
        {rows.map((row, i) => (
          <div key={i} className="grid grid-cols-[1fr_90px_90px_90px] gap-2">
            <input
              value={row.label}
              onChange={(e) => updateRow(i, { label: e.target.value })}
              placeholder={`Item ${i + 1} (e.g. Brand A 500g)`}
              className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none"
            />
            <input
              value={row.price}
              onChange={(e) => updateRow(i, { price: e.target.value })}
              placeholder="Price"
              inputMode="decimal"
              className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none"
            />
            <input
              value={row.size}
              onChange={(e) => updateRow(i, { size: e.target.value })}
              placeholder="Size"
              inputMode="decimal"
              className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none"
            />
            <select
              value={row.unit}
              onChange={(e) => updateRow(i, { unit: e.target.value as Unit })}
              className="rounded-md border border-slate-700 bg-slate-950 px-2 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
            >
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </div>
        ))}
        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={loading}
            className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50"
          >
            {loading ? "Calculating..." : "Compare prices"}
          </button>
          <button
            type="button"
            onClick={() => setRows((r) => [...r, emptyRow()])}
            className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 transition hover:border-slate-500"
          >
            + Add item
          </button>
        </div>
      </form>

      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

      {results && (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-slate-400">
              <tr>
                <th className="px-2 py-2 font-medium">Item</th>
                <th className="px-2 py-2 font-medium">Price</th>
                <th className="px-2 py-2 font-medium">Unit price</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr
                  key={r.label}
                  className={r.isBest ? "bg-emerald-950/40" : undefined}
                >
                  <td className="px-2 py-2 text-white">
                    {r.label}
                    {r.isBest && (
                      <span className="ml-2 rounded bg-emerald-500/20 px-1.5 py-0.5 text-xs font-semibold text-emerald-400">
                        best
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-slate-300">
                    ${r.price.toFixed(2)}
                  </td>
                  <td className="px-2 py-2 font-mono text-emerald-400">
                    {formatUnitPrice(r.unitPrice, r.baseUnit)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
