import { auth, signOut } from "../../auth";
import { authenticationEnabled } from "@/lib/access";

export async function AccountControl() {
  if (!authenticationEnabled()) return <span className="status warn">Sign-in not enabled</span>;
  const session = await auth();
  if (!session?.user?.email) return null;
  return (
    <div className="account-control">
      <span>{session.user.name ?? session.user.email}</span>
      <span className="status">{session.user.role}</span>
      <form action={async () => {
        "use server";
        await signOut({ redirectTo: "/login" });
      }}>
        <button type="submit">Sign out</button>
      </form>
    </div>
  );
}
