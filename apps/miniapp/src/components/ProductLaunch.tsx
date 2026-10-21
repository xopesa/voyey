"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { productLaunchPath } from "../lib/product-launch";

export function ProductLaunch() {
  const applied = useRef(false);
  const router = useRouter();
  useEffect(() => {
    if (applied.current) return;
    applied.current = true;
    const path = productLaunchPath(
      window.Telegram?.WebApp,
      window.location.search,
    );
    if (path && window.location.pathname === "/") router.replace(path);
  }, [router]);
  return null;
}
