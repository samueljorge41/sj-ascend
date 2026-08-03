import * as React from "react";
import * as ToastPrimitives from "@radix-ui/react-toast";

import { cva } from "class-variance-authority";

import {
  CheckCircle2,
  Info,
  TriangleAlert,
  X,
  XCircle,
} from "lucide-react";

import { cn } from "@/lib/utils";

const ToastProvider =
  ToastPrimitives.Provider;

const ToastViewport =
  React.forwardRef(
    (
      {
        className,
        ...props
      },
      ref
    ) => (
      <ToastPrimitives.Viewport
        ref={ref}
        className={cn(
          "fixed bottom-0 right-0 z-[100] flex max-h-screen w-full flex-col items-end gap-3 p-4 sm:max-w-[420px]",
          className
        )}
        {...props}
      />
    )
  );

ToastViewport.displayName =
  ToastPrimitives.Viewport.displayName;

const toastVariants = cva(
  [
    "group",
    "pointer-events-auto",
    "relative",
    "flex",
    "w-full",
    "items-start",
    "gap-3",
    "overflow-hidden",
    "rounded-xl",
    "border",
    "p-4",
    "pr-10",
    "shadow-xl",
    "backdrop-blur-sm",
    "transition-all duration-500 ease-out",

    "data-[state=open]:animate-in",
    "data-[state=open]:fade-in-0",
    "data-[state=open]:slide-in-from-bottom-3",
    "data-[state=open]:duration-300",

    "data-[state=closed]:animate-out",
    "data-[state=closed]:fade-out-0",
    "data-[state=closed]:slide-out-to-right-10",
    "data-[state=closed]:duration-500",

    "data-[swipe=end]:animate-out",
  ].join(" "),
  {
    variants: {
      variant: {
        default:
          "border-border bg-background/95 text-foreground",

        success:
          "border-emerald-500/30 bg-emerald-50/95 text-emerald-950 dark:bg-emerald-950/95 dark:text-emerald-50",

        destructive:
          "border-destructive/30 bg-destructive text-destructive-foreground",

        warning:
          "border-amber-500/30 bg-amber-50/95 text-amber-950 dark:bg-amber-950/95 dark:text-amber-50",

        info:
          "border-blue-500/30 bg-blue-50/95 text-blue-950 dark:bg-blue-950/95 dark:text-blue-50",
      },
    },

    defaultVariants: {
      variant: "default",
    },
  }
);

function ToastIcon({
  variant,
}) {
  const commonClass =
    "mt-0.5 h-5 w-5 shrink-0";

  if (variant === "success") {
    return (
      <CheckCircle2
        className={cn(
          commonClass,
          "text-emerald-600 dark:text-emerald-400"
        )}
      />
    );
  }

  if (
    variant ===
    "destructive"
  ) {
    return (
      <XCircle
        className={cn(
          commonClass,
          "text-current"
        )}
      />
    );
  }

  if (variant === "warning") {
    return (
      <TriangleAlert
        className={cn(
          commonClass,
          "text-amber-600 dark:text-amber-400"
        )}
      />
    );
  }

  return (
    <Info
      className={cn(
        commonClass,
        variant === "info"
          ? "text-blue-600 dark:text-blue-400"
          : "text-muted-foreground"
      )}
    />
  );
}

const Toast =
  React.forwardRef(
    (
      {
        className,
        variant,
        children,
        ...props
      },
      ref
    ) => (
      <ToastPrimitives.Root
        ref={ref}
        className={cn(
          toastVariants({
            variant,
          }),
          className
        )}
        {...props}
      >
        <ToastIcon
          variant={variant}
        />

        {children}
      </ToastPrimitives.Root>
    )
  );

Toast.displayName =
  ToastPrimitives.Root.displayName;

const ToastAction =
  React.forwardRef(
    (
      {
        className,
        ...props
      },
      ref
    ) => (
      <ToastPrimitives.Action
        ref={ref}
        className={cn(
          "inline-flex h-8 shrink-0 items-center justify-center rounded-md border bg-transparent px-3 text-sm font-medium transition-colors hover:bg-black/5 focus:outline-none focus:ring-2 focus:ring-ring disabled:pointer-events-none disabled:opacity-50 dark:hover:bg-white/10",
          className
        )}
        {...props}
      />
    )
  );

ToastAction.displayName =
  ToastPrimitives.Action.displayName;

const ToastClose =
  React.forwardRef(
    (
      {
        className,
        ...props
      },
      ref
    ) => (
      <ToastPrimitives.Close
        ref={ref}
        className={cn(
          "absolute right-2 top-2 rounded-md p-1 text-current opacity-50 transition-opacity hover:opacity-100 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring",
          className
        )}
        {...props}
      >
        <X className="h-4 w-4" />
      </ToastPrimitives.Close>
    )
  );

ToastClose.displayName =
  ToastPrimitives.Close.displayName;

const ToastTitle =
  React.forwardRef(
    (
      {
        className,
        ...props
      },
      ref
    ) => (
      <ToastPrimitives.Title
        ref={ref}
        className={cn(
          "text-sm font-semibold leading-tight",
          className
        )}
        {...props}
      />
    )
  );

ToastTitle.displayName =
  ToastPrimitives.Title.displayName;

const ToastDescription =
  React.forwardRef(
    (
      {
        className,
        ...props
      },
      ref
    ) => (
      <ToastPrimitives.Description
        ref={ref}
        className={cn(
          "text-sm leading-relaxed opacity-80",
          className
        )}
        {...props}
      />
    )
  );

ToastDescription.displayName =
  ToastPrimitives.Description.displayName;

export {
  ToastProvider,
  ToastViewport,
  Toast,
  ToastTitle,
  ToastDescription,
  ToastClose,
  ToastAction,
};