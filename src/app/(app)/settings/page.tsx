"use client";

import { useEffect, useState } from "react";

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
    <div>
      <label>
        Default VAT rate
        <input value={defaultVatRate} onChange={(e) => setDefaultVatRate(e.target.value)} />
      </label>
      <label>
        Language
        <select value={language} onChange={(e) => setLanguage(e.target.value)}>
          <option value="ar">Arabic</option>
          <option value="en">English</option>
        </select>
      </label>
      <button onClick={handleSave}>Save</button>
    </div>
  );
}
