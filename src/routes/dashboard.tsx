import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Trash2, Ban, Copy, ExternalLink, Loader2, ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { describeStatus, formatBytes } from "@/lib/expiration";

export const Route = createFileRoute("/dashboard")({
  component: Dashboard,
  head: () => ({ meta: [{ title: "Dashboard · Lossless" }] }),
});

type ImageRow = {
  id: string;
  file_name: string;
  size_bytes: number;
  mime_type: string;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  deleted_at: string | null;
  download_count: number;
  bytes_downloaded: number;
  storage_path: string;
};

function Dashboard() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [images, setImages] = useState<ImageRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && !user) navigate({ to: "/auth" });
  }, [user, authLoading, navigate]);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("images")
      .select("id, file_name, size_bytes, mime_type, created_at, expires_at, revoked_at, deleted_at, download_count, bytes_downloaded, storage_path")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    else setImages(data ?? []);
    setLoading(false);
  };

  useEffect(() => { if (user) load(); /* eslint-disable-next-line */ }, [user]);

  const active = images.filter((i) => !i.deleted_at);
  const totalStorage = active.reduce((s, i) => s + Number(i.size_bytes), 0);
  const totalBandwidth = images.reduce((s, i) => s + Number(i.bytes_downloaded), 0);
  const totalDownloads = images.reduce((s, i) => s + Number(i.download_count), 0);

  const revoke = async (id: string) => {
    const { error } = await supabase.from("images").update({ revoked_at: new Date().toISOString() }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Link revoked");
    load();
  };

  const unrevoke = async (id: string) => {
    const { error } = await supabase.from("images").update({ revoked_at: null }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Link restored");
    load();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("images").update({ deleted_at: new Date().toISOString() }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Image marked for deletion (file removed within 24h)");
    load();
  };

  const copyLink = async (id: string) => {
    await navigator.clipboard.writeText(`${window.location.origin}/i/${id}`);
    toast.success("Link copied");
  };

  if (authLoading || !user) {
    return (
      <>
        <SiteHeader />
        <main className="flex min-h-[calc(100vh-65px)] items-center justify-center">
          <Loader2 className="animate-spin text-muted-foreground" />
        </main>
      </>
    );
  }

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <header className="mb-8">
          <h1 className="text-2xl font-medium tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">Manage your shared images.</p>
        </header>

        <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-4">
          <StatCard label="Images stored" value={String(active.length)} />
          <StatCard label="Storage used" value={formatBytes(totalStorage)} />
          <StatCard label="Bandwidth served" value={formatBytes(totalBandwidth)} />
          <StatCard label="Total downloads" value={String(totalDownloads)} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your images</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center py-10"><Loader2 className="animate-spin text-muted-foreground" /></div>
            ) : images.length === 0 ? (
              <div className="flex flex-col items-center py-10 text-center">
                <ImageIcon className="mb-2 size-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">No images yet.</p>
                <Link to="/" className="mt-4"><Button size="sm">Upload one</Button></Link>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {images.map((img) => {
                  const status = describeStatus(img);
                  const isInactive = !!(img.deleted_at || img.revoked_at || (img.expires_at && new Date(img.expires_at) < new Date()));
                  return (
                    <div key={img.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{img.file_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatBytes(Number(img.size_bytes))} · {img.download_count} downloads · {formatDistanceToNow(new Date(img.created_at), { addSuffix: true })}
                        </p>
                      </div>
                      <span className={
                        status.tone === "ok" ? "text-xs text-muted-foreground"
                        : status.tone === "warn" ? "text-xs text-amber-600 dark:text-amber-500"
                        : "text-xs text-destructive"
                      }>
                        {status.label}
                      </span>
                      <div className="flex gap-1">
                        {!isInactive && (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => copyLink(img.id)} title="Copy link">
                              <Copy />
                            </Button>
                            <Link to="/i/$id" params={{ id: img.id }}>
                              <Button size="sm" variant="ghost" title="Open">
                                <ExternalLink />
                              </Button>
                            </Link>
                          </>
                        )}
                        {!img.deleted_at && (img.revoked_at ? (
                          <Button size="sm" variant="ghost" onClick={() => unrevoke(img.id)}>Restore</Button>
                        ) : (
                          <Button size="sm" variant="ghost" onClick={() => revoke(img.id)} title="Revoke link">
                            <Ban />
                          </Button>
                        ))}
                        {!img.deleted_at && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button size="sm" variant="ghost" title="Delete">
                                <Trash2 />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete this image?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  The share link stops working immediately. The file is permanently removed within 24 hours.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => remove(img.id)}>Delete</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-medium">{value}</p>
    </div>
  );
}
