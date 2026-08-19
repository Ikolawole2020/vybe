-- Enable pg_net extension if not already enabled (used to make async HTTP requests)
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Function to dispatch web push on new notification
CREATE OR REPLACE FUNCTION public.handle_new_notification_push()
RETURNS TRIGGER AS $$
DECLARE
  v_supabase_url TEXT := 'https://lbppjcyzgrkhtygbporq.supabase.co';
  v_anon_key TEXT := 'YOUR_ANON_OR_SERVICE_ROLE_KEY';
  v_actor_name TEXT := 'Someone';
  v_title TEXT := 'Vybe';
  v_body TEXT := 'You have a new update';
  v_url TEXT := '/notifications';
BEGIN
  -- Get actor display name
  SELECT COALESCE(name, 'Someone') INTO v_actor_name
  FROM public.profiles
  WHERE id = NEW.actor_id;

  -- Customize body per notification type
  IF NEW.type = 'like' THEN
    v_body := v_actor_name || ' liked your post';
  ELSIF NEW.type = 'boost' THEN
    v_body := v_actor_name || ' reposted your post';
  ELSIF NEW.type = 'comment' OR NEW.type = 'reply' THEN
    v_body := v_actor_name || ' replied to your post';
  ELSIF NEW.type = 'follow' THEN
    v_body := v_actor_name || ' started following you';
  ELSIF NEW.type = 'post' THEN
    v_body := v_actor_name || ' posted something new';
  ELSIF NEW.type = 'profile_view' THEN
    v_body := v_actor_name || ' viewed your profile';
  END IF;

  IF NEW.post_id IS NOT NULL THEN
    v_url := '/post/' || NEW.post_id::text;
  END IF;

  -- Call the send-push Edge Function via pg_net async HTTP request
  PERFORM net.http_post(
    url := v_supabase_url || '/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'recipientId', NEW.user_id,
      'title', v_title,
      'body', v_body,
      'url', v_url
    )
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger on notifications table
DROP TRIGGER IF EXISTS on_notification_created_push ON public.notifications;
CREATE TRIGGER on_notification_created_push
AFTER INSERT ON public.notifications
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_notification_push();