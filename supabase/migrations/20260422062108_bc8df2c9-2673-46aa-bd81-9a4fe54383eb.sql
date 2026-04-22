-- ============= PROFILES =============
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Profiles viewable by owner"
  ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============= IMAGES TABLE UPDATES =============
ALTER TABLE public.images
  ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN expires_at TIMESTAMPTZ,
  ADD COLUMN revoked_at TIMESTAMPTZ,
  ADD COLUMN deleted_at TIMESTAMPTZ,
  ADD COLUMN download_count BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN bytes_downloaded BIGINT NOT NULL DEFAULT 0;

CREATE INDEX idx_images_user_id ON public.images(user_id);
CREATE INDEX idx_images_expires_at ON public.images(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX idx_images_deleted_at ON public.images(deleted_at) WHERE deleted_at IS NOT NULL;

-- Replace old public policies with stricter ones
DROP POLICY IF EXISTS "Public can read images" ON public.images;
DROP POLICY IF EXISTS "Public can insert images" ON public.images;

-- Anyone can view an image only if it's active
CREATE POLICY "Public can view active images"
  ON public.images FOR SELECT TO anon, authenticated
  USING (
    deleted_at IS NULL
    AND revoked_at IS NULL
    AND (expires_at IS NULL OR expires_at > now())
  );

-- Owners can also see their own images regardless of state (for dashboard)
CREATE POLICY "Owners can view own images"
  ON public.images FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Only authenticated users can upload, and must set themselves as owner
CREATE POLICY "Authenticated users can upload"
  ON public.images FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Owners can update (revoke / soft-delete) their own images
CREATE POLICY "Owners can update own images"
  ON public.images FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

-- ============= IMAGE DOWNLOADS (bandwidth tracking) =============
CREATE TABLE public.image_downloads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  image_id UUID NOT NULL REFERENCES public.images(id) ON DELETE CASCADE,
  ip_hash TEXT NOT NULL,
  bytes BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_image_downloads_image_id ON public.image_downloads(image_id);
CREATE INDEX idx_image_downloads_ip_created ON public.image_downloads(ip_hash, created_at);

ALTER TABLE public.image_downloads ENABLE ROW LEVEL SECURITY;
-- No public policies: only service role (server route) writes/reads this.

-- ============= UPLOAD ATTEMPTS (rate limiting) =============
CREATE TABLE public.upload_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_hash TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_upload_attempts_ip_created ON public.upload_attempts(ip_hash, created_at);

ALTER TABLE public.upload_attempts ENABLE ROW LEVEL SECURITY;
-- No public policies: server-only.

-- ============= STORAGE POLICIES =============
-- Drop any existing public-write policies on shared-images, recreate as auth-only insert
DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN
    SELECT polname FROM pg_policy
    WHERE polrelid = 'storage.objects'::regclass
      AND polname LIKE '%shared-images%'
  LOOP
    EXECUTE format('DROP POLICY %I ON storage.objects', pol.polname);
  END LOOP;
END $$;

-- Public can read files in shared-images bucket (we filter via DB row visibility)
CREATE POLICY "shared-images public read"
  ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'shared-images');

-- Only authenticated users may upload
CREATE POLICY "shared-images authenticated upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'shared-images');

-- Users may delete their own files (we'll mostly delete via service role)
CREATE POLICY "shared-images owner delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'shared-images' AND owner = auth.uid());