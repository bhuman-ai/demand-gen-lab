import { redirect } from "next/navigation";
import AuthScreen from "@/components/auth/auth-screen";
import { AUTHENTICATED_HOME } from "@/lib/auth-paths";
import { getRequestAuthSession } from "@/lib/auth-server";

export default async function SignupPage() {
  const session = await getRequestAuthSession();
  if (session) {
    redirect(AUTHENTICATED_HOME);
  }

  return <AuthScreen mode="signup" />;
}
