"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useLocale } from "@/lib/i18n/language-provider";
import { isPasswordValid } from "@/lib/auth/password-rules";
import { PasswordChecklist } from "./password-checklist";

interface Cashier {
  id: string;
  email: string;
  isActive: boolean;
}

const LABEL_CLASS = "mb-1.5 block text-[10.5px] font-bold uppercase tracking-wider text-muted-fg";

export function StaffSection({ initialCashiers }: { initialCashiers: Cashier[] }) {
  const { dict } = useLocale();
  const [cashiers, setCashiers] = useState(initialCashiers);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  function openDialog() {
    setEmail("");
    setPassword("");
    setError(null);
    setDialogOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/users", { method: "POST", body: JSON.stringify({ email, password }) });
      const body = await response.json();
      if (!response.ok) {
        setError(body.error ?? dict.common.somethingWentWrong);
        return;
      }
      setCashiers((prev) => [...prev, body]);
      setDialogOpen(false);
    } catch {
      setError(dict.common.somethingWentWrong);
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(cashier: Cashier) {
    setActionError(null);
    try {
      const response = await fetch(`/api/users/${cashier.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !cashier.isActive }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setActionError(body.error ?? dict.common.somethingWentWrong);
        return;
      }
      const updated = await response.json();
      setCashiers((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    } catch {
      setActionError(dict.common.somethingWentWrong);
    }
  }

  const canSubmit = email.trim() !== "" && isPasswordValid(password);

  return (
    <Card className="max-w-md border border-border-subtle shadow-[0_1px_2px_rgba(16,44,30,0.03),0_6px_16px_rgba(16,44,30,0.05)] p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-heading text-base font-medium text-heading">{dict.staff.title}</h2>
        <Button variant="primary" size="sm" onClick={openDialog}>
          {dict.staff.addCashier}
        </Button>
      </div>

      {actionError && (
        <p role="alert" className="mb-3 text-xs text-red-600">
          {actionError}
        </p>
      )}

      {cashiers.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-fg">{dict.staff.noCashiersYet}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{dict.staff.email}</TableHead>
              <TableHead className="text-right">{dict.common.actions}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cashiers.map((cashier) => (
              <TableRow key={cashier.id} className={!cashier.isActive ? "opacity-50" : undefined}>
                <TableCell>
                  {cashier.email}
                  <Badge variant={cashier.isActive ? "secondary" : "outline"} className="ms-2">
                    {cashier.isActive ? dict.staff.activeBadge : dict.staff.inactiveBadge}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="outline" size="sm" onClick={() => toggleActive(cashier)}>
                    {cashier.isActive ? dict.common.deactivate : dict.common.reactivate}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dict.staff.dialogTitle}</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {error && (
              <p role="alert" className="text-xs text-red-600">
                {error}
              </p>
            )}

            <div>
              <Label htmlFor="cashier-email" className={LABEL_CLASS}>
                {dict.staff.email}
              </Label>
              <Input id="cashier-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>

            <div>
              <Label htmlFor="cashier-password" className={LABEL_CLASS}>
                {dict.staff.password}
              </Label>
              <Input
                id="cashier-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <div className="mt-2">
                <PasswordChecklist password={password} />
              </div>
            </div>

            <DialogFooter>
              <Button type="submit" variant="primary" disabled={saving || !canSubmit}>
                {saving ? dict.common.savingEllipsis : dict.common.save}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
