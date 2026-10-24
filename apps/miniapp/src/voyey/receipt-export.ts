import { assets } from "./assets";
import {
  localizedText,
  type Locale,
  type Translator,
  type UiKey,
} from "./messages";
import {
  receiptAmounts,
  receiptDate,
  receiptMoney,
  receiptTitle,
  type ReceiptData,
} from "./receipt";

export function wrapReceiptText(
  text: string,
  max: number,
  measure: (s: string) => number,
) {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (line && measure(`${line} ${word}`) > max) {
      lines.push(line);
      line = "";
    }
    if (measure(word) > max) {
      for (const char of word) {
        if (line && measure(line + char) > max) {
          lines.push(line);
          line = "";
        }
        line += char;
      }
    } else line += (line ? " " : "") + word;
  }
  if (line) lines.push(line);
  return lines;
}
type DrawText = {
  text: string;
  x: number;
  y: number;
  size: number;
  weight: number;
  color: string;
  align: CanvasTextAlign;
};
// This renderer uses the same ReceiptData/amount rows as the paper component.
// It never reads animated DOM, captures a printer, or sends data to a service.
export async function receiptPng(
  receipt: ReceiptData,
  locale: Locale,
  t: Translator,
): Promise<Blob> {
  await document.fonts.ready;
  const logo = new Image();
  logo.src = assets.logo;
  await logo.decode();
  const canvas = document.createElement("canvas"),
    ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  const width = 360,
    margin = 24,
    commands: DrawText[] = [],
    rules: number[] = [];
  let y = 112;
  const text = (
    value: string,
    size = 13,
    weight = 400,
    color = "#4a2c1a",
    align: CanvasTextAlign = "left",
    max = width - margin * 2,
  ) => {
    ctx.font = `${weight} ${size}px VoyeyInter, Arial, sans-serif`;
    for (const line of wrapReceiptText(
      value,
      max,
      (s) => ctx.measureText(s).width,
    )) {
      commands.push({
        text: line,
        x: align === "center" ? width / 2 : margin,
        y,
        size,
        weight,
        color,
        align,
      });
      y += size * 1.5;
    }
  };
  const divider = () => {
    y += 12;
    rules.push(y);
    y += 20;
  };
  const pair = (label: string, value: string, strong = false) => {
    ctx.font = `${strong ? 600 : 400} 13px VoyeyInter, Arial, sans-serif`;
    const labels = wrapReceiptText(label, 163, (s) => ctx.measureText(s).width),
      values = wrapReceiptText(value, 132, (s) => ctx.measureText(s).width),
      height = Math.max(labels.length, values.length) * 20;
    labels.forEach((line, i) =>
      commands.push({
        text: line,
        x: margin,
        y: y + i * 20,
        size: 13,
        weight: strong ? 600 : 400,
        color: strong ? "#4a2c1a" : "#697386",
        align: "left",
      }),
    );
    values.forEach((line, i) =>
      commands.push({
        text: line,
        x: width - margin,
        y: y + i * 20,
        size: 13,
        weight: strong ? 650 : 500,
        color: "#4a2c1a",
        align: "right",
      }),
    );
    y += height + 8;
  };
  text(t("receiptMock"), 11, 500, "#697386", "center");
  y += 4;
  text(t(receiptTitle(receipt.kind)), 19, 650, "#4a2c1a", "center");
  y += 12;
  text(t(receipt.status), 14, 600, "#236e3c", "center");
  divider();
  pair(t("receiptOrder"), receipt.orderId);
  pair(t("receiptDate"), receiptDate(receipt.confirmedAt, locale));
  pair(
    t("saleMode"),
    t(receipt.saleMode === "IN_STOCK" ? "inStock" : "preorder"),
  );
  divider();
  for (const row of receipt.lines) {
    text(localizedText(locale, { ru: row.nameRu, uz: row.nameUz }), 14, 600);
    text(
      localizedText(locale, { ru: row.variantRu, uz: row.variantUz }),
      12,
      400,
      "#697386",
    );
    pair(
      `${row.quantity} × ${receiptMoney(row.unitPrice, locale, t)}`,
      receiptMoney(row.unitPrice * row.quantity, locale, t),
    );
    y += 5;
  }
  divider();
  for (const row of receiptAmounts(receipt, t))
    pair(
      row.label,
      row.text ??
        `${row.negative ? "− " : ""}${receiptMoney(row.amount!, locale, t)}`,
      row.strong,
    );
  if (receipt.cargo === null) {
    y += 8;
    text(t("receiptUnknownCargo"), 12, 400, "#697386");
  }
  divider();
  text(t("receiptThanks"), 14, 600, "#4a2c1a", "center");
  y += 10;
  text(t("receiptDisclaimer"), 11, 400, "#697386", "center");
  y += 30;
  if (y > 12000) throw new Error("Receipt too large");
  canvas.width = width * 2;
  canvas.height = Math.ceil(y) * 2;
  ctx.scale(2, 2);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, y);
  // Crop only the original PNG's whitespace during drawing. Source stays exact.
  ctx.drawImage(
    logo,
    logo.naturalWidth * 0.148,
    logo.naturalHeight * 0.36,
    logo.naturalWidth * 0.705,
    logo.naturalHeight * 0.3,
    96,
    28,
    168,
    54,
  );
  ctx.strokeStyle = "#dfe2e8";
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 4]);
  for (const rule of rules) {
    ctx.beginPath();
    ctx.moveTo(margin, rule);
    ctx.lineTo(width - margin, rule);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.textBaseline = "top";
  for (const c of commands) {
    ctx.font = `${c.weight} ${c.size}px VoyeyInter, Arial, sans-serif`;
    ctx.fillStyle = c.color;
    ctx.textAlign = c.align;
    ctx.fillText(c.text, c.x, c.y);
  }
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("PNG unavailable"))),
      "image/png",
    ),
  );
}
export type ExportResult = UiKey | "cancelled";
export async function saveReceipt(
  data: ReceiptData,
  locale: Locale,
  t: Translator,
  share = false,
): Promise<ExportResult> {
  const blob = await receiptPng(data, locale, t);
  return deliverReceipt(blob, data.orderId, data.kind, share);
}
export async function deliverReceipt(
  blob: Blob,
  orderId: string,
  kind: ReceiptData["kind"],
  share = false,
): Promise<ExportResult> {
  const name = `VOYEY-${orderId}-${kind}.png`;
  let result: UiKey = share ? "receiptFallback" : "receiptSaved";
  let file: File | null = null,
    canShare = false;
  try {
    if (
      share &&
      typeof File === "function" &&
      typeof navigator.share === "function" &&
      typeof navigator.canShare === "function"
    ) {
      file = new File([blob], name, { type: "image/png" });
      canShare = navigator.canShare({ files: [file] });
    }
  } catch {
    /* Unsupported file sharing uses the same local PNG download. */
  }
  if (share && file && canShare) {
    try {
      await navigator.share({
        files: [file],
        title: `VOYEY · ${orderId}`,
      });
      return "receiptShared";
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return "cancelled";
      result = "receiptShareFailed";
    }
  }
  const url = URL.createObjectURL(blob),
    anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.style.display = "none";
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
  }
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return result;
}
