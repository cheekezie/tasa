import { useContext } from "react";
import { AskActionContext } from "@/contexts/AskActionContext";

export function useAskAction() {
  const ctx = useContext(AskActionContext);
  if (!ctx) throw new Error("useAskAction must be used within AskActionProvider");
  return ctx;
}
