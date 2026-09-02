import { redirect } from "next/navigation";
import Image from "next/image";
import { auth, signIn } from "../../../auth";
import { authenticationEnabled } from "@/lib/access";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (!authenticationEnabled()) redirect("/");
  const session = await auth();
  if (session?.user) redirect("/");
  const { error } = await searchParams;

  return (
    <main className="login-page">
      <section className="login-panel">
        <Image src="/star-websites.png" alt="Star Websites" width={88} height={35} priority />
        <h1>Report Hub</h1>
        <p>Sign in with an approved Google account.</p>
        {error ? (
          <div className="notice danger-notice" role="alert">
            This Google account is not currently approved for Report Hub.
          </div>
        ) : null}
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
