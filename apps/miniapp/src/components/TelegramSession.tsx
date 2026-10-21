"use client";
import {
  createContext,
  useContext,
  useState,
  type ReactNode,
  type Dispatch,
  type SetStateAction,
} from "react";
export type TelegramSessionStatus =
  "loading" | "authenticated" | "outside-telegram" | "error";
const SessionContext = createContext<{
  status: TelegramSessionStatus;
  setStatus: Dispatch<SetStateAction<TelegramSessionStatus>>;
} | null>(null);
export function TelegramSessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<TelegramSessionStatus>("loading");
  return (
    <SessionContext.Provider value={{ status, setStatus }}>
      {children}
    </SessionContext.Provider>
  );
}
export function useTelegramSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error("TelegramSessionProvider is required");
  return session;
}
