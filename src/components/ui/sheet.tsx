"use client"

import * as React from "react"
import { Dialog as SheetPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Sheet({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetPortal({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/40 transition-opacity duration-200 data-[state=closed]:opacity-0 data-[state=open]:opacity-100",
        className
      )}
      {...props}
    />
  )
}

// A left(start)-anchored slide-in panel for mobile/tablet navigation -- built
// on the same Dialog primitive as the modal system (focus trap, Escape to
// close, scroll lock all come for free) but positioned and animated as a
// drawer instead of a centered dialog. The slide is a plain `transition-transform`
// keyed off Radix's own `data-state`, not the tw-animate-css keyframe utilities --
// those never settled to their resting transform in this project's Tailwind v4
// setup (verified empirically: the element stayed pinned at its off-screen
// starting position well after the animation's duration had elapsed). `start-0`
// plus the RTL-aware translate pairing below means this opens from the left
// under `dir=ltr` and from the right under `dir=rtl` with no separate branch.
function SheetContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content>) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          "fixed inset-y-0 start-0 z-50 flex h-full w-[78%] max-w-[280px] flex-col outline-none transition-transform duration-200 ease-out",
          "data-[state=closed]:-translate-x-full rtl:data-[state=closed]:translate-x-full",
          "data-[state=open]:translate-x-0",
          className
        )}
        {...props}
      >
        {children}
      </SheetPrimitive.Content>
    </SheetPortal>
  )
}

export { Sheet, SheetContent, SheetOverlay, SheetPortal }
