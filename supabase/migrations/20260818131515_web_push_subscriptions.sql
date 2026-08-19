CREATE TABLE IF NOT EXISTS public.web_push_subscriptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.web_push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Allow users to manage their own subscriptions
CREATE POLICY "Users can insert their own push subscriptions"
ON public.web_push_subscriptions FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own push subscriptions"
ON public.web_push_subscriptions FOR DELETE
USING (auth.uid() = user_id);

CREATE POLICY "Users can view their own push subscriptions"
ON public.web_push_subscriptions FOR SELECT
USING (auth.uid() = user_id);