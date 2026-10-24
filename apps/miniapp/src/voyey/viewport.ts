import { useEffect, useState } from "react";

export function isTextEditor(element: Element | null) {
  return (
    element instanceof HTMLElement &&
    (element.matches('textarea,[contenteditable="true"]') ||
      (element instanceof HTMLInputElement &&
        ![
          "radio",
          "checkbox",
          "file",
          "button",
          "submit",
          "reset",
          "range",
          "color",
        ].includes(element.type)))
  );
}
// Narrow-screen editing hides both fixed bars by one deterministic rule.
// They retain their reserved space; no animation moves them above the keyboard.
export function useDemoKeyboard() {
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    const viewport = window.visualViewport;
    let frame = 0;
    const update = () => {
      const focused = isTextEditor(document.activeElement),
        narrow = window.matchMedia("(max-width: 600px)").matches,
        shrunk = !!viewport && window.innerHeight - viewport.height > 140;
      setEditing(focused && (narrow || shrunk));
    };
    const reveal = () => {
      update();
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (isTextEditor(document.activeElement))
          document.activeElement?.scrollIntoView({
            block: "nearest",
            behavior: "instant",
          });
      });
    };
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);
    viewport?.addEventListener("resize", reveal);
    window.addEventListener("resize", update);
    update();
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
      viewport?.removeEventListener("resize", reveal);
      window.removeEventListener("resize", update);
    };
  }, []);
  return editing;
}
