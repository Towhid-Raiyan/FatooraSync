export interface PasswordRule {
  id: "minLength" | "uppercase" | "number" | "special";
  test: (password: string) => boolean;
}

export const PASSWORD_RULES: PasswordRule[] = [
  { id: "minLength", test: (p) => p.length >= 8 },
  { id: "uppercase", test: (p) => /[A-Z]/.test(p) },
  { id: "number", test: (p) => /[0-9]/.test(p) },
  { id: "special", test: (p) => /[^A-Za-z0-9]/.test(p) },
];

export function isPasswordValid(password: string): boolean {
  return PASSWORD_RULES.every((rule) => rule.test(password));
}
