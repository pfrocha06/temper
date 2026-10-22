import { createContext, use, useState, type ReactNode } from "react";

type Dialog = "new-ticket" | "import-spec" | "palette";

type AppActions = {
  open: Dialog | null;
  show: (d: Dialog) => void;
  setOpen: (d: Dialog, open: boolean) => void;
};

const Ctx = createContext<AppActions | null>(null);

/** App-wide dialogs, so the command palette, hotkeys and page buttons open the same ones. */
export function AppActionsProvider({ children }: { children: ReactNode }) {
  const [open, setOpenState] = useState<Dialog | null>(null);
  const value: AppActions = {
    open,
    show: setOpenState,
    setOpen: (d, isOpen) => setOpenState((cur) => (isOpen ? d : cur === d ? null : cur)),
  };
  return <Ctx value={value}>{children}</Ctx>;
}

export function useAppActions(): AppActions {
  const ctx = use(Ctx);
  if (!ctx) throw new Error("useAppActions outside AppActionsProvider");
  return ctx;
}
