import { LoginForm } from "./login-form";
import { getServices } from "@/composition";

interface LoginPageProps {
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = (await searchParams) ?? {};
  const rawError = params.error;
  const initialError = typeof rawError === "string" ? rawError : null;
  const services = getServices();
  const initialEmail = services.config.seed.heliosAdmin?.email ?? "";

  return <LoginForm initialError={initialError} initialEmail={initialEmail} />;
}
