"use client";

import { useEffect, useState } from "react";
import { Mail, Calendar } from "lucide-react";

type HealthStatus = "loading" | "ok" | "failed";

export default function Footer() {
  const [status, setStatus] = useState<HealthStatus>("loading");

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/test", { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(() => setStatus("ok"))
      .catch((error) => {
        if ((error as Error).name !== "AbortError") {
          setStatus("failed");
        }
      });

    return () => controller.abort();
  }, []);

  const statusColorClass =
    status === "ok"
      ? "bg-emerald-500"
      : status === "failed"
        ? "bg-red-500"
        : "bg-amber-400";
  const statusGlowClass =
    status === "ok"
      ? "shadow-[0_0_0_4px_rgba(16,185,129,0.18),0_0_14px_3px_rgba(16,185,129,0.5)]"
      : status === "failed"
        ? "shadow-[0_0_0_4px_rgba(239,68,68,0.18),0_0_14px_3px_rgba(239,68,68,0.45)]"
        : "shadow-[0_0_0_4px_rgba(251,191,36,0.2),0_0_14px_3px_rgba(251,191,36,0.45)]";

  return (
    <footer className="bg-white/60 backdrop-blur-md border-t border-slate-200 mt-auto">
      <div className="container mx-auto px-4 py-3">
        <div className="flex flex-col md:flex-row items-center justify-between space-y-4 md:space-y-0">
          <div className="flex items-center space-x-4 text-sm text-slate-600">
            <div className="flex items-center space-x-1">
              <Calendar className="w-4 h-4" />
              <span>Updated Mar. 09, 2026</span>
            </div>
            <div className="flex items-center space-x-1">
              <Mail className="w-4 h-4" />
              <span>qianhuiz@cs.cmu.edu</span>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span
              aria-label={`System status: ${status}`}
              title={`System status: ${status}`}
              className={`inline-block h-2.5 w-2.5 rounded-full animate-pulse ${statusColorClass} ${statusGlowClass}`}
            />
            <span className="capitalize">System {status}</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
