"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function SettingsPage() {
  const [defaultVatRate, setDefaultVatRate] = useState("15");
  const [language, setLanguage] = useState("ar");
  const [printFormat, setPrintFormat] = useState("THERMAL");
  const [phone, setPhone] = useState("");

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        setDefaultVatRate(data.defaultVatRate);
        setLanguage(data.language);
        setPrintFormat(data.printFormat);
        setPhone(data.phone ?? "");
      });
  }, []);

  async function handleSave() {
    await fetch("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({ defaultVatRate, language, printFormat, phone }),
    });
  }

  return (
    <Card className="max-w-md border border-border-subtle shadow-[0_1px_2px_rgba(16,44,30,0.03),0_6px_16px_rgba(16,44,30,0.05)]">
      <CardHeader>
        <CardTitle className="text-heading">Settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label htmlFor="vat" className="mb-1.5 block text-[10.5px] font-bold uppercase tracking-wider text-muted-fg">
            Default VAT Rate (%)
          </Label>
          <Input id="vat" value={defaultVatRate} onChange={(e) => setDefaultVatRate(e.target.value)} />
        </div>

        <div>
          <Label htmlFor="lang" className="mb-1.5 block text-[10.5px] font-bold uppercase tracking-wider text-muted-fg">
            Language
          </Label>
          <select
            id="lang"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="w-full rounded-lg border border-input h-8 px-3 text-sm bg-background"
          >
            <option value="ar">Arabic</option>
            <option value="en">English</option>
          </select>
        </div>

        <div>
          <Label htmlFor="phone" className="mb-1.5 block text-[10.5px] font-bold uppercase tracking-wider text-muted-fg">
            Business Phone
          </Label>
          <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+966 5X XXX XXXX" />
        </div>

        <div>
          <Label
            htmlFor="printFormat"
            className="mb-1.5 block text-[10.5px] font-bold uppercase tracking-wider text-muted-fg"
          >
            Print Format
          </Label>
          <select
            id="printFormat"
            value={printFormat}
            onChange={(e) => setPrintFormat(e.target.value)}
            className="w-full rounded-lg border border-input h-8 px-3 text-sm bg-background"
          >
            <option value="THERMAL">Thermal (receipt roll)</option>
            <option value="A4">A4 (full page)</option>
          </select>
        </div>

        <Button onClick={handleSave} variant="primary">
          Save Changes
        </Button>
      </CardContent>
    </Card>
  );
}
