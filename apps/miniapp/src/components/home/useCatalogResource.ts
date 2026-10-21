"use client";

import { useEffect, useState } from "react";

type ResourceState<T> =
  { status: "loading" } | { status: "error" } | { status: "success"; data: T };
const requestTimeoutMs = 15_000;

export function useCatalogResource<T>(
  load: (signal: AbortSignal) => Promise<T>,
) {
  const [state, setState] = useState<ResourceState<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(
      () => controller.abort(),
      requestTimeoutMs,
    );
    setState({ status: "loading" });
    void load(controller.signal)
      .then((data) => {
        if (active) setState({ status: "success", data });
      })
      .catch(() => {
        if (active) setState({ status: "error" });
      })
      .finally(() => window.clearTimeout(timeout));
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [load, attempt]);
  return { state, retry: () => setAttempt((value) => value + 1) };
}
