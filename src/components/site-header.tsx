import { Link, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { LayoutGrid, LogOut, LogIn } from "lucide-react";

export function SiteHeader() {
  const { user, signOut, loading } = useAuth();
  const navigate = useNavigate();

  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <Link to="/" className="text-base font-medium tracking-tight">
          Lossless
        </Link>
        <nav className="flex items-center gap-2">
          {loading ? null : user ? (
            <>
              <Link to="/dashboard">
                <Button variant="ghost" size="sm">
                  <LayoutGrid /> Dashboard
                </Button>
              </Link>
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  await signOut();
                  navigate({ to: "/" });
                }}
              >
                <LogOut /> Sign out
              </Button>
            </>
          ) : (
            <Link to="/auth">
              <Button variant="ghost" size="sm">
                <LogIn /> Sign in
              </Button>
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
