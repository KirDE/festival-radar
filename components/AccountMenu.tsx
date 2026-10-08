"use client";

import { FormEvent, useEffect, useState } from "react";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { useLanguage } from "./LanguageProvider";
import { authErrorMessage } from "@/lib/auth-error-copy";

type User = { id: string; email: string };
type Mode = "login" | "register";

const copy = {
  en: { account: "Account", signIn: "Sign in", register: "Create account", email: "Email", password: "Password", passkeySignIn: "Sign in with passkey", passkeyRegister: "Create account with passkey", passkeyHint: "Passkeys use your fingerprint, face, screen lock, or security key.", passwordDivider: "or use a password", emailRequired: "Enter a valid email first.", cancelled: "Passkey request was cancelled.", logout: "Sign out", close: "Close", loading: "Please wait…", local: "No account? Your plan stays on this device.", failed: "Something went wrong. Please try again." },
  de: { account: "Konto", signIn: "Anmelden", register: "Konto erstellen", email: "E-Mail", password: "Passwort", passkeySignIn: "Mit Passkey anmelden", passkeyRegister: "Konto mit Passkey erstellen", passkeyHint: "Passkeys verwenden Fingerabdruck, Gesichtserkennung, Gerätesperre oder Sicherheitsschlüssel.", passwordDivider: "oder Passwort verwenden", emailRequired: "Bitte zuerst eine gültige E-Mail eingeben.", cancelled: "Passkey-Anfrage wurde abgebrochen.", logout: "Abmelden", close: "Schließen", loading: "Bitte warten…", local: "Ohne Konto bleibt dein Plan auf diesem Gerät.", failed: "Etwas ist schiefgegangen. Bitte erneut versuchen." },
  ru: { account: "Аккаунт", signIn: "Войти", register: "Создать аккаунт", email: "Эл. почта", password: "Пароль", passkeySignIn: "Войти с паскеем", passkeyRegister: "Создать аккаунт с паскеем", passkeyHint: "Паскей использует отпечаток, лицо, код блокировки устройства или ключ безопасности.", passwordDivider: "или использовать пароль", emailRequired: "Сначала введите корректный адрес почты.", cancelled: "Запрос паскея отменён.", logout: "Выйти", close: "Закрыть", loading: "Подождите…", local: "Без аккаунта план останется на этом устройстве.", failed: "Что-то пошло не так. Попробуйте ещё раз." },
} as const;

export function AccountMenu() {
  const { language } = useLanguage();
  const t = copy[language];
  const [user, setUser] = useState<User | null>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [passkeySupported, setPasskeySupported] = useState(false);

  useEffect(() => {
    setPasskeySupported(Boolean(window.PublicKeyCredential && navigator.credentials));
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
      if (!response.ok) { setError(authErrorMessage(language, result.error, t.failed)); return; }
      setUser(result.user); setOpen(false);
      window.dispatchEvent(new CustomEvent("festival-radar-authenticated"));
    } catch { setError(t.failed); }
    finally { setBusy(false); }
  }

  async function usePasskey() {
    setBusy(true); setError("");
    try {
      if (mode === "register" && !email.trim()) { setError(t.emailRequired); return; }
      const optionsResponse = await fetch(`/api/auth/passkey/${mode}/options`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(mode === "register" ? { email } : {}),
      });
      const optionsResult = await optionsResponse.json();
      if (!optionsResponse.ok) { setError(authErrorMessage(language, optionsResult.error, t.failed)); return; }
      const credential = mode === "register"
        ? await startRegistration({ optionsJSON: optionsResult.options })
        : await startAuthentication({ optionsJSON: optionsResult.options });
      const verificationResponse = await fetch(`/api/auth/passkey/${mode}/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(credential),
      });
      const verificationResult = await verificationResponse.json();
      if (!verificationResponse.ok) { setError(authErrorMessage(language, verificationResult.error, t.failed)); return; }
      setUser(verificationResult.user); setOpen(false);
      window.dispatchEvent(new CustomEvent("festival-radar-authenticated"));
    } catch (reason) {
      setError(reason instanceof DOMException && reason.name === "NotAllowedError"
        ? t.cancelled
        : t.failed);
    } finally { setBusy(false); }
  }

  async function logout() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error(t.failed);
      setUser(null); setMode("login"); setOpen(false);
    } catch { setError(t.failed); }
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
          <button type="button" role="tab" aria-selected={mode === "login"} onClick={() => { setMode("login"); setError(""); }}>{t.signIn}</button>
          <button type="button" role="tab" aria-selected={mode === "register"} onClick={() => { setMode("register"); setError(""); }}>{t.register}</button>
        </div>
        <form onSubmit={submit} aria-busy={busy}>
          {passkeySupported && mode === "login" && <>
            <button className="passkeyButton" type="button" disabled={busy} onClick={usePasskey}>{busy ? t.loading : t.passkeySignIn}</button>
            <small className="accountHint">{t.passkeyHint}</small>
            <span className="accountDivider">{t.passwordDivider}</span>
          </>}
          <label>{t.email}<input required name="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.currentTarget.value)} /></label>
          {passkeySupported && mode === "register" && <>
            <button className="passkeyButton" type="button" disabled={busy} onClick={usePasskey}>{busy ? t.loading : t.passkeyRegister}</button>
            <small className="accountHint">{t.passkeyHint}</small>
            <span className="accountDivider">{t.passwordDivider}</span>
          </>}
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
