"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function SettingsPage() {
  const [defaultVatRate, setDefaultVatRate] = useState("15");
  const [language, setLanguage] = useState("ar");

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        setDefaultVatRate(data.defaultVatRate);
        setLanguage(data.language);
      });
  }, []);

  async function handleSave() {
    await fetch("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({ defaultVatRate, language }),
    });
  }

  return (
    <Card className="max-w-md border-border-subtle shadow-[0_1px_2px_rgba(16,44,30,0.03),0_6px_16px_rgba(16,44,30,0.05)]">
      <CardHeader>
        <CardTitle className="text-heading">Settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label htmlFor="vat" className="mb-1.5 block text-xs font-semibold text-body">
            Default VAT Rate (%)
          </Label>
          <Input id="vat" value={defaultVatRate} onChange={(e) => setDefaultVatRate(e.target.value)} />
        </div>

        <div>
          <Label htmlFor="lang" className="mb-1.5 block text-xs font-semibold text-body">
            Language
          </Label>
          <select
            id="lang"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="w-full rounded-md border border-border-subtle px-3 py-2 text-sm"
          >
            <option value="ar">Arabic</option>
            <option value="en">English</option>
          </select>
        </div>

        <Button onClick={handleSave} className="bg-gradient-to-br from-primary-hover to-primary-dark">
          Save Changes
        </Button>
      </CardContent>
    </Card>
  );
}
