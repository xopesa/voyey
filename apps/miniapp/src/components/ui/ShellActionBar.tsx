"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function ShellActionBar({
  children,
  className,
  reserveProperty,
}: {
  children: ReactNode;
  className: string;
  reserveProperty: string;
}) {
  const [shell, setShell] = useState<HTMLElement | null>(null);
  const bar = useRef<HTMLDivElement>(null);
  useEffect(
    () => setShell(document.querySelector<HTMLElement>(".app-shell")),
    [],
  );
  useEffect(() => {
    if (!shell || !bar.current) return;
    const measure = () =>
      shell.style.setProperty(
        reserveProperty,
        `${bar.current?.getBoundingClientRect().height ?? 0}px`,
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(bar.current);
    return () => {
      observer.disconnect();
      shell.style.removeProperty(reserveProperty);
    };
  }, [shell, reserveProperty]);
  return shell
    ? createPortal(
        <div className={className} ref={bar}>
          {children}
        </div>,
        shell,
      )
    : null;
}
