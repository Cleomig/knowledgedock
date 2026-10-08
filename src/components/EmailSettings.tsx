"use client";

import { useEffect, useState } from "react";

export function EmailSettings() {
  const [email, setEmail] = useState<string>("");
  const [notify, setNotify] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        if (data.email !== undefined) {
          setEmail(data.email);
          setNotify(data.notifyEmail);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function toggleNotify() {
    const next = !notify;
    setNotify(next);
    setSaving(true);
    setMessage(null);
    try {
      const r = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notifyEmail: next }),
      });
      if (r.ok) {
        setMessage(next ? "Notificaciones activadas" : "Notificaciones desactivadas");
      } else {
        setNotify(!next);
        setMessage("Error al guardar");
      }
    } catch {
      setNotify(!next);
      setMessage("Error de conexión");
    } finally {
      setSaving(false);
      setTimeout(() => setMessage(null), 3000);
    }
  }

  if (loading) {
    return <div className="text-xs text-zinc-500">Cargando ajustes…</div>;
  }

  return (
    <div className="space-y-1">
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={notify}
          onChange={toggleNotify}
          disabled={saving}
          className="rounded border-zinc-600 bg-zinc-800 text-emerald-500 focus:ring-emerald-500/40"
        />
        <span className="text-xs text-zinc-400">Avisarme por email</span>
      </label>
      {notify && (
        <p className="text-[11px] text-zinc-500 pl-5">
          Se enviará a <span className="text-zinc-300">{email}</span>
        </p>
      )}
      {message && (
        <p className="text-[11px] text-emerald-400 pl-5" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
