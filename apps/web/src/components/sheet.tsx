"use client";

import * as Dialog from "@radix-ui/react-dialog";

/**
 * dialog: centred on desktop, a bottom sheet on the phone (`mxDialog`, money.css).
 * panel: slides in from the right on desktop, full screen on the phone (`ovPanel`, overview.css).
 */
const variants = {
  dialog: { overlay: "mxDialogOverlay", content: "mxDialog" },
  panel: { overlay: "ovScrim", content: "ovPanel" }
} as const;

type SheetProps = {
  /** Controlled: omit for a sheet that is open while it's rendered. */
  open?: boolean;
  onOpenChange: (open: boolean) => void;
  /** The element that opens it, when the sheet owns its trigger (Radix `asChild`). */
  trigger?: React.ReactElement;
  /** The id of the text that describes it, for screen readers. */
  describedBy?: string;
  variant?: keyof typeof variants;
  className?: string;
  children: React.ReactNode;
};

/**
 * A dismissible dialog: scrim, focus trap, Escape, and focus returned to what opened it. Children bring the title
 * (`Dialog.Title`) and any `Dialog.Close`.
 */
export function Sheet({ open = true, onOpenChange, trigger, describedBy, variant = "dialog", className, children }: SheetProps) {
  const classes = variants[variant];
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    {trigger && <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>}
    <Dialog.Portal>
      <Dialog.Overlay className={classes.overlay} />
      <Dialog.Content className={`${classes.content}${className ? ` ${className}` : ""}`} aria-describedby={describedBy}>{children}</Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
