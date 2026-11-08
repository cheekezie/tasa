import * as React from "react";

import { cn } from "@/lib/utils";

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div data-slot="table-container" className="relative w-full overflow-x-auto bg-white">
      <table
        data-slot="table"
        className={cn("text-body w-full caption-bottom", className)}
        {...props}
      />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("border-0 border-b border-b-[#D9D9D9] bg-[#FAFAFC] [&_tr]:border-0", className)}
      {...props}
    />
  );
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("border-0 [&_tr:last-child]:border-0", className)}
      // className={cn("[&_tr:last-child]:border-0 border-0", className)}
      {...props}
    />
  );
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn("border-0 bg-muted/50 font-medium [&>tr]:last:border-b-0", className)}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b border-b-[#D9D9D9] transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
        className,
      )}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "manrope h-8 border-0 px-2 text-left align-middle text-[11px] font-medium whitespace-nowrap text-[#414651] sm:h-9 sm:px-3 sm:text-xs md:h-10 md:text-body lg:h-11 lg:px-5 [&:has([role=checkbox])]:pr-0",
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "manrope h-10 border-0 px-2 py-1.5 align-middle text-[11px] whitespace-nowrap text-[#414651] sm:h-11 sm:px-3 sm:py-2 sm:text-xs md:h-14 md:px-4 md:py-3 md:text-body lg:h-[72px] lg:px-5 lg:py-4 [&:has([role=checkbox])]:pr-0",
        // Single values stay on one line; sentences and width-capped blocks wrap inside their column
        // instead of running into the next one. Text meant to be cut off (`truncate`) still is.
        "[&_p:not(.truncate)]:whitespace-normal [&_[class*=max-w-]:not(.truncate)]:whitespace-normal [&_p]:break-words",
        "[&_[data-slot=button]]:h-7 [&_[data-slot=button]]:gap-1 [&_[data-slot=button]]:px-2 [&_[data-slot=button]]:text-[11px] [&_[data-slot=button]_svg]:size-3",
        "sm:[&_[data-slot=button]]:h-8 sm:[&_[data-slot=button]]:px-2.5 sm:[&_[data-slot=button]]:text-xs sm:[&_[data-slot=button]_svg]:size-3.5",
        "lg:[&_[data-slot=button]]:h-10 lg:[&_[data-slot=button]]:gap-1.5 lg:[&_[data-slot=button]]:px-4 lg:[&_[data-slot=button]]:text-sm lg:[&_[data-slot=button]_svg]:size-4",
        "[&_[data-slot=button][data-size=icon-sm]]:size-7 sm:[&_[data-slot=button][data-size=icon-sm]]:size-8",
        className,
      )}
      {...props}
    />
  );
}

function TableCaption({ className, ...props }: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };
