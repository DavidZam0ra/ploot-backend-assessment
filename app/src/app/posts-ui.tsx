"use client";

import { useCallback, useEffect, useState } from "react";

interface Post {
  id: string;
  content: string;
  status: string;
  scheduledAt: string | null;
  publishedAt: string | null;
  lastErrorCode: string | null;
}

const STORAGE_KEY = "ploot_demo_session";

function loadSession(): { tenantId: string; profileId: string; token: string } | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

export default function PostsUI() {
  const [tenantId, setTenantId] = useState("");
  const [profileId, setProfileId] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [content, setContent] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const saved = loadSession();
    if (saved) {
      setTenantId(saved.tenantId);
      setProfileId(saved.profileId);
      setToken(saved.token);
    }
  }, []);

  const fetchPosts = useCallback(async () => {
    if (!token) return;
    const res = await fetch("/api/v1/posts?limit=50", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const body = await res.json();
      setPosts(body.items ?? body.posts ?? []);
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    fetchPosts();
    const id = setInterval(fetchPosts, 4000);
    return () => clearInterval(id);
  }, [token, fetchPosts]);

  async function login() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/dev/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId, profileId }),
      });
      if (!res.ok) throw new Error("No se pudo generar el token — revisa los IDs");
      const body = await res.json();
      setToken(body.token);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ tenantId, profileId, token: body.token }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    } finally {
      setBusy(false);
    }
  }

  function logout() {
    window.localStorage.removeItem(STORAGE_KEY);
    setToken(null);
    setPosts([]);
  }

  async function createPost(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setError(null);
    const res = await fetch("/api/v1/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        profileId,
        content,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.message ?? "No se pudo crear el post");
      return;
    }
    setContent("");
    setScheduledAt("");
    fetchPosts();
  }

  async function publishNow(id: string) {
    if (!token) return;
    setError(null);
    const res = await fetch(`/api/v1/posts/${id}/publish`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Idempotency-Key": `ui-${id}-${Date.now()}` },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.message ?? `No se pudo publicar (HTTP ${res.status})`);
      return;
    }
    fetchPosts();
  }

  async function cancelPost(id: string) {
    if (!token) return;
    setError(null);
    const res = await fetch(`/api/v1/posts/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.message ?? `No se pudo cancelar (HTTP ${res.status})`);
      return;
    }
    fetchPosts();
  }

  if (!token) {
    return (
      <main style={{ maxWidth: 480, margin: "4rem auto", fontFamily: "system-ui" }}>
        <h1>Ploot — scheduler</h1>
        <p>
          Pega el <code>tenantId</code> y <code>profileId</code> de un seed (ver{" "}
          <code>worker/scripts/seed.ts</code>) para entrar como ese tenant.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <input placeholder="tenantId" value={tenantId} onChange={(e) => setTenantId(e.target.value)} />
          <input placeholder="profileId" value={profileId} onChange={(e) => setProfileId(e.target.value)} />
          <button onClick={login} disabled={busy || !tenantId || !profileId}>
            Entrar
          </button>
          {error && <p style={{ color: "crimson" }}>{error}</p>}
        </div>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 720, margin: "2rem auto", fontFamily: "system-ui" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h1>Ploot — scheduler</h1>
        <button onClick={logout}>Salir</button>
      </div>
      <p style={{ color: "#666" }}>
        Tenant: <code>{tenantId}</code> — la lista se refresca sola cada 4s.
      </p>

      <form onSubmit={createPost} style={{ display: "flex", gap: 8, margin: "1rem 0", flexWrap: "wrap" }}>
        <input
          placeholder="Contenido del post"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          required
          style={{ flex: 1, minWidth: 240 }}
        />
        <input
          type="datetime-local"
          value={scheduledAt}
          onChange={(e) => setScheduledAt(e.target.value)}
          title="Dejar vacío para crear como borrador"
        />
        <button type="submit">Crear</button>
      </form>
      {error && <p style={{ color: "crimson" }}>{error}</p>}

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
            <th>Contenido</th>
            <th>Estado</th>
            <th>Programado</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {posts.map((p) => (
            <tr key={p.id} style={{ borderBottom: "1px solid #eee" }}>
              <td>{p.content}</td>
              <td>{p.status}{p.lastErrorCode ? ` (${p.lastErrorCode})` : ""}</td>
              <td>{p.scheduledAt ? new Date(p.scheduledAt).toLocaleString() : "—"}</td>
              <td style={{ display: "flex", gap: 4 }}>
                {p.status !== "published" && p.status !== "cancelled" && (
                  <>
                    <button onClick={() => publishNow(p.id)}>Publicar ahora</button>
                    <button onClick={() => cancelPost(p.id)}>Cancelar</button>
                  </>
                )}
              </td>
            </tr>
          ))}
          {posts.length === 0 && (
            <tr>
              <td colSpan={4} style={{ color: "#666", padding: "1rem 0" }}>
                Sin posts todavía — crea uno arriba.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </main>
  );
}
