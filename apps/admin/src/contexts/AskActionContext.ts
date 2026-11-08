import { createContext, type ReactNode } from "react";

/**
 * One confirmation for every action that changes something important (deletes, approvals,
 * verifications, suspensions…): ask, run it with a spinner, close and toast the API's message on
 * success, or stay open with the error so it can be retried. Ported from the fees admin portal.
 */
export type AskActionApi = {
  ask: <TApi extends AskApiWithMessage>(config: AskConfig<TApi>) => void;
  close: () => void;
};

/** Whatever `onConfirm` resolves to must carry the message to show when it succeeds. */
export type AskApiWithMessage = { message: string };

export type AskInputConfig = {
  label?: string;
  placeholder?: string;
  required?: boolean;
  variant?: "text" | "textarea";
  defaultValue?: string;
  minLength?: number;
  maxLength?: number;
};

export type AskConfig<TApi extends AskApiWithMessage> = {
  title: string;
  description?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: "primary" | "danger" | "warning" | "success";
  /** One optional field, e.g. the reason for a rejection. Its value reaches `onConfirm`. */
  input?: AskInputConfig;
  /** Runs the action; throw to keep the dialog open with the error. */
  onConfirm: (values: { inputValue?: string }) => Promise<TApi>;
  onSuccess?: (res: TApi) => void;
  onError?: (error: unknown) => void;
  onDecline?: () => void;
};

export const AskActionContext = createContext<AskActionApi | null>(null);
