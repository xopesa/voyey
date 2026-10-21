"use client";

import { useEffect } from "react";
import {
  clearProductReturn,
  productReturnHref,
  readProductReturn,
} from "../../lib/product-navigation";

export function useProductReturnScroll(ready: boolean) {
  useEffect(() => {
    if (!ready) return;
    const saved = readProductReturn();
    if (
      !saved ||
      saved.href !==
        productReturnHref(window.location.pathname + window.location.search)
    )
      return;
    const frame = requestAnimationFrame(() => {
      document
        .querySelector(".app-shell__scroll")
        ?.scrollTo({ top: saved.scroll });
      clearProductReturn();
    });
    return () => cancelAnimationFrame(frame);
  }, [ready]);
}
