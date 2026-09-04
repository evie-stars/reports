import Image from "next/image";
import { redirect } from "next/navigation";
import { auth } from "../../../../auth";
import { signInWithGoogle } from "@/actions/auth";
import { Notice } from "@/components/ui/notice";
import { authenticationEnabled } from "@/lib/access";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (!authenticationEnabled()) redirect("/");
  const session = await auth();
  if (session?.user) redirect("/");
  const { error } = await searchParams;

  return (
    <div className="min-h-[calc(100vh-1.5rem)] md:min-h-full flex items-center justify-center p-4">
      <div className="card w-full max-w-sm text-center p-6">
        <Image src="/star-websites.png" alt="Star Websites" width={120} height={48} priority className="h-11 w-auto mx-auto mb-5" />
        <h1 className="text-2xl mb-1 flex items-center justify-center gap-2">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-accent" />
          Report Hub
        </h1>
        <p className="text-slate text-sm mb-6">Sign in with an approved Google account.</p>
        {error ? (
          <Notice tone="danger" role="alert">This Google account is not currently approved for Report Hub.</Notice>
        ) : null}
        <form action={signInWithGoogle}>
          <button type="submit" className="btn-dark w-full py-2.5">Continue with Google</button>
        </form>
      </div>
    </div>
  );
}
