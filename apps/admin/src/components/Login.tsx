"use client";
import { useEffect, useState, type FormEvent } from "react";
import { Header } from "./Header";
import { usePreferences } from "./Preferences";
import { api, errorKey } from "../lib/api";
import type { MessageKey } from "../lib/i18n";
import {
  deriveAdminPasswordProof,
  type PasswordChallenge,
} from "../lib/admin-login";

export function Login() {
  const { t, locale } = usePreferences();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [passwordRequired, setPasswordRequired] = useState<boolean | null>(
    null,
  );
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [challenge, setChallenge] = useState<PasswordChallenge | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    api<{ passwordRequired: boolean; challenge?: PasswordChallenge }>(
      "auth/method",
      { signal: controller.signal },
      false,
    )
      .then((result) => {
        if (result.passwordRequired && !result.challenge)
          throw new Error("Missing challenge");
        setChallenge(result.challenge ?? null);
        setPasswordRequired(result.passwordRequired);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("unavailable");
      });
    return () => controller.abort();
  }, []);
  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (passwordRequired === null || busy) return;
    setBusy(true);
    setError(null);
    try {
      const passwordProof = passwordRequired
        ? await deriveAdminPasswordProof(password, challenge!)
        : undefined;
      setPassword("");
      await api(
        passwordRequired ? "auth/login" : "auth/access",
        {
          method: "POST",
          headers: { "x-stenzo-admin": "1" },
          ...(passwordRequired
            ? { body: JSON.stringify({ login, passwordProof }) }
            : {}),
        },
        false,
      );
      window.location.replace("/admin/");
    } catch (error) {
      setError(errorKey(error));
      setBusy(false);
    } finally {
      setPassword("");
    }
  }
  return (
    <>
      <Header />
      <main className="login-wrap">
        <section className="login-card">
          <div className="eyebrow">STENZO WEAR</div>
          <h1>{t("login")}</h1>
          <p className="muted">
            {passwordRequired
              ? locale === "uz"
                ? "Administrator login va parolini kiriting."
                : "Введите логин и пароль администратора."
              : locale === "uz"
                ? "Administrator uchun ruxsat berilgan email bilan Cloudflare Access orqali kiring."
                : "Войдите через Cloudflare Access с email, которому разрешён доступ администратора."}
          </p>
          {error && (
            <p className="error" role="alert">
              {t(error)}
            </p>
          )}
          <form onSubmit={signIn}>
            {passwordRequired && (
              <>
                <label>
                  {t("username")}
                  <input
                    name="username"
                    autoComplete="username"
                    required
                    maxLength={100}
                    value={login}
                    onChange={(event) => setLogin(event.target.value)}
                    disabled={busy}
                  />
                </label>
                <label>
                  {t("password")}
                  <input
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    maxLength={1024}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    disabled={busy}
                  />
                </label>
              </>
            )}
            <button
              className="primary wide"
              type="submit"
              disabled={busy || passwordRequired === null}
            >
              {busy
                ? t("signingIn")
                : passwordRequired
                  ? t("signIn")
                  : locale === "uz"
                    ? "Cloudflare Access orqali kirish"
                    : "Войти через Cloudflare Access"}{" "}
              <span aria-hidden="true">↗</span>
            </button>
          </form>
        </section>
        <p className="login-footer">STENZO Wear · Admin</p>
      </main>
    </>
  );
}
