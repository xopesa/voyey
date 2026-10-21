interface TelegramSafeAreaInset {
  top: number;
  right: number;
  bottom: number;
  left: number;
}
type TelegramLayoutEvent =
  | "viewportChanged"
  | "safeAreaChanged"
  | "contentSafeAreaChanged"
  | "themeChanged";

interface TelegramWebApp {
  readonly BackButton?: {
    show(): void;
    hide(): void;
    onClick(handler: () => void): void;
    offClick(handler: () => void): void;
  };
  isVersionAtLeast?(version: string): boolean;
  readonly initData: string;
  readonly initDataUnsafe?: {
    user?: { language_code?: string };
    start_param?: string;
  };
  readonly platform?: string;
  readonly colorScheme: "light" | "dark";
  readonly version: string;
  readonly viewportHeight?: number;
  readonly viewportStableHeight?: number;
  readonly safeAreaInset?: TelegramSafeAreaInset;
  readonly contentSafeAreaInset?: TelegramSafeAreaInset;
  onEvent?(event: TelegramLayoutEvent, handler: () => void): void;
  offEvent?(event: TelegramLayoutEvent, handler: () => void): void;
  ready(): void;
  expand(): void;
}

interface Window {
  Telegram?: {
    WebApp: TelegramWebApp;
  };
}
