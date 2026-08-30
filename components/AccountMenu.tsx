"use client";

import { FormEvent, useEffect, useState } from "react";
import { useLanguage } from "./LanguageProvider";

type User = { id: string; email: string };
type Mode = "login" | "register";

const copy = {
  en: { account: "Account", signIn: "Sign in", register: "Create account", email: "Email", password: "Password", logout: "Sign out", close: "Close", loading: "Please wait…", local: "No account? Your plan stays on this device.", failed: "Something went wrong. Please try again." },
  de: { account: "Konto", signIn: "Anmelden", register: "Konto erstellen", email: "E-Mail", password: "Passwort", logout: "Abmelden", close: "Schließen", loading: "Bitte warten…", local: "Ohne Konto bleibt dein Plan auf diesem Gerät.", failed: "Etwas ist schiefgegangen. Bitte erneut versuchen." },
  ru: { account: "Аккаунт", signIn: "Войти", register: "Создать аккаунт", email: "Эл. почта", password: "Пароль", logout: "Выйти", close: "Закрыть", loading: "Подождите…", local: "Без аккаунта план останется на этом устройстве.", failed: "Что-то пошло не так. Попробуйте ещё раз." },
} as const;

export function AccountMenu() {
  const { language } = useLanguage();
  const t = copy[language];
  const [user, setUser] = useState<User | null>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then(async (response) => response.ok && setUser((await response.json()).user))
      .catch(() => undefined);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError("");
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: data.get("email"), password: data.get("password") }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || t.failed);
      setUser(result.user); setOpen(false);
      window.dispatchEvent(new CustomEvent("festival-radar-authenticated"));
    } catch (reason) { setError(reason instanceof Error ? reason.message : t.failed); }
    finally { setBusy(false); }
  }

  async function logout() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error(t.failed);
      setUser(null); setOpen(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : t.failed); }
    finally { setBusy(false); }
  }

  return <div className="accountMenu">
    <button type="button" className="accountButton" aria-expanded={open} onClick={() => setOpen((value) => !value)}>{user?.email ?? t.account}</button>
    {open && <section className="accountPopover" aria-label={t.account}>
      {user ? <>
        <strong>{user.email}</strong>
        {error && <p role="alert">{error}</p>}
        <button type="button" disabled={busy} onClick={logout}>{busy ? t.loading : t.logout}</button>
      </> : <>
        <div className="accountTabs" role="tablist">
          <button type="button" role="tab" aria-selected={mode === "login"} onClick={() => setMode("login")}>{t.signIn}</button>
          <button type="button" role="tab" aria-selected={mode === "register"} onClick={() => setMode("register")}>{t.register}</button>
        </div>
        <form onSubmit={submit} aria-busy={busy}>
          <label>{t.email}<input required name="email" type="email" autoComplete="email" /></label>
          <label>{t.password}<input required minLength={mode === "register" ? 12 : 1} name="password" type="password" autoComplete={mode === "register" ? "new-password" : "current-password"} /></label>
          {error && <p role="alert">{error}</p>}
          <button type="submit" disabled={busy}>{busy ? t.loading : mode === "login" ? t.signIn : t.register}</button>
        </form>
        <p className="accountHint">{t.local}</p>
      </>}
      <button type="button" className="accountClose" onClick={() => setOpen(false)} aria-label={t.close}>×</button>
    </section>}
  </div>;
}
