import { LoginForm } from "./login-form";

interface LoginPageProps {
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = (await searchParams) ?? {};
  const rawError = params.error;
  const initialError = typeof rawError === "string" ? rawError : null;

  return <LoginForm initialError={initialError} />;
}
