import { cn } from "@/lib/utils";
import { ChevronLeft } from "lucide-react";

interface BackButtonProps {
  className?: string;
  onClick?: () => void;
  disabled?: boolean;
}

export default function BackButton({ className, onClick, disabled }: BackButtonProps) {
  return (
    <button
      className={cn(
        "flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-grey-50 bg-grey-25 transition-colors duration-200 hover:bg-grey-50",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      onClick={onClick}
      disabled={disabled}
    >
      <ChevronLeft className="text-grey-500" />
    </button>
  );
}
