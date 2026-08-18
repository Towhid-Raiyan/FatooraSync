"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import type { IScannerControls } from "@zxing/browser";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/lib/i18n/language-provider";

interface BarcodeScannerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDetected: (code: string) => void;
}

// Camera half of item 3's "both" barcode-scanning requirement -- the physical
// USB/Bluetooth scanner half needs no library, it just types into whatever
// input is focused (see the Enter-key handling in items-section.tsx and
// product-form-dialog.tsx). This modal is only for shops without a physical
// scanner plugged in.
export function BarcodeScannerModal({ open, onOpenChange, onDetected }: BarcodeScannerModalProps) {
  const { dict } = useLocale();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);

    const reader = new BrowserMultiFormatReader();
    let controls: IScannerControls | undefined;
    let cancelled = false;

    reader
      .decodeFromVideoDevice(undefined, videoRef.current ?? undefined, (result, _err, ctrl) => {
        if (cancelled) return;
        controls = ctrl;
        if (result) {
          onDetected(result.getText());
          onOpenChange(false);
        }
      })
      .catch(() => {
        if (!cancelled) setError(dict.barcodeScanner.cameraError);
      });

    return () => {
      cancelled = true;
      controls?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{dict.barcodeScanner.title}</DialogTitle>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        ) : (
          <>
            <video ref={videoRef} className="aspect-video w-full rounded-lg bg-black" muted playsInline />
            <p className="text-center text-xs text-muted-fg">{dict.barcodeScanner.hint}</p>
          </>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {dict.a11y.close}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
