import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { SiteHeader } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Check, Copy, CalendarIcon } from "lucide-react";
import { toast } from "sonner";
import { EXPIRATION_OPTIONS, presetToDate, formatBytes, type ExpirationPreset } from "@/lib/expiration";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  component: Index,
});

const MAX_BYTES = 200 * 1024 * 1024;

function Index() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expiration, setExpiration] = useState<ExpirationPreset>("7d");
  const [customDate, setCustomDate] = useState<Date>();
  const [customTime, setCustomTime] = useState("12:00");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((f: File) => {
    setError(null);
    setShareUrl(null);
    if (!f.type.startsWith("image/")) {
      setError("Please select an image file.");
      return;
    }
    if (f.size > MAX_BYTES) {
      setError("File too large. Max 200 MB.");
      return;
    }
    setFile(f);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(f));
  }, [previewUrl]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  const computeExpiresAt = (): Date | null => {
    if (expiration !== "custom") return presetToDate(expiration);
    if (!customDate) return null;
    const [hh, mm] = customTime.split(":").map(Number);
    const d = new Date(customDate);
    d.setHours(hh || 0, mm || 0, 0, 0);
    return d;
  };

  const upload = async () => {
    if (!file || !user) return;

    if (expiration === "custom") {
      const d = computeExpiresAt();
      if (!d || d.getTime() < Date.now() + 60 * 1000) {
        setError("Pick an expiration at least 1 minute in the future.");
        return;
      }
    }

    setUploading(true);
    setProgress(5);
    setError(null);

    try {
      // Server-side rate limit + attempt log
      const { data: sess } = await supabase.auth.getSession();
      const rlRes = await fetch("/api/upload-check", {
        method: "POST",
        headers: sess.session ? { Authorization: `Bearer ${sess.session.access_token}` } : {},
      });
      if (!rlRes.ok) {
        const j = await rlRes.json().catch(() => ({}));
        throw new Error(j.error || "Upload not allowed right now.");
      }

      const ext = file.name.split(".").pop() || "bin";
      const path = `${user.id}/${crypto.randomUUID()}.${ext}`;

      const fake = setInterval(() => {
        setProgress((p) => (p < 85 ? p + Math.random() * 8 : p));
      }, 200);

      const { error: upErr } = await supabase.storage
        .from("shared-images")
        .upload(path, file, {
          cacheControl: "31536000",
          contentType: file.type,
          upsert: false,
        });

      clearInterval(fake);
      if (upErr) throw upErr;
      setProgress(92);

      const expiresAt = computeExpiresAt();

      const { data: row, error: dbErr } = await supabase
        .from("images")
        .insert({
          storage_path: path,
          file_name: file.name,
          mime_type: file.type,
          size_bytes: file.size,
          user_id: user.id,
          expires_at: expiresAt ? expiresAt.toISOString() : null,
        })
        .select("id")
        .single();

      if (dbErr) throw dbErr;
      setProgress(100);

      setShareUrl(`${window.location.origin}/i/${row.id}`);
      toast.success("Upload complete");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
      setProgress(0);
    } finally {
      setUploading(false);
    }
  };

  const copy = async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const reset = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(null);
    setPreviewUrl(null);
    setShareUrl(null);
    setProgress(0);
    setError(null);
  };

  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex min-h-[calc(100vh-65px)] max-w-xl flex-col px-6 py-16">
        <header className="mb-10">
          <h1 className="text-2xl font-medium tracking-tight">Lossless</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Share images at original quality. No compression.
          </p>
        </header>

        {!authLoading && !user && (
          <div className="rounded-md border border-border p-6 text-center">
            <p className="text-sm">Sign in to upload and share images.</p>
            <Button className="mt-4" onClick={() => navigate({ to: "/auth" })}>Sign in</Button>
          </div>
        )}

        {user && !shareUrl && !file && (
          <section
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-md border border-dashed py-20 text-center transition-colors ${
              dragOver ? "border-foreground bg-muted" : "border-border hover:border-foreground/40"
            }`}
          >
            <p className="text-sm">Drop an image, or click to choose</p>
            <p className="mt-1 text-xs text-muted-foreground">Max 200 MB</p>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />
          </section>
        )}

        {user && file && !shareUrl && (
          <section className="space-y-5">
            <div className="overflow-hidden rounded-md border border-border">
              {previewUrl && <img src={previewUrl} alt="preview" className="mx-auto max-h-72 w-auto" />}
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Link expires</Label>
              <Select value={expiration} onValueChange={(v) => setExpiration(v as ExpirationPreset)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EXPIRATION_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {expiration === "custom" && (
                <div className="flex gap-2 pt-1">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className={cn("flex-1 justify-start font-normal", !customDate && "text-muted-foreground")}
                      >
                        <CalendarIcon className="mr-1" />
                        {customDate ? format(customDate, "PPP") : "Pick a date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar
                        mode="single"
                        selected={customDate}
                        onSelect={setCustomDate}
                        disabled={(d) => d < new Date(new Date().setHours(0, 0, 0, 0))}
                        initialFocus
                        className={cn("p-3 pointer-events-auto")}
                      />
                    </PopoverContent>
                  </Popover>
                  <Input
                    type="time"
                    value={customTime}
                    onChange={(e) => setCustomTime(e.target.value)}
                    className="w-28"
                  />
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate">{file.name}</p>
                <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={reset} disabled={uploading}>Cancel</Button>
                <Button size="sm" onClick={upload} disabled={uploading}>
                  {uploading ? "Uploading…" : "Upload"}
                </Button>
              </div>
            </div>
            {uploading && <Progress value={progress} />}
            {error && <p className="text-sm text-destructive">{error}</p>}
          </section>
        )}

        {shareUrl && (
          <section className="space-y-5">
            <div>
              <h2 className="text-base font-medium">Link ready</h2>
              <p className="mt-1 text-xs text-muted-foreground">Anyone with the link can view and download the original.</p>
            </div>

            <div className="flex items-center gap-2 rounded-md border border-border">
              <input
                readOnly
                value={shareUrl}
                className="w-full bg-transparent px-3 py-2 text-sm outline-none"
                onFocus={(e) => e.currentTarget.select()}
              />
              <Button onClick={copy} size="sm" variant="ghost" className="mr-1">
                {copied ? <Check /> : <Copy />}
              </Button>
            </div>

            <div className="flex gap-2">
              <Link to="/i/$id" params={{ id: shareUrl.split("/").pop()! }}>
                <Button size="sm" variant="outline">Open</Button>
              </Link>
              <Button size="sm" variant="ghost" onClick={reset}>Upload another</Button>
              <Link to="/dashboard">
                <Button size="sm" variant="ghost">Manage</Button>
              </Link>
            </div>
          </section>
        )}
      </main>
    </>
  );
}
