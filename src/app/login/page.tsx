import { redirect } from "next/navigation";
import Image from "next/image";
import { auth, signIn } from "../../../auth";
import { authenticationEnabled } from "@/lib/access";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (!authenticationEnabled()) redirect("/");
  const session = await auth();
  if (session?.user) redirect("/");

  return (
    <main className="login-page">
      <section className="login-panel">
        <Image src="/star-websites.png" alt="Star Websites" width={88} height={35} priority />
        <h1>Report Hub</h1>
        <p>Sign in with an approved Google account.</p>
        <form action={async () => {
          "use server";
          await signIn("google", { redirectTo: "/" });
        }}>
          <button className="button" type="submit">Continue with Google</button>
        </form>
      </section>
    </main>
  );
}
