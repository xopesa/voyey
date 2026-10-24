import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  motion,
  MotionConfig,
  useIsPresent,
  useReducedMotion,
  type Transition,
} from "motion/react";

export const motionTokens = {
  tap: 0.12,
  tab: 0.24,
  page: 0.26,
  exit: 0.12,
  dialog: 0.24,
  receipt: 0.62,
  ease: [0.22, 0.8, 0.28, 1] as [number, number, number, number],
};
const MotionSettings = createContext<{
  reduced: boolean;
  forceReduced: boolean;
  setForceReduced: (value: boolean) => void;
}>({ reduced: false, forceReduced: false, setForceReduced: () => undefined });
export function VoyeyMotionSystem({ children }: { children: ReactNode }) {
  const systemReduced = useReducedMotion(),
    [forceReduced, setForceReduced] = useState(false),
    reduced = forceReduced || !!systemReduced;
  return (
    <MotionSettings.Provider value={{ reduced, forceReduced, setForceReduced }}>
      <MotionConfig
        reducedMotion={reduced ? "always" : "user"}
        transition={{
          duration: reduced ? 0.08 : motionTokens.tab,
          ease: motionTokens.ease,
        }}
      >
        {children}
      </MotionConfig>
    </MotionSettings.Provider>
  );
}
export const useVoyeyMotion = () => useContext(MotionSettings);
export function useVoyeyTransition(duration = motionTokens.tab): Transition {
  const { reduced } = useVoyeyMotion();
  return { duration: reduced ? 0.08 : duration, ease: motionTokens.ease };
}
// popLayout requires a ref on the immediate custom child. Only this page moves;
// fixed navigation and the portal host never have an animated ancestor.
export const VoyeyPage = forwardRef<
  HTMLDivElement,
  { children: ReactNode; route: string }
>(function VoyeyPage({ children, route }, ref) {
  const { reduced } = useVoyeyMotion(),
    present = useIsPresent();
  return (
    <motion.div
      ref={ref}
      data-route={route}
      className="vy-page"
      inert={!present}
      aria-hidden={!present || undefined}
      initial={{ opacity: reduced ? 0.5 : 0.15, y: reduced ? 0 : 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: reduced ? 0 : -3 }}
      transition={{
        duration: present
          ? reduced
            ? 0.08
            : motionTokens.page
          : motionTokens.exit,
        ease: motionTokens.ease,
      }}
    >
      {children}
    </motion.div>
  );
});
export function VoyeyPurchasePortal({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null),
    present = useIsPresent();
  useEffect(() => {
    setHost(document.getElementById("vy-purchase-slot"));
  }, []);
  return present && host ? createPortal(children, host) : null;
}
