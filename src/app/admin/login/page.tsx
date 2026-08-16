import { redirect } from "next/navigation";
import { AuthError } from "next-auth";
import { signIn } from "@/lib/admin-auth/config";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  async function handleLogin(formData: FormData) {
    "use server";
    try {
      await signIn("credentials", {
        email: formData.get("email"),
        password: formData.get("password"),
        redirectTo: "/admin",
      });
    } catch (err) {
      if (err instanceof AuthError) {
        redirect("/admin/login?error=CredentialsSignin");
      }
      throw err;
    }
  }

  return (
    <div dir="ltr" className="flex min-h-screen items-center justify-center bg-neutral-50">
      <form action={handleLogin} className="w-[340px] rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex flex-col items-center">
          <div className="mb-3 flex size-11 items-center justify-center rounded-xl bg-green-950 text-sm font-extrabold text-white">
            FS
          </div>
          <h1 className="text-[15px] font-semibold text-neutral-900">Agency sign in</h1>
          <p className="mt-1 text-xs text-neutral-500">Separate from tenant Owner/Cashier logins</p>
        </div>

        {error && (
          <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
            Invalid email or password.
          </p>
        )}

        <div className="mb-4">
          <label htmlFor="email" className="mb-1.5 block text-xs font-semibold text-neutral-600">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-green-700"
          />
        </div>

        <div className="mb-5">
          <label htmlFor="password" className="mb-1.5 block text-xs font-semibold text-neutral-600">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-green-700"
          />
        </div>

        <button
          type="submit"
          className="w-full rounded-lg bg-green-800 py-2 text-sm font-semibold text-white transition-colors hover:bg-green-700"
        >
          Sign in
        </button>
      </form>
    </div>
  );
}
