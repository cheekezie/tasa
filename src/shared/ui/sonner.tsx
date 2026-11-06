import { Toaster as Sonner, type ToasterProps } from "sonner";

export function Toaster({ ...props }: ToasterProps) {
  return (
    <Sonner
      theme="system"
      richColors
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          // success
          "--success-bg": "var(--green-96)",
          "--success-text": "var(--green-dark)",
          "--success-border": "var(--green-74)",
          // error
          "--error-bg": "#fff1f0",
          "--error-text": "#BE2434",
          "--error-border": "#fca5a5",

          // warning
          "--warning-bg": "#fff3cd",
          "--warning-text": "#856404",
          "--warning-border": "#f8d7da",
          // info
          "--info-bg": "#e6f7ff",
          "--info-text": "#007bff",
          "--info-border": "#b8daff",
        } as React.CSSProperties
      }
      {...props}
    />
  );
}
