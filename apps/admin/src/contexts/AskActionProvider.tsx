import { Loader2 } from "lucide-react";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { AskActionContext, type AskActionApi, type AskApiWithMessage, type AskConfig } from "@/contexts/AskActionContext";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/shared/ui/dialog";

const CONFIRM_STYLES: Record<NonNullable<AskConfig<AskApiWithMessage>["variant"]>, string> = {
  primary: "bg-primary hover:bg-primary/90",
  danger: "bg-destructive hover:bg-destructive/90",
  warning: "bg-amber-500 hover:bg-amber-600",
  success: "bg-success-500 hover:bg-success-500/90",
};

/** Mounted once around the app; pages call `useAskAction().ask({...})`. */
export function AskActionProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AskConfig<AskApiWithMessage> | null>(null);
  const [loading, setLoading] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const [input, setInput] = useState("");

  const reset = useCallback(() => {
    setConfig(null);
    setLoading(false);
    setInlineError(null);
    setInput("");
  }, []);

  const close = useCallback(() => {
    // Never mid-request: the outcome would be lost.
    if (!loading) reset();
  }, [loading, reset]);

  const ask = useCallback(<TApi extends AskApiWithMessage>(next: AskConfig<TApi>) => {
    // Callbacks are contravariant in TApi, so the widened config needs a double cast.
    setConfig(next as unknown as AskConfig<AskApiWithMessage>);
    setInlineError(null);
    setLoading(false);
    setInput(next.input?.defaultValue ?? "");
  }, []);

  const validate = () => {
    const cfg = config?.input;
    if (!cfg) return null;
    const v = input.trim();
    if (cfg.required && v.length === 0) return `${cfg.label ?? "This field"} is required`;
    // An optional field may stay empty; anything typed still has to be long enough.
    if (cfg.minLength && (cfg.required || v.length > 0) && v.length < cfg.minLength) return `Use at least ${cfg.minLength} characters`;
    if (cfg.maxLength && v.length > cfg.maxLength) return `Use at most ${cfg.maxLength} characters`;
    return null;
  };

  const decline = () => {
    if (loading) return;
    config?.onDecline?.();
    reset();
  };

  const confirm = async () => {
    if (!config || loading) return;
    const problem = validate();
    if (problem) {
      setInlineError(problem);
      return;
    }
    setLoading(true);
    try {
      const res = await config.onConfirm({ inputValue: input.trim() });
      config.onSuccess?.(res);
      reset();
      toast.success(res.message);
    } catch (err) {
      // Stays open with the reason, so they can fix it or try again.
      setLoading(false);
      config.onError?.(err);
      setInlineError(err instanceof Error && err.message ? err.message : "Something went wrong. Try again.");
    }
  };

  const ctx = useMemo<AskActionApi>(() => ({ ask, close }), [ask, close]);
  const field = config?.input;

  return (
    <AskActionContext.Provider value={ctx}>
      {children}
      <Dialog open={!!config} onOpenChange={(open) => !open && decline()}>
        <DialogContent className="sm:max-w-md" showCloseButton={false} onInteractOutside={(e) => loading && e.preventDefault()}>
          <div className="space-y-2 text-center">
            <DialogTitle className="font-heading text-base font-semibold text-grey-800">{config?.title}</DialogTitle>
            {config?.description ? (
              <DialogDescription asChild>
                <div className="text-sm text-grey-500">{config.description}</div>
              </DialogDescription>
            ) : (
              <DialogDescription className="sr-only">{config?.title}</DialogDescription>
            )}

            {field && (
              <div className="mt-4 w-full text-left">
                {field.label && (
                  <label htmlFor="ask-action-input" className="mb-1 block text-sm font-medium text-grey-800">
                    {field.label}
                    {field.required && <span className="text-destructive"> *</span>}
                  </label>
                )}
                {field.variant === "textarea" ? (
                  <textarea
                    id="ask-action-input"
                    value={input}
                    onChange={(e) => {
                      setInput(e.target.value);
                      setInlineError(null);
                    }}
                    placeholder={field.placeholder}
                    maxLength={field.maxLength}
                    disabled={loading}
                    className="min-h-24 w-full rounded-xl border border-grey-100 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
                  />
                ) : (
                  <input
                    id="ask-action-input"
                    value={input}
                    onChange={(e) => {
                      setInput(e.target.value);
                      setInlineError(null);
                    }}
                    placeholder={field.placeholder}
                    maxLength={field.maxLength}
                    disabled={loading}
                    className="h-10 w-full rounded-xl border border-grey-100 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
                  />
                )}
              </div>
            )}

            {inlineError && <div className="mt-2 rounded-xl bg-destructive/5 px-3 py-2 text-left text-sm text-destructive">{inlineError}</div>}
          </div>

          <div className="mt-2 flex justify-between gap-2 border-t border-grey-50 pt-4">
            <button
              type="button"
              onClick={decline}
              disabled={loading}
              className="rounded-xl bg-grey-25 px-4 py-2 text-sm font-medium text-grey-800 hover:bg-grey-50 disabled:opacity-50"
            >
              {config?.cancelText ?? "Cancel"}
            </button>
            <button
              type="button"
              onClick={() => void confirm()}
              disabled={loading}
              className={cn("rounded-xl px-4 py-2 text-sm font-medium text-white disabled:opacity-50", CONFIRM_STYLES[config?.variant ?? "primary"])}
            >
              <span className="flex items-center gap-2">
                {loading && <Loader2 className="size-4 animate-spin" />}
                {config?.confirmText ?? "Confirm"}
              </span>
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </AskActionContext.Provider>
  );
}
