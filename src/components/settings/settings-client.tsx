"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLocale } from "@/lib/i18n/language-provider";
import { useToast } from "@/lib/toast/toast-provider";
import { Loader2Icon } from "lucide-react";

export function SettingsClient() {
  const { dict } = useLocale();
  const { toast } = useToast();
  const [defaultVatRate, setDefaultVatRate] = useState("15");
  const [language, setLanguage] = useState("ar");
  const [printFormat, setPrintFormat] = useState("THERMAL");
  const [phone, setPhone] = useState("");
  const [cashierCanManageCatalog, setCashierCanManageCatalog] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        setDefaultVatRate(data.defaultVatRate);
        setLanguage(data.language);
        setPrintFormat(data.printFormat);
        setPhone(data.phone ?? "");
        setCashierCanManageCatalog(data.cashierCanManageCatalog);
        setLoaded(true);
      });
  }, []);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ defaultVatRate, language, printFormat, phone, cashierCanManageCatalog }),
      });
      if (!response.ok) {
        setError(dict.settings.saveError);
        return;
      }
      toast.success(dict.settings.savedToast);
    } catch {
      setError(dict.settings.saveError);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="max-w-md border border-border-subtle shadow-[0_1px_2px_rgba(16,44,30,0.03),0_6px_16px_rgba(16,44,30,0.05)]">
      <CardHeader>
        <CardTitle className="text-heading">{dict.settings.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label htmlFor="vat" className="mb-1.5 block text-[10.5px] font-bold uppercase tracking-wider text-muted-fg">
            {dict.settings.defaultVatRate}
          </Label>
          <Input id="vat" value={defaultVatRate} onChange={(e) => setDefaultVatRate(e.target.value)} />
        </div>

        <div>
          <Label htmlFor="lang" className="mb-1.5 block text-[10.5px] font-bold uppercase tracking-wider text-muted-fg">
            {dict.settings.language}
          </Label>
          <select
            id="lang"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="w-full rounded-lg border border-input h-8 px-3 text-sm bg-background"
          >
            <option value="ar">العربية</option>
            <option value="en">English</option>
          </select>
          <p className="mt-1.5 text-xs text-muted-fg">{dict.settings.languageCaption}</p>
        </div>

        <div>
          <Label htmlFor="phone" className="mb-1.5 block text-[10.5px] font-bold uppercase tracking-wider text-muted-fg">
            {dict.settings.businessPhone}
          </Label>
          <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+966 5X XXX XXXX" />
        </div>

        <div>
          <Label
            htmlFor="printFormat"
            className="mb-1.5 block text-[10.5px] font-bold uppercase tracking-wider text-muted-fg"
          >
            {dict.settings.printFormat}
          </Label>
          <select
            id="printFormat"
            value={printFormat}
            onChange={(e) => setPrintFormat(e.target.value)}
            className="w-full rounded-lg border border-input h-8 px-3 text-sm bg-background"
          >
            <option value="THERMAL">{dict.settings.thermal}</option>
            <option value="A4">{dict.settings.a4}</option>
          </select>
        </div>

        <label className="flex items-center gap-2 text-sm text-body">
          <Checkbox
            checked={cashierCanManageCatalog}
            onCheckedChange={(checked) => setCashierCanManageCatalog(checked === true)}
          />
          {dict.settings.cashierCanManageCatalog}
        </label>

        {error && (
          <p role="alert" className="text-xs text-red-600">
            {error}
          </p>
        )}

        <Button onClick={handleSave} variant="primary" disabled={!loaded || saving}>
          {saving && <Loader2Icon className="size-3.5 animate-spin" />}
          {dict.settings.saveChanges}
        </Button>
      </CardContent>
    </Card>
  );
}
