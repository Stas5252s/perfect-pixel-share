import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Upload, Check, Copy, ImagePlus, Sparkles } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Index,
});

const MAX_BYTES = 200 * 1024 * 1024; // 200 MB

function formatBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function Index() {
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((f: File) => {
    setError(null);
    setShareUrl(null);
    if (!f.type.startsWith("image/")) {
      setError("Please select an image file.");
      return;
    }
    if (f.size > MAX_BYTES) {
      setError(`File too large. Max 200 MB.`);
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

  const upload = async () => {
    if (!file) return;
    setUploading(true);
    setProgress(5);
    setError(null);

    try {
      const ext = file.name.split(".").pop() || "bin";
      const path = `${crypto.randomUUID()}.${ext}`;

      // Fake-progress while we wait (Supabase JS doesn't expose progress for storage)
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

      const { data: row, error: dbErr } = await supabase
        .from("images")
        .insert({
          storage_path: path,
          file_name: file.name,
          mime_type: file.type,
          size_bytes: file.size,
        })
        .select("id")
        .single();

      if (dbErr) throw dbErr;
      setProgress(100);

      const url = `${window.location.origin}/i/${row.id}`;
      setShareUrl(url);
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
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col px-6 py-12">
      <header className="mb-10 text-center">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-border bg-card/50 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
          <Sparkles className="size-3" />
          Lossless image sharing
        </div>
        <h1 className="bg-clip-text text-4xl font-bold tracking-tight text-transparent sm:text-5xl"
            style={{ backgroundImage: "var(--gradient-hero)" }}>
          Share images in 100% quality
        </h1>
        <p className="mt-3 text-muted-foreground">
          Upload an image, get a link. Anyone with the link sees and downloads the original — no compression, no resizing.
        </p>
      </header>

      {!shareUrl && (
        <section
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`relative overflow-hidden rounded-2xl border-2 border-dashed bg-card/40 p-8 backdrop-blur transition-all ${
            dragOver ? "border-primary shadow-[var(--shadow-glow)]" : "border-border"
          }`}
        >
          {!file ? (
            <div className="flex flex-col items-center text-center">
              <div className="mb-4 flex size-16 items-center justify-center rounded-2xl"
                   style={{ background: "var(--gradient-hero)" }}>
                <ImagePlus className="size-8 text-primary-foreground" />
              </div>
              <h2 className="text-lg font-semibold">Drop an image here</h2>
              <p className="mt-1 text-sm text-muted-foreground">or click below to choose a file (max 200 MB)</p>
              <Button className="mt-5" onClick={() => inputRef.current?.click()}>
                <Upload /> Choose image
              </Button>
              <input
                ref={inputRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              />
            </div>
          ) : (
            <div className="space-y-5">
              <div className="overflow-hidden rounded-xl border border-border bg-background/40">
                {previewUrl && (
                  <img src={previewUrl} alt="preview" className="mx-auto max-h-96 w-auto" />
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{file.name}</p>
                  <p className="text-muted-foreground">{formatBytes(file.size)} · {file.type}</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" onClick={reset} disabled={uploading}>Cancel</Button>
                  <Button onClick={upload} disabled={uploading}>
                    {uploading ? "Uploading…" : <><Upload /> Upload</>}
                  </Button>
                </div>
              </div>
              {uploading && <Progress value={progress} />}
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
          )}
        </section>
      )}

      {shareUrl && (
        <section className="rounded-2xl border border-border bg-card/60 p-8 text-center backdrop-blur"
                 style={{ boxShadow: "var(--shadow-elevated)" }}>
          <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-primary/15 text-primary">
            <Check className="size-7" />
          </div>
          <h2 className="text-2xl font-semibold">Your link is ready</h2>
          <p className="mt-1 text-sm text-muted-foreground">Anyone with this link can view and download the original.</p>

          <div className="mt-6 flex items-center gap-2 rounded-lg border border-border bg-background/60 p-2">
            <input
              readOnly
              value={shareUrl}
              className="w-full bg-transparent px-3 py-2 text-sm outline-none"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button onClick={copy} size="sm">
              {copied ? <><Check /> Copied</> : <><Copy /> Copy</>}
            </Button>
          </div>

          <div className="mt-6 flex justify-center gap-3">
            <Link to="/i/$id" params={{ id: shareUrl.split("/").pop()! }}>
              <Button variant="outline">Open link</Button>
            </Link>
            <Button variant="ghost" onClick={reset}>Upload another</Button>
          </div>
        </section>
      )}

      {error && !file && <p className="mt-4 text-center text-sm text-destructive">{error}</p>}
    </main>
  );
}
